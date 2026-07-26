from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class NotificationEntry(BaseModel):
    """Запись панели уведомлений (v1.6.3) — структурированные данные;
    человеческий текст собирает фронт (как humanizeError в api/client.ts)."""
    id: str                      # стабильный ключ: "<run_id>:digest|cred|skip|quiet"
    kind: str                    # digest | cred_invalid | run_skipped | run_quiet
    project_id: UUID
    project_name: str
    happened_at: datetime        # finished_at прогона — время события
    unseen: bool = False

    # Наполнение дайджеста (kind=digest); у остальных видов — нули.
    pages_total: int = 0
    pages_changed: int = 0
    pages_failed: int = 0
    to_outdated: int = 0
    to_lost: int = 0
    affected_tests: list[str] = []
    # Названия страниц, не обновившихся в прогоне (ошибки уровня страницы,
    # v1.7.2): дайджест называет их поимённо, а не абстрактным числом.
    failed_pages: list[str] = []
    # confluence_unreachable | no_valid_credentials — у run_skipped всегда,
    # у digest — если прогон прерван (обрыв связи посреди прогона).
    skipped_reason: Optional[str] = None
    # run_skipped и run_quiet — не события, а СОСТОЯНИЯ («проект сейчас не
    # обновляется» / «изменений нет, слежение живо», v1.6.5): хвостовая серия
    # одинаковых исходов схлопывается в одну живую строку (иначе почасовое
    # самолечение или неделя тишины утопили бы панель повторами).
    # attempts — длина серии, first_attempt_at — её начало,
    # happened_at — последняя попытка/прогон.
    attempts: int = 1
    first_attempt_at: Optional[datetime] = None


class NotificationsResponse(BaseModel):
    unseen_count: int
    entries: list[NotificationEntry]


# --- Живой статус прогонов (v1.6.4): индикатор у колокольчика ---

class RunningRun(BaseModel):
    """Прогон, идущий прямо сейчас (строка журнала без finished_at)."""
    id: UUID
    project_id: UUID
    project_name: str
    trigger: str
    started_at: datetime


class FinishedRunSummary(BaseModel):
    """Итог последнего завершённого прогона — индикатор показывает его пару
    секунд после окончания, даже когда бейджу загораться не от чего
    («изменений нет», «Confluence недоступен»)."""
    id: UUID
    project_id: UUID
    project_name: str
    status: str
    finished_at: datetime
    pages_changed: int = 0
    pages_failed: int = 0
    to_outdated: int = 0
    to_lost: int = 0
    skipped_reason: Optional[str] = None


class RefreshStatusResponse(BaseModel):
    running: list[RunningRun]
    last_finished: Optional[FinishedRunSummary] = None
