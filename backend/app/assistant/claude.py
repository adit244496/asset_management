import logging

try:
    import anthropic
except ImportError:  # pragma: no cover - depends on the environment
    anthropic = None

from app.assistant import tools as T
from app.assistant.prompt import SYSTEM_PROMPT
from app.assistant.reply import Reply, ToolCall
from app.core.config import settings

logger = logging.getLogger(__name__)

NAME = "anthropic"

FALLBACK_BETA = "server-side-fallback-2026-07-01"
BETAS = [FALLBACK_BETA, "thinking-binding-controls-2026-08-01"]

LEGACY_MODEL_PREFIXES = ("claude-haiku-4-5",)

_client = None


def model() -> str:
    return settings.ASSISTANT_MODEL


def _legacy(name: str | None = None) -> bool:
    return str(name or model()).startswith(LEGACY_MODEL_PREFIXES)


def available() -> bool:
    return anthropic is not None


def configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY or settings.ASSISTANT_BASE_URL)


def errors() -> tuple:
    return (anthropic.APIError,) if anthropic is not None else ()


def client():
    global _client
    if _client is None:
        kwargs = {"timeout": 120.0, "max_retries": 2}
        if settings.ASSISTANT_BASE_URL:
            kwargs["base_url"] = settings.ASSISTANT_BASE_URL
        if settings.ANTHROPIC_API_KEY:
            kwargs["api_key"] = settings.ANTHROPIC_API_KEY
        elif settings.ASSISTANT_BASE_URL:
            kwargs["api_key"] = "local-stand-in"
        _client = anthropic.Anthropic(**kwargs)
    return _client


def reset_client():
    global _client
    _client = None


def user_turn(question: str, notes: list[str]) -> list[dict]:
    if not notes:
        return [{"role": "user", "content": question}]
    if _legacy():
        return [{"role": "user", "content": [
            {"type": "text", "text": question},
            {"type": "text", "text": "<app_note>\n" + "\n".join(notes) + "\n</app_note>"},
        ]}]
    return [{"role": "user", "content": question},
            {"role": "system", "content": "\n".join(notes)}]


def tool_results(results) -> dict:
    blocks = []
    for call, content, is_error in results:
        block = {"type": "tool_result", "tool_use_id": call.id, "content": content}
        if is_error:
            block["is_error"] = True
        blocks.append(block)
    return {"role": "user", "content": blocks}


def compatible(transcript: list[dict]) -> bool:
    if any("content" not in m for m in transcript):
        return False
    if _legacy():
        return not any(m.get("role") == "system" for m in transcript)
    return True


def call(transcript: list[dict], conversation_id: str) -> Reply:
    kwargs = dict(
        model=model(),
        system=SYSTEM_PROMPT,
        tools=T.TOOLS,
        messages=transcript,
        cache_control={"type": "ephemeral"},
        fallbacks="default",
    )
    if _legacy():
        kwargs.update(max_tokens=4096, betas=[FALLBACK_BETA])
    else:
        kwargs.update(
            max_tokens=16000,
            thinking={"type": "adaptive",
                      "block_binding": {"prefix_mismatch_behavior": "drop_block"}},
            output_config={"effort": settings.ASSISTANT_EFFORT},
            betas=BETAS,
        )
    response = client().beta.messages.create(**kwargs)
    _report_drops(response, conversation_id)

    stop = {"tool_use": "tool_use", "max_tokens": "max_tokens",
            "refusal": "refusal"}.get(response.stop_reason, "end")
    return Reply(
        stored=[{"role": "assistant", "content": [b.to_dict() for b in response.content]}],
        tool_calls=[ToolCall(id=b.id, name=b.name, args=b.input)
                    for b in response.content if b.type == "tool_use"],
        text="".join(b.text for b in response.content if b.type == "text").strip(),
        stop=stop,
    )


def _report_drops(response, conversation_id: str):
    for t in getattr(response, "input_transformations", None) or []:
        if getattr(t, "type", None) == "thinking_dropped" and getattr(t, "reason", None) == "prefix_binding_mismatch":
            logger.warning("Assistant conversation %s: earlier reasoning dropped "
                           "(history changed at %s).", conversation_id, getattr(t, "path", "?"))


def explain(exc: Exception) -> str:
    if anthropic is None:
        return "The AI assistant is not available on this server."
    if isinstance(exc, anthropic.AuthenticationError):
        return "The AI assistant is not set up correctly -- its API key was refused. Tell your administrator."
    if isinstance(exc, anthropic.NotFoundError):
        return ("The AI assistant is not set up correctly -- the model named in ASSISTANT_MODEL "
                f"({model()}) does not exist. Tell your administrator.")
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "The AI assistant's API key is not allowed to use this model. Tell your administrator."
    if isinstance(exc, anthropic.RateLimitError):
        return "The AI assistant is busy right now. Try again in a minute."
    if isinstance(exc, anthropic.APIConnectionError):
        return "The AI assistant could not be reached. Check the internet connection and try again."
    if isinstance(exc, anthropic.APIStatusError) and exc.status_code >= 500:
        return "The AI service had a problem answering. Try again shortly."
    return "The AI assistant could not answer that. Try rephrasing, or start a new conversation."

