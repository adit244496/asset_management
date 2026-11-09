"""The AI assistant's set-up: which provider, which model, and the API keys.

A superadmin manages it under Admin controls (app/api/admin.py); it is kept in
the `assistant_settings` table, one row. API keys are stored encrypted with a
key derived from SECRET_KEY and are never returned to the browser.

Keys come only from here. On the very first start the row is created and any
keys in backend/.env are copied in, once. After that .env keys are ignored,
so removing a key in Admin controls switches the assistant off for good --
a restart cannot bring it back from .env.

Reads are cached for a few seconds; a save clears the cache at once, so a
change applies on the next question without restarting the backend.
"""
import base64
import hashlib
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.database import SessionLocal
from app.models import AssistantSettings

logger = logging.getLogger(__name__)

GEMINI = "gemini"
ANTHROPIC = "anthropic"
PROVIDERS = (GEMINI, ANTHROPIC)
PROVIDER_LABELS = {GEMINI: "Google Gemini", ANTHROPIC: "Anthropic Claude"}
DEFAULT_MODELS = {GEMINI: "gemini-3.8-flash", ANTHROPIC: "claude-opus-5-5"}

CACHE_SECONDS = 5
MAX_KEY_CHARS = 500
MAX_MODEL_CHARS = 100
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]*$")


@dataclass(frozen=True)
class Config:
    provider: str
    gemini_model: str
    claude_model: str
    gemini_key: str = ""
    anthropic_key: str = ""

    def key_for(self, provider: str) -> str:
        return self.anthropic_key if provider == ANTHROPIC else self.gemini_key

    def model_for(self, provider: str) -> str:
        return self.claude_model if provider == ANTHROPIC else self.gemini_model


OFF = Config(provider=GEMINI, gemini_model=DEFAULT_MODELS[GEMINI],
             claude_model=DEFAULT_MODELS[ANTHROPIC])

_lock = threading.Lock()
_cache: Config | None = None
_cached_at = 0.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fernet() -> Fernet:
    digest = hashlib.sha256(("assistant-api-key:" + settings.SECRET_KEY).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt(token: str | None) -> str | None:
    """The key, "" when none is saved, or None when one is saved but can no
    longer be read (SECRET_KEY changed)."""
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def invalidate() -> None:
    global _cache, _cached_at
    with _lock:
        _cache = None
        _cached_at = 0.0


def _config_of(row: AssistantSettings | None) -> Config:
    if row is None:
        return OFF
    provider = row.provider if row.provider in PROVIDERS else GEMINI
    return Config(
        provider=provider,
        gemini_model=row.gemini_model or DEFAULT_MODELS[GEMINI],
        claude_model=row.claude_model or DEFAULT_MODELS[ANTHROPIC],
        gemini_key=decrypt(row.gemini_key_enc) or "",
        anthropic_key=decrypt(row.anthropic_key_enc) or "",
    )


def current() -> Config:
    """The set-up in force now (cached for CACHE_SECONDS)."""
    global _cache, _cached_at
    with _lock:
        if _cache is not None and time.monotonic() - _cached_at < CACHE_SECONDS:
            return _cache
    try:
        with SessionLocal() as db:
            cfg = _config_of(db.get(AssistantSettings, 1))
    except Exception:  # noqa: BLE001 -- the assistant must not take a page down with it
        logger.exception("Could not read the assistant settings")
        with _lock:
            return _cache or OFF
    with _lock:
        _cache, _cached_at = cfg, time.monotonic()
    return cfg


def get_row(db) -> AssistantSettings:
    row = db.get(AssistantSettings, 1)
    if row is None:
        ensure_settings(db)
        row = db.get(AssistantSettings, 1)
    return row


def ensure_settings(db) -> list[str] | None:
    """Create the settings row on the first start, copying the .env set-up
    in once. Returns the providers whose key was copied, or None when the row
    already existed (then .env is not looked at)."""
    if db.get(AssistantSettings, 1) is not None:
        return None
    provider = settings.ASSISTANT_PROVIDER if settings.ASSISTANT_PROVIDER in PROVIDERS else GEMINI
    row = AssistantSettings(
        id=1,
        provider=provider,
        gemini_model=(settings.GEMINI_MODEL or DEFAULT_MODELS[GEMINI]).strip()[:MAX_MODEL_CHARS],
        claude_model=(settings.ASSISTANT_MODEL or DEFAULT_MODELS[ANTHROPIC]).strip()[:MAX_MODEL_CHARS],
        imported_from_env=True,
        updated_by="backend/.env (first start)",
    )
    copied = []
    now = _utcnow()
    if settings.GEMINI_API_KEY.strip():
        row.gemini_key_enc = encrypt(settings.GEMINI_API_KEY.strip())
        row.gemini_key_set_at = now
        copied.append(GEMINI)
    if settings.ANTHROPIC_API_KEY.strip():
        row.anthropic_key_enc = encrypt(settings.ANTHROPIC_API_KEY.strip())
        row.anthropic_key_set_at = now
        copied.append(ANTHROPIC)
    db.add(row)
    try:
        db.commit()
    except Exception:  # noqa: BLE001 -- another process created it first
        db.rollback()
        return None
    invalidate()
    return copied


def _clean_model(value, label: str, errors: list) -> str | None:
    model = str(value or "").strip()
    if not model:
        errors.append(f"Enter the {label} model.")
        return None
    if len(model) > MAX_MODEL_CHARS or not MODEL_RE.match(model):
        errors.append(f"The {label} model name is not valid -- use the model ID, like "
                      f"{DEFAULT_MODELS[GEMINI] if label == 'Gemini' else DEFAULT_MODELS[ANTHROPIC]}.")
        return None
    return model


def clean_key(value) -> tuple[str, str | None]:
    key = str(value or "").strip()
    if not key:
        return "", None
    if len(key) > MAX_KEY_CHARS or any(ch.isspace() for ch in key):
        return "", "That does not look like an API key -- paste it again, without spaces."
    return key, None


def update(db, data: dict, username: str) -> tuple[AssistantSettings, list[str], list[str]]:
    """Apply a save from Admin controls. Returns (row, errors, what changed).
    A blank key field leaves the saved key alone."""
    row = get_row(db)
    errors: list[str] = []
    changed: list[str] = []

    if "provider" in data:
        provider = str(data.get("provider") or "").strip().lower()
        if provider not in PROVIDERS:
            errors.append("Choose Gemini or Claude.")
        elif provider != row.provider:
            changed.append(f"provider {PROVIDER_LABELS.get(row.provider, row.provider)} → "
                           f"{PROVIDER_LABELS[provider]}")
            row.provider = provider
    for field, attr, label in (("geminiModel", "gemini_model", "Gemini"),
                               ("claudeModel", "claude_model", "Claude")):
        if field in data:
            model = _clean_model(data.get(field), label, errors)
            if model and model != getattr(row, attr):
                changed.append(f"{label} model {getattr(row, attr) or '(none)'} → {model}")
                setattr(row, attr, model)
    for field, provider in (("geminiApiKey", GEMINI), ("anthropicApiKey", ANTHROPIC)):
        key, problem = clean_key(data.get(field))
        if problem:
            errors.append(problem)
        elif key:
            set_key(row, provider, key)
            changed.append(f"new {PROVIDER_LABELS[provider]} API key")

    if errors:
        db.rollback()
        return row, errors, []
    if changed:
        row.updated_by = username
        db.commit()
        invalidate()
    return row, [], changed


def set_key(row: AssistantSettings, provider: str, key: str | None) -> None:
    enc = encrypt(key) if key else None
    when = _utcnow() if key else None
    if provider == ANTHROPIC:
        row.anthropic_key_enc, row.anthropic_key_set_at = enc, when
    else:
        row.gemini_key_enc, row.gemini_key_set_at = enc, when


def remove_key(db, provider: str, username: str) -> tuple[AssistantSettings, bool]:
    row = get_row(db)
    had = bool(row.anthropic_key_enc if provider == ANTHROPIC else row.gemini_key_enc)
    if had:
        set_key(row, provider, None)
        row.updated_by = username
        db.commit()
        invalidate()
    return row, had


def _iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def key_state(row: AssistantSettings, provider: str) -> dict:
    enc = row.anthropic_key_enc if provider == ANTHROPIC else row.gemini_key_enc
    saved_at = row.anthropic_key_set_at if provider == ANTHROPIC else row.gemini_key_set_at
    return {
        "saved": bool(enc),
        # False when SECRET_KEY changed since it was saved: enter it again.
        "readable": decrypt(enc) is not None,
        "savedAt": _iso(saved_at) if enc else None,
    }


def public(row: AssistantSettings) -> dict:
    """What Admin controls shows. Never includes a key."""
    return {
        "provider": row.provider if row.provider in PROVIDERS else GEMINI,
        "providers": [{"key": p, "label": PROVIDER_LABELS[p], "defaultModel": DEFAULT_MODELS[p]}
                      for p in PROVIDERS],
        "geminiModel": row.gemini_model or DEFAULT_MODELS[GEMINI],
        "claudeModel": row.claude_model or DEFAULT_MODELS[ANTHROPIC],
        "keys": {GEMINI: key_state(row, GEMINI), ANTHROPIC: key_state(row, ANTHROPIC)},
        "importedFromEnv": bool(row.imported_from_env),
        "updatedBy": row.updated_by,
        "updatedAt": _iso(row.updated_at),
    }
