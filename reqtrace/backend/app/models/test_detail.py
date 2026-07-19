import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TestDetail(Base):
    """Название теста из Jira (v1.7.0, план — jira-test-names-plan-v1.7.md).

    ReqTrace ходит в Jira ТОЛЬКО за summary — рядом с ключом видно, какой
    тест привязан (панель привязки, экран «Тесты»). Пер-проект, не глобально:
    jira_base_url — свойство проекта, один ключ в разных проектах может жить
    в разных Jira. Актуализация — как у страниц: мгновенный fetch при
    привязке + ночная синхронизация в прогоне; осиротевшие ключи (без единой
    привязки) ночь подчищает.

    Правило перезаписи: ok перезаписывает всё; not_found/error НЕ затирают
    добытый ранее summary — у участников разные права в Jira, бесправный не
    должен «стереть» имя, которое видит коллега.
    """
    __tablename__ = "test_details"
    __table_args__ = (
        UniqueConstraint("project_id", "test_key", name="uq_test_details_project_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_key: Mapped[str] = mapped_column(String(64), nullable=False)  # нормализован (upper)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetch_result: Mapped[str] = mapped_column(String(16), nullable=False)  # ok | not_found | error
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
