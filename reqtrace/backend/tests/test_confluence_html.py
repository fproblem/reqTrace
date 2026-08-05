"""Тесты преобразования Confluence storage-format → HTML.

Фиксируют правило: видимый текст страницы НЕ должен теряться при обработке
макросов. Исторические баги (оба — «нежадный regex обрезается на закрывающем
теге вложенного/самозакрытого элемента»):

1. anchor-макрос внутри expand-блока съедал всё содержимое expand до анкера
   (на реальной странице пропали требования 1–14 и открывающий тег таблицы);
2. самозакрытый <ac:link/> (или <ac:image/>) заставлял парный regex съесть
   весь текст до закрывающего тега СЛЕДУЮЩЕЙ ссылки/картинки.

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import unittest

from app.services import anchoring
from app.services.confluence import process_confluence_html


def _macro(name: str, inner: str = "", params: str = "") -> str:
    return (
        f'<ac:structured-macro ac:name="{name}" ac:schema-version="1" '
        f'ac:macro-id="x">{params}{inner}</ac:structured-macro>'
    )


def _rich(inner: str) -> str:
    return f"<ac:rich-text-body>{inner}</ac:rich-text-body>"


class ExpandWithNestedMacros(unittest.TestCase):
    """Регрессия: контент expand не должен теряться из-за вложенных макросов."""

    def test_anchor_inside_expand_table_keeps_all_rows(self):
        # Мини-копия реальной страницы: expand > таблица, в строке 3 — anchor
        rows = (
            "<tr><td>1</td><td>Выполнение запросов</td></tr>"
            "<tr><td>2</td><td>Обработка ошибки 401</td></tr>"
            "<tr><td>3</td><td>"
            + _macro("anchor", params='<ac:parameter ac:name="">Треб 15</ac:parameter>')
            + "Шеринг чека</td></tr>"
            "<tr><td>4</td><td>Изменение контракта</td></tr>"
        )
        html = _macro(
            "expand",
            _rich(f"<table><tbody>{rows}</tbody></table>"),
            params='<ac:parameter ac:name="title">Требования</ac:parameter>',
        )
        out = process_confluence_html(html, "p1")
        for text in ["Выполнение запросов", "Обработка ошибки 401",
                     "Шеринг чека", "Изменение контракта"]:
            self.assertIn(text, out)
        self.assertIn("<table>", out)
        self.assertNotIn("ac:", out)

    def test_nested_panels_keep_both_bodies(self):
        html = _macro("expand", _rich("<p>внешний текст</p>"
                                      + _macro("info", _rich("<p>внутренняя заметка</p>"))
                                      + "<p>хвост внешнего</p>"))
        out = process_confluence_html(html, "p1")
        self.assertIn("внешний текст", out)
        self.assertIn("внутренняя заметка", out)
        self.assertIn("хвост внешнего", out)

    def test_unknown_paired_macro_keeps_rich_body(self):
        # Неизвестный макрос с rich-text-body: содержимое сохраняем, не выбрасываем
        html = _macro("some-future-macro", _rich("<p>ценное требование</p>"))
        out = process_confluence_html(html, "p1")
        self.assertIn("ценное требование", out)

    def test_bodyless_macro_removed_entirely(self):
        html = "<p>до</p>" + _macro(
            "anchor", params='<ac:parameter ac:name="">якорь</ac:parameter>'
        ) + "<p>после</p>"
        out = process_confluence_html(html, "p1")
        self.assertIn("до", out)
        self.assertIn("после", out)
        self.assertNotIn("якорь", out)  # текст параметров не видим в Confluence

    def test_unclosed_macro_does_not_eat_content(self):
        html = '<ac:structured-macro ac:name="expand"><p>оборванный</p><p>текст жив</p>'
        out = process_confluence_html(html, "p1")
        self.assertIn("текст жив", out)
        self.assertNotIn("ac:", out)


class SelfClosingBeforePaired(unittest.TestCase):
    """Регрессия: самозакрытый тег не должен «спариваться» с чужим закрывающим."""

    def test_self_closing_link_does_not_eat_text(self):
        html = (
            "<p>начало</p><ac:link />"
            "<p>текст между ссылками не должен пропасть</p>"
            '<ac:link><ri:page ri:content-title="Стр" /></ac:link>'
        )
        out = process_confluence_html(html, "p1")
        self.assertIn("текст между ссылками не должен пропасть", out)
        self.assertIn("Стр", out)

    def test_self_closing_image_does_not_eat_text(self):
        html = (
            '<ac:image ac:width="200" />'
            "<p>текст между картинками</p>"
            '<ac:image><ri:attachment ri:filename="a.png" /></ac:image>'
        )
        out = process_confluence_html(html, "p1")
        self.assertIn("текст между картинками", out)
        self.assertIn('alt="a.png"', out)


class ExistingMacroRendering(unittest.TestCase):
    """Поведение остальных макросов не изменилось."""

    def test_jira_macro_becomes_link(self):
        html = _macro("jira", params=(
            '<ac:parameter ac:name="server">Jira</ac:parameter>'
            '<ac:parameter ac:name="key">DLMOB-3356</ac:parameter>'
        ))
        out = process_confluence_html(html, "p1", jira_base_url="https://jira.example.com")
        self.assertIn("DLMOB-3356", out)
        self.assertIn("https://jira.example.com/browse/DLMOB-3356", out)

    def test_jira_macro_inside_expand_table_cell(self):
        html = _macro("expand", _rich(
            "<table><tr><td>"
            + _macro("jira", params='<ac:parameter ac:name="key">AB-1</ac:parameter>')
            + "</td><td>описание</td></tr></table>"
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("AB-1", out)
        self.assertIn("описание", out)
        self.assertIn("<table>", out)

    def test_status_macro_becomes_badge(self):
        html = _macro("status", params=(
            '<ac:parameter ac:name="colour">Green</ac:parameter>'
            '<ac:parameter ac:name="title">готово</ac:parameter>'
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("готово", out)
        self.assertIn("#14892c", out)

    def test_code_macro_becomes_pre(self):
        html = _macro(
            "code",
            '<ac:plain-text-body><![CDATA[if (a < b) { return; }]]></ac:plain-text-body>',
            params='<ac:parameter ac:name="language">js</ac:parameter>',
        )
        out = process_confluence_html(html, "p1")
        self.assertIn("if (a &lt; b) { return; }", out)
        self.assertIn("<pre", out)

    def test_view_file_macro_becomes_attachment_link(self):
        html = _macro("view-file", params=(
            '<ac:parameter ac:name="name">'
            '<ri:attachment ri:filename="Методичка НТ.pdf" /></ac:parameter>'
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("Методичка НТ.pdf", out)
        self.assertIn("/api/pages/p1/attachments/", out)

    def test_multimedia_macro_becomes_attachment_link(self):
        html = _macro("multimedia", params=(
            '<ac:parameter ac:name="name">'
            '<ri:attachment ri:filename="запись экрана.mov" /></ac:parameter>'
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("запись экрана.mov", out)

    def test_include_macro_becomes_note(self):
        html = _macro("include", params=(
            '<ac:parameter ac:name="">'
            '<ri:page ri:content-title="Общие требования" /></ac:parameter>'
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("Вставка страницы", out)
        self.assertIn("Общие требования", out)

    def test_self_closing_toc_removed(self):
        html = '<p>шапка</p><ac:structured-macro ac:name="toc" ac:schema-version="1"/><p>тело</p>'
        out = process_confluence_html(html, "p1")
        self.assertIn("шапка", out)
        self.assertIn("тело", out)
        self.assertNotIn("ac:", out)


class ChipIconsKeepAnchorTextSpace(unittest.TestCase):
    """Иконки чипов (v1.7.6) не смеют менять текстовое пространство привязок.

    Эмодзи чипов («🔗 », «📎 », «📄 ») — часть текста ОБРАБОТАННОГО HTML, по
    которому считаются якоря существующих привязок. Замена на SVG обязана
    оставить текст блока байт-в-байт прежним (символ прячется невидимым
    span'ом), иначе смещения привязок в блоках с чипами поедут.
    """

    def test_jira_chip_shows_svg_but_text_space_unchanged(self):
        html = "<p>Смотри " + _macro("jira", params=(
            '<ac:parameter ac:name="key">AB-1</ac:parameter>'
        )) + " перед релизом</p>"
        out = process_confluence_html(html, "p1")
        self.assertIn("<svg", out)
        doc = anchoring.doc_from_html(out)
        self.assertEqual(doc.text, "Смотри 🔗 AB-1 перед релизом")

    def test_file_chip_shows_svg_but_text_space_unchanged(self):
        html = "<p>Методичка: " + _macro("view-file", params=(
            '<ac:parameter ac:name="name">'
            '<ri:attachment ri:filename="НТ.pdf" /></ac:parameter>'
        )) + "</p>"
        out = process_confluence_html(html, "p1")
        self.assertIn("<svg", out)
        doc = anchoring.doc_from_html(out)
        self.assertEqual(doc.text, "Методичка: 📎 НТ.pdf")

    def test_include_note_shows_svg_but_text_space_unchanged(self):
        html = _macro("include", params=(
            '<ac:parameter ac:name="">'
            '<ri:page ri:content-title="Общие требования" /></ac:parameter>'
        ))
        out = process_confluence_html(html, "p1")
        self.assertIn("<svg", out)
        doc = anchoring.doc_from_html(out)
        self.assertEqual(doc.text, "📄 Вставка страницы: Общие требования")


if __name__ == "__main__":
    unittest.main()
