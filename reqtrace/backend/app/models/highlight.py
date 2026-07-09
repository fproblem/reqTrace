import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Highlight(Base):
    __tablename__ = "highlights"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pages.id"), nullable=False)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("page_snapshots.id"), nullable=False)
    start_xpath: Mapped[str] = mapped_column(Text, nullable=False)
    start_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_xpath: Mapped[str] = mapped_column(Text, nullable=False)
    end_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    # Текущий текст под маркером в актуальном снимке (v1.5.9). text_content —
    # замороженная цитата (аналог inlineOriginalSelection у Confluence);
    # anchored_text пересчитывает движок anchoring при refresh. NULL — привязка
    # ещё не проходила refresh по новой модели.
    anchored_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    text_before: Mapped[str] = mapped_column(String(100), nullable=True, default="")
    text_after: Mapped[str] = mapped_column(String(100), nullable=True, default="")
    anchor_block_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    anchor_block_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_char_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_char_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reanchored_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reanchored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    page = relationship("Page", back_populates="highlights")
    tests = relationship("HighlightTest", back_populates="highlight", cascade="all, delete-orphan")
    created_by_user = relationship("User", foreign_keys=[created_by])
    reanchored_by_user = relationship("User", foreign_keys=[reanchored_by])

    @property
    def created_by_name(self) -> str:
        return self.created_by_user.name if self.created_by_user else ""

    @property
    def reanchored_by_name(self) -> str | None:
        return self.reanchored_by_user.name if self.reanchored_by_user else None
