import json
import logging
from datetime import datetime, timezone

from app import roles
from app.assistant import claude, gemini
from app.assistant import tools as T
from app.assistant.reply import Reply, ToolCall  # noqa: F401 -- re-exported for providers/tests
from app.core.config import settings
from app.datefmt import now_ist

logger = logging.getLogger(__name__)

PROVIDERS = {claude.NAME: claude, gemini.NAME: gemini}

MAX_TOOL_ROUNDS = 8
MAX_QUESTION_CHARS = 2000
MAX_TURNS = 8
IDLE_MINUTES = 30

MODE_ANSWER = "answer"
MODE_CHANGES = "changes"
MODES = (MODE_ANSWER, MODE_CHANGES)

MODE_TEXT = {
    MODE_ANSWER: "Answer only -- look things up and explain; propose_change is switched off.",
    MODE_CHANGES: "Can make changes -- you may use propose_change; every change still "
                  "needs the person's confirmation before anything happens.",
}


class AssistantError(Exception):
    pass


def provider():
    return PROVIDERS.get(settings.ASSISTANT_PROVIDER, gemini)


def ai_enabled() -> bool:
    p = provider()
    return p.available() and p.configured()


def model_name() -> str:
    return provider().model()


def effective_mode(user, requested: str) -> str:
    if requested == MODE_CHANGES and roles.can_write(user.role):
        return MODE_CHANGES
    return MODE_ANSWER


def context_note(user, mode: str) -> str:
    today = now_ist().strftime("%d %b %Y (%Y-%m-%d), %H:%M IST")
    return (
        f"Signed in: {user.full_name or user.username} (username {user.username}), "
        f"profile {user.role}. Today is {today}. Assistant mode: {MODE_TEXT[mode]}"
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compatible(conversation) -> bool:
    return provider().compatible(json.loads(conversation.transcript or "[]"))


def usable(conversation) -> bool:
    return (conversation.turns or 0) < MAX_TURNS and compatible(conversation)


def run_turn(db, user, conversation, question: str) -> list[dict]:
    question = (question or "").strip()
    if not question:
        raise AssistantError("Type a question first.")
    if len(question) > MAX_QUESTION_CHARS:
        raise AssistantError(f"That is too long -- keep it under {MAX_QUESTION_CHARS} characters.")
    if conversation.turns >= MAX_TURNS:
        raise AssistantError("This conversation is getting long. Start a new one to keep answers fast.")
    if not compatible(conversation):
        raise AssistantError("This conversation was started with a different AI model. "
                             "Start a new one with the + button.")

    p = provider()
    transcript = json.loads(conversation.transcript or "[]")
    pending = json.loads(conversation.pending_notes or "[]")
    mode = effective_mode(user, conversation.mode)

    notes = ([context_note(user, mode)] if conversation.turns == 0 else []) + pending
    transcript.extend(p.user_turn(question, notes))

    ctx = T.ToolContext(db=db, user=user, conversation=conversation, mode=mode)
    answer, notice = "", None

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            reply = p.call(transcript, conversation.id)
            transcript.extend(reply.stored)

            if reply.stop == "refusal":
                notice = "The assistant cannot help with that request."
                break
            if reply.stop == "tool_use" and reply.tool_calls:
                results = [(c, *T.run(ctx, c.name, c.args)) for c in reply.tool_calls]
                transcript.append(p.tool_results(results))
                continue

            answer = reply.text
            if reply.stop == "max_tokens":
                notice = "The answer was cut short. Ask a narrower question for the rest."
            break
        else:
            notice = "That needed too many steps to answer. Try a narrower question."
    except p.errors() as exc:
        logger.warning("Assistant request (%s) failed for %s: %s", p.NAME, user.username, exc)
        raise AssistantError(p.explain(exc)) from exc

    at = _now()
    items = [{"type": "user", "text": question, "at": at}]
    if answer:
        items.append({"type": "assistant", "text": answer, "at": at})
    for card in ctx.cards:
        items.append({**card, "at": at})
    for proposal in ctx.proposals:
        items.append(proposal_item(proposal))
    if notice:
        items.append({"type": "notice", "text": notice, "at": at})
    if not answer and not ctx.proposals and not ctx.cards and not notice:
        items.append({"type": "notice", "text": "No answer came back. Try rephrasing.", "at": at})

    display = json.loads(conversation.display or "[]")
    conversation.transcript = json.dumps(transcript)
    conversation.display = json.dumps(display + items)
    conversation.pending_notes = "[]"
    conversation.turns = (conversation.turns or 0) + 1
    return items


def proposal_item(p) -> dict:
    return {
        "type": "proposal",
        "id": p.id,
        "kind": p.kind,
        "register": p.register,
        "record": p.record_label,
        "reason": p.reason,
        "diff": json.loads(p.diff or "[]"),
        "method": p.method,
        "path": p.path,
        "payload": json.loads(p.payload or "{}"),
        "status": p.status,
        "detail": p.outcome_detail,
    }


def queue_note(conversation, text: str):
    notes = json.loads(conversation.pending_notes or "[]")
    notes.append(text)
    conversation.pending_notes = json.dumps(notes)

