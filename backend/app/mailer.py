import base64
import hashlib
import logging
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import formataddr, getaddresses

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 20


class MailError(Exception):
    pass


def _fernet() -> Fernet:
    digest = hashlib.sha256(("smtp-password:" + settings.SECRET_KEY).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt(token: str | None) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise MailError("The saved mail password can no longer be read (the server's "
                        "secret key has changed). Enter the password again and save.")


def split_addresses(value: str | None) -> list[str]:
    raw = (value or "").replace(";", ",")
    out: list[str] = []
    for _, addr in getaddresses([raw]):
        addr = addr.strip()
        if addr and addr.lower() not in {a.lower() for a in out}:
            out.append(addr)
    return out


def configured(cfg) -> bool:
    return bool(cfg and cfg.smtp_host and (cfg.from_address or cfg.smtp_username))


def send(cfg, to: list[str], subject: str, text: str, html: str | None = None,
         cc: list[str] | None = None, attachments: list[tuple] | None = None) -> None:
    if not configured(cfg):
        raise MailError("Email is not set up -- add the mail server and sender on "
                        "Master Data > Notifications.")
    recipients = [a for a in to if a]
    if not recipients:
        raise MailError("There is no one to send this to.")

    sender = cfg.from_address or cfg.smtp_username
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("IT Asset Engine", sender))
    msg["To"] = ", ".join(recipients)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    for name, data, maintype, subtype in attachments or []:
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)

    host, port = cfg.smtp_host.strip(), int(cfg.smtp_port or 587)
    security = (cfg.smtp_security or "starttls").lower()
    password = decrypt(cfg.smtp_password_enc)
    context = ssl.create_default_context()
    try:
        if security == "ssl":
            server = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
        with server:
            server.ehlo()
            if security == "starttls":
                server.starttls(context=context)
                server.ehlo()
            if cfg.smtp_username:
                server.login(cfg.smtp_username, password)
            server.send_message(msg, from_addr=sender, to_addrs=recipients + list(cc or []))
    except smtplib.SMTPAuthenticationError as exc:
        raise MailError("The mail server refused the login. Check the username and "
                        "password -- and, for Microsoft 365, that SMTP AUTH is allowed "
                        f"for this mailbox. ({_short(exc)})") from exc
    except smtplib.SMTPRecipientsRefused as exc:
        raise MailError(f"The mail server refused the recipient address. ({_short(exc)})") from exc
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        raise MailError(f"Could not send through {host}:{port} -- {_short(exc)}") from exc


def _short(exc: Exception) -> str:
    text = str(exc) or exc.__class__.__name__
    return text if len(text) <= 200 else text[:199] + "…"


def run_in_background(fn, *args, **kwargs) -> None:
    def work():
        try:
            fn(*args, **kwargs)
        except Exception:  # noqa: BLE001 -- a background job must never kill the thread silently
            logger.exception("Background email job failed")

    threading.Thread(target=work, daemon=True).start()

