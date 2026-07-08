"""
Движок привязок v1.5.9 — модель «маркер в снимке».

Эталон — inline-комментарии Confluence: якорь живёт В ДОКУМЕНТЕ (маркер,
оборачивающий текст), правки переносят его механически, повторного поиска текста
не существует, а «утрата» наступает, когда от размеченного диапазона не осталось
ни одного символа (dangling). ReqTrace не может писать маркеры в Confluence,
поэтому маркер эмулируется: привязка — диапазон [start, end) в полном тексте
ОБРАБОТАННОГО HTML (render_page_html) конкретного снимка, и при каждой новой
версии диапазон ОДИН РАЗ переносится диффом «старый текст → новый текст».
Дифф приближает последовательность правок редактора, через которую Confluence
протаскивает свой маркер. Никаких порогов похожести и поиска цитаты по странице
нет — прыжок привязки на похожий чужой текст невозможен по построению.

⚠ Координатное пространство: все координаты — по DOM ОБРАБОТАННОГО HTML
(render_page_html / process_confluence_html), как их считает фронт. Сырой
storage-XML даёт другую разбивку на блоки: текст ссылок/кода сидит в CDATA и
невидим HTML-парсеру (баг v1.5.6 — порча цитат при актуализации).

Границы диапазона ведут себя как annotation-mark ProseMirror (inclusive=false):
вставка СТРОГО ВНУТРИ диапазона расширяет его, вставка вплотную к границе — нет.
Это следует из правила переноса «образ диапазона = от образа первого до образа
последнего УЦЕЛЕВШЕГО символа»: только 'equal'-символы диффа переживают правку.

Известные ограничения (документированные) — неустранимые неоднозначности
сравнения двух снимков, когда дифф восстанавливает НЕ ту последовательность
правок, что была на самом деле:
  • одновременное удаление пункта и правка похожего соседа — уцелевшие куски
    могут зацепиться за соседний текст; привязка выживет со статусом «Требует
    проверки», человек разрешит вручную;
  • своп соседних блоков неотличим от «переехал другой блок» — неизменённый
    блок остаётся жив (мягче эталона, где cut/paste теряет комментарий, но
    честно: текст привязки не менялся); перенос через несколько блоков — утрата.
"""
import unicodedata
from bisect import bisect_right
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from bs4 import BeautifulSoup

BLOCK_TAGS = frozenset(
    ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "pre", "dt", "dd"]
)

# Невидимые символы: Confluence-редактор вставляет их при перенаборе текста.
# В КООРДИНАТАХ они остаются (текст не искажаем), но при СРАВНЕНИИ текстов
# (например «изменилась ли цитата») их не существует, как и пробелов.
_INVISIBLE_CHARS = frozenset("\N{ZERO WIDTH SPACE}\N{ZERO WIDTH NON-JOINER}\N{ZERO WIDTH JOINER}\N{ZERO WIDTH NO-BREAK SPACE}\N{SOFT HYPHEN}")

# Потолок на посимвольный дифф внутри одной replace-пары блоков: выше него пара
# считается непрозрачной заменой (диапазоны внутри не выживают). Страховка от
# O(n*m) на полностью переписанной странице.
CHAR_DIFF_CAP = 4_000_000

# Посимвольный дифф между НЕсвязанными текстами находит «шумовые» совпадения из
# отдельных букв и знаков препинания. Маркер на таком мусоре — ложное выживание:
# полностью перенабранный абзац обязан давать «Утрачено», как у эталона
# (select-all + перенабор уничтожает маркер). Равные куски короче этого числа
# ЗНАЧАЩИХ символов (norm_key) считаются частью замены.
MIN_EQUAL_RUN = 4


# --------------------------------------------------------------------------
# Документная модель
# --------------------------------------------------------------------------

@dataclass
class Doc:
    """Обработанный HTML как последовательность листовых блоков + полный текст.

    bounds[i] — абсолютное смещение начала i-го блока в text;
    bounds[-1] == len(text). Все позиции привязок живут в пространстве text.
    """
    blocks: list[str] = field(default_factory=list)
    text: str = ""
    bounds: list[int] = field(default_factory=list)


def doc_from_html(html: str) -> Doc:
    """Разбирает ОБРАБОТАННЫЙ HTML в документную модель (листовые блоки)."""
    soup = BeautifulSoup(html or "", "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    blocks: list[str] = []
    for el in soup.find_all(BLOCK_TAGS):
        if not el.find(BLOCK_TAGS):
            blocks.append(el.get_text(separator="", strip=False))
    bounds = [0]
    for b in blocks:
        bounds.append(bounds[-1] + len(b))
    return Doc(blocks=blocks, text="".join(blocks), bounds=bounds)


def abs_range(doc: Doc, block_start: int, block_end: int | None,
              start_offset: int, end_offset: int) -> tuple[int, int] | None:
    """Блочные якоря → абсолютный диапазон [start, end) в doc.text.

    None — якорь вне документа (блока с таким индексом нет) или пустой диапазон.
    Смещения клампятся к длинам блоков (защита от дрейфа исторических данных).
    """
    if not doc.blocks or block_start < 0 or block_start >= len(doc.blocks):
        return None
    b_end = block_start if block_end is None else min(block_end, len(doc.blocks) - 1)
    if b_end < block_start:
        b_end = block_start
    start = doc.bounds[block_start] + min(max(start_offset, 0), len(doc.blocks[block_start]))
    end = doc.bounds[b_end] + min(max(end_offset, 0), len(doc.blocks[b_end]))
    if end <= start:
        return None
    return (start, end)


def block_coords(doc: Doc, start: int, end: int) -> dict:
    """Абсолютный диапазон [start, end) → блочные якоря (для БД и фронта)."""
    start_block = min(bisect_right(doc.bounds, start) - 1, len(doc.blocks) - 1)
    end_block = min(bisect_right(doc.bounds, end - 1) - 1, len(doc.blocks) - 1)
    return {
        "anchor_block_start": start_block,
        "anchor_block_end": end_block,
        "start_char_offset": start - doc.bounds[start_block],
        "end_char_offset": end - doc.bounds[end_block],
    }


def norm_key(s: str) -> str:
    """Ключ СРАВНЕНИЯ текстов: NFC, без пробельных и невидимых символов.

    Только для ответов на вопрос «это тот же текст?» — координаты всегда
    считаются по сырому тексту.
    """
    s = unicodedata.normalize("NFC", s or "")
    return "".join(
        ch for ch in s if not ch.isspace() and ch not in _INVISIBLE_CHARS
    )


# --------------------------------------------------------------------------
# Перенос диапазонов через дифф версий
# --------------------------------------------------------------------------

def char_opcodes(old: Doc, new: Doc) -> list[tuple[str, int, int, int, int]]:
    """Посимвольные опкоды old.text → new.text.

    Двухуровнево: сначала выравнивание СПИСКОВ блоков (дёшево и устойчиво к
    большим страницам), затем посимвольный дифф внутри каждой replace-группы.
    Replace-группа может объединять несколько блоков — это корректно переносит
    разбиение/склейку абзацев. Возвращает (tag, o1, o2, n1, n2) в символах.
    """
    ops: list[tuple[str, int, int, int, int]] = []
    sm = SequenceMatcher(None, old.blocks, new.blocks, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        o1, o2 = old.bounds[i1], old.bounds[i2]
        n1, n2 = new.bounds[j1], new.bounds[j2]
        if tag == "equal":
            ops.append(("equal", o1, o2, n1, n2))
        elif tag == "delete":
            ops.append(("delete", o1, o2, n1, n1))
        elif tag == "insert":
            ops.append(("insert", o1, o1, n1, n2))
        else:  # replace — уточняем посимвольно
            a, b = old.text[o1:o2], new.text[n1:n2]
            if len(a) * len(b) > CHAR_DIFF_CAP:
                ops.append(("replace", o1, o2, n1, n2))
                continue
            inner = SequenceMatcher(None, a, b, autojunk=False)
            for t, a1, a2, b1, b2 in inner.get_opcodes():
                if t == "equal" and len(norm_key(a[a1:a2])) < MIN_EQUAL_RUN:
                    t = "replace"  # шумовое совпадение — см. MIN_EQUAL_RUN
                ops.append((t, o1 + a1, o1 + a2, n1 + b1, n1 + b2))
    return ops


def map_range(ops: list[tuple[str, int, int, int, int]],
              start: int, end: int) -> tuple[int, int] | None:
    """Переносит [start, end) через опкоды: образ диапазона — от образа первого
    до образа последнего уцелевшего ('equal') символа.

    Следствия (семантика маркера):
      • правка/вставка/замена СТРОГО ВНУТРИ — диапазон накрывает её;
      • вставка на границе — не входит (inclusive=false);
      • не уцелел ни один символ — None (→ «Утрачено», как dangling).
    """
    new_start: int | None = None
    new_end: int | None = None
    for tag, o1, o2, n1, n2 in ops:
        if tag != "equal" or o2 <= start or o1 >= end:
            continue
        s = max(start, o1)
        e = min(end, o2)
        if new_start is None:
            new_start = n1 + (s - o1)
        new_end = n1 + (e - o1)
    if new_start is None or new_end is None or new_end <= new_start:
        return None
    return (new_start, new_end)


# --------------------------------------------------------------------------
# Проекция привязок на новую версию (вызывается из refresh)
# --------------------------------------------------------------------------

def project(old_html: str, new_html: str, highlights: list[dict]) -> list[dict]:
    """Переносит привязки на новую версию страницы и решает статусы.

    highlights — dict'ы с полями: id, status, text_content (original_quote),
    anchor_block_start/end, start_char_offset/end_char_offset.

    Правила (полная таблица переходов — в anchoring-plan-v1.5.9.md):
      • lost НЕ проецируется — статус терминальный, якоря заморожены;
      • диапазон не выжил → lost;
      • выжил и текст == цитате (norm_key) → статус сохраняется как был
        (правка соседнего текста привязку не трогает — как в Confluence);
      • выжил и текст изменился → active понижается до outdated,
        outdated остаётся outdated.

    Каждому спроецированному возвращаются new_* якоря и anchored_text —
    текущий текст под маркером (для диффа цитаты в панели).
    """
    old_doc = doc_from_html(old_html)
    new_doc = doc_from_html(new_html)
    ops = char_opcodes(old_doc, new_doc)

    results: list[dict] = []
    for h in highlights:
        if h.get("status") == "lost":
            results.append({**h, "projected_status": "lost"})
            continue

        rng = None
        if h.get("anchor_block_start") is not None:
            src = abs_range(
                old_doc,
                h["anchor_block_start"], h.get("anchor_block_end"),
                h.get("start_char_offset") or 0, h.get("end_char_offset") or 0,
            )
            if src is not None:
                rng = map_range(ops, *src)

        if rng is None:
            results.append({**h, "projected_status": "lost"})
            continue

        anchored_text = new_doc.text[rng[0]:rng[1]]
        quote = h.get("text_content") or ""
        if norm_key(anchored_text) == norm_key(quote):
            status = h.get("status") or "outdated"
        else:
            status = "outdated"

        results.append({
            **h,
            "projected_status": status,
            "anchored_text": anchored_text,
            **{f"new_{k}": v for k, v in block_coords(new_doc, *rng).items()},
        })
    return results


# --------------------------------------------------------------------------
# Создание и «Актуализировать»
# --------------------------------------------------------------------------

def verify_creation(html: str, block_start: int, block_end: int | None,
                    start_offset: int, end_offset: int, quote: str) -> dict | None:
    """Серверная проверка якоря при создании привязки.

    Зеркало контракта Confluence «textSelection + matchIndex используется один
    раз при создании»: координаты, посчитанные фронтом по DOM, должны указывать
    на текст, совпадающий с цитатой (norm_key). Возвращает канонизированные
    блочные якоря и anchored_text, либо None — фронт прислал битый якорь
    (например, страница успела обновиться) и создание надо отклонить.
    """
    doc = doc_from_html(html)
    rng = abs_range(doc, block_start, block_end, start_offset, end_offset)
    if rng is None:
        return None
    anchored_text = doc.text[rng[0]:rng[1]]
    if not norm_key(quote) or norm_key(anchored_text) != norm_key(quote):
        return None
    return {"anchored_text": anchored_text, **block_coords(doc, *rng)}


def confirm_reanchor(anchored_text: str | None) -> dict | None:
    """«Актуализировать» (outdated → active): цитатой становится текущий текст
    под маркером. Поиска текста больше нет — якорь всегда точен по инварианту.
    None — подтверждать нечего (пустой маркер), вызывающий код вернёт ошибку.
    """
    if not anchored_text or not norm_key(anchored_text):
        return None
    return {"text_content": anchored_text}
