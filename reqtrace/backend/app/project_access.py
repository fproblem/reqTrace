"""Доступ к проектам и личным кредам (v1.5.1).

Членство = запись в project_credentials; право видеть контент проекта =
членство со статусом ok (для демо-проекта — только его создатель). Все походы
в Confluence выполняются кредами текущего пользователя; 401/403 от Confluence
помечает подключение invalid — статус хранит последнее известное состояние.
"""
import urllib.parse
from datetime import datetime, timezone
from uuid import UUID

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import decrypt_secret
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.user import User
from app.services.confluence import ConfluenceAuthError, ConfluenceConnection


def normalize_base_url(url: str) -> str:
    """Каноничный вид base URL: схема (https, если не указана), host в нижнем
    регистре, без стандартного порта, без завершающего / и без query."""
    url = (url or "").strip()
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    parts = urllib.parse.urlsplit(url)
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    if port and not (scheme == "https" and port == 443) and not (scheme == "http" and port == 80):
        host = f"{host}:{port}"
    path = parts.path.rstrip("/")
    return f"{scheme}://{host}{path}"


def url_belongs_to_base(page_url: str, base_url: str) -> bool:
    """Относится ли ссылка на страницу к данному Confluence (учитывая context path)."""
    if not base_url:
        return False
    normalized_page = normalize_base_url(page_url)
    normalized_base = normalize_base_url(base_url)
    return normalized_page == normalized_base or normalized_page.startswith(normalized_base + "/")


def _no_access(project: Project, has_creds: bool) -> HTTPException:
    if has_creds:
        detail = f"Нет доступа к проекту «{project.name}». Проверьте креды в настройках"
    else:
        detail = f"Нет доступа к проекту «{project.name}». Подключитесь к нему в настройках"
    return HTTPException(status_code=403, detail=detail)


async def get_my_credential(
    db: AsyncSession, project_id: UUID, user: User
) -> ProjectCredential | None:
    result = await db.execute(
        select(ProjectCredential).where(
            ProjectCredential.project_id == project_id,
            ProjectCredential.user_id == user.id,
        )
    )
    return result.scalar_one_or_none()


async def require_project_access(
    db: AsyncSession, project: Project, user: User
) -> ProjectCredential | None:
    """Проверить право видеть контент проекта; вернуть креды (None у демо).

    Демо-проект доступен только создателю (чужой демо «не существует» → 404).
    Обычный проект: членство со статусом ok, иначе 403 с подсказкой.
    """
    if project.is_demo:
        if project.created_by != user.id:
            raise HTTPException(status_code=404, detail="Page not found")
        return None
    cred = await get_my_credential(db, project.id, user)
    if cred is None:
        raise _no_access(project, has_creds=False)
    if cred.status != "ok":
        raise _no_access(project, has_creds=True)
    return cred


async def require_page_access(
    db: AsyncSession, page_id: UUID, user: User
) -> tuple[Page, Project, ProjectCredential | None]:
    """Страница + её проект + креды пользователя, если контент ему доступен."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    project = await db.get(Project, page.project_id)
    cred = await require_project_access(db, project, user)
    return page, project, cred


def connection_for(project: Project, cred: ProjectCredential) -> ConfluenceConnection:
    """Подключение к Confluence проекта кредами участника."""
    try:
        password = decrypt_secret(cred.confluence_password_enc)
    except InvalidToken:
        raise HTTPException(
            status_code=403,
            detail=f"Сохранённый пароль для проекта «{project.name}» не читается "
                   "(сменился ключ шифрования). Обновите креды в настройках",
        )
    return ConfluenceConnection(
        base_url=project.confluence_base_url,
        username=cred.confluence_username,
        password=password,
    )


async def mark_invalid(db: AsyncSession, cred: ProjectCredential) -> None:
    """Пометить креды невалидными и закоммитить сразу: HTTPException, брошенный
    следом, откатит транзакцию get_db — пометка должна пережить откат."""
    cred.status = "invalid"
    cred.last_check_at = datetime.now(timezone.utc)
    await db.commit()


async def run_confluence(
    db: AsyncSession, project: Project, cred: ProjectCredential, awaitable
):
    """Выполнить запрос к Confluence кредами участника.

    401/403 от Confluence = креды протухли: подключение помечается invalid,
    пользователю уходит 403 с подсказкой (замок в дереве появится при
    следующей загрузке).
    """
    try:
        return await awaitable
    except ConfluenceAuthError as e:
        await mark_invalid(db, cred)
        raise HTTPException(
            status_code=403,
            detail=f"Confluence отклонил ваши логин/пароль в проекте «{project.name}» "
                   f"(HTTP {e.status_code}). Обновите креды в настройках",
        )


DEMO_CONFLUENCE_ERROR = HTTPException(
    status_code=400, detail="Демо-страница не связана с Confluence"
)


def require_confluence_project(project: Project) -> None:
    """Confluence-операции (refresh/promote/sync, вложения) для демо — 400."""
    if project.is_demo:
        raise DEMO_CONFLUENCE_ERROR


async def get_or_create_demo_project(db: AsyncSession, user: User) -> Project:
    """Личный демо-проект пользователя; создаётся при первом использовании.

    Без кред и без записей в project_credentials — участник только создатель.
    """
    result = await db.execute(
        select(Project).where(Project.is_demo == True, Project.created_by == user.id)  # noqa: E712
    )
    project = result.scalar_one_or_none()
    if project:
        return project
    project = Project(
        name=f"Демо — {user.name}",
        confluence_base_url="",
        is_demo=True,
        created_by=user.id,
    )
    db.add(project)
    await db.flush()
    return project
