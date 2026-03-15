import re
import logging
import urllib.parse
from dataclasses import dataclass
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

    result = re.sub(r"<ac:image[^>]*>.*?</ac:image>", _replace_ac_image, html, flags=re.DOTALL)
    result = re.sub(r"<ac:image[^/]*/\s*>", "", result)

    # --- 2. Remove self-closing structured macros (e.g. toc) BEFORE paired ones ---
    result = re.sub(r"<ac:structured-macro\s[^>]*/\s*>", "", result)

    # --- 3. Jira issue macro → link ---
    def _replace_jira_macro(m: re.Match) -> str:
        block = m.group(0)
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

    result = re.sub(
        r'<ac:structured-macro\s[^>]*ac:name="jira"[^>]*>.*?</ac:structured-macro>',
        _replace_jira_macro, result, flags=re.DOTALL,
    )

    # --- 4. Status macro → badge ---
    def _replace_status_macro(m: re.Match) -> str:
        block = m.group(0)
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

    result = re.sub(
        r'<ac:structured-macro\s[^>]*ac:name="status"[^>]*>.*?</ac:structured-macro>',
        _replace_status_macro, result, flags=re.DOTALL,
    )

    # --- 5. Code / noformat macro → <pre><code> ---
    import html as html_mod

    def _replace_code_macro(m: re.Match) -> str:
        block = m.group(0)
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

    result = re.sub(
        r'<ac:structured-macro\s[^>]*ac:name="(?:code|noformat)"[^>]*>'
        r".*?</ac:structured-macro>",
        _replace_code_macro, result, flags=re.DOTALL,
    )

    # --- 6. Info/note/warning/tip/expand → keep rich-text body ---
    def _replace_panel_macro(m: re.Match) -> str:
        block = m.group(0)
        body_m = re.search(
            r"<ac:rich-text-body>(.*?)</ac:rich-text-body>", block, re.DOTALL
        )
        return body_m.group(1) if body_m else ""

    result = re.sub(
        r'<ac:structured-macro\s[^>]*ac:name="(?:info|note|warning|tip|expand|panel|excerpt)"[^>]*>'
        r".*?</ac:structured-macro>",
        _replace_panel_macro, result, flags=re.DOTALL,
    )

    # --- 6. Any remaining paired structured macros → remove ---
    result = re.sub(
        r"<ac:structured-macro[^>]*>.*?</ac:structured-macro>",
        "", result, flags=re.DOTALL,
    )

    # --- 5. ac:link → <a> ---
    def _replace_ac_link(m: re.Match) -> str:
        block = m.group(0)
        body_m = re.search(r"<!\[CDATA\[(.+?)\]\]>", block, re.DOTALL)
        title_m = re.search(r'ri:content-title="([^"]+)"', block)
        label = (body_m.group(1).strip() if body_m
                 else title_m.group(1) if title_m else "ссылка")
        return f'<span style="color: #2a6496; text-decoration: underline;">{label}</span>'

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
class ConfluencePageData:
    page_id: str
    title: str
    space_key: str
    version: int
    content_html: str


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

    params = {"expand": "body.storage,version,space"}

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

        return ConfluencePageData(
            page_id=str(data["id"]),
            title=data["title"],
            space_key=data.get("space", {}).get("key", ""),
            version=data["version"]["number"],
            content_html=data["body"]["storage"]["value"],
        )


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
