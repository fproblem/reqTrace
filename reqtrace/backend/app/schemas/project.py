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


class CredentialCheckResult(BaseModel):
    status: str                            # ok | invalid
    last_check_at: datetime
