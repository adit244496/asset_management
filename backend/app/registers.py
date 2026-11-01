from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.models import Asset, Peripheral, RegisterItemBase, Software


@dataclass(frozen=True)
class Register:
    key: str
    model: type[RegisterItemBase]
    counter: str
    prefix: str
    noun: str
    plural: str
    id_label: str

    @property
    def table(self) -> str:
        return self.model.__tablename__

    @property
    def srl_index(self) -> str:
        return f"ix_{self.table}_srl_unique"

    def __str__(self) -> str:
        return self.key


ASSETS = Register(
    key="asset",
    model=Asset,
    counter="asset_id",
    prefix="AMB",
    noun="asset",
    plural="assets",
    id_label="Asset ID",
)

PERIPHERALS = Register(
    key="peripheral",
    model=Peripheral,
    counter="peripheral_id",
    prefix="PRP",
    noun="peripheral",
    plural="peripherals",
    id_label="Peripheral ID",
)

SOFTWARES = Register(
    key="software",
    model=Software,
    counter="software_id",
    prefix="SFT",
    noun="software",
    plural="softwares",
    id_label="Software ID",
)

ALL: tuple[Register, ...] = (ASSETS, PERIPHERALS, SOFTWARES)

HARDWARE: tuple[Register, ...] = (ASSETS, PERIPHERALS)

BY_KEY: dict[str, Register] = {reg.key: reg for reg in ALL}


def by_key(key: str) -> Optional[Register]:
    if not isinstance(key, str):
        return None
    name = key.strip().lower().rstrip("s") or key.strip().lower()
    return BY_KEY.get(name)


def by_model(model: type) -> Register:
    for reg in ALL:
        if reg.model is model:
            return reg
    raise ValueError(f"{model!r} is not a register model")


def of(item) -> Register:
    return by_model(type(item))

