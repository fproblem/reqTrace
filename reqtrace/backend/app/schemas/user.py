from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class GoogleLoginRequest(BaseModel):
    credential: str


class AuthUserResponse(BaseModel):
    id: UUID
    name: str
    email: Optional[str] = None
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}
