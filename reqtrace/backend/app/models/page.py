import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (
        # Одна и та же Confluence-страница может быть заведена в двух проектах —
        # это две независимые записи (уникальность в пределах проекта, v1.5.1).
        UniqueConstraint("project_id", "confluence_page_id", name="uq_pages_project_confluence_page_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True
    )
    confluence_page_id: Mapped[str] = mapped_column(String(64), nullable=False)
    confluence_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    space_key: Mapped[str] = mapped_column(String(64), nullable=True)
    parent_confluence_page_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_virtual: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    added_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    snapshots = relationship("PageSnapshot", back_populates="page", order_by="PageSnapshot.fetched_at.desc()", cascade="all, delete-orphan", passive_deletes=True)
    baselines = relationship("Baseline", back_populates="page", order_by="Baseline.confirmed_at.desc()", cascade="all, delete-orphan", passive_deletes=True)
    highlights = relationship("Highlight", back_populates="page", cascade="all, delete-orphan", passive_deletes=True)
