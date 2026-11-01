import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="assignee")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    date_of_joining: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Counter(Base):
    __tablename__ = "counters"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class RegisterItemBase(Base):
    __abstract__ = True


    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    srl: Mapped[str | None] = mapped_column(String(50), nullable=True)

    asset_id: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)

    sap_id: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)

    make: Mapped[str | None] = mapped_column(String(100), nullable=True)

    type: Mapped[str] = mapped_column(String(50), nullable=False)
    asset_tag: Mapped[str] = mapped_column(String(255), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)

    description: Mapped[str] = mapped_column(String(500), nullable=False)

    service_tag: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)

    status: Mapped[str] = mapped_column(String(50), nullable=False)

    availability: Mapped[str | None] = mapped_column(String(20), nullable=True)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    previous_status: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)

    location: Mapped[str] = mapped_column(String(255), nullable=False)
    site: Mapped[str] = mapped_column(String(100), nullable=False)
    floor: Mapped[str | None] = mapped_column(String(50), nullable=True)

    company: Mapped[str] = mapped_column(String(100), nullable=False)
    po_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dop: Mapped[str | None] = mapped_column(String(20), nullable=True)
    warranty_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    doj: Mapped[str | None] = mapped_column(String(20), nullable=True)

    comments: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(150), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(150), nullable=True)

    verification: Mapped[str] = mapped_column(
        String(20), nullable=False, default="verified", server_default="verified", index=True
    )
    verified_by: Mapped[str | None] = mapped_column(String(150), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    insurance_end: Mapped[str | None] = mapped_column(String(20), nullable=True)

    assign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    assigned_date: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Asset(RegisterItemBase):
    __tablename__ = "assets"


class Peripheral(RegisterItemBase):
    __tablename__ = "peripherals"


class Software(RegisterItemBase):
    __tablename__ = "softwares"

    version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)


class PeripheralLink(Base):
    __tablename__ = "peripheral_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    peripheral_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    asset_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(150), nullable=True)

    __table_args__ = (
        UniqueConstraint("peripheral_id", "asset_id", name="uq_peripheral_link"),
    )


class AssetEvent(Base):
    __tablename__ = "asset_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    register: Mapped[str] = mapped_column(String(20), nullable=False, default="asset", index=True)

    asset_pk: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    asset_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    action: Mapped[str] = mapped_column(String(20), nullable=False)

    field: Mapped[str | None] = mapped_column(String(50), nullable=True)

    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor: Mapped[str | None] = mapped_column(String(150), nullable=True)

    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    actor: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)

    actor_role: Mapped[str | None] = mapped_column(String(20), nullable=True)

    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    category: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    summary: Mapped[str] = mapped_column(String(400), nullable=False, default="")

    target: Mapped[str | None] = mapped_column(String(200), nullable=True)

    outcome: Mapped[str] = mapped_column(String(10), nullable=False, default="ok", index=True)

    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    method: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    path: Mapped[str] = mapped_column(String(300), nullable=False, default="")

    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(150), nullable=False)

    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="answer")

    transcript: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    display: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    pending_notes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    turns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class AssistantProposal(Base):
    __tablename__ = "assistant_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    register: Mapped[str] = mapped_column(String(20), nullable=False)
    record_pk: Mapped[str] = mapped_column(String(36), nullable=False)
    record_label: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    diff: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending", index=True)
    outcome_detail: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MasterBase(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class AssetType(MasterBase):
    __tablename__ = "asset_types"

    is_shared: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, sort_order=100
    )


class AssetStatus(MasterBase):
    __tablename__ = "asset_statuses"


class Department(MasterBase):
    __tablename__ = "departments"


class Company(MasterBase):
    __tablename__ = "companies"


class Location(MasterBase):
    __tablename__ = "locations"


class Floor(MasterBase):
    __tablename__ = "floors"


class Make(MasterBase):
    __tablename__ = "makes"

    name: Mapped[str] = mapped_column(String(150), index=True, nullable=False)
    classification: Mapped[str] = mapped_column(String(20), index=True, nullable=False)

    __table_args__ = (
        UniqueConstraint("classification", "name", name="uq_make_classification_name"),
    )


class NotificationSettings(Base):
    __tablename__ = "notification_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="off")
    it_head_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cc_emails: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    smtp_security: Mapped[str] = mapped_column(String(10), nullable=False, default="starttls")
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    from_address: Mapped[str | None] = mapped_column(String(255), nullable=True)

    app_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    summary_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    summary_time: Mapped[str] = mapped_column(String(5), nullable=False, default="18:00")
    last_summary_on: Mapped[str | None] = mapped_column(String(10), nullable=True)

    updated_by: Mapped[str | None] = mapped_column(String(150), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    hr_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    joiner_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    joiner_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    transfer_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    registration_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    verification_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    renewal_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    renewal_time: Mapped[str] = mapped_column(String(5), nullable=False, default="09:00")
    last_renewal_on: Mapped[str | None] = mapped_column(String(10), nullable=True)

    export_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    export_recipients: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    export_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    export_time: Mapped[str] = mapped_column(String(5), nullable=False, default="09:00")
    last_export_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_export_try_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    export_clear_activity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    activity_cleared_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class RenewalNotice(Base):
    __tablename__ = "renewal_notices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    software_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    renewal_date: Mapped[str] = mapped_column(String(20), nullable=False)
    stage: Mapped[str] = mapped_column(String(10), nullable=False)
    sent_on: Mapped[str] = mapped_column(String(10), nullable=False)
    sent_to: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("software_id", "renewal_date", "stage", "sent_on", name="uq_renewal_notice"),
    )


class RegistrationQueue(Base):
    __tablename__ = "registration_queue"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    register: Mapped[str] = mapped_column(String(20), nullable=False)
    item_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor: Mapped[str] = mapped_column(String(150), nullable=False)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    claim: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    register: Mapped[str] = mapped_column(String(20), nullable=False)
    item_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    items: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    changes: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    requested_by: Mapped[str] = mapped_column(String(150), nullable=False)
    requested_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    status: Mapped[str] = mapped_column(String(15), nullable=False, default="pending", index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)


class ApprovalToken(Base):
    __tablename__ = "approval_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

