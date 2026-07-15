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


class TestLinkRef(BaseModel):
    """Одна привязка ключа: где живёт и в каком статусе."""
    link_id: UUID
    highlight_id: UUID
    page_id: UUID
    page_title: str
    status: str
    excerpt: str        # цитата, обрезанная на сервере — полная не нужна списку


class TestIndexEntry(BaseModel):
    key: str
    links: list[TestLinkRef]


class ProjectTestIndex(BaseModel):
    project_id: UUID
    project_name: str
    jira_base_url: Optional[str] = None   # для ссылок ключей в Jira
    tests: list[TestIndexEntry]
