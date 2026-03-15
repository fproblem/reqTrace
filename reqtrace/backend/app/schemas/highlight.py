from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel


class HighlightCreate(BaseModel):
    start_xpath: str
    start_offset: int
    end_xpath: str
    end_offset: int
    text_content: str
    text_before: Optional[str] = ""
    text_after: Optional[str] = ""
    user_id: UUID


class TestLinkCreate(BaseModel):
    test_key: str
    user_id: UUID


class TestLinkResponse(BaseModel):
    id: UUID
    test_key: str
    created_by: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class HighlightResponse(BaseModel):
    id: UUID
    page_id: UUID
    snapshot_id: UUID
    start_xpath: str
    start_offset: int
    end_xpath: str
    end_offset: int
    text_content: str
    text_before: Optional[str] = ""
    text_after: Optional[str] = ""
    status: str
    created_by: UUID
    created_at: datetime
    tests: list[TestLinkResponse] = []

    model_config = {"from_attributes": True}
