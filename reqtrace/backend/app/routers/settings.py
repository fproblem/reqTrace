from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.settings import Settings
from app.schemas.settings import SettingsUpdate, SettingsResponse

router = APIRouter(prefix="/api/settings", tags=["settings"])

SETTINGS_KEYS = [
    "confluence_base_url",
    "confluence_username",
    "confluence_password",
    "jira_base_url",
]


async def _get_setting(db: AsyncSession, key: str) -> str:
    result = await db.execute(select(Settings).where(Settings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else ""


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    result = await db.execute(select(Settings).where(Settings.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Settings(key=key, value=value))


@router.get("", response_model=SettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    confluence_url = await _get_setting(db, "confluence_base_url")
    confluence_user = await _get_setting(db, "confluence_username")
    confluence_pass = await _get_setting(db, "confluence_password")
    jira_url = await _get_setting(db, "jira_base_url")

    return SettingsResponse(
        confluence_base_url=confluence_url,
        confluence_username=confluence_user,
        confluence_password_set=bool(confluence_pass),
        jira_base_url=jira_url,
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(data: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    if data.confluence_base_url is not None:
        await _set_setting(db, "confluence_base_url", data.confluence_base_url.rstrip("/"))
    if data.confluence_username is not None:
        await _set_setting(db, "confluence_username", data.confluence_username)
    if data.confluence_password:
        await _set_setting(db, "confluence_password", data.confluence_password)
    if data.jira_base_url is not None:
        await _set_setting(db, "jira_base_url", data.jira_base_url.rstrip("/"))

    await db.flush()

    return await get_settings(db)


async def get_confluence_params(db: AsyncSession) -> dict:
    """Get Confluence connection parameters from DB, with env fallback."""
    from app.config import settings as env_settings

    base_url = await _get_setting(db, "confluence_base_url")
    username = await _get_setting(db, "confluence_username")
    password = await _get_setting(db, "confluence_password")

    return {
        "base_url": base_url or env_settings.CONFLUENCE_BASE_URL,
        "username": username or env_settings.CONFLUENCE_USERNAME,
        "password": password or env_settings.CONFLUENCE_PASSWORD,
    }


async def get_jira_base_url(db: AsyncSession) -> str:
    from app.config import settings as env_settings
    url = await _get_setting(db, "jira_base_url")
    return url or env_settings.JIRA_BASE_URL
