from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel


class PageCreate(BaseModel):
    confluence_url: str
    user_id: UUID


class PageListItem(BaseModel):
    id: UUID
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
    confluence_page_id: str
    confluence_url: str
    title: str
    space_key: Optional[str] = None
    created_at: datetime
    current_snapshot: Optional[SnapshotInfo] = None
    baseline: Optional[BaselineInfo] = None
    content_html: Optional[str] = None

    model_config = {"from_attributes": True}


class BaselineCreate(BaseModel):
    user_id: UUID


class RefreshRequest(BaseModel):
    user_id: UUID
