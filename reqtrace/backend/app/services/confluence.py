import re
import logging
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


_STATUS_COLORS = {
    "green": ("#14892c", "rgba(20,137,44,0.08)"),
    "yellow": ("#594300", "rgba(255,210,51,0.15)"),
    "red": ("#d04437", "rgba(208,68,55,0.08)"),
    "blue": ("#2a6496", "rgba(42,100,150,0.08)"),
    "grey": ("#5e6c84", "rgba(94,108,132,0.08)"),
    "gray": ("#5e6c84", "rgba(94,108,132,0.08)"),
    "purple": ("#6554c0", "rgba(101,84,192,0.08)"),
}


# Токены structured-macro: открывающий (group(1)="/" если самозакрытый) и закрывающий.
_MACRO_TOKEN_RE = re.compile(r"<ac:structured-macro\b[^>]*?(/)?>|</ac:structured-macro>")
_MACRO_NAME_RE = re.compile(r'ac:name="([^"]+)"')
_RICH_BODY_RE = re.compile(
    r"<ac:rich-text-body[^>]*>(.*)</ac:rich-text-body>", re.DOTALL
)


def _sub_macro_blocks(html: str, names, repl) -> str:
    """Заменить парные блоки <ac:structured-macro> с учётом вложенности.

    Нежадный regex `.*?</ac:structured-macro>` обрезает блок на закрывающем теге
    первого же ВЛОЖЕННОГО макроса (например, anchor внутри expand) — так терялось
    содержимое. Здесь закрывающий тег ищется подсчётом глубины.

    names — множество имён макросов (None = любой), repl(block) -> str получает
    полный блок от открывающего до закрывающего тега. Блок без закрывающего тега
    не трогаем — остатки снимет финальная зачистка ac:-тегов.
    """
    out = []
    pos = 0
    for m in _MACRO_TOKEN_RE.finditer(html):
        if m.start() < pos:
            continue  # токен внутри уже обработанного блока
        tag = m.group(0)
        if tag.startswith("</") or m.group(1):
            continue  # закрывающий или самозакрытый — не начало блока
        if names is not None:
            name_m = _MACRO_NAME_RE.search(tag)
            if not name_m or name_m.group(1) not in names:
                continue
        depth = 1
        end = None
        for t in _MACRO_TOKEN_RE.finditer(html, m.end()):
            if t.group(0).startswith("</"):
                depth -= 1
                if depth == 0:
                    end = t.end()
                    break
            elif not t.group(1):
                depth += 1
        if end is None:
            continue
        out.append(html[pos:m.start()])
        out.append(repl(html[m.start():end]))
        pos = end
    out.append(html[pos:])
    return "".join(out)


def _macro_rich_body(block: str) -> str:
    """Содержимое <ac:rich-text-body> блока (жадно: от первого открывающего до
    последнего закрывающего — внешнее тело сбалансированного блока), иначе ''."""
    body_m = _RICH_BODY_RE.search(block)
    return body_m.group(1) if body_m else ""


def process_confluence_html(
    html: str, page_id: str, jira_base_url: str = ""
) -> str:
    """Transform Confluence storage-format XML into browser-renderable HTML.

    Handles: ac:image, ac:structured-macro (jira, status, …),
    ac:link, ac:emoticon, and leftover ac:/ri: tags."""

    # --- 1. Images (ac:image → <img>) ---
    def _replace_ac_image(m: re.Match) -> str:
        block = m.group(0)
        width_m = re.search(r'ac:width="(\d+)"', block)
        height_m = re.search(r'ac:height="(\d+)"', block)
        align_m = re.search(r'ac:align="([^"]+)"', block)

        size_attrs = ""
        if width_m:
            size_attrs += f' width="{width_m.group(1)}"'
        if height_m:
            size_attrs += f' height="{height_m.group(1)}"'

        style_parts = ["max-width: 100%", "height: auto"]
        if align_m and align_m.group(1) == "center":
            style_parts += ["display: block", "margin: 8px auto"]

        style = "; ".join(style_parts)

        att = re.search(r'ri:filename="([^"]+)"', block)
        if att:
            fn = att.group(1)
            enc = urllib.parse.quote(fn, safe="")
            return f'<img src="/api/pages/{page_id}/attachments/{enc}" alt="{fn}" style="{style}"{size_attrs} />'

        url = re.search(r'ri:value="([^"]+)"', block)
        if url:
            return f'<img src="{url.group(1)}" style="{style}"{size_attrs} />'
        return ""

    # Сначала убрать самозакрытые <ac:image/>: иначе парный regex примет такой
    # тег за открывающий и съест весь текст до </ac:image> следующей картинки.
    result = re.sub(r"<ac:image[^>]*/\s*>", "", html)
    result = re.sub(r"<ac:image[^>]*>.*?</ac:image>", _replace_ac_image, result, flags=re.DOTALL)

    # --- 2. Remove self-closing structured macros (e.g. toc) BEFORE paired ones ---
    result = re.sub(r"<ac:structured-macro\s[^>]*/\s*>", "", result)

    # --- 3. Jira issue macro → link ---
    def _replace_jira_macro(block: str) -> str:
        key_m = re.search(r'ac:name="key"[^>]*>([^<]+)<', block)
        if not key_m:
            return ""
        key = key_m.group(1).strip()
        base = jira_base_url.rstrip("/") if jira_base_url else ""
        href = f"{base}/browse/{key}" if base else "#"
        target = ' target="_blank" rel="noopener"' if base else ""
        return (
            f'<a href="{href}"{target} style="'
            f"display: inline-flex; align-items: center; gap: 4px; "
            f"color: #2a6496; font-weight: 500; text-decoration: none; "
            f"background: rgba(42,100,150,0.06); padding: 1px 6px; "
            f'border-radius: 4px; font-size: 0.92em;">'
            f"🔗 {key}</a>"
        )

    result = _sub_macro_blocks(result, {"jira"}, _replace_jira_macro)

    # --- 4. Status macro → badge ---
    def _replace_status_macro(block: str) -> str:
        title_m = re.search(r'ac:name="title"[^>]*>([^<]+)<', block)
        colour_m = re.search(r'ac:name="colou?r"[^>]*>([^<]+)<', block)
        title = title_m.group(1).strip() if title_m else ""
        colour = (colour_m.group(1).strip().lower() if colour_m else "grey")
        fg, bg = _STATUS_COLORS.get(colour, _STATUS_COLORS["grey"])
        return (
            f'<span style="display: inline-block; padding: 1px 8px; '
            f"border-radius: 4px; font-size: 0.82em; font-weight: 700; "
            f"text-transform: uppercase; letter-spacing: 0.02em; "
            f'color: {fg}; background: {bg}; border: 1px solid {fg}30;">'
            f"{title}</span>"
        )

    result = _sub_macro_blocks(result, {"status"}, _replace_status_macro)

    # --- 5. Code / noformat macro → <pre><code> ---
    import html as html_mod

    def _replace_code_macro(block: str) -> str:
        lang_m = re.search(r'ac:name="language"[^>]*>([^<]+)<', block)
        lang = lang_m.group(1).strip() if lang_m else ""
        body_m = re.search(r"<!\[CDATA\[(.*?)\]\]>", block, re.DOTALL)
        code = html_mod.escape(body_m.group(1)) if body_m else ""
        lang_attr = f' data-lang="{lang}"' if lang else ""
        return (
            f'<pre style="background: #f4f5f7; border: 1px solid rgba(0,0,0,0.08); '
            f"border-radius: 6px; padding: 14px 18px; overflow-x: auto; "
            f"font-size: 12.5px; line-height: 1.55; margin: 10px 0; "
            f'font-family: \'SF Mono\', Menlo, Consolas, monospace;">'
            f"<code{lang_attr}>{code}</code></pre>"
        )

    result = _sub_macro_blocks(result, {"code", "noformat"}, _replace_code_macro)

    # --- 5b. Вставки файлов (view-file/multimedia/…) → чип-ссылка на вложение ---
    # В Confluence это карточка/предпросмотр файла; молчаливое удаление теряет
    # ссылку на артефакт (методички, записи экрана, отчёты).
    def _replace_file_macro(block: str) -> str:
        fn_m = re.search(r'ri:filename="([^"]+)"', block)
        if not fn_m:
            return ""
        fn = fn_m.group(1)
        enc = urllib.parse.quote(fn, safe="")
        return (
            f'<a href="/api/pages/{page_id}/attachments/{enc}" target="_blank" '
            f'rel="noopener" style="display: inline-flex; align-items: center; '
            f"gap: 4px; color: #2a6496; font-weight: 500; text-decoration: none; "
            f"background: rgba(42,100,150,0.06); padding: 2px 8px; "
            f'border-radius: 4px; font-size: 0.92em;">📎 {html_mod.escape(fn)}</a>'
        )

    result = _sub_macro_blocks(
        result,
        {"view-file", "viewpdf", "viewdoc", "viewxls", "viewppt", "multimedia"},
        _replace_file_macro,
    )

    # --- 5c. Вставка другой страницы (include) → явная пометка ---
    # Транслируемый контент не тянем, но читатель должен видеть, что здесь
    # включена другая страница, а не пустое место.
    def _replace_include_macro(block: str) -> str:
        title_m = re.search(r'ri:content-title="([^"]+)"', block)
        if not title_m:
            return ""
        return (
            f'<p style="color: #5e6c84; font-style: italic;">'
            f"📄 Вставка страницы: {html_mod.escape(title_m.group(1))}</p>"
        )

    result = _sub_macro_blocks(result, {"include", "excerpt-include"}, _replace_include_macro)

    # --- 6. Остальные парные макросы (info/expand/panel/anchor/…) ---
    # У любого сохраняем содержимое rich-text-body (потерять текст требований
    # хуже, чем показать лишний), без тела (anchor и т.п.) — удаляем целиком.
    # Замена возвращает тело, внутри которого могут быть вложенные макросы, —
    # повторяем до неподвижной точки (каждый проход снимает уровень вложенности).
    prev = None
    while prev != result:
        prev = result
        result = _sub_macro_blocks(result, None, _macro_rich_body)

    # --- 5. ac:link → <a> ---
    def _replace_ac_link(m: re.Match) -> str:
        block = m.group(0)
        body_m = re.search(r"<!\[CDATA\[(.+?)\]\]>", block, re.DOTALL)
        title_m = re.search(r'ri:content-title="([^"]+)"', block)
        label = (body_m.group(1).strip() if body_m
                 else title_m.group(1) if title_m else "ссылка")
        return f'<span style="color: #2a6496; text-decoration: underline;">{label}</span>'

    # Самозакрытые <ac:link/> убрать до парного прохода — по той же причине,
    # что и у ac:image (иначе съедается текст между двумя ссылками).
    result = re.sub(r"<ac:link[^>]*/\s*>", "", result)
    result = re.sub(r"<ac:link[^>]*>.*?</ac:link>", _replace_ac_link, result, flags=re.DOTALL)

    # --- 6. Emoticons ---
    _EMOTICON_MAP = {
        "blue-star": "⭐", "yellow-star": "⭐", "red-star": "⭐",
        "green-star": "⭐", "smile": "🙂", "sad": "😞",
        "tick": "✅", "cross": "❌", "warning": "⚠️",
        "information": "ℹ️", "plus": "➕", "minus": "➖",
        "question": "❓", "light-on": "💡", "light-off": "💡",
        "thumbs-up": "👍", "thumbs-down": "👎", "heart": "❤️",
    }

    def _replace_emoticon(m: re.Match) -> str:
        name = m.group(1)
        return _EMOTICON_MAP.get(name, "")

    result = re.sub(r'<ac:emoticon\s+ac:name="([^"]+)"[^/]*/>', _replace_emoticon, result)

    # --- 7. Strip any remaining ac: / ri: tags ---
    result = re.sub(r"</?ac:[^>]*>", "", result)
    result = re.sub(r"</?ri:[^>]*>", "", result)

    # --- 8. Rewrite relative Confluence img src ---
    def _rewrite_relative_img(m: re.Match) -> str:
        src = m.group(1)
        if src.startswith("/download/attachments/") or src.startswith("/rest/"):
            enc = urllib.parse.quote(src, safe="/:?=&")
            return f'src="/api/confluence-proxy?url={enc}"'
        return m.group(0)

    result = re.sub(r'src="(/[^"]+)"', _rewrite_relative_img, result)

    return result


# Keep old name as alias for backward compat
process_confluence_images = process_confluence_html


@dataclass
class ConfluenceAncestor:
    page_id: str
    title: str


@dataclass
class ConfluencePageData:
    page_id: str
    title: str
    space_key: str
    version: int
    content_html: str
    ancestors: list[ConfluenceAncestor] = field(default_factory=list)


@dataclass
class ConfluenceConnection:
    base_url: str
    username: str = ""
    password: str = ""


def extract_page_id_from_url(url: str) -> str:
    """Extract Confluence page ID from various URL formats."""
    match = re.search(r"pageId=(\d+)", url)
    if match:
        return match.group(1)

    match = re.search(r"/pages/(\d+)", url)
    if match:
        return match.group(1)

    match = re.search(r"viewpage\.action\?pageId=(\d+)", url)
    if match:
        return match.group(1)

    raise ValueError(f"Cannot extract page ID from URL: {url}")


async def fetch_page(page_id: str, conn: Optional[ConfluenceConnection] = None) -> ConfluencePageData:
    """Fetch page content from Confluence Server REST API."""
    if conn is None:
        from app.config import settings
        conn = ConfluenceConnection(
            base_url=settings.CONFLUENCE_BASE_URL,
            username=settings.CONFLUENCE_USERNAME,
            password=settings.CONFLUENCE_PASSWORD,
        )

    base_url = conn.base_url.rstrip("/")
    if not base_url:
        raise ValueError(
            "Confluence URL is not configured. Open Settings and set a valid Confluence Server URL."
        )

    api_url = f"{base_url}/rest/api/content/{page_id}"

    params = {"expand": "body.storage,version,space,ancestors"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        auth = None
        if conn.username and conn.password:
            auth = httpx.BasicAuth(conn.username, conn.password)

        try:
            response = await client.get(api_url, params=params, auth=auth)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise ValueError(
                    "Confluence returned 401 Unauthorized. Check the username/password saved in Settings."
                ) from exc
            if exc.response.status_code == 403:
                raise ValueError(
                    "Confluence returned 403 Forbidden. Check account permissions for this page."
                ) from exc
            raise

        data = response.json()

        ancestors = [
            ConfluenceAncestor(page_id=str(a["id"]), title=a["title"])
            for a in data.get("ancestors", [])
        ]

        return ConfluencePageData(
            page_id=str(data["id"]),
            title=data["title"],
            space_key=data.get("space", {}).get("key", ""),
            version=data["version"]["number"],
            content_html=data["body"]["storage"]["value"],
            ancestors=ancestors,
        )


@dataclass
class SpacePageInfo:
    """Lightweight page info returned by fetch_space_pages."""
    page_id: str
    title: str
    parent_page_id: Optional[str]  # direct parent, None for root pages


async def fetch_space_pages(
    space_key: str, conn: Optional[ConfluenceConnection] = None
) -> list[SpacePageInfo]:
    """Fetch all pages in a Confluence space with their parent info.

    Uses pagination to handle large spaces. Returns a flat list of
    SpacePageInfo with parent_page_id derived from the ancestors array.
    """
    if conn is None:
        from app.config import settings
        conn = ConfluenceConnection(
            base_url=settings.CONFLUENCE_BASE_URL,
            username=settings.CONFLUENCE_USERNAME,
            password=settings.CONFLUENCE_PASSWORD,
        )

    base_url = conn.base_url.rstrip("/")
    if not base_url:
        raise ValueError("Confluence URL is not configured.")

    pages: list[SpacePageInfo] = []
    start = 0
    limit = 200
    max_pages = 10_000  # safety cap

    async with httpx.AsyncClient(timeout=60.0) as client:
        auth = None
        if conn.username and conn.password:
            auth = httpx.BasicAuth(conn.username, conn.password)

        while len(pages) < max_pages:
            api_url = f"{base_url}/rest/api/content"
            params = {
                "spaceKey": space_key,
                "type": "page",
                "expand": "ancestors",
                "start": str(start),
                "limit": str(limit),
            }

            response = await client.get(api_url, params=params, auth=auth)
            response.raise_for_status()
            data = response.json()

            for item in data.get("results", []):
                ancestors = item.get("ancestors", [])
                parent_id = str(ancestors[-1]["id"]) if ancestors else None
                pages.append(SpacePageInfo(
                    page_id=str(item["id"]),
                    title=item["title"],
                    parent_page_id=parent_id,
                ))

            # Check if there are more pages
            returned = data.get("size", 0)
            if returned < limit:
                break
            start += limit

    logger.info("Fetched %d pages from space %s", len(pages), space_key)
    return pages


async def get_page_version(page_id: str, conn: Optional[ConfluenceConnection] = None) -> int:
    """Get current version number of a Confluence page."""
    if conn is None:
        from app.config import settings
        conn = ConfluenceConnection(
            base_url=settings.CONFLUENCE_BASE_URL,
            username=settings.CONFLUENCE_USERNAME,
            password=settings.CONFLUENCE_PASSWORD,
        )

    base_url = conn.base_url.rstrip("/")
    api_url = f"{base_url}/rest/api/content/{page_id}"

    params = {"expand": "version"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        auth = None
        if conn.username and conn.password:
            auth = httpx.BasicAuth(conn.username, conn.password)

        response = await client.get(api_url, params=params, auth=auth)
        response.raise_for_status()

        data = response.json()
        return data["version"]["number"]
