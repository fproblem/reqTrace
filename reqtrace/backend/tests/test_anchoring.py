"""Тесты движка привязок v1.5.9 (anchoring.py) — модель «маркер в снимке».

Правила зафиксированы планом anchoring-plan-v1.5.9.md (эталон — inline-комментарии
Confluence): диапазон переносится диффом версий, «уцелел хотя бы символ» — жив,
не уцелел ни один — «Утрачено» (терминально); правка внутри диапазона накрывается,
вставка на границе не входит; никакого поиска текста по странице.

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import unittest

from app.services.confluence import process_confluence_html
from app.services.anchoring import (
    abs_range,
    block_coords,
    char_opcodes,
    confirm_reanchor,
    doc_from_html,
    map_range,
    norm_key,
    project,
    verify_creation,
)

QUOTE = "Текст под подзаголовок четвертого уровня."
PAGE = f"<p>Шапка</p><p>{QUOTE}</p><p>Хвост</p>"


def rng_of(html: str, needle: str) -> tuple[int, int]:
    """Абсолютный диапазон первого вхождения needle в тексте документа."""
    doc = doc_from_html(html)
    i = doc.text.index(needle)
    return i, i + len(needle)


def transfer(old_html: str, new_html: str, start: int, end: int):
    old, new = doc_from_html(old_html), doc_from_html(new_html)
    return map_range(char_opcodes(old, new), start, end)


def transferred_text(old_html: str, new_html: str, needle: str) -> str | None:
    """Текст, на котором окажется маркер после переноса (None — утрачен)."""
    rng = transfer(old_html, new_html, *rng_of(old_html, needle))
    if rng is None:
        return None
    return doc_from_html(new_html).text[rng[0]:rng[1]]


# Мини-копия страницы из бага v1.5.6: абзац с Confluence-ссылкой (текст в
# CDATA) — сырой storage-XML прячет его от HTML-парсера, обработанный HTML нет.
RAW_XML = (
    '<table><tbody><tr><td><p>Текст блока</p></td><td>'
    '<p>Значение параметра "first_block.text" из кэша '
    '<ac:link><ri:page ri:content-title="GET /v7/configuration" />'
    '<ac:plain-text-link-body><![CDATA[GET /v7/configuration]]></ac:plain-text-link-body>'
    '</ac:link></p>'
    '<p>Если параметр не пришел или равен null, то значение по дефолту</p>'
    '</td></tr></tbody></table>'
)


class AnchorCoordinateSpace(unittest.TestCase):
    """Документная модель обязана строиться по ОБРАБОТАННОМУ HTML (регрессия
    v1.5.6: по сырому storage-XML текст ссылок в CDATA невидим — блоки короче,
    и все смещения врут)."""

    def test_processed_blocks_keep_link_text(self):
        doc = doc_from_html(process_confluence_html(RAW_XML, "p1"))
        self.assertIn("GET /v7/configuration", doc.blocks[1])

    def test_raw_xml_hides_link_text(self):
        doc = doc_from_html(RAW_XML)
        self.assertNotIn("GET /v7/configuration", doc.blocks[1])


class DocModel(unittest.TestCase):
    def test_leaf_blocks_only(self):
        doc = doc_from_html(
            "<p>Абзац</p><ul><li>Пункт <ul><li>Вложенный</li></ul></li></ul>"
            "<table><tbody><tr><td><p>В ячейке</p></td><td>Просто</td></tr></tbody></table>"
        )
        self.assertEqual(
            [b.strip() for b in doc.blocks],
            ["Абзац", "Вложенный", "В ячейке", "Просто"],
        )
        self.assertEqual(doc.text, "".join(doc.blocks))

    def test_abs_range_and_block_coords_round_trip(self):
        doc = doc_from_html(PAGE)
        rng = abs_range(doc, 1, 1, 0, len(QUOTE))
        self.assertEqual(doc.text[rng[0]:rng[1]], QUOTE)
        coords = block_coords(doc, *rng)
        self.assertEqual(coords["anchor_block_start"], 1)
        self.assertEqual(coords["anchor_block_end"], 1)
        self.assertEqual(coords["start_char_offset"], 0)
        self.assertEqual(coords["end_char_offset"], len(QUOTE))

    def test_abs_range_clamps_and_rejects(self):
        doc = doc_from_html(PAGE)
        # Смещение за длиной блока клампится, а не роняет.
        rng = abs_range(doc, 1, 1, 0, 10_000)
        self.assertEqual(doc.text[rng[0]:rng[1]], QUOTE)
        # Блока с таким индексом нет / пустой диапазон.
        self.assertIsNone(abs_range(doc, 99, 99, 0, 5))
        self.assertIsNone(abs_range(doc, 1, 1, 7, 7))


class NormKey(unittest.TestCase):
    def test_whitespace_and_invisible_ignored(self):
        self.assertEqual(norm_key("Текст  для\nудаления"), norm_key("Текст для удаления"))
        self.assertEqual(norm_key("под\N{ZERO WIDTH SPACE}заголовок"), norm_key("подзаголовок"))
        self.assertEqual(norm_key("чет\N{SOFT HYPHEN}вертого\N{ZERO WIDTH NO-BREAK SPACE}"), "четвертого")

    def test_nfc_normalization(self):
        # й: составная форма (и + бреве) равна монолитной.
        self.assertEqual(norm_key("й"), norm_key("й"))

    def test_real_edits_differ(self):
        self.assertNotEqual(norm_key("Уровень 3 — пункт два."), norm_key("Уровень 3.1 — пункт один."))


class Transfer(unittest.TestCase):
    def test_unchanged_page_keeps_range(self):
        self.assertEqual(transferred_text(PAGE, PAGE, QUOTE), QUOTE)

    def test_edit_before_shifts_range(self):
        new = PAGE.replace("Шапка", "Шапка стала заметно длиннее")
        self.assertEqual(transferred_text(PAGE, new, QUOTE), QUOTE)

    def test_edit_after_keeps_range(self):
        new = PAGE.replace("Хвост", "Совсем другой хвост")
        self.assertEqual(transferred_text(PAGE, new, QUOTE), QUOTE)

    def test_word_deleted_inside_shrinks(self):
        new = PAGE.replace("подзаголовок ", "")
        self.assertEqual(
            transferred_text(PAGE, new, QUOTE), "Текст под четвертого уровня."
        )

    def test_word_replaced_inside_is_covered(self):
        new = PAGE.replace("подзаголовок", "врезку")
        self.assertEqual(
            transferred_text(PAGE, new, QUOTE), "Текст под врезку четвертого уровня."
        )

    def test_insertion_strictly_inside_extends(self):
        html = "<p>Шапка</p><p>Первое правило. Второе правило.</p>"
        new = html.replace(". Второе", ". Вставка автора. Второе")
        self.assertEqual(
            transferred_text(html, new, "Первое правило. Второе правило."),
            "Первое правило. Вставка автора. Второе правило.",
        )

    def test_insertion_at_start_boundary_excluded(self):
        html = "<p>Введение.</p><p>Первое правило работы.</p>"
        new = html.replace("правило", "доброе правило")
        self.assertEqual(transferred_text(html, new, "правило работы."), "правило работы.")

    def test_insertion_at_end_boundary_excluded(self):
        html = "<p>Введение.</p><p>Первое правило</p>"
        new = html.replace("Первое правило", "Первое правило!!")
        self.assertEqual(transferred_text(html, new, "правило"), "правило")

    def test_whole_range_deleted_is_lost(self):
        new = PAGE.replace(QUOTE, "")
        self.assertIsNone(transferred_text(PAGE, new, QUOTE))

    def test_whole_block_deleted_is_lost(self):
        new = "<p>Шапка</p><p>Хвост</p>"
        self.assertIsNone(transferred_text(PAGE, new, QUOTE))

    def test_full_retype_of_range_is_lost(self):
        # Confluence: select-all + перенабор уничтожает маркер вместе с текстом.
        new = PAGE.replace(QUOTE, "Совершенно другое содержимое раздела.")
        self.assertIsNone(transferred_text(PAGE, new, QUOTE))

    def test_paragraph_moved_far_away_is_lost(self):
        # Cut/paste у эталона = удаление (CONFSERVER-42726). Перенос через
        # несколько блоков дифф совместить не может → утрата.
        old = ("<p>Один.</p><p>Переносимый абзац.</p><p>Два.</p>"
               "<p>Три.</p><p>Четыре.</p>")
        new = ("<p>Один.</p><p>Два.</p><p>Три.</p><p>Четыре.</p>"
               "<p>Переносимый абзац.</p>")
        self.assertIsNone(transferred_text(old, new, "Переносимый абзац."))

    def test_adjacent_swap_keeps_intact_block(self):
        # Своп соседних блоков для диффа неотличим от «переехал ДРУГОЙ блок»:
        # неизменённый блок остаётся жив. Сознательно мягче эталона — текст
        # привязки не менялся (см. «Известные ограничения» в anchoring.py).
        old = "<p>Один.</p><p>Переносимый абзац.</p><p>Три.</p>"
        new = "<p>Один.</p><p>Три.</p><p>Переносимый абзац.</p>"
        self.assertEqual(
            transferred_text(old, new, "Переносимый абзац."), "Переносимый абзац."
        )

    def test_duplicate_text_disambiguated_by_position(self):
        # Исторический баг «прыгающей» подсветки невозможен: координаты, а не поиск.
        old = "<p>Цена: 10 руб.</p><p>Скидка.</p><p>Цена: 10 руб.</p>"
        new = "<p>Цена: 10 руб.</p><p>Скидка.</p><p>Цена: 12 руб.</p>"
        doc = doc_from_html(old)
        first = abs_range(doc, 0, 0, 0, len("Цена: 10 руб."))
        second = abs_range(doc, 2, 2, 0, len("Цена: 10 руб."))
        new_doc = doc_from_html(new)
        ops = char_opcodes(doc, new_doc)

        r1 = map_range(ops, *first)
        self.assertEqual(new_doc.text[r1[0]:r1[1]], "Цена: 10 руб.")
        self.assertEqual(block_coords(new_doc, *r1)["anchor_block_start"], 0)

        r2 = map_range(ops, *second)
        self.assertEqual(new_doc.text[r2[0]:r2[1]], "Цена: 12 руб.")
        self.assertEqual(block_coords(new_doc, *r2)["anchor_block_start"], 2)

    def test_paragraph_split_survives(self):
        old = "<p>Первая часть и вторая часть.</p>"
        new = "<p>Первая часть</p><p>и вторая часть.</p>"
        got = transferred_text(old, new, "часть и вторая")
        self.assertIsNotNone(got)
        self.assertEqual(norm_key(got), norm_key("часть и вторая"))

    def test_zwsp_insertion_survives_and_norm_equal(self):
        new = PAGE.replace("подзаголовок", "под\N{ZERO WIDTH SPACE}заголовок")
        got = transferred_text(PAGE, new, QUOTE)
        self.assertIsNotNone(got)
        self.assertEqual(norm_key(got), norm_key(QUOTE))

    def test_user_scenario_delete_then_readd(self):
        # Сценарий пользователя: удалили слово → маркер на остатке; вернули
        # слово (вставка внутрь) → маркер снова накрывает исходный текст.
        after_delete = PAGE.replace("подзаголовок ", "")
        remainder = transferred_text(PAGE, after_delete, QUOTE)
        self.assertEqual(remainder, "Текст под четвертого уровня.")

        restored = transferred_text(after_delete, PAGE, remainder)
        self.assertIsNotNone(restored)
        self.assertEqual(norm_key(restored), norm_key(QUOTE))


def hl(**over) -> dict:
    base = {
        "id": "h1",
        "status": "active",
        "text_content": QUOTE,
        "anchor_block_start": 1,
        "anchor_block_end": 1,
        "start_char_offset": 0,
        "end_char_offset": len(QUOTE),
    }
    base.update(over)
    return base


class Project(unittest.TestCase):
    def test_unchanged_page_keeps_statuses(self):
        for status in ("active", "outdated"):
            proj = project(PAGE, PAGE, [hl(status=status)])[0]
            self.assertEqual(proj["projected_status"], status)
            self.assertEqual(proj["anchored_text"], QUOTE)
            self.assertEqual(proj["new_anchor_block_start"], 1)

    def test_neighbor_edit_keeps_active(self):
        # Ключевое отличие от старой модели: правка соседнего текста в ТОМ ЖЕ
        # блоке не трогает «Актуально» — как в Confluence.
        old = "<p>Шапка</p><p>Правило номер один. И примечание рядом.</p>"
        new = "<p>Шапка</p><p>Правило номер один. И совсем новое примечание.</p>"
        doc = doc_from_html(old)
        i = doc.text.index("Правило номер один.")
        coords = block_coords(doc, i, i + len("Правило номер один."))
        h = hl(text_content="Правило номер один.", **coords)
        proj = project(old, new, [h])[0]
        self.assertEqual(proj["projected_status"], "active")
        self.assertEqual(proj["anchored_text"], "Правило номер один.")

    def test_word_deleted_demotes_to_outdated(self):
        new = PAGE.replace("подзаголовок ", "")
        proj = project(PAGE, new, [hl(status="active")])[0]
        self.assertEqual(proj["projected_status"], "outdated")
        self.assertEqual(proj["anchored_text"], "Текст под четвертого уровня.")
        self.assertEqual(proj["new_anchor_block_start"], 1)
        self.assertEqual(proj["new_end_char_offset"], len("Текст под четвертого уровня."))

    def test_text_restored_stays_outdated_until_human(self):
        # Текст вернулся к цитате — статус НЕ повышается сам (только человек).
        after_delete = PAGE.replace("подзаголовок ", "")
        h = hl(
            status="outdated",
            end_char_offset=len("Текст под четвертого уровня."),
        )
        proj = project(after_delete, PAGE, [h])[0]
        self.assertEqual(proj["projected_status"], "outdated")
        self.assertEqual(norm_key(proj["anchored_text"]), norm_key(QUOTE))

    def test_range_gone_is_lost(self):
        new = "<p>Шапка</p><p>Хвост</p>"
        proj = project(PAGE, new, [hl(status="active")])[0]
        self.assertEqual(proj["projected_status"], "lost")
        self.assertNotIn("new_anchor_block_start", proj)

    def test_lost_is_terminal_and_not_projected(self):
        proj = project(PAGE, PAGE, [hl(status="lost")])[0]
        self.assertEqual(proj["projected_status"], "lost")
        self.assertNotIn("new_anchor_block_start", proj)
        self.assertNotIn("anchored_text", proj)

    def test_legacy_highlight_without_anchor_is_lost(self):
        proj = project(PAGE, PAGE, [hl(anchor_block_start=None)])[0]
        self.assertEqual(proj["projected_status"], "lost")


class VerifyCreation(unittest.TestCase):
    def test_valid_anchor_accepted(self):
        r = verify_creation(PAGE, 1, 1, 0, len(QUOTE), QUOTE)
        self.assertIsNotNone(r)
        self.assertEqual(r["anchored_text"], QUOTE)
        self.assertEqual(r["anchor_block_start"], 1)

    def test_ragged_whitespace_quote_accepted(self):
        # selection.toString() вставляет переносы — норм-сравнение терпимо.
        ragged = QUOTE.replace(" четвертого ", "\nчетвертого\n")
        r = verify_creation(PAGE, 1, 1, 0, len(QUOTE), ragged)
        self.assertIsNotNone(r)
        self.assertEqual(r["anchored_text"], QUOTE)

    def test_mismatched_quote_rejected(self):
        self.assertIsNone(verify_creation(PAGE, 1, 1, 0, len(QUOTE), "Чужой текст"))

    def test_out_of_range_anchor_rejected(self):
        self.assertIsNone(verify_creation(PAGE, 99, 99, 0, 5, QUOTE))

    def test_empty_quote_rejected(self):
        self.assertIsNone(verify_creation(PAGE, 1, 1, 0, 5, "   "))


class ConfirmReanchor(unittest.TestCase):
    def test_quote_becomes_current_text(self):
        r = confirm_reanchor("Текст под четвертого уровня.")
        self.assertEqual(r, {"text_content": "Текст под четвертого уровня."})

    def test_empty_marker_rejected(self):
        self.assertIsNone(confirm_reanchor(""))
        self.assertIsNone(confirm_reanchor("  \n "))
        self.assertIsNone(confirm_reanchor(None))


if __name__ == "__main__":
    unittest.main()
