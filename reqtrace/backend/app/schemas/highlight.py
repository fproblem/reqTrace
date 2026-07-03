from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel


class HighlightCreate(BaseModel):
    start_xpath: str = ""
    start_offset: int = 0
    end_xpath: str = ""
    end_offset: int = 0
    text_content: str
    text_before: Optional[str] = ""
    text_after: Optional[str] = ""
    anchor_block_start: Optional[int] = None
    anchor_block_end: Optional[int] = None
    start_char_offset: Optional[int] = None
    end_char_offset: Optional[int] = None


class TestLinkCreate(BaseModel):
    test_key: str


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
    anchor_block_start: Optional[int] = None
    anchor_block_end: Optional[int] = None
    start_char_offset: Optional[int] = None
    end_char_offset: Optional[int] = None
    status: str
    created_by: UUID
    created_by_name: str = ""
    created_at: datetime
    reanchored_by: Optional[UUID] = None
    reanchored_by_name: Optional[str] = None
    reanchored_at: Optional[datetime] = None
    tests: list[TestLinkResponse] = []

    model_config = {"from_attributes": True}
