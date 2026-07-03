import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.auth import create_session_token, get_current_user, session_cookie_kwargs
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.user import AuthUserResponse, GoogleLoginRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_FORBIDDEN_DOMAIN = HTTPException(
    status_code=403,
    detail=f"Доступ только для сотрудников {settings.ALLOWED_EMAIL_DOMAIN}",
)


def _verify_google_credential(credential: str) -> dict:
    """Блокирующая верификация Google ID-token (подпись, aud, iss, exp)."""
    return id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        settings.GOOGLE_CLIENT_ID,
        clock_skew_in_seconds=10,
    )


@router.post("/google", response_model=AuthUserResponse)
async def login_with_google(
    data: GoogleLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    if not settings.GOOGLE_CLIENT_ID or not settings.SESSION_SECRET:
        logger.error("GOOGLE_CLIENT_ID/SESSION_SECRET не заданы — вход невозможен")
        raise HTTPException(status_code=500, detail="Авторизация не настроена на сервере")

    try:
        idinfo = await run_in_threadpool(_verify_google_credential, data.credential)
    except ValueError as e:
        logger.warning("Отклонён невалидный Google ID-token: %s", e)
        raise HTTPException(status_code=401, detail="Не удалось подтвердить вход через Google")

    email = (idinfo.get("email") or "").lower()
    # Двойная проверка домена: hd-claim Workspace И суффикс почты. У личных
    # gmail-аккаунтов hd отсутствует — они отсекаются первым же условием.
    if (
        not idinfo.get("email_verified")
        or idinfo.get("hd") != settings.ALLOWED_EMAIL_DOMAIN
        or not email.endswith("@" + settings.ALLOWED_EMAIL_DOMAIN)
    ):
        raise _FORBIDDEN_DOMAIN

    google_sub = idinfo["sub"]
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()

    display_name = idinfo.get("name") or email
    if user is None:
        # Имя должно остаться уникальным: у исторических пользователей «по имени»
        # оно могло совпасть с именем Google-профиля — тогда берём почту.
        taken = await db.execute(select(User).where(User.name == display_name))
        if taken.scalar_one_or_none():
            display_name = email
        user = User(name=display_name, google_sub=google_sub)
        db.add(user)

    user.email = email
    user.avatar_url = idinfo.get("picture")
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(user)

    response.set_cookie(
        value=create_session_token(user),
        max_age=settings.SESSION_TTL_DAYS * 24 * 3600,
        **session_cookie_kwargs(),
    )
    return user


@router.get("/me", response_model=AuthUserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(**session_cookie_kwargs())
