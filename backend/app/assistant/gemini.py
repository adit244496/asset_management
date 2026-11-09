import json
import logging

try:
    import httpx
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types
except ImportError:  # pragma: no cover - depends on the environment
    genai = None

from app.assistant import control
from app.assistant import tools as T
from app.assistant.prompt import SYSTEM_PROMPT
from app.assistant.reply import Reply, ToolCall
from app.core.config import settings

logger = logging.getLogger(__name__)

NAME = control.GEMINI

MAX_OUTPUT_TOKENS = 8192

TEST_TIMEOUT_MS = 20_000

_BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION",
            "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"}

# One client per (key, address): a key changed in Admin controls gets a fresh
# client on the next question, without a restart.
_client = None
_client_for = None
_config = None


def model() -> str:
    return control.current().gemini_model


def _api_key() -> str:
    return control.current().gemini_key


def available() -> bool:
    return genai is not None


def configured() -> bool:
    return bool(_api_key() or settings.GEMINI_BASE_URL)


def errors() -> tuple:
    return (genai_errors.APIError, httpx.HTTPError) if genai is not None else ()


def _new_client(api_key: str, timeout_ms: int):
    options = {"timeout": timeout_ms}
    if settings.GEMINI_BASE_URL:
        options["base_url"] = settings.GEMINI_BASE_URL
    return genai.Client(api_key=api_key or "local-stand-in",
                        http_options=types.HttpOptions(**options))


def client():
    global _client, _client_for
    wanted = (_api_key(), settings.GEMINI_BASE_URL)
    if _client is None or _client_for != wanted:
        _client = _new_client(wanted[0], 120_000)
        _client_for = wanted
    return _client


def reset_client():
    global _client, _client_for, _config
    _client = None
    _client_for = None
    _config = None


def test(api_key: str, model_id: str) -> str:
    """Check that the key is accepted and can see the model. Looks the model
    up, so it costs no tokens. Returns the model's display name."""
    info = _new_client(api_key, TEST_TIMEOUT_MS).models.get(model=model_id)
    return getattr(info, "display_name", None) or model_id


def explain_test(exc: Exception, model_id: str) -> str:
    if genai is None:
        return "The google-genai package is not installed on the server (pip install -r requirements.txt)."
    if isinstance(exc, genai_errors.APIError):
        code = getattr(exc, "code", 0) or 0
        message = (getattr(exc, "message", "") or str(exc)).lower()
        if code in (401, 403) or (code == 400 and "api key" in message):
            return "Google refused the API key. Check that it was pasted whole and is still active."
        if code == 404:
            return f"Gemini has no model called {model_id!r} for this key. Check the model ID."
        if code == 429:
            return "The key works, but it has reached its usage limit or is busy. Try again in a minute."
        return f"Google answered with an error ({code}). Try again shortly."
    if isinstance(exc, httpx.HTTPError):
        return "Could not reach Google from the server. Check its internet access and firewall."
    return "The connection test failed."


def config():
    global _config
    if _config is None:
        declarations = [
            types.FunctionDeclaration(
                name=t["name"],
                description=t["description"],
                parameters_json_schema=t["input_schema"],
            )
            for t in T.TOOLS
        ]
        _config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[types.Tool(function_declarations=declarations)],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            max_output_tokens=MAX_OUTPUT_TOKENS,
        )
    return _config


def user_turn(question: str, notes: list[str]) -> list[dict]:
    parts = [{"text": question}]
    if notes:
        parts.append({"text": "<app_note>\n" + "\n".join(notes) + "\n</app_note>"})
    return [{"role": "user", "parts": parts}]


def tool_results(results) -> dict:
    parts = []
    for call, content, is_error in results:
        if is_error:
            response = {"error": content}
        else:
            try:
                response = {"result": json.loads(content)}
            except (TypeError, ValueError):
                response = {"result": content}
        fr = {"name": call.name, "response": response}
        if call.id:
            fr["id"] = call.id
        parts.append({"function_response": fr})
    return {"role": "user", "parts": parts}


def compatible(transcript: list[dict]) -> bool:
    return all("parts" in m for m in transcript)


def call(transcript: list[dict], conversation_id: str) -> Reply:
    contents = [types.Content.model_validate(m) for m in transcript]
    response = client().models.generate_content(model=model(), contents=contents, config=config())

    candidate = (response.candidates or [None])[0]
    finish = getattr(getattr(candidate, "finish_reason", None), "name", None) or ""
    blocked = bool(getattr(response.prompt_feedback, "block_reason", None)) or finish in _BLOCKED
    content = getattr(candidate, "content", None)

    if content is None or not content.parts:
        return Reply(stored=[{"role": "model", "parts": [{"text": "(no answer)"}]}],
                     stop="refusal" if blocked else ("max_tokens" if finish == "MAX_TOKENS" else "end"))

    stored = content.model_dump(mode="json", exclude_none=True)
    stored["role"] = "model"
    calls = [ToolCall(id=p.function_call.id, name=p.function_call.name,
                      args=dict(p.function_call.args or {}))
             for p in content.parts if p.function_call is not None]
    text = "".join(p.text for p in content.parts if p.text and not p.thought).strip()

    if calls:
        stop = "tool_use"
    elif blocked:
        stop = "refusal"
    elif finish == "MAX_TOKENS":
        stop = "max_tokens"
    else:
        stop = "end"
    return Reply(stored=[stored], tool_calls=calls, text=text, stop=stop)


def explain(exc: Exception) -> str:
    if genai is None:
        return "The AI assistant is not available on this server."
    if isinstance(exc, genai_errors.APIError):
        code = getattr(exc, "code", 0) or 0
        message = (getattr(exc, "message", "") or str(exc)).lower()
        if code in (401, 403) or (code == 400 and "api key" in message):
            return ("The AI assistant is not set up correctly -- its Gemini API key was refused. "
                    "Tell your administrator.")
        if code == 404:
            return ("The AI assistant is not set up correctly -- the Gemini model set in Admin controls "
                    f"({model()}) is not available to this Gemini API key. Tell your administrator.")
        if code == 429:
            return ("The AI assistant has reached its usage limit or is busy right now. "
                    "Try again in a minute.")
        if code >= 500:
            return "The AI service had a problem answering. Try again shortly."
    if isinstance(exc, httpx.HTTPError):
        return "The AI assistant could not be reached. Check the internet connection and try again."
    return "The AI assistant could not answer that. Try rephrasing, or start a new conversation."

