from dataclasses import dataclass
from typing import Any, Optional

from app.models import AssetStatus, AssetType, Company, Department, Floor, Location, Make


@dataclass(frozen=True)
class MasterSpec:
    key: str
    model: Any
    label: str
    plural: str
    asset_attr: str
    field: str = ""
    classification: Optional[str] = None

    @property
    def row_key(self) -> str:
        return self.field or self.key

    def scope(self) -> list:
        if self.classification is None:
            return []
        return [self.model.classification == self.classification]

    def new_row(self, **values) -> Any:
        if self.classification is not None:
            values["classification"] = self.classification
        return self.model(**values)

    def applies_to(self, register_key: Optional[str]) -> bool:
        return self.classification is None or self.classification == register_key


MAKE_CLASSIFICATIONS = (("asset", "Asset"), ("peripheral", "Peripheral"))

MASTER_SPECS: list[MasterSpec] = [
    MasterSpec(
        key="type",
        model=AssetType,
        label="Asset Type",
        plural="Asset Types",
        asset_attr="type",
    ),
    MasterSpec(
        key="status",
        model=AssetStatus,
        label="Status",
        plural="Statuses",
        asset_attr="status",
    ),
    MasterSpec(
        key="department",
        model=Department,
        label="Department",
        plural="Departments",
        asset_attr="department",
    ),
    MasterSpec(
        key="company",
        model=Company,
        label="Company",
        plural="Companies",
        asset_attr="company",
    ),
    MasterSpec(
        key="location",
        model=Location,
        label="Location",
        plural="Locations",
        asset_attr="location",
    ),
    MasterSpec(
        key="floor",
        model=Floor,
        label="Floor",
        plural="Floors",
        asset_attr="floor",
    ),
    *[
        MasterSpec(
            key=f"{key}Make",
            model=Make,
            label=f"{noun} Make",
            plural=f"{noun} Makes",
            asset_attr="make",
            field="make",
            classification=key,
        )
        for key, noun in MAKE_CLASSIFICATIONS
    ],
]

MASTERS: dict[str, MasterSpec] = {spec.key: spec for spec in MASTER_SPECS}

MASTER_KEYS: list[str] = [spec.key for spec in MASTER_SPECS]


def get_spec(key: str) -> MasterSpec | None:
    return MASTERS.get(key)


def specs_for(register_key: Optional[str]) -> list[MasterSpec]:
    return [spec for spec in MASTER_SPECS if spec.applies_to(register_key)]
