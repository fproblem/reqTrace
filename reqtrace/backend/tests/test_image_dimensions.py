"""Тесты замера размеров картинок и резерва места под них (v1.6.6).

Зачем фича: браузер резервирует место под <img> только при известных
размерах — без них контент «едет» при первом открытии страницы (кэш браузера
лечит лишь повторные визиты). Размеры меряет бэкенд при снимке, рендер
подставляет их в HTML.

БД не нужна: сессия — FakeSession, скачивание — фейковый fetch.
Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import asyncio
import struct
import unittest
import uuid

from app.models.attachment_dimension import AttachmentDimension
from app.services.confluence import ConfluenceConnection, process_confluence_html
from app.services.image_dimensions import (
    extract_attachment_filenames,
    measure_page_images,
    parse_image_size,
)


def png_bytes(w: int, h: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", w, h)


def gif_bytes(w: int, h: int) -> bytes:
    return b"GIF89a" + struct.pack("<HH", w, h) + b"\x00" * 14


def jpeg_bytes(w: int, h: int) -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9
    sof0 = b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", h, w) + b"\x00" * 10
    return b"\xff\xd8" + app0 + sof0


def webp_lossless_bytes(w: int, h: int) -> bytes:
    bits = (w - 1) | ((h - 1) << 14)
    return (
        b"RIFF" + b"\x00" * 4 + b"WEBP" + b"VP8L" + b"\x00" * 4
        + b"\x2f" + bits.to_bytes(4, "little")
    )


class ParseImageSizeTest(unittest.TestCase):
    def test_png(self):
        self.assertEqual(parse_image_size(png_bytes(800, 600)), (800, 600))

    def test_gif(self):
        self.assertEqual(parse_image_size(gif_bytes(320, 200)), (320, 200))

    def test_jpeg(self):
        self.assertEqual(parse_image_size(jpeg_bytes(1024, 768)), (1024, 768))

    def test_webp_lossless(self):
        self.assertEqual(parse_image_size(webp_lossless_bytes(500, 300)), (500, 300))

    def test_garbage_and_short_data(self):
        self.assertIsNone(parse_image_size(b"not an image, honestly not"))
        self.assertIsNone(parse_image_size(b"\x89PNG"))


class ExtractFilenamesTest(unittest.TestCase):
    def test_only_ac_image_attachments(self):
        html = (
            '<p>текст</p>'
            '<ac:image ac:width="300"><ri:attachment ri:filename="схема.png"/></ac:image>'
            # Файловая ссылка — не картинка, мерить нечего.
            '<ac:link><ri:attachment ri:filename="отчёт.pdf"/></ac:link>'
            # Самозакрытый ac:image рендер выбрасывает — и замер тоже.
            '<ac:image ri:filename="мимо.png"/>'
            '<ac:image><ri:url ri:value="https://ex.com/a.png"/></ac:image>'
        )
        self.assertEqual(extract_attachment_filenames(html), {"схема.png"})


class RenderReservesSpaceTest(unittest.TestCase):
    """process_confluence_html подставляет замеренные размеры в <img>."""

    IMG = '<ac:image%s><ri:attachment ri:filename="a.png"/></ac:image>'

    def test_no_author_size_gets_measured_attrs(self):
        out = process_confluence_html(
            self.IMG % "", "p1", image_dims={"a.png": (800, 600)},
        )
        self.assertIn('width="800"', out)
        self.assertIn('height="600"', out)

    def test_author_width_only_gets_aspect_ratio(self):
        out = process_confluence_html(
            self.IMG % ' ac:width="300"', "p1", image_dims={"a.png": (800, 600)},
        )
        self.assertIn('width="300"', out)
        self.assertIn("aspect-ratio: 800 / 600", out)
        self.assertNotIn('width="800"', out)

    def test_author_both_sizes_win(self):
        out = process_confluence_html(
            self.IMG % ' ac:width="300" ac:height="200"', "p1",
            image_dims={"a.png": (800, 600)},
        )
        self.assertIn('width="300"', out)
        self.assertIn('height="200"', out)
        self.assertNotIn("aspect-ratio", out)

    def test_without_dims_render_unchanged(self):
        out = process_confluence_html(self.IMG % "", "p1")
        self.assertNotIn("aspect-ratio", out)
        self.assertNotIn("width=", out)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class FakeSession:
    def __init__(self, execute_results):
        self.execute_results = list(execute_results)
        self.added = []
        self.flushes = 0

    async def execute(self, stmt):
        return self.execute_results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushes += 1


def make_page():
    class P:  # утиная страница: замеру нужны только id и confluence_page_id
        id = uuid.uuid4()
        confluence_page_id = "12345"
    return P()


class MeasurePageImagesTest(unittest.TestCase):
    HTML = "".join(
        f'<ac:image><ri:attachment ri:filename="{fn}"/></ac:image>'
        for fn in ("new.png", "known.png", "broken.bin", "gone.png")
    )
    CONN = ConfluenceConnection(base_url="https://conf.x", username="u", password="p")

    def run_measure(self, fetch):
        session = FakeSession([FakeResult([("known.png",)])])
        count = asyncio.run(measure_page_images(
            session, make_page(), self.HTML, self.CONN, fetch=fetch,
        ))
        return count, session

    def test_measures_only_missing_and_survives_failures(self):
        async def fetch(url, conn):
            if "new.png" in url:
                return png_bytes(640, 480)
            if "broken.bin" in url:
                return b"not an image at all......."  # формат не распознан
            return None  # gone.png: 404 на Confluence

        count, session = self.run_measure(fetch)

        # known.png уже замерен — не скачивался; gone.png не записан (сеть
        # может ожить — доберём следующим прогоном); broken.bin записан
        # «пустым», чтобы не скачивать гиганта каждую ночь.
        self.assertEqual(count, 2)
        by_name = {row.filename: row for row in session.added}
        self.assertEqual(set(by_name), {"new.png", "broken.bin"})
        self.assertEqual((by_name["new.png"].width, by_name["new.png"].height), (640, 480))
        self.assertIsNone(by_name["broken.bin"].width)
        self.assertTrue(all(isinstance(r, AttachmentDimension) for r in session.added))

    def test_network_error_of_one_image_does_not_stop_others(self):
        async def fetch(url, conn):
            if "new.png" in url:
                raise RuntimeError("boom")
            return png_bytes(10, 10)

        count, session = self.run_measure(fetch)
        self.assertEqual(count, 2)  # broken.bin и gone.png дошли до записи
        self.assertNotIn("new.png", {r.filename for r in session.added})


if __name__ == "__main__":
    unittest.main()
