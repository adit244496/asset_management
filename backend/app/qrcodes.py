from typing import Any, Optional

import segno

from app.models import Asset

ERROR_LEVEL = "m"

MAX_CODES = 250

MAX_FREE_TEXT = 80


def _line(label: str, value: Any, limit: Optional[int] = None) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return f"{label}{text}"


def qr_payload(asset: Asset) -> str:
    parts = [
        _line("", asset.asset_id),
        _line("", asset.model, MAX_FREE_TEXT),
        _line("Srl: ", asset.srl),
        _line("Tag: ", asset.service_tag),
        _line("Type: ", asset.type),
        _line("PO: ", asset.po_no),
        _line("DOP: ", asset.dop),
        _line("Wty: ", asset.warranty_end),
        _line("Notes: ", asset.comments, MAX_FREE_TEXT),
    ]
    return "\n".join(p for p in parts if p)


def qr_svg_data_uri(payload: str) -> str:
    return segno.make(payload, error=ERROR_LEVEL).svg_data_uri(scale=1, border=0)


def asset_qr_dict(asset: Asset) -> dict[str, Any]:
    payload = qr_payload(asset)
    code = segno.make(payload, error=ERROR_LEVEL)
    return {
        "assetPk": asset.id,
        "assetId": asset.asset_id,
        "assetTag": asset.asset_tag,
        "model": asset.model,
        "srl": asset.srl,
        "serviceTag": asset.service_tag,
        "site": asset.site,
        "user": asset.user,
        "payload": payload,
        "svg": code.svg_data_uri(scale=1, border=0),
        "version": code.version,
        "modules": 17 + 4 * code.version if isinstance(code.version, int) else None,
    }

