from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class NotificationEntry(BaseModel):
    """Запись панели уведомлений (v1.6.3) — структурированные данные;
    человеческий текст собирает фронт (как humanizeError в api/client.ts)."""
    id: str                      # стабильный ключ: "<run_id>:digest|cred|skip"
    kind: str                    # digest | cred_invalid | run_skipped
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
    # confluence_unreachable | no_valid_credentials — у run_skipped всегда,
    # у digest — если прогон прерван (обрыв связи посреди прогона).
    skipped_reason: Optional[str] = None
    # run_skipped — не событие, а СОСТОЯНИЕ «проект сейчас не обновляется»:
    # хвостовая серия неудачных прогонов схлопывается в одну живую строку
    # (иначе почасовое самолечение утопило бы панель повторами).
    # attempts — длина серии, first_attempt_at — её начало,
    # happened_at — последняя попытка.
    attempts: int = 1
    first_attempt_at: Optional[datetime] = None


class NotificationsResponse(BaseModel):
    unseen_count: int
    entries: list[NotificationEntry]
