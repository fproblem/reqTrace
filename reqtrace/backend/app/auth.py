"""Сессии на HttpOnly-cookie с JWT (HS256) и зависимость get_current_user.

Поток: POST /api/auth/google верифицирует Google ID-token и ставит cookie
с нашим собственным сессионным JWT. Дальше каждый запрос проходит через
get_current_user — она подключена ко всем роутерам, кроме auth, на уровне
include_router в main.py.
"""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

SESSION_COOKIE_NAME = "reqtrace_session"
JWT_ALGORITHM = "HS256"


def create_session_token(user: User) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.SESSION_TTL_DAYS)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.SESSION_SECRET, algorithm=JWT_ALGORITHM)


def session_cookie_kwargs() -> dict:
    """Единые параметры cookie для set_cookie и delete_cookie."""
    return {
        "key": SESSION_COOKIE_NAME,
        "path": "/",
        "httponly": True,
        "samesite": "lax",
        "secure": settings.COOKIE_SECURE,
    }


_UNAUTHORIZED = HTTPException(status_code=401, detail="Требуется вход")


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise _UNAUTHORIZED

    try:
        payload = jwt.decode(token, settings.SESSION_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _UNAUTHORIZED

    user = await db.get(User, user_id)
    if not user:
        raise _UNAUTHORIZED
    return user
