import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AttachmentDimension(Base):
    """Замеренные размеры картинок-вложений страницы (v1.6.6).

    Браузер резервирует место под <img> до загрузки, только когда знает
    размеры заранее — иначе при первом открытии страницы контент «едет» по
    мере догрузки картинок (диплинк к привязке уезжает из вьюпорта).
    Confluence отдаёт ac:width/ac:height лишь у вручную ресайзнутых картинок,
    поэтому остальные ReqTrace замеряет сам при снимке страницы
    (services/image_dimensions.py), а рендер подставляет размеры в HTML.

    width/height NULL — замер был, но формат не распознан: повторно не
    скачиваем. Кэш браузера тут не помог бы: он ускоряет только повторные
    визиты, а сдвиги бьют именно по первому.
    """
    __tablename__ = "attachment_dimensions"
    __table_args__ = (
        UniqueConstraint("page_id", "filename", name="uq_attachment_dimensions_page_filename"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(1024), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
