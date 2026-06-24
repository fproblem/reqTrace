import logging
import urllib.parse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.page import Page
from app.models.snapshot import PageSnapshot
from app.models.baseline import Baseline
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.schemas.page import (
    PageCreate, PageListItem, PageDetail,
    SnapshotInfo, BaselineInfo, BaselineCreate, RefreshRequest,
    TreeNodeItem, SpaceTreeResponse,
)
from app.services import confluence
from app.services.confluence import ConfluenceConnection, process_confluence_html
from app.services.diff_engine import has_text_changed
from app.services.highlight_projection import project_highlights
from app.routers.settings import get_confluence_params, get_jira_base_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pages", tags=["pages"])

DEMO_HTML = """
<h1>Экран «Каталог товаров»</h1>
<h2>1. Инициализация</h2>
<p>При открытии экрана каталога приложение отправляет запрос <code>GET /api/v2/catalog</code>
с параметрами <code>page=1</code>, <code>limit=20</code>, <code>sort=popular</code>.
Данные кешируются на 5 минут. При отсутствии сети отображается последний закешированный результат.</p>
<h2>2. Компоновка</h2>
<table>
<tr><th>Элемент</th><th>Описание</th></tr>
<tr><td>Поисковая строка</td><td>Отображается в верхней части экрана. Placeholder: «Найти товар». При фокусе появляется клавиатура. Иконка лупы слева, крестик очистки справа (появляется при вводе текста).</td></tr>
<tr><td>Фильтры</td><td>Горизонтальный скролл с пилюлями категорий. Активная категория выделена зелёным фоном. По умолчанию выбрана «Все».</td></tr>
<tr><td>Карточка товара</td><td>Сетка 2 колонки. Содержит: изображение (aspect ratio 1:1, скругление 12px), название (макс. 2 строки, обрезка с многоточием), цена (жирный шрифт), кнопка «В корзину».</td></tr>
<tr><td>Пустое состояние</td><td>Отображается при пустом результате поиска. Иконка, текст «Ничего не найдено», кнопка «Сбросить фильтры».</td></tr>
</table>
<h2>3. Логика работы</h2>
<p>При нажатии на карточку товара — переход на экран детальной информации. Анимация push-перехода, длительность 300мс.</p>
<p>При нажатии «В корзину» — товар добавляется в корзину. Кнопка меняется на счётчик с «−» и «+». Запрос <code>POST /api/v2/cart/add</code> отправляется с задержкой 500мс (debounce) для группировки быстрых нажатий.</p>
<p>Pull-to-refresh обновляет каталог. Во время обновления отображается индикатор загрузки. Если запрос завершился ошибкой — показывается toast «Не удалось обновить каталог» с кнопкой «Повторить».</p>
<h2>4. Пагинация</h2>
<p>Бесконечная прокрутка. При достижении конца списка автоматически загружается следующая страница. Индикатор загрузки внизу списка. Если достигнут конец каталога — текст «Вы просмотрели все товары».</p>
"""


# Страница-полигон для ручного тестирования выделения (highlight) текста.
# Намеренно написана как итоговый HTML (без ac:-макросов Confluence), чтобы
# структура блоков на бэкенде (extract_blocks) и на фронтенде (getContentBlocks)
# совпадала. Так под тестом остаётся ровно одна переменная — логика выделения,
# а не различия raw/processed-разметки. Каждый раздел помечен меткой §N; разделы
# с ⚠ — наиболее вероятные места поломки (вложенная структура блоков).
FORMATTING_TEST_HTML = """
<h1>🧪 Полигон форматирования и выделения текста</h1>
<p>Страница для проверки механизма выделения (highlight) и привязки тестов на всех типах
форматирования. Выделяйте текст в каждом разделе, жмите «Привязать тесты» и проверяйте,
что подсветка остаётся ровно на выделенном фрагменте, а не «улетает» в начало страницы
или не исчезает. Метка <code>§N</code> — номер раздела; <strong>⚠</strong> отмечает разделы
с повышенным риском.</p>

<h2>§1. Обычный абзац (контроль)</h2>
<p>Это простой абзац без вложенного форматирования. Выделение здесь обязано работать корректно:
подсветка остаётся на выделенном фрагменте. Используйте его как эталон ожидаемого поведения.</p>

<h2>§2. Инлайн-форматирование внутри абзаца</h2>
<p>В этом абзаце есть <strong>полужирный текст</strong>, <em>курсив</em>, <u>подчёркнутый</u>,
<s>зачёркнутый</s>, верхний<sup>индекс</sup> и нижний<sub>индекс</sub>, встроенный код
<code>response.status == 200</code>, а также <a href="https://example.com">внешняя ссылка</a>.
Из-за форматирования абзац состоит из множества текстовых узлов — выделяйте фрагменты,
пересекающие границы форматирования (например, от «полужирный» до «курсив»), и проверяйте
точность смещений начала и конца подсветки.</p>

<h2>§3. Заголовки</h2>
<h3>§3.1 Заголовок третьего уровня</h3>
<p>Текст под заголовком третьего уровня — для проверки выделения заголовка целиком.</p>
<h4>§3.2 Заголовок четвёртого уровня</h4>
<p>Текст под заголовком четвёртого уровня.</p>

<h2>§4. Плоский маркированный список</h2>
<ul>
<li>Первый пункт списка — короткий.</li>
<li>Второй пункт списка, в котором текста чуть побольше, чтобы было что выделять.</li>
<li>Третий пункт списка с <strong>полужирным</strong> словом внутри.</li>
</ul>
<p>Проверьте два сценария: (а) выделение внутри одного пункта; (б) выделение, охватывающее
сразу несколько пунктов, — частая причина «улёта» подсветки в начало страницы.</p>

<h2>§5. Плоский нумерованный список</h2>
<ol>
<li>Шаг первый: открыть экран каталога.</li>
<li>Шаг второй: нажать на карточку товара.</li>
<li>Шаг третий: убедиться в открытии детального экрана.</li>
</ol>

<h2>§6 ⚠ Вложенный список (главный подозреваемый)</h2>
<ul>
<li>Родительский пункт с собственным текстом, у которого есть вложенный список:
<ul>
<li>Вложенный пункт A.</li>
<li>Вложенный пункт B с <em>курсивом</em>.</li>
</ul>
</li>
<li>Ещё один родительский пункт с двумя уровнями вложенности:
<ul>
<li>Уровень 2 — пункт с подпунктами:
<ol>
<li>Уровень 3 — пункт один.</li>
<li>Уровень 3 — пункт два.</li>
</ol>
</li>
</ul>
</li>
</ul>
<p>Особое внимание: выделите именно <strong>текст родительского пункта</strong>
(«Родительский пункт с собственным текстом…»). Такой текст не лежит в «листовом» блоке,
поэтому подсветка с большой вероятностью улетит в начало страницы.</p>

<h2>§7. Список с разнообразным инлайн-форматированием</h2>
<ul>
<li>Пункт со ссылкой <a href="https://example.com">на документацию</a> и кодом <code>GET /api/v2/items</code>.</li>
<li>Пункт с <em>курсивом</em>, <s>зачёркиванием</s> и эмодзи 🚀 внутри.</li>
</ul>

<h2>§8. Пункты списка, обёрнутые в абзац</h2>
<ul>
<li><p>Этот пункт содержит абзац внутри (li → p). Структура блоков отличается от обычного списка.</p></li>
<li><p>Второй такой же пункт. Проверьте смещение подсветки относительно §4.</p></li>
</ul>

<h2>§9. Таблица</h2>
<table>
<tbody>
<tr><th>Поле</th><th>Описание</th></tr>
<tr><td>Логин</td><td>Строка, обязательное поле. <strong>Не более 32 символов.</strong></td></tr>
<tr><td>Пароль</td><td>Минимум 8 символов, хотя бы одна цифра и одна <em>заглавная</em> буква.</td></tr>
</tbody>
</table>

<h2>§10 ⚠ Таблица со списком внутри ячейки</h2>
<table>
<tbody>
<tr><th>Сценарий</th><th>Шаги</th></tr>
<tr><td>Авторизация</td><td>Перед списком идёт прямой текст ячейки, а затем шаги:
<ul>
<li>ввести логин;</li>
<li>ввести пароль;</li>
<li>нажать «Войти».</li>
</ul>
</td></tr>
</tbody>
</table>
<p>Выделите «прямой текст ячейки» (фразу до списка) — ячейка с вложенным списком не является
листовым блоком, поэтому это потенциально проблемный случай.</p>

<h2>§11. Список определений (dt / dd)</h2>
<dl>
<dt>Идемпотентность</dt>
<dd>Свойство операции давать один и тот же результат при повторном выполнении.</dd>
<dt>Дебаунс</dt>
<dd>Задержка перед отправкой запроса для группировки частых событий.</dd>
</dl>

<h2>§12. Блок кода</h2>
<pre style="background:#f4f5f7;border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:14px 18px;overflow-x:auto;font-size:12.5px;line-height:1.55;margin:10px 0;font-family:'SF Mono',Menlo,Consolas,monospace;"><code>{
  "id": 42,
  "name": "Товар",
  "price": 199.0,
  "tags": ["new", "sale"]
}</code></pre>
<p>Выделите несколько строк внутри блока кода и привяжите тест.</p>

<h2>§13 ⚠ Цитата</h2>
<blockquote style="margin:8px 0;padding:6px 16px;border-left:3px solid rgba(0,0,0,0.15);color:#5e6c84;"><p>Цитата, обёрнутая в абзац. Здесь подсветка обычно работает (абзац — листовой блок).</p></blockquote>
<blockquote style="margin:8px 0;padding:6px 16px;border-left:3px solid rgba(0,0,0,0.15);color:#5e6c84;">Цитата с прямым текстом без абзаца внутри. Текст лежит прямо в blockquote — потенциально проблемный случай выделения.</blockquote>

<h2>§14. Инлайн-элементы (бейдж, ссылка-задача, эмодзи)</h2>
<p>Статус задачи:
<span style="display:inline-block;padding:1px 8px;border-radius:4px;font-size:0.82em;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;color:#14892c;background:rgba(20,137,44,0.08);border:1px solid #14892c30;">Готово</span>,
связанная задача
<a href="#" style="display:inline-flex;align-items:center;gap:4px;color:#2a6496;font-weight:500;text-decoration:none;background:rgba(42,100,150,0.06);padding:1px 6px;border-radius:4px;font-size:0.92em;">🔗 PROJ-123</a>,
значок проверки ✅. Выделите фрагмент, пересекающий эти инлайн-элементы.</p>

<h2>§15. Абзац с переносами строк и пробелами</h2>
<p>Первая строка абзаца,<br/>вторая строка после переноса,<br/>третья строка.
Здесь   несколько   подряд   идущих   пробелов, а также ведущие и хвостовые пробелы,
которые проверяют логику обрезки (trim) смещений выделения.</p>
"""


async def _render_html(raw_html: str | None, page_id, db: AsyncSession) -> str | None:
    """Process stored Confluence HTML so images, Jira links, statuses etc. render correctly."""
    if not raw_html:
        return raw_html
    jira_url = await get_jira_base_url(db)
    return process_confluence_html(raw_html, str(page_id), jira_base_url=jira_url)


async def _create_demo_page(
    db: AsyncSession,
    *,
    user_id,
    title: str,
    content_html: str,
    space_key: str = "DEMO",
    id_prefix: str = "demo",
) -> PageDetail:
    """Create a self-contained demo page (page + snapshot + baseline) without Confluence."""
    import uuid as _uuid

    demo_id = f"{id_prefix}-" + str(_uuid.uuid4())[:8]

    page = Page(
        confluence_page_id=demo_id,
        confluence_url=f"https://confluence.example.com/pages/viewpage.action?pageId={demo_id}",
        title=title,
        space_key=space_key,
        added_by=user_id,
    )
    db.add(page)
    await db.flush()

    snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=1,
        content_html=content_html,
    )
    db.add(snapshot)
    await db.flush()

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=snapshot.id,
        confirmed_by=user_id,
    )
    db.add(baseline)
    await db.flush()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        is_virtual=page.is_virtual,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ),
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ),
        content_html=await _render_html(snapshot.content_html, page.id, db),
    )


@router.post("/demo", response_model=PageDetail)
async def add_demo_page(data: BaselineCreate, db: AsyncSession = Depends(get_db)):
    """Add a demo page with sample content for testing without Confluence."""
    return await _create_demo_page(
        db,
        user_id=data.user_id,
        title="Экран «Каталог товаров» — Требования",
        content_html=DEMO_HTML,
    )


@router.post("/demo/formatting", response_model=PageDetail)
async def add_formatting_test_page(data: BaselineCreate, db: AsyncSession = Depends(get_db)):
    """Add a formatting test page — a playground for manually testing text highlighting."""
    return await _create_demo_page(
        db,
        user_id=data.user_id,
        title="🧪 Полигон форматирования и выделения",
        content_html=FORMATTING_TEST_HTML,
        id_prefix="fmt",
    )


@router.post("", response_model=PageDetail)
async def add_page(data: PageCreate, db: AsyncSession = Depends(get_db)):
    """Add a Confluence page by URL. Fetches content and creates initial baseline."""
    try:
        page_id_str = confluence.extract_page_id_from_url(data.confluence_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing_result = await db.execute(
        select(Page).where(Page.confluence_page_id == page_id_str)
    )
    existing_page = existing_result.scalar_one_or_none()
    if existing_page and not existing_page.is_virtual:
        raise HTTPException(status_code=409, detail="Page already tracked")

    params = await get_confluence_params(db)
    conn = ConfluenceConnection(**params)

    try:
        page_data = await confluence.fetch_page(page_id_str, conn)
    except Exception as e:
        logger.error("Failed to fetch Confluence page %s: %s", page_id_str, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch page from Confluence: {e}")

    # Sync full space tree: create virtual pages for ALL pages in the space
    conf_base_url = params["base_url"].rstrip("/")
    try:
        space_pages = await confluence.fetch_space_pages(page_data.space_key, conn)
    except Exception as e:
        logger.warning("Failed to fetch space tree for %s: %s — falling back to ancestors only",
                       page_data.space_key, e)
        space_pages = []

    if space_pages:
        # Build a set of confluence_page_ids already in the DB for this space
        space_existing = await db.execute(
            select(Page.confluence_page_id).where(Page.space_key == page_data.space_key)
        )
        existing_cpids = set(space_existing.scalars().all())

        for sp in space_pages:
            if sp.page_id not in existing_cpids and sp.page_id != page_id_str:
                virtual_page = Page(
                    confluence_page_id=sp.page_id,
                    confluence_url=f"{conf_base_url}/pages/viewpage.action?pageId={sp.page_id}",
                    title=sp.title,
                    space_key=page_data.space_key,
                    parent_confluence_page_id=sp.parent_page_id,
                    is_virtual=True,
                    added_by=data.user_id,
                )
                db.add(virtual_page)
                existing_cpids.add(sp.page_id)
        await db.flush()
    else:
        # Fallback: create virtual ancestors only (original behavior)
        prev_ancestor_id: str | None = None
        for ancestor in page_data.ancestors:
            existing_ancestor = await db.execute(
                select(Page).where(Page.confluence_page_id == ancestor.page_id)
            )
            if not existing_ancestor.scalar_one_or_none():
                virtual_page = Page(
                    confluence_page_id=ancestor.page_id,
                    confluence_url=f"{conf_base_url}/pages/viewpage.action?pageId={ancestor.page_id}",
                    title=ancestor.title,
                    space_key=page_data.space_key,
                    parent_confluence_page_id=prev_ancestor_id,
                    is_virtual=True,
                    added_by=data.user_id,
                )
                db.add(virtual_page)
                await db.flush()
            prev_ancestor_id = ancestor.page_id

    # Determine parent: last ancestor in the chain
    parent_cpid = page_data.ancestors[-1].page_id if page_data.ancestors else None

    if existing_page and existing_page.is_virtual:
        # Convert virtual page to a real tracked page
        existing_page.is_virtual = False
        existing_page.confluence_url = data.confluence_url
        existing_page.title = page_data.title
        existing_page.space_key = page_data.space_key
        existing_page.parent_confluence_page_id = parent_cpid
        page = existing_page
        await db.flush()
    else:
        page = Page(
            confluence_page_id=page_data.page_id,
            confluence_url=data.confluence_url,
            title=page_data.title,
            space_key=page_data.space_key,
            parent_confluence_page_id=parent_cpid,
            added_by=data.user_id,
        )
        db.add(page)
        await db.flush()

    snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    )
    db.add(snapshot)
    await db.flush()

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)
    await db.flush()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        is_virtual=page.is_virtual,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ),
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ),
        content_html=await _render_html(snapshot.content_html, page.id, db),
    )


@router.get("", response_model=list[PageListItem])
async def list_pages(db: AsyncSession = Depends(get_db)):
    """List all tracked pages with coverage stats."""
    result = await db.execute(
        select(Page).where(Page.is_virtual == False).order_by(Page.created_at.desc())
    )
    pages = result.scalars().all()

    items = []
    for page in pages:
        snap_result = await db.execute(
            select(PageSnapshot)
            .where(PageSnapshot.page_id == page.id)
            .order_by(PageSnapshot.fetched_at.desc())
            .limit(1)
        )
        latest_snapshot = snap_result.scalar_one_or_none()

        bl_result = await db.execute(
            select(Baseline)
            .where(Baseline.page_id == page.id)
            .order_by(Baseline.confirmed_at.desc())
            .limit(1)
        )
        latest_baseline = bl_result.scalar_one_or_none()

        hl_count = await db.execute(
            select(func.count(Highlight.id))
            .where(Highlight.page_id == page.id)
        )
        highlight_count = hl_count.scalar() or 0

        has_updates = False

        items.append(PageListItem(
            id=page.id,
            confluence_page_id=page.confluence_page_id,
            confluence_url=page.confluence_url,
            title=page.title,
            space_key=page.space_key,
            created_at=page.created_at,
            last_snapshot_at=latest_snapshot.fetched_at if latest_snapshot else None,
            baseline_at=latest_baseline.confirmed_at if latest_baseline else None,
            coverage_percent=min(highlight_count * 10.0, 100.0),
            has_updates=has_updates,
        ))

    return items


@router.get("/tree", response_model=list[SpaceTreeResponse])
async def get_page_tree(db: AsyncSession = Depends(get_db)):
    """Get all pages grouped by space as a tree structure."""
    result = await db.execute(
        select(Page).order_by(Page.space_key, Page.title)
    )
    pages = result.scalars().all()

    # Compute coverage for tracked pages
    nodes: list[TreeNodeItem] = []
    for page in pages:
        coverage = 0.0
        if not page.is_virtual:
            hl_count = await db.execute(
                select(func.count(Highlight.id))
                .where(Highlight.page_id == page.id)
            )
            highlight_count = hl_count.scalar() or 0
            coverage = min(highlight_count * 10.0, 100.0)

        nodes.append(TreeNodeItem(
            id=page.id,
            confluence_page_id=page.confluence_page_id,
            title=page.title,
            space_key=page.space_key,
            is_virtual=page.is_virtual,
            parent_confluence_page_id=page.parent_confluence_page_id,
            coverage_percent=coverage,
            has_updates=False,
        ))

    # Group by space_key
    spaces: dict[str, list[TreeNodeItem]] = {}
    for node in nodes:
        key = node.space_key or "OTHER"
        spaces.setdefault(key, []).append(node)

    return [
        SpaceTreeResponse(space_key=sk, pages=pg)
        for sk, pg in spaces.items()
    ]


@router.get("/{page_id}", response_model=PageDetail)
async def get_page(page_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get detailed page information with current content."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()

    bl_result = await db.execute(
        select(Baseline)
        .where(Baseline.page_id == page.id)
        .order_by(Baseline.confirmed_at.desc())
        .limit(1)
    )
    latest_baseline = bl_result.scalar_one_or_none()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        is_virtual=page.is_virtual,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=latest_snapshot.id,
            confluence_version=latest_snapshot.confluence_version,
            fetched_at=latest_snapshot.fetched_at,
        ) if latest_snapshot else None,
        baseline=BaselineInfo(
            id=latest_baseline.id,
            snapshot_id=latest_baseline.snapshot_id,
            confirmed_by=latest_baseline.confirmed_by,
            confirmed_at=latest_baseline.confirmed_at,
        ) if latest_baseline else None,
        content_html=(await _render_html(latest_snapshot.content_html, page.id, db)) if latest_snapshot else None,
    )


@router.post("/{page_id}/promote", response_model=PageDetail)
async def promote_page(page_id: UUID, data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Promote a virtual page to a fully tracked page by fetching its content from Confluence."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if not page.is_virtual:
        raise HTTPException(status_code=400, detail="Page is already tracked")

    params = await get_confluence_params(db)
    conn = ConfluenceConnection(**params)

    try:
        page_data = await confluence.fetch_page(page.confluence_page_id, conn)
    except Exception as e:
        logger.error("Failed to fetch Confluence page %s: %s", page.confluence_page_id, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch page from Confluence: {e}")

    page.is_virtual = False
    page.title = page_data.title
    page.confluence_url = f"{params['base_url'].rstrip('/')}/pages/viewpage.action?pageId={page.confluence_page_id}"
    await db.flush()

    snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    )
    db.add(snapshot)
    await db.flush()

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)
    await db.flush()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        is_virtual=page.is_virtual,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ),
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ),
        content_html=await _render_html(snapshot.content_html, page.id, db),
    )


@router.post("/{page_id}/refresh", response_model=PageDetail)
async def refresh_page(page_id: UUID, data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh page content from Confluence. Projects highlights if content changed."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    params = await get_confluence_params(db)
    conn = ConfluenceConnection(**params)

    try:
        page_data = await confluence.fetch_page(page.confluence_page_id, conn)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from Confluence: {e}")

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()

    if latest_snapshot and not has_text_changed(latest_snapshot.content_html, page_data.content_html):
        return await get_page(page_id, db)

    new_snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    )
    db.add(new_snapshot)
    await db.flush()

    page.title = page_data.title

    hl_result = await db.execute(
        select(Highlight)
        .where(Highlight.page_id == page.id, Highlight.status != "lost")
    )
    highlights = hl_result.scalars().all()

    if highlights:
        hl_dicts = [
            {
                "id": h.id,
                "text_content": h.text_content,
                "text_before": h.text_before or "",
                "text_after": h.text_after or "",
                "anchor_block_start": h.anchor_block_start,
                "anchor_block_end": h.anchor_block_end,
                "start_char_offset": h.start_char_offset,
                "end_char_offset": h.end_char_offset,
            }
            for h in highlights
        ]

        old_html = latest_snapshot.content_html if latest_snapshot else None
        projected = project_highlights(hl_dicts, page_data.content_html, old_html)

        for proj in projected:
            for h in highlights:
                if h.id == proj["id"]:
                    projected_status = proj["projected_status"]
                    # Only a human action (reanchor) can resolve outdated → active.
                    # Refresh must not silently clear an outdated status.
                    if h.status == "outdated" and projected_status == "active":
                        projected_status = "outdated"
                    h.status = projected_status
                    if "new_anchor_block_start" in proj:
                        h.anchor_block_start = proj["new_anchor_block_start"]
                        h.anchor_block_end = proj["new_anchor_block_end"]
                        h.start_char_offset = proj["new_start_char_offset"]
                        h.end_char_offset = proj["new_end_char_offset"]
                    break

    await db.flush()
    return await get_page(page_id, db)


@router.post("/{page_id}/baseline", response_model=BaselineInfo)
async def set_baseline(page_id: UUID, data: BaselineCreate, db: AsyncSession = Depends(get_db)):
    """Set the current snapshot as the new baseline."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=400, detail="No snapshots available")

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=latest_snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)

    await db.flush()
    await db.refresh(baseline)

    return BaselineInfo(
        id=baseline.id,
        snapshot_id=baseline.snapshot_id,
        confirmed_by=baseline.confirmed_by,
        confirmed_at=baseline.confirmed_at,
    )


@router.delete("/{page_id}", status_code=204)
async def delete_page(page_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a tracked page and all its related data (snapshots, baselines, highlights).
    Also cleans up orphaned virtual ancestors."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Remember space key before deletion
    space_key = page.space_key

    highlight_ids_q = select(Highlight.id).where(Highlight.page_id == page_id)
    await db.execute(
        delete(HighlightTest).where(HighlightTest.highlight_id.in_(highlight_ids_q))
    )
    await db.execute(delete(Highlight).where(Highlight.page_id == page_id))
    await db.execute(delete(Baseline).where(Baseline.page_id == page_id))
    await db.execute(delete(PageSnapshot).where(PageSnapshot.page_id == page_id))

    await db.delete(page)
    await db.flush()

    # If no real (non-virtual) pages remain in this space, clean up all virtual pages
    if space_key:
        real_count_result = await db.execute(
            select(func.count(Page.id))
            .where(Page.space_key == space_key, Page.is_virtual == False)
        )
        real_count = real_count_result.scalar() or 0

        if real_count == 0:
            # Bulk-remove all remaining virtual pages in this space
            await db.execute(
                delete(Page).where(Page.space_key == space_key, Page.is_virtual == True)
            )
            await db.flush()

    return Response(status_code=204)


async def _confluence_image_response(
    download_url: str, params: dict
) -> Response:
    """Fetch an image from Confluence and return it as a FastAPI Response."""
    auth = None
    if params["username"] and params["password"]:
        auth = httpx.BasicAuth(params["username"], params["password"])

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(download_url, auth=auth)

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Attachment not found on Confluence")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(
        content=resp.content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{page_id}/attachments/{filename:path}")
async def get_attachment(
    page_id: UUID, filename: str, db: AsyncSession = Depends(get_db)
):
    """Proxy a page attachment image from Confluence."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    params = await get_confluence_params(db)
    base_url = params["base_url"].rstrip("/")

    decoded = urllib.parse.unquote(filename)
    encoded = urllib.parse.quote(decoded, safe="")
    download_url = f"{base_url}/download/attachments/{page.confluence_page_id}/{encoded}"

    return await _confluence_image_response(download_url, params)


confluence_proxy_router = APIRouter(prefix="/api", tags=["proxy"])


@confluence_proxy_router.get("/confluence-proxy")
async def proxy_confluence_resource(
    url: str = Query(..., description="Relative Confluence URL to proxy"),
    db: AsyncSession = Depends(get_db),
):
    """Proxy any relative Confluence resource (images, thumbnails, etc.)."""
    if not url.startswith("/"):
        raise HTTPException(status_code=400, detail="Only relative URLs are allowed")

    params = await get_confluence_params(db)
    base_url = params["base_url"].rstrip("/")
    full_url = base_url + url

    return await _confluence_image_response(full_url, params)
