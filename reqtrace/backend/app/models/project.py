import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Project(Base):
    """Проект — Confluence-сервер + участники со своими кредами (v1.5.1).

    Спейсы проекта отдельно не ведутся: их определяют добавленные страницы.
    Демо-проект (is_demo) — личный, без кред и без записей в
    project_credentials; его единственный участник — created_by.
    """
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Уникальность по lower(name) — индексом uq_projects_name_lower (миграция 007).
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Нормализованный (https по умолчанию, host в нижнем регистре, без завершающего /);
    # у демо-проектов — пустая строка.
    confluence_base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    jira_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectCredential(Base):
    """Личные креды участника в проекте. Запись здесь = членство в проекте."""
    __tablename__ = "project_credentials"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_credentials_project_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    confluence_username: Mapped[str] = mapped_column(String(255), nullable=False)
    confluence_password_enc: Mapped[str] = mapped_column(Text, nullable=False)  # Fernet(CREDENTIALS_KEY)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="unchecked")  # ok | invalid | unchecked
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Исход последней попытки проверки: ok | invalid | unreachable (Confluence
    # недоступен — VPN/сеть). На доступ к контенту, в отличие от status, не влияет.
    last_check_result: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
