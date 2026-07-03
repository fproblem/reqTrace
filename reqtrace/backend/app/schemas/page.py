from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel


class PageCreate(BaseModel):
    confluence_url: str
    # Обязателен, только если ссылка подходит нескольким проектам пользователя
    # (разные проекты на одном Confluence-сервере).
    project_id: Optional[UUID] = None


class PageListItem(BaseModel):
    id: UUID
    project_id: UUID
    confluence_page_id: str
    confluence_url: str
    title: str
    space_key: Optional[str] = None
    created_at: datetime
    last_snapshot_at: Optional[datetime] = None
    baseline_at: Optional[datetime] = None
    coverage_percent: float = 0.0
    has_updates: bool = False

    model_config = {"from_attributes": True}


class SnapshotInfo(BaseModel):
    id: UUID
    confluence_version: int
    fetched_at: datetime

    model_config = {"from_attributes": True}


class BaselineInfo(BaseModel):
    id: UUID
    snapshot_id: UUID
    confirmed_by: UUID
    confirmed_at: datetime

    model_config = {"from_attributes": True}


class PageDetail(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str
    # Jira проекта страницы — фронт строит ссылки на тест-кейсы из него.
    jira_base_url: str = ""
    confluence_page_id: str
    confluence_url: str
    title: str
    space_key: Optional[str] = None
    is_virtual: bool = False
    created_at: datetime
    current_snapshot: Optional[SnapshotInfo] = None
    baseline: Optional[BaselineInfo] = None
    content_html: Optional[str] = None

    model_config = {"from_attributes": True}


class TreeNodeItem(BaseModel):
    id: UUID
    confluence_page_id: str
    title: str
    space_key: Optional[str] = None
    is_virtual: bool
    parent_confluence_page_id: Optional[str] = None
    # Счётчики привязок страницы по статусам — индикатор в дереве красится
    # по худшему из них (lost > outdated > active).
    highlights_active: int = 0
    highlights_outdated: int = 0
    highlights_lost: int = 0
    has_updates: bool = False

    model_config = {"from_attributes": True}


class SpaceTreeResponse(BaseModel):
    space_key: str
    pages: list[TreeNodeItem]


class ProjectTreeResponse(BaseModel):
    """Верхний уровень дерева — проект пользователя.

    no_access=true (креды невалидны) — спейсы не отдаются, UI показывает замок.
    """
    project_id: UUID
    project_name: str
    is_demo: bool = False
    no_access: bool = False
    spaces: list[SpaceTreeResponse] = []


class TreeSyncResult(BaseModel):
    """Summary of a hierarchy re-sync against Confluence."""
    spaces: int = 0
    moved: int = 0
    added: int = 0
    removed: int = 0
    missing_tracked: int = 0

