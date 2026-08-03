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
from app.services.jira import JiraAuthError
from app.database import get_db
from app.jobs.scheduler import start_manual_run
from app.models.baseline import Baseline
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.models.snapshot import PageSnapshot
from app.models.user import User
from app.project_access import (
    connection_for,
    get_my_credential,
    normalize_base_url,
    require_project_access,
)
from app.schemas.project import (
    CredentialCheckResult,
    CredentialsUpsert,
    ProjectCreate,
    ProjectListItem,
    ProjectTestIndex,
    ProjectTestsStats,
    ProjectUpdate,
    TestIndexEntry,
    TestKeyLinks,
    TestLinkRef,
    UncoveredLinks,
    UncoveredStats,
)
from app.services import confluence, jira, test_names
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
        my_jira_token_status=(cred.jira_token_status if cred and cred.jira_token_enc else None),
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


def _norm_key(key: str) -> str:
    """Ключи аппер-кейсятся при вводе, но старые данные могли сохраниться
    иначе — агрегируем по нормализованной форме."""
    return (key or "").strip().upper()


@router.get("/stats", response_model=list[ProjectTestsStats])
async def projects_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сводка по проектам пользователя — ярус выбора экрана «Тесты».

    Видимость — как у дерева страниц: обычные проекты со статусом ok плюс
    личный демо-проект. Всё считается по локальной БД (агрегация в Python —
    объёмы малые, зато запросы простые и тестируемые).
    """
    memberships = await db.execute(
        select(Project)
        .join(ProjectCredential, ProjectCredential.project_id == Project.id)
        .where(
            ProjectCredential.user_id == current_user.id,
            ProjectCredential.status == "ok",
            Project.is_demo == False,  # noqa: E712
        )
        .order_by(Project.name)
    )
    projects: list[Project] = list(memberships.scalars().all())
    demo_result = await db.execute(
        select(Project).where(
            Project.is_demo == True, Project.created_by == current_user.id  # noqa: E712
        )
    )
    projects += list(demo_result.scalars().all())
    if not projects:
        return []

    project_ids = [p.id for p in projects]
    page_rows = (await db.execute(
        select(Page.id, Page.project_id).where(Page.project_id.in_(project_ids))
    )).all()
    page_project = {page_id: project_id for page_id, project_id in page_rows}

    hl_rows = []
    if page_project:
        hl_rows = (await db.execute(
            select(Highlight.id, Highlight.page_id, Highlight.status)
            .where(Highlight.page_id.in_(list(page_project)))
        )).all()
    hl_project = {hl_id: page_project[page_id] for hl_id, page_id, _ in hl_rows}

    link_rows = []
    if hl_project:
        link_rows = (await db.execute(
            select(HighlightTest.highlight_id, HighlightTest.test_key)
            .where(HighlightTest.highlight_id.in_(list(hl_project)))
        )).all()

    stats = {
        p.id: ProjectTestsStats(project_id=p.id, project_name=p.name, is_demo=p.is_demo)
        for p in projects
    }
    for _, project_id in page_rows:
        stats[project_id].pages += 1
    for _, page_id, status in hl_rows:
        s = stats[page_project[page_id]]
        s.highlights += 1
        if status == "active":
            s.active += 1
        elif status == "outdated":
            s.outdated += 1
        elif status == "lost":
            s.lost += 1
    covered: set = set()
    keys_by_project: dict = {}
    for hl_id, key in link_rows:
        covered.add(hl_id)
        keys_by_project.setdefault(hl_project[hl_id], set()).add(_norm_key(key))
    for hl_id in covered:
        stats[hl_project[hl_id]].covered += 1
    for project_id, keys in keys_by_project.items():
        stats[project_id].tests = len(keys)

    # Свежесть автообновления (v1.6.2): когда ночной прогон в последний раз
    # проверял проект. skipped/failed не в счёт — страницы тогда не проверялись.
    run_rows = (await db.execute(
        select(RefreshRun.project_id, func.max(RefreshRun.finished_at))
        .where(
            RefreshRun.project_id.in_(project_ids),
            RefreshRun.status.in_(("ok", "partial")),
        )
        .group_by(RefreshRun.project_id)
    )).all()
    for project_id, finished_at in run_rows:
        stats[project_id].last_auto_refresh_at = finished_at

    # Последняя попытка любого исхода (v1.6.4): не удалась — карточка
    # предупредит, что свежесть застыла не просто так (VPN/сеть/креды).
    attempt_rows = (await db.execute(
        select(
            RefreshRun.project_id, RefreshRun.status,
            RefreshRun.details, RefreshRun.finished_at,
        )
        .where(
            RefreshRun.project_id.in_(project_ids),
            RefreshRun.finished_at.isnot(None),
        )
        .distinct(RefreshRun.project_id)
        .order_by(RefreshRun.project_id, RefreshRun.finished_at.desc())
    )).all()
    for project_id, status, details, finished_at in attempt_rows:
        stats[project_id].last_attempt_at = finished_at
        if status == "skipped":
            reason = (details or {}).get("skipped_reason")
            if reason in ("confluence_unreachable", "no_valid_credentials"):
                stats[project_id].last_attempt_reason = reason

    return [stats[p.id] for p in projects]


@router.get("/{project_id}/tests", response_model=ProjectTestIndex)
async def project_test_index(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Реверс-индекс тестов проекта — ЛЁГКИЙ список (v1.7.3): ключ, название,
    счётчики статусов и страниц. Цитаты сюда сознательно НЕ грузятся (ни из
    БД, ни в ответ): весь индекс с цитатами весил бы мегабайты уже на сотнях
    тестов, а закрытой строке списка нужны только счётчики. Привязки ключа
    отдаёт project_test_links — при раскрытии строки.

    Доступ — как к контенту проекта (членство ok; чужое демо «не существует»).
    Ключи агрегируются по нормализованной форме; порядок ключей — дело фронта
    (натуральная сортировка уже живёт там, testOrder.ts).
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await require_project_access(db, project, current_user)

    page_rows = (await db.execute(
        select(Page.id).where(Page.project_id == project.id)
    )).all()
    page_ids = [row[0] for row in page_rows]

    hl_rows = []
    if page_ids:
        hl_rows = (await db.execute(
            select(Highlight.id, Highlight.page_id, Highlight.status)
            .where(Highlight.page_id.in_(page_ids))
        )).all()
    hl_by_id = {hl_id: (page_id, status) for hl_id, page_id, status in hl_rows}

    link_rows = []
    if hl_by_id:
        link_rows = (await db.execute(
            select(HighlightTest.highlight_id, HighlightTest.test_key)
            .where(HighlightTest.highlight_id.in_(list(hl_by_id)))
        )).all()

    counts: dict[str, dict[str, int]] = {}
    key_pages: dict[str, set] = {}
    covered_pages: set = set()
    for hl_id, key in link_rows:
        page_id, status = hl_by_id[hl_id]
        norm = _norm_key(key)
        per_key = counts.setdefault(norm, {"active": 0, "outdated": 0, "lost": 0})
        if status in per_key:
            per_key[status] += 1
        key_pages.setdefault(norm, set()).add(page_id)
        covered_pages.add(page_id)

    # Привязки без единого теста (v1.7.5): hl_rows уже подняты целиком, а
    # covered-множество известно из link_rows — разница считается бесплатно,
    # без новых запросов. Без этих цифр чип «Требует проверки» яруса 1 обещал
    # больше, чем ярус 2 показывал.
    covered_ids = {hl_id for hl_id, _ in link_rows}
    uncovered = UncoveredStats()
    uncovered_pages: set = set()
    for hl_id, (page_id, status) in hl_by_id.items():
        if hl_id in covered_ids:
            continue
        if status == "active":
            uncovered.active += 1
        elif status == "outdated":
            uncovered.outdated += 1
        elif status == "lost":
            uncovered.lost += 1
        uncovered_pages.add(page_id)
    uncovered.pages_count = len(uncovered_pages)

    # Названия тестов из Jira (v1.7.0) — свойство ключа, не привязки.
    details = await test_names.load_details(db, project.id)
    tests = [
        TestIndexEntry(
            key=key,
            summary=details[key].summary if key in details else None,
            jira_status=details[key].fetch_result if key in details else None,
            active=per_key["active"],
            outdated=per_key["outdated"],
            lost=per_key["lost"],
            pages_count=len(key_pages[key]),
        )
        for key, per_key in sorted(counts.items())
    ]
    return ProjectTestIndex(
        project_id=project.id,
        project_name=project.name,
        jira_base_url=project.jira_base_url,
        pages_covered=len(covered_pages),
        tests=tests,
        uncovered=uncovered,
    )


@router.get("/{project_id}/test-links", response_model=TestKeyLinks)
async def project_test_links(
    project_id: UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Привязки одного ключа с цитатами — вторая половина реверс-индекса
    (v1.7.3): грузится при раскрытии строки на экране «Тесты».

    key принимается в любом написании и нормализуется как в списке
    (upper/trim); нормализация продублирована в SQL, чтобы не поднимать из БД
    цитаты чужих ключей. key — query-параметр, а не сегмент пути:
    нестандартные ключи бывают с «/» и ломали бы маршрут.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await require_project_access(db, project, current_user)

    norm = _norm_key(key)
    rows = (await db.execute(
        select(
            HighlightTest.id, Highlight.id, Highlight.page_id,
            Highlight.status, Highlight.text_content, Page.title,
        )
        .join(Highlight, Highlight.id == HighlightTest.highlight_id)
        .join(Page, Page.id == Highlight.page_id)
        .where(
            Page.project_id == project.id,
            func.upper(func.trim(HighlightTest.test_key)) == norm,
        )
    )).all()

    links = [
        TestLinkRef(
            link_id=link_id,
            highlight_id=hl_id,
            page_id=page_id,
            page_title=page_title,
            status=status,
            # Цитата целиком (v1.6.5): именно текст требования — то, ради
            # чего открывают реверс-индекс; сколько строк показать, решает
            # фронт (line-clamp).
            excerpt=text or "",
        )
        for link_id, hl_id, page_id, status, text, page_title in rows
    ]
    links.sort(key=lambda l: (l.page_title, l.excerpt))
    # Пустой список — не 404: ключ могли отвязать, пока строка была открыта.
    return TestKeyLinks(key=norm, links=links)


@router.get("/{project_id}/uncovered-links", response_model=UncoveredLinks)
async def project_uncovered_links(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Привязки без единого теста — пара к project_test_links (v1.7.5):
    грузится при раскрытии строки «Привязки без тестов» на экране «Тесты».

    Форма ссылок та же (TestLinkRef), только link_id пуст — записи
    HighlightTest не существует по определению. Пустой список — не 404:
    последнюю непокрытую привязку могли покрыть, пока строка была открыта.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await require_project_access(db, project, current_user)

    rows = (await db.execute(
        select(
            Highlight.id, Highlight.page_id,
            Highlight.status, Highlight.text_content, Page.title,
        )
        .join(Page, Page.id == Highlight.page_id)
        .where(
            Page.project_id == project.id,
            ~select(HighlightTest.id)
            .where(HighlightTest.highlight_id == Highlight.id)
            .exists(),
        )
    )).all()

    links = [
        TestLinkRef(
            link_id=None,
            highlight_id=hl_id,
            page_id=page_id,
            page_title=page_title,
            status=status,
            excerpt=text or "",
        )
        for hl_id, page_id, status, text, page_title in rows
    ]
    links.sort(key=lambda l: (l.page_title, l.excerpt))
    return UncoveredLinks(links=links)


@router.post("/{project_id}/refresh-run", status_code=202)
async def refresh_project_now(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ручной прогон проекта (v1.6.4): «Обновить страницы сейчас» с карточки.

    Полный прогон (перепроверка кред → sync-tree → refresh) стартует фоном,
    итог придёт в журнал/колокольчик; кредам инициатора — приоритет. Доступ —
    участникам с рабочим подключением. 409 — какой-то прогон уже идёт
    (ночной, добор или чей-то ручной): второй параллельный не запускаем.
    """
    project = await _get_regular_project(db, project_id)
    await require_project_access(db, project, current_user)
    if not await start_manual_run(project.id, prefer_user_id=current_user.id):
        raise HTTPException(
            status_code=409,
            detail="Прогон обновления уже идёт — попробуйте через пару минут",
        )
    return {"started": True}


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

    # Личный Jira-токен (v1.7.0): None — не трогать, "" — удалить, непустой —
    # живая проверка (GET /myself) и сохранение. Токен нужен ТОЛЬКО для чтения
    # названий тестов; без него фича молчит.
    jira_token = data.jira_token.strip() if data.jira_token is not None else None
    if jira_token:
        if not project.jira_base_url:
            raise HTTPException(
                status_code=400,
                detail="У проекта не указан адрес Jira — добавьте его в «Изменить проект», затем сохраните токен",
            )
        try:
            await jira.check_token(project.jira_base_url, jira_token)
        except JiraAuthError:
            raise HTTPException(
                status_code=400,
                detail="Jira отклонила токен — проверьте его в профиле Jira (Personal Access Tokens)",
            )
        except Exception:
            raise HTTPException(
                status_code=502,
                detail="Jira недоступна — токен не проверить. Проверьте VPN и попробуйте ещё раз",
            )

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

    if jira_token:
        cred.jira_token_enc = encrypt_secret(jira_token)
        cred.jira_token_status = "ok"
    elif jira_token == "":
        cred.jira_token_enc = None
        cred.jira_token_status = None

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
