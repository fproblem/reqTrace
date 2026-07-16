import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RefreshRun(Base):
    """Журнал прогонов автообновления (v1.6.2, план — auto-refresh-plan-v1.6.md).

    Одна строка = прогон одного проекта. Дайджест (v1.6.3) — представление
    этого журнала по членству пользователя: рассылок и fan-out нет, видимость
    уведомлений тождественна доступу к проекту. Строка без finished_at —
    прогон идёт прямо сейчас либо был прерван смертью процесса.
    """
    __tablename__ = "refresh_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # auto — ночной прогон; retry — самолечебный добор (v1.6.4); manual —
    # кнопка «Обновить страницы сейчас»; cli — python -m app.jobs.nightly.
    # Ночное расписание (is_run_due) считает только auto — остальные
    # триггеры следующую ночь не отменяют.
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, server_default="auto")
    # ok — все страницы обработаны без ошибок; partial — часть страниц не
    # удалась или прогон остановлен на середине (кончились рабочие креды);
    # skipped — не начинался (нет кред / Confluence недоступен); failed —
    # прерван неожиданной ошибкой.
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="skipped")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    pages_total: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    pages_changed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    pages_failed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Переходы статусов привязок за прогон (правила статусов не здесь —
    # их решает anchoring.project при refresh, журнал только считает).
    to_outdated: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    to_lost: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Итоги ночного sync-tree: с v1.6.2 копятся данные для будущего сигнала
    # дайджеста «в спейсах появились новые страницы» (v1.6.3+).
    tree_added: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tree_moved: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tree_removed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tree_missing_tracked: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Пер-страничные подробности — только страницы с изменениями или ошибками:
    # {"pages": [{page_id, title, changed, to_outdated: [hl_id], to_lost: [hl_id],
    #             affected_tests: [key], error}], "skipped_reason": str}
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Чьи подключения отклонил Confluence этой ночью:
    # [{user_id, username, result}] — источник личных уведомлений (v1.6.3).
    cred_issues: Mapped[list | None] = mapped_column(JSONB, nullable=True)
