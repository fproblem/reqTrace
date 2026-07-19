"""Замер размеров картинок-вложений (v1.6.6).

Зачем: браузер резервирует место под <img> до загрузки только при известных
размерах; без них контент страницы «едет» по мере догрузки картинок при
ПЕРВОМ открытии (кэш браузера лечит лишь повторные). Confluence присылает
ac:width/ac:height только у вручную ресайзнутых картинок — остальные меряем
сами: при снимке страницы скачиваем недостающие вложения (они всё равно
поедут в браузеры через наш прокси) и читаем размеры из заголовков файла.
Рендер (process_confluence_html) подставляет известные размеры в <img>.

Замер — строго best effort: любая его неудача не должна трогать ни снимок,
ни прогон (вызовы обёрнуты try/except у вызывающих).
"""
import logging
import re
import struct
import urllib.parse
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment_dimension import AttachmentDimension
from app.models.page import Page
from app.services.confluence import ConfluenceConnection

logger = logging.getLogger(__name__)

# Пределы на один замер: страницы с десятками скриншотов меряются за
# несколько прогонов, а гигантский файл не съедает память.
MAX_IMAGES_PER_RUN = 30
MAX_BYTES = 20 * 1024 * 1024
FETCH_TIMEOUT = 20.0

# Те же формы, что у конвейера рендера (process_confluence_html):
# самозакрытый ac:image не содержит вложения и рендером выбрасывается.
_AC_IMAGE_SELF_CLOSED_RE = re.compile(r"<ac:image[^>]*/\s*>")
_AC_IMAGE_RE = re.compile(r"<ac:image[^>]*>.*?</ac:image>", re.DOTALL)
_FILENAME_RE = re.compile(r'ri:filename="([^"]+)"')


def extract_attachment_filenames(storage_html: str) -> set[str]:
    """Имена картинок-вложений страницы — только из блоков ac:image
    (файловые ссылки ac:link тоже несут ri:filename, но это не картинки).

    Самозакрытые ac:image выбрасываются ПЕРВЫМИ — как в рендере: иначе
    парный regex примет такой тег за открывающий и съест текст до
    закрывающего тега следующей картинки."""
    cleaned = _AC_IMAGE_SELF_CLOSED_RE.sub("", storage_html or "")
    names: set[str] = set()
    for block in _AC_IMAGE_RE.findall(cleaned):
        m = _FILENAME_RE.search(block)
        if m:
            names.add(m.group(1))
    return names


def parse_image_size(data: bytes) -> tuple[int, int] | None:
    """Размеры картинки из заголовков файла: PNG, JPEG, GIF, WebP.

    Без внешних зависимостей — нужны только первые байты. Не распознали —
    None (замер запишется «пустым» и не будет повторяться каждую ночь).
    """
    if len(data) < 24:
        return None

    # PNG: сигнатура + IHDR, ширина/высота big-endian на смещении 16.
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return (w, h) if w and h else None

    # GIF87a/89a: ширина/высота little-endian на смещении 6.
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return (w, h) if w and h else None

    # JPEG: обход сегментов до SOFn (C0–CF, кроме C4/C8/CC) — там высота/ширина.
    if data[:2] == b"\xff\xd8":
        pos = 2
        size = len(data)
        while pos + 9 < size:
            if data[pos] != 0xFF:
                pos += 1
                continue
            marker = data[pos + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                pos += 2
                continue
            seg_len = struct.unpack(">H", data[pos + 2:pos + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[pos + 5:pos + 9])
                return (w, h) if w and h else None
            pos += 2 + seg_len

    # WebP: RIFF-контейнер, размеры зависят от варианта чанка.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 30:
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return (w, h)
        if chunk == b"VP8 " and len(data) >= 30:
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return (w, h) if w and h else None
        if chunk == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            w = (bits & 0x3FFF) + 1
            h = ((bits >> 14) & 0x3FFF) + 1
            return (w, h)

    return None


async def _fetch_attachment(url: str, conn: ConfluenceConnection) -> bytes | None:
    """Скачивает вложение кредами подключения; не-200 или гигант — None."""
    auth = None
    if conn.username and conn.password:
        auth = httpx.BasicAuth(conn.username, conn.password)
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url, auth=auth)
    if resp.status_code != 200 or len(resp.content) > MAX_BYTES:
        return None
    return resp.content


async def load_image_dimensions(db: AsyncSession, page_id) -> dict[str, tuple[int, int]]:
    """Известные размеры картинок страницы для подстановки при рендере."""
    result = await db.execute(
        select(AttachmentDimension).where(AttachmentDimension.page_id == page_id)
    )
    return {
        row.filename: (row.width, row.height)
        for row in result.scalars().all()
        if row.width and row.height
    }


async def measure_page_images(
    db: AsyncSession,
    page: Page,
    storage_html: str,
    conn: ConfluenceConnection,
    *,
    fetch=_fetch_attachment,
) -> int:
    """Замеряет ещё не замеренные картинки страницы; возвращает их число.

    Уже замеренные (включая нераспознанные, width/height NULL) не трогаем —
    в обычную ночь это один SELECT без единого скачивания. Сетевая ошибка
    отдельной картинки не пишет ничего: доберём следующим прогоном.
    """
    filenames = extract_attachment_filenames(storage_html)
    if not filenames:
        return 0

    result = await db.execute(
        select(AttachmentDimension.filename).where(AttachmentDimension.page_id == page.id)
    )
    known = {row[0] for row in result.all()}
    missing = sorted(filenames - known)[:MAX_IMAGES_PER_RUN]

    measured = 0
    for filename in missing:
        encoded = urllib.parse.quote(filename, safe="")
        url = (
            f"{conn.base_url}/download/attachments/"
            f"{page.confluence_page_id}/{encoded}"
        )
        try:
            data = await fetch(url, conn)
        except Exception:
            logger.warning("замер картинки не удался (сеть): %s", filename)
            continue
        if data is None:
            continue
        size = parse_image_size(data)
        db.add(AttachmentDimension(
            page_id=page.id,
            filename=filename,
            width=size[0] if size else None,
            height=size[1] if size else None,
            measured_at=datetime.now(timezone.utc),
        ))
        measured += 1
    if measured:
        await db.flush()
    return measured
