"""Проекты и личные креды участников (v1.5.1).

Создание проекта и апсерт кред проходят живую проверку подключения к
Confluence — это и есть контроль доступа: без работающих кред к Confluence
проекта членства нет. Пароли хранятся зашифрованными (Fernet, CREDENTIALS_KEY).
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.crypto import decrypt_secret, encrypt_secret
from app.database import get_db
from app.models.baseline import Baseline
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.snapshot import PageSnapshot
from app.models.user import User
from app.project_access import connection_for, get_my_credential, normalize_base_url
from app.schemas.project import (
    CredentialCheckResult,
    CredentialsUpsert,
    ProjectCreate,
    ProjectListItem,
    ProjectUpdate,
)
from app.services import confluence
from app.services.confluence import ConfluenceAuthError, ConfluenceConnection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _item(project: Project, cred: ProjectCredential | None) -> ProjectListItem:
    return ProjectListItem(
        id=project.id,
        name=project.name,
        confluence_base_url=project.confluence_base_url,
        jira_base_url=project.jira_base_url,
        joined=cred is not None,
        my_status=cred.status if cred else None,
        my_username=cred.confluence_username if cred else None,
        last_check_at=cred.last_check_at if cred else None,
        my_last_check_result=cred.last_check_result if cred else None,
    )


async def _get_regular_project(db: AsyncSession, project_id: UUID) -> Project:
    """Обычный (не демо) проект; демо-проекты для этого API «не существуют»."""
    project = await db.get(Project, project_id)
    if not project or project.is_demo:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _check_live(conn: ConfluenceConnection) -> None:
    """Живая проверка кред перед сохранением; провал = ничего не сохраняем."""
    try:
        await confluence.check_connection(conn)
    except ConfluenceAuthError:
        raise HTTPException(
            status_code=400,
            detail="Confluence отклонил логин/пароль — проверьте их и попробуйте ещё раз",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.warning("Confluence check failed for %s: %s", conn.base_url, e)
        # Чаще всего сервер за корпоративной сетью: «проверьте адрес» без
        # упоминания VPN сбивал с толку при выключенном VPN и верном адресе.
        raise HTTPException(
            status_code=502,
            detail=f"Не удалось подключиться к Confluence ({conn.base_url}). Проверьте VPN, сеть или адрес сервера",
        )


@router.get("", response_model=list[ProjectListItem])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Все проекты (кроме демо): имена и URL видны любому сотруднику — это
    нужно для «присоединиться»; сам контент проектов закрыт кредами."""
    result = await db.execute(
        select(Project).where(Project.is_demo == False).order_by(Project.name)  # noqa: E712
    )
    projects = result.scalars().all()

    creds_result = await db.execute(
        select(ProjectCredential).where(ProjectCredential.user_id == current_user.id)
    )
    my_creds = {c.project_id: c for c in creds_result.scalars().all()}

    return [_item(p, my_creds.get(p.id)) for p in projects]


@router.post("", response_model=ProjectListItem, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать проект вместе со своим подключением. Провал проверки кред —
    не создаётся ничего."""
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Имя проекта не может быть пустым")
    base_url = normalize_base_url(data.confluence_base_url)
    if not base_url:
        raise HTTPException(status_code=400, detail="Укажите адрес Confluence-сервера")
    username = data.confluence_username.strip()
    if not username or not data.confluence_password:
        raise HTTPException(status_code=400, detail="Укажите логин и пароль Confluence")

    taken = await db.execute(
        select(Project).where(func.lower(Project.name) == name.lower())
    )
    if taken.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Проект с таким именем уже есть — возможно, стоит присоединиться к нему",
        )

    # Дубль Confluence URL запрещён: проекты-двойники ведут одинаковые страницы
    # с раздельным покрытием. Сравнение по нормализованному URL; демо-проекты
    # (пустой URL) не в счёт. Уникального индекса нет сознательно — в базе
    # могут жить дубли, созданные до запрета.
    dup = await db.execute(
        select(Project).where(
            Project.confluence_base_url == base_url,
            Project.is_demo == False,  # noqa: E712
        ).limit(1)
    )
    dup_project = dup.scalar_one_or_none()
    if dup_project:
        raise HTTPException(
            status_code=409,
            detail=f"Этот Confluence уже подключён в проекте «{dup_project.name}» — присоединитесь к нему в профиле",
        )

    await _check_live(ConfluenceConnection(
        base_url=base_url, username=username, password=data.confluence_password,
    ))

    project = Project(
        name=name,
        confluence_base_url=base_url,
        jira_base_url=normalize_base_url(data.jira_base_url) or None if data.jira_base_url else None,
        created_by=current_user.id,
    )
    db.add(project)
    try:
        await db.flush()
    except IntegrityError:
        # Гонка с параллельным созданием: select выше имя не увидел, но индекс
        # uq_projects_name_lower его уже держит.
        raise HTTPException(
            status_code=409,
            detail="Проект с таким именем уже есть — возможно, стоит присоединиться к нему",
        )

    cred = ProjectCredential(
        project_id=project.id,
        user_id=current_user.id,
        confluence_username=username,
        confluence_password_enc=encrypt_secret(data.confluence_password),
        status="ok",
        last_check_at=datetime.now(timezone.utc),
        last_check_result="ok",
    )
    db.add(cred)
    await db.flush()

    return _item(project, cred)


@router.put("/{project_id}", response_model=ProjectListItem)
async def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Имя/Jira URL проекта. Менять может любой участник — в проекте все равны."""
    project = await _get_regular_project(db, project_id)
    cred = await get_my_credential(db, project.id, current_user)
    if cred is None:
        raise HTTPException(
            status_code=403,
            detail=f"Нет доступа к проекту «{project.name}». Подключитесь к нему в профиле",
        )

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Имя проекта не может быть пустым")
        if name.lower() != project.name.lower():
            taken = await db.execute(
                select(Project).where(func.lower(Project.name) == name.lower())
            )
            if taken.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Проект с таким именем уже есть")
        project.name = name

    if data.jira_base_url is not None:
        project.jira_base_url = normalize_base_url(data.jira_base_url) or None

    try:
        await db.flush()
    except IntegrityError:
        # Гонка с параллельным переименованием/созданием под тем же именем.
        raise HTTPException(status_code=409, detail="Проект с таким именем уже есть")
    return _item(project, cred)


@router.put("/{project_id}/credentials", response_model=ProjectListItem)
async def upsert_credentials(
    project_id: UUID,
    data: CredentialsUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Свои креды в проекте: первое сохранение = присоединиться.

    Сохраняются только после успешной живой проверки подключения.
    Пустой пароль у уже подключённого участника = не менять пароль.
    """
    project = await _get_regular_project(db, project_id)
    username = data.confluence_username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Укажите логин Confluence")

    cred = await get_my_credential(db, project.id, current_user)
    if data.confluence_password:
        password = data.confluence_password
    elif cred is not None:
        try:
            password = decrypt_secret(cred.confluence_password_enc)
        except InvalidToken:
            raise HTTPException(
                status_code=400,
                detail="Сохранённый пароль не читается (сменился ключ шифрования) — введите пароль заново",
            )
    else:
        raise HTTPException(status_code=400, detail="Укажите пароль Confluence")

    await _check_live(ConfluenceConnection(
        base_url=project.confluence_base_url, username=username, password=password,
    ))

    now = datetime.now(timezone.utc)
    if cred is None:
        cred = ProjectCredential(
            project_id=project.id,
            user_id=current_user.id,
            confluence_username=username,
            confluence_password_enc=encrypt_secret(password),
            status="ok",
            last_check_at=now,
            last_check_result="ok",
        )
        db.add(cred)
    else:
        cred.confluence_username = username
        cred.confluence_password_enc = encrypt_secret(password)
        cred.status = "ok"
        cred.last_check_at = now
        cred.last_check_result = "ok"

    try:
        await db.flush()
    except IntegrityError:
        # Двойной сабмит присоединения: обе вставки прошли проверку «кред ещё
        # нет», вторую отклонил uq_project_credentials_project_user.
        raise HTTPException(
            status_code=409,
            detail="Креды уже сохранены параллельным запросом — попробуйте ещё раз",
        )
    return _item(project, cred)


@router.post("/{project_id}/credentials/check", response_model=CredentialCheckResult)
async def check_credentials(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Проверить сохранённые креды. Отказ Confluence — это результат (invalid),
    а не ошибка запроса; недоступность сервера статус не меняет."""
    project = await _get_regular_project(db, project_id)
    cred = await get_my_credential(db, project.id, current_user)
    if cred is None:
        raise HTTPException(status_code=404, detail="Вы не подключены к этому проекту")

    conn = connection_for(project, cred)
    now = datetime.now(timezone.utc)
    try:
        await confluence.check_connection(conn)
    except ConfluenceAuthError:
        cred.status = "invalid"
        cred.last_check_at = now
        cred.last_check_result = "invalid"
        await db.flush()
        return CredentialCheckResult(status="invalid", last_check_at=now)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.warning("Confluence check failed for %s: %s", project.confluence_base_url, e)
        # Сервер недоступен (VPN, сеть) — креды не виноваты: status не трогаем,
        # но след попытки сохраняем. Коммит до raise: HTTPException откатит
        # транзакцию get_db (тот же паттерн, что mark_invalid).
        cred.last_check_at = now
        cred.last_check_result = "unreachable"
        await db.commit()
        raise HTTPException(
            status_code=502,
            detail=f"Не удалось подключиться к Confluence ({project.confluence_base_url}). Попробуйте позже",
        )

    cred.status = "ok"
    cred.last_check_at = now
    cred.last_check_result = "ok"
    await db.flush()
    return CredentialCheckResult(status="ok", last_check_at=now)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удалить проект целиком — для всех участников: страницы со снимками,
    baseline'ами и привязками, креды участников (каскадом). Право есть у
    любого участника — в проекте все равны. Порядок ручного каскада — как в
    delete_page: у этих FK нет ondelete."""
    project = await _get_regular_project(db, project_id)
    cred = await get_my_credential(db, project.id, current_user)
    if cred is None:
        raise HTTPException(
            status_code=403,
            detail=f"Нет доступа к проекту «{project.name}». Подключитесь к нему в профиле",
        )

    page_ids_q = select(Page.id).where(Page.project_id == project.id)
    highlight_ids_q = select(Highlight.id).where(Highlight.page_id.in_(page_ids_q))
    await db.execute(
        delete(HighlightTest).where(HighlightTest.highlight_id.in_(highlight_ids_q))
    )
    await db.execute(delete(Highlight).where(Highlight.page_id.in_(page_ids_q)))
    await db.execute(delete(Baseline).where(Baseline.page_id.in_(page_ids_q)))
    await db.execute(delete(PageSnapshot).where(PageSnapshot.page_id.in_(page_ids_q)))
    await db.execute(delete(Page).where(Page.project_id == project.id))

    await db.delete(project)  # project_credentials удаляются ondelete=CASCADE
    await db.flush()


@router.delete("/{project_id}/credentials", status_code=204)
async def disconnect_from_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Отключиться от проекта: удалить свои креды. Страницы, привязки и
    авторство не трогаем — проект остаётся жить у других участников."""
    project = await _get_regular_project(db, project_id)
    cred = await get_my_credential(db, project.id, current_user)
    if cred is not None:
        await db.delete(cred)
        await db.flush()
