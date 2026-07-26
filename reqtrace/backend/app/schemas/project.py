from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    """Создание проекта вместе со своим подключением (одним запросом)."""
    name: str
    confluence_base_url: str
    jira_base_url: Optional[str] = None
    confluence_username: str
    confluence_password: str


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    jira_base_url: Optional[str] = None


class CredentialsUpsert(BaseModel):
    """Свои креды в проекте; первое сохранение = присоединиться."""
    confluence_username: str
    # None/пусто — оставить прежний пароль (для уже подключённого участника).
    confluence_password: Optional[str] = None
    # Личный Jira-токен (PAT) — только для чтения названий тестов (v1.7.0).
    # None — не менять; пустая строка — удалить; непустая — проверить и сохранить.
    jira_token: Optional[str] = None


class ProjectListItem(BaseModel):
    id: UUID
    name: str
    confluence_base_url: str
    jira_base_url: Optional[str] = None
    joined: bool = False
    my_status: Optional[str] = None        # ok | invalid | unchecked — только у участника
    my_username: Optional[str] = None
    last_check_at: Optional[datetime] = None
    my_last_check_result: Optional[str] = None  # ok | invalid | unreachable — исход последней проверки
    # Jira-токен участника (v1.7.0): ok | invalid; None — токена нет.
    my_jira_token_status: Optional[str] = None


class CredentialCheckResult(BaseModel):
    status: str                            # ok | invalid
    last_check_at: datetime


# --- Экран «Тесты» (v1.6.1): реверс-индекс «ключ → привязки» ---

class ProjectTestsStats(BaseModel):
    """Сводка проекта для яруса выбора на экране «Тесты».

    Считается целиком по локальной БД — походов в Confluence нет, поэтому
    доступна и при недоступном Confluence (лишь бы креды были ok).
    """
    project_id: UUID
    project_name: str
    is_demo: bool = False
    pages: int = 0
    highlights: int = 0
    covered: int = 0    # привязок с хотя бы одним тестом
    tests: int = 0      # различных ключей (нормализованных)
    active: int = 0
    outdated: int = 0
    lost: int = 0
    # Когда автообновление в последний раз проверяло проект (v1.6.2):
    # finished_at последнего успешного прогона; None — ещё ни разу (или демо).
    last_auto_refresh_at: Optional[datetime] = None
    # Последняя попытка (любой исход, v1.6.4): если last_attempt_reason
    # заполнен (confluence_unreachable | no_valid_credentials) — последний
    # прогон не удался, и карточка честно предупреждает, что данные
    # несвежие не просто так.
    last_attempt_at: Optional[datetime] = None
    last_attempt_reason: Optional[str] = None


class TestLinkRef(BaseModel):
    """Одна привязка ключа: где живёт и в каком статусе."""
    link_id: UUID
    highlight_id: UUID
    page_id: UUID
    page_title: str
    status: str
    excerpt: str        # цитата целиком (v1.6.5); сколько показать — решает фронт


class TestIndexEntry(BaseModel):
    """Строка ЛЁГКОГО списка тестов (v1.7.3): только то, что нужно закрытой
    строке — ключ, название и счётчики. Привязки с цитатами приезжают
    отдельным запросом при раскрытии (см. TestKeyLinks): весь индекс с
    цитатами разом весил бы мегабайты уже на сотнях тестов."""
    key: str
    # Название теста из Jira (v1.7.0); None — имени нет, UI показывает ключ.
    summary: Optional[str] = None
    # ok | not_found | error; None — в Jira не ходили. not_found — задачи нет:
    # чип серый, ссылка снята.
    jira_status: Optional[str] = None
    # Счётчики привязок по статусам и число страниц, где живёт ключ, —
    # для пилюль, фильтров и сортировки без загрузки самих привязок.
    active: int = 0
    outdated: int = 0
    lost: int = 0
    pages_count: int = 0


class ProjectTestIndex(BaseModel):
    project_id: UUID
    project_name: str
    jira_base_url: Optional[str] = None   # для ссылок ключей в Jira
    # Сколько разных страниц покрыто хоть одним тестом — для строки сводки
    # (сумма pages_count по ключам считала бы общие страницы дважды).
    pages_covered: int = 0
    tests: list[TestIndexEntry]


class TestKeyLinks(BaseModel):
    """Привязки одного ключа с цитатами — вторая половина реверс-индекса
    (v1.7.3), грузится при раскрытии строки."""
    key: str
    links: list[TestLinkRef]
