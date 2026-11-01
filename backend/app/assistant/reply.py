from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolCall:
    id: Optional[str]
    name: str
    args: dict[str, Any]


@dataclass
class Reply:
    stored: list[dict]
    tool_calls: list[ToolCall] = field(default_factory=list)
    text: str = ""
    stop: str = "end"

