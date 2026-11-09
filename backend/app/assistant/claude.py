import logging

try:
    import anthropic
except ImportError:  # pragma: no cover - depends on the environment
    anthropic = None

from app.assistant import control
from app.assistant import tools as T
from app.assistant.prompt import SYSTEM_PROMPT
from app.assistant.reply import Reply, ToolCall
from app.core.config import settings

logger = logging.getLogger(__name__)

NAME = control.ANTHROPIC

FALLBACK_BETA = "server-side-fallback-2026-07-01"
BETAS = [FALLBACK_BETA, "thinking-binding-controls-2026-08-01"]

LEGACY_MODEL_PREFIXES = ("claude-haiku-4-5",)

TEST_TIMEOUT_SECONDS = 20.0

# One client per (key, address): a key changed in Admin controls gets a fresh
# client on the next question, without a restart.
_client = None
_client_for = None


def model() -> str:
    return control.current().claude_model


def _api_key() -> str:
    return control.current().anthropic_key


def _legacy(name: str | None = None) -> bool:
    return str(name or model()).startswith(LEGACY_MODEL_PREFIXES)


def available() -> bool:
    return anthropic is not None


def configured() -> bool:
    return bool(_api_key() or settings.ASSISTANT_BASE_URL)


def errors() -> tuple:
    return (anthropic.APIError,) if anthropic is not None else ()


def _new_client(api_key: str, **options):
    kwargs = dict(options)
    if settings.ASSISTANT_BASE_URL:
        kwargs["base_url"] = settings.ASSISTANT_BASE_URL
    kwargs["api_key"] = api_key or "local-stand-in"
    return anthropic.Anthropic(**kwargs)


def client():
    global _client, _client_for
    wanted = (_api_key(), settings.ASSISTANT_BASE_URL)
    if _client is None or _client_for != wanted:
        _client = _new_client(wanted[0], timeout=120.0, max_retries=2)
        _client_for = wanted
    return _client


def reset_client():
    global _client, _client_for
    _client = None
    _client_for = None


def test(api_key: str, model_id: str) -> str:
    """Check that the key is accepted and can see the model. Uses the Models
    API, so it costs no tokens. Returns the model's display name."""
    info = _new_client(api_key, timeout=TEST_TIMEOUT_SECONDS, max_retries=0).models.retrieve(model_id)
    return getattr(info, "display_name", None) or getattr(info, "id", None) or model_id


def explain_test(exc: Exception, model_id: str) -> str:
    if anthropic is None:
        return "The anthropic package is not installed on the server (pip install -r requirements.txt)."
    if isinstance(exc, anthropic.AuthenticationError):
        return "Anthropic refused the API key. Check that it was pasted whole and is still active."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return f"This API key is not allowed to use {model_id}."
    if isinstance(exc, anthropic.NotFoundError):
        return f"Anthropic has no model called {model_id!r} for this key. Check the model ID."
    if isinstance(exc, anthropic.RateLimitError):
        return "The key works, but Anthropic is rate-limiting it right now. Try again in a minute."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach Anthropic from the server. Check its internet access and firewall."
    if isinstance(exc, anthropic.APIStatusError):
        return f"Anthropic answered with an error ({exc.status_code}). Try again shortly."
    return "The connection test failed."


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
        return ("The AI assistant is not set up correctly -- the Claude model set in Admin controls "
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

