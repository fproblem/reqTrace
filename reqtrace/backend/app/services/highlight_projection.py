"""
Highlight projection engine – block-based approach.

When a Confluence page is updated, this module aligns the block structure
of the old and new HTML and projects highlight anchors to the new version.
This mirrors how Confluence inline comments survive edits.

⚠ Координатное пространство: блочные якоря привязок (номера блоков и
символьные смещения) фронт считает по DOM ОБРАБОТАННОГО HTML
(process_confluence_html / render_page_html). Все функции этого модуля,
принимающие html, обязаны получать то же ОБРАБОТАННОЕ представление — сырой
storage-XML даёт другую разбивку: текст ссылок и кода в нём сидит в
CDATA/атрибутах и невидим HTML-парсеру, из-за чего цитаты при реанкоре
подменялись чужим текстом (баг v1.5.6).
"""
import bisect
import logging
from difflib import SequenceMatcher

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BLOCK_TAGS = frozenset(
    ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "pre", "dt", "dd"]
)

CONTEXT_MATCH_THRESHOLD = 0.6
TEXT_MATCH_THRESHOLD = 0.7

# Частичное совпадение (v1.5.8, зеркало highlightMatching.ts): кусок короче
# PARTIAL_MIN_RUN значащих символов — случайное совпадение букв, а не «след
# цитаты»; уцелело меньше PARTIAL_MIN_SURVIVAL доли цитаты → «Утрачено».
PARTIAL_MIN_RUN = 4
PARTIAL_MIN_SURVIVAL = 0.5

# Невидимые символы (zero-width space и т.п.) — Confluence-редактор вставляет
# их при перенаборе текста; для сопоставления их не существует, как и пробелов.
_INVISIBLE_CHARS = frozenset("\u200b\u200c\u200d\ufeff\u00ad")


def extract_blocks(html: str) -> list[str]:
    """Extract leaf-level block texts from HTML in document order."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    blocks: list[str] = []
    for el in soup.find_all(BLOCK_TAGS):
        if not el.find(BLOCK_TAGS):
            blocks.append(el.get_text(separator="", strip=False))
    return blocks


def extract_text_from_html(html: str) -> str:
    """Extract plain text from HTML (kept for legacy fallback)."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    return soup.get_text(separator=" ", strip=False)


def _similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _build_block_mapping(
    old_blocks: list[str], new_blocks: list[str]
) -> dict[int, tuple[str, int]]:
    """
    Align old blocks to new blocks.
    Returns {old_index: (change_type, new_index)}.
    change_type is 'equal', 'changed', or absent (deleted).
    """
    matcher = SequenceMatcher(None, old_blocks, new_blocks, autojunk=False)
    mapping: dict[int, tuple[str, int]] = {}

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                mapping[i1 + k] = ("equal", j1 + k)
        elif op == "replace":
            pairs = min(i2 - i1, j2 - j1)
            for k in range(pairs):
                mapping[i1 + k] = ("changed", j1 + k)
        # 'delete' → old blocks not in mapping → lost
        # 'insert' → no old blocks to map

    return mapping


def _find_text_in_content_legacy(
    content: str,
    text_content: str,
    text_before: str = "",
    text_after: str = "",
) -> tuple[str, float]:
    """Legacy text-based search for highlights without block anchoring."""
    if not text_content:
        return "lost", 0.0

    if text_content in content:
        if text_before or text_after:
            full_context = text_before + text_content + text_after
            if full_context in content:
                return "active", 1.0

            idx = content.find(text_content)
            while idx != -1:
                before_start = max(0, idx - len(text_before))
                actual_before = content[before_start:idx]
                after_end = min(
                    len(content), idx + len(text_content) + len(text_after)
                )
                actual_after = content[idx + len(text_content) : after_end]

                before_ratio = (
                    _similarity(text_before, actual_before) if text_before else 1.0
                )
                after_ratio = (
                    _similarity(text_after, actual_after) if text_after else 1.0
                )

                avg_context_match = (before_ratio + after_ratio) / 2
                if avg_context_match >= CONTEXT_MATCH_THRESHOLD:
                    return "active", avg_context_match

                idx = content.find(text_content, idx + 1)

        return "active", 0.9

    best_ratio = 0.0
    window_size = len(text_content)
    step = max(1, window_size // 4)
    for i in range(0, max(1, len(content) - window_size + 1), step):
        window = content[i : i + window_size + window_size // 2]
        ratio = _similarity(text_content, window)
        best_ratio = max(best_ratio, ratio)
        if best_ratio >= TEXT_MATCH_THRESHOLD:
            break

    if best_ratio >= TEXT_MATCH_THRESHOLD:
        return "outdated", best_ratio

    return "lost", 0.0


def extract_text_at_anchor(
    html: str,
    anchor_block_start: int,
    anchor_block_end: int | None,
    start_char_offset: int,
    end_char_offset: int,
) -> dict:
    """Extract text_content, text_before, text_after at the given anchor positions.

    html — ОБРАБОТАННЫЙ HTML (render_page_html), см. предупреждение в шапке модуля.
    """
    return _extract_at_anchor(
        extract_blocks(html),
        anchor_block_start, anchor_block_end,
        start_char_offset, end_char_offset,
    )


def _extract_at_anchor(
    blocks: list[str],
    anchor_block_start: int,
    anchor_block_end: int | None,
    start_char_offset: int,
    end_char_offset: int,
) -> dict:
    if anchor_block_end is None:
        anchor_block_end = anchor_block_start

    if anchor_block_start >= len(blocks):
        return {"text_content": "", "text_before": "", "text_after": ""}

    anchor_block_end = min(anchor_block_end, len(blocks) - 1)

    parts: list[str] = []
    for bi in range(anchor_block_start, anchor_block_end + 1):
        block_text = blocks[bi]
        if bi == anchor_block_start and bi == anchor_block_end:
            s = min(start_char_offset, len(block_text))
            e = min(end_char_offset, len(block_text))
            parts.append(block_text[s:e])
        elif bi == anchor_block_start:
            s = min(start_char_offset, len(block_text))
            parts.append(block_text[s:])
        elif bi == anchor_block_end:
            e = min(end_char_offset, len(block_text))
            parts.append(block_text[:e])
        else:
            parts.append(block_text)

    text_content = "".join(parts)

    full_text = "".join(blocks)
    prefix_len = sum(len(blocks[i]) for i in range(anchor_block_start))
    abs_start = prefix_len + min(start_char_offset, len(blocks[anchor_block_start]))
    text_before = full_text[max(0, abs_start - 100):abs_start]
    abs_end = abs_start + len(text_content)
    text_after = full_text[abs_end:abs_end + 100]

    return {
        "text_content": text_content,
        "text_before": text_before,
        "text_after": text_after,
    }


def _strip_with_map(s: str) -> tuple[str, list[int]]:
    """Текст без пробельных/невидимых символов + карта: map[i] = индекс i-го
    значащего символа в исходной строке. Зеркало stripWhitespaceWithMap на фронте."""
    chars: list[str] = []
    mapping: list[int] = []
    for i, ch in enumerate(s):
        if not ch.isspace() and ch not in _INVISIBLE_CHARS:
            chars.append(ch)
            mapping.append(i)
    return "".join(chars), mapping


def _common_runs(a: str, b: str, min_run: int) -> list[tuple[int, int, int]]:
    """Общие куски a и b в порядке следования: разложение по самой длинной
    общей подстроке, рекурсивно слева и справа от неё (зеркало commonRuns на
    фронте). Возвращает [(ai, bi, len)]; ветки с куском короче min_run
    отбрасываются целиком — короткие совпадения букв не «след цитаты»."""
    if len(a) < min_run or len(b) < min_run:
        return []
    m = SequenceMatcher(None, a, b, autojunk=False).find_longest_match(
        0, len(a), 0, len(b)
    )
    if m.size < min_run:
        return []
    left = _common_runs(a[: m.a], b[: m.b], min_run)
    right = [
        (ai + m.a + m.size, bi + m.b + m.size, ln)
        for ai, bi, ln in _common_runs(a[m.a + m.size :], b[m.b + m.size :], min_run)
    ]
    return [*left, (m.a, m.b, m.size), *right]


def _surviving_share(needle_stripped: str, region_stripped: str) -> float:
    """Доля значащих символов цитаты, уцелевших в тексте её блоков."""
    if not needle_stripped:
        return 0.0
    runs = _common_runs(needle_stripped, region_stripped, PARTIAL_MIN_RUN)
    return sum(r[2] for r in runs) / len(needle_stripped)


def _find_stripped_occurrence(
    haystack: str, needle: str, before: str, after: str
) -> int:
    """Лучшее вхождение needle в haystack (все строки — уже без пробелов):
    при нескольких вхождениях выбирается то, у которого длиннее непрерывное
    совпадение окружения с before/after. Зеркало findBestMatchIndex на фронте.
    -1 — вхождений нет."""
    occurrences: list[int] = []
    i = haystack.find(needle)
    while i != -1 and len(occurrences) < 50:
        occurrences.append(i)
        i = haystack.find(needle, i + 1)
    if not occurrences:
        return -1
    if len(occurrences) == 1:
        return occurrences[0]

    best, best_score = occurrences[0], -1
    for idx in occurrences:
        score = 0
        if before:
            actual = haystack[max(0, idx - len(before)):idx]
            for k in range(1, min(len(actual), len(before)) + 1):
                if actual[-k] != before[-k]:
                    break
                score += 1
        if after:
            tail_start = idx + len(needle)
            actual = haystack[tail_start:tail_start + len(after)]
            for k in range(min(len(actual), len(after))):
                if actual[k] != after[k]:
                    break
                score += 1
        if score > best_score:
            best_score, best = score, idx
    return best


def _block_coords(blocks: list[str], start: int, end: int) -> dict:
    """Смещения [start, end) в "".join(blocks) → блочные якоря."""
    bounds = [0]
    for b in blocks:
        bounds.append(bounds[-1] + len(b))
    start_block = min(bisect.bisect_right(bounds, start) - 1, len(blocks) - 1)
    end_block = min(bisect.bisect_right(bounds, end - 1) - 1, len(blocks) - 1)
    return {
        "anchor_block_start": start_block,
        "anchor_block_end": end_block,
        "start_char_offset": start - bounds[start_block],
        "end_char_offset": end - bounds[end_block],
    }


def _find_split_span(haystack: str, needle: str, before: str) -> tuple[int, int] | None:
    """Найти needle в haystack с РОВНО ОДНОЙ вставкой внутри: самый длинный
    префикс, у которого суффикс находится дальше по тексту. Возвращает [start, end)
    объемлющего диапазона (вместе со вставкой) или None. Все строки — без
    пробелов. Зеркало findSplitRangesIgnoringWhitespace на фронте."""
    anchor_from = 0
    if before:
        bi = haystack.find(before)
        if bi != -1:
            anchor_from = bi + len(before)

    def try_split(from_: int) -> tuple[int, int] | None:
        for k in range(len(needle) - 1, 0, -1):
            a = haystack.find(needle[:k], from_)
            if a == -1:
                continue
            b = haystack.find(needle[k:], a + k)
            if b == -1:
                continue
            return a, b + (len(needle) - k)
        return None

    span = try_split(anchor_from)
    if span is None and anchor_from != 0:
        span = try_split(0)
    return span


def resolve_reanchor(
    html: str,
    text_content: str,
    text_before: str,
    text_after: str,
    anchor_block_start: int | None,
    anchor_block_end: int | None,
    start_char_offset: int,
    end_char_offset: int,
) -> dict | None:
    """Пересчитать привязку для «Актуализировать», НЕ теряя цитату.

    html — ОБРАБОТАННЫЙ HTML снимка (render_page_html): то же представление,
    по которому фронт считал якоря и рисует страницу.

    Порядок (от строгого к терпимому) — те же правила, по которым фронт
    решает, ГДЕ показать привязку (highlightMatching.ts):
      1) текст под якорем совпадает с цитатой без учёта пробелов → якоря верны,
         обновляются только text_before/text_after;
      2) цитата находится на странице текстовым поиском (неоднозначность
         снимается контекстом) → якоря пересчитываются от найденного места —
         лечит якоря, съехавшие от старых версий проекции;
      3) цитата лежит «разрывом» — префикс + суффикс с одной вставкой между
         ними (как инлайн-комментарий Confluence) → цитатой становится весь
         найденный диапазон вместе со вставкой;
      4) ничего не подошло → None: вызывающий код НЕ должен перезаписывать
         привязку — молчаливая перезапись превращала цитату в чужой текст.

    Возвращает dict с новыми text_content/text_before/text_after и якорями.
    """
    blocks = extract_blocks(html)
    full_text = "".join(blocks)
    stored_stripped, _ = _strip_with_map(text_content or "")
    if not stored_stripped or not blocks:
        return None

    if anchor_block_start is not None and 0 <= anchor_block_start < len(blocks):
        anchored = _extract_at_anchor(
            blocks, anchor_block_start, anchor_block_end,
            start_char_offset, end_char_offset,
        )
        anchored_stripped, _ = _strip_with_map(anchored["text_content"])
        if anchored_stripped == stored_stripped:
            return {
                **anchored,
                "anchor_block_start": anchor_block_start,
                "anchor_block_end": (
                    anchor_block_end if anchor_block_end is not None
                    else anchor_block_start
                ),
                "start_char_offset": start_char_offset,
                "end_char_offset": end_char_offset,
            }

    haystack, hay_map = _strip_with_map(full_text)
    before_stripped, _ = _strip_with_map(text_before or "")
    after_stripped, _ = _strip_with_map(text_after or "")
    at = _find_stripped_occurrence(
        haystack, stored_stripped, before_stripped, after_stripped
    )
    if at != -1:
        orig_start = hay_map[at]
        orig_end = hay_map[at + len(stored_stripped) - 1] + 1
        return {
            "text_content": full_text[orig_start:orig_end],
            "text_before": full_text[max(0, orig_start - 100):orig_start],
            "text_after": full_text[orig_end:orig_end + 100],
            **_block_coords(blocks, orig_start, orig_end),
        }

    span = _find_split_span(haystack, stored_stripped, before_stripped)
    if span is not None:
        orig_start = hay_map[span[0]]
        orig_end = hay_map[span[1] - 1] + 1
        return {
            "text_content": full_text[orig_start:orig_end],
            "text_before": full_text[max(0, orig_start - 100):orig_start],
            "text_after": full_text[orig_end:orig_end + 100],
            **_block_coords(blocks, orig_start, orig_end),
        }

    # 4) Частичное совпадение в якорных блоках (v1.5.8): цитату правили, но
    #    уцелело ≥ половины — цитатой становится текст от первого до последнего
    #    уцелевшего куска (как Confluence сжимает inline-комментарий до
    #    оставшегося текста). Строго в якорных блоках: «похожий» текст в другом
    #    месте страницы цитатой становиться не должен.
    if anchor_block_start is not None and 0 <= anchor_block_start < len(blocks):
        a_end = anchor_block_end if anchor_block_end is not None else anchor_block_start
        a_end = min(max(a_end, anchor_block_start), len(blocks) - 1)
        prefix_len = sum(len(blocks[i]) for i in range(anchor_block_start))
        region = "".join(blocks[anchor_block_start : a_end + 1])
        region_stripped, region_map = _strip_with_map(region)
        runs = _common_runs(stored_stripped, region_stripped, PARTIAL_MIN_RUN)
        survived = sum(r[2] for r in runs)
        if runs and survived >= len(stored_stripped) * PARTIAL_MIN_SURVIVAL:
            first_b = runs[0][1]
            last_b = runs[-1][1] + runs[-1][2] - 1
            orig_start = prefix_len + region_map[first_b]
            orig_end = prefix_len + region_map[last_b] + 1
            return {
                "text_content": full_text[orig_start:orig_end],
                "text_before": full_text[max(0, orig_start - 100):orig_start],
                "text_after": full_text[orig_end:orig_end + 100],
                **_block_coords(blocks, orig_start, orig_end),
            }

    return None


def project_highlights(
    highlights: list[dict],
    new_content_html: str,
    old_content_html: str | None = None,
) -> list[dict]:
    """
    Project all highlights onto new content.

    Оба html — ОБРАБОТАННЫЕ (render_page_html), см. предупреждение в шапке модуля.

    For highlights with block anchoring (anchor_block_start is set):
      uses structural block alignment between old and new HTML.
    For legacy highlights:
      falls back to text-based matching.
    """
    new_blocks = extract_blocks(new_content_html)
    old_blocks = extract_blocks(old_content_html) if old_content_html else []

    block_mapping = (
        _build_block_mapping(old_blocks, new_blocks) if old_blocks else {}
    )

    plain_text_new = extract_text_from_html(new_content_html)

    results: list[dict] = []
    for h in highlights:
        anchor_start = h.get("anchor_block_start")

        if anchor_start is not None and old_blocks:
            result = _project_block_anchored(h, block_mapping, new_blocks)
        else:
            status, confidence = _find_text_in_content_legacy(
                plain_text_new,
                h.get("text_content", ""),
                h.get("text_before", ""),
                h.get("text_after", ""),
            )
            result = {**h, "projected_status": status, "confidence": confidence}

        results.append(result)
        logger.debug(
            "Highlight '%s...' -> %s",
            h.get("text_content", "")[:50],
            result.get("projected_status"),
        )

    return results


def _project_block_anchored(
    h: dict,
    block_mapping: dict[int, tuple[str, int]],
    new_blocks: list[str],
) -> dict:
    """Project a single block-anchored highlight using the block mapping."""
    anchor_start = h["anchor_block_start"]
    anchor_end = h.get("anchor_block_end", anchor_start)
    if anchor_end is None:
        anchor_end = anchor_start

    start_mapping = block_mapping.get(anchor_start)
    end_mapping = block_mapping.get(anchor_end)

    if start_mapping is None:
        # Блок с цитатой удалён целиком. Якорь больше ничего не значит: после
        # сдвига блоков его индекс указывает на СОСЕДНИЙ текст, и частичное
        # размещение (v1.5.8) подсвечивало бы похожий чужой пункт — регрессия
        # «прыгающей» подсветки (§6). Обнуляем якоря; вернуть привязку можно
        # точным текстовым поиском (текст вернули) или «Актуализировать».
        return {
            **h,
            "projected_status": "lost",
            "confidence": 0.0,
            "new_anchor_block_start": None,
            "new_anchor_block_end": None,
            "new_start_char_offset": None,
            "new_end_char_offset": None,
        }

    start_type, new_start_idx = start_mapping

    if end_mapping is not None:
        end_type, new_end_idx = end_mapping
    else:
        end_type = start_type
        new_end_idx = new_start_idx

    new_start_offset = h.get("start_char_offset", 0) or 0
    new_end_offset = h.get("end_char_offset", 0) or 0

    if new_start_idx < len(new_blocks):
        block_text_len = len(new_blocks[new_start_idx])
        new_start_offset = min(new_start_offset, block_text_len)
    if new_end_idx < len(new_blocks):
        block_text_len = len(new_blocks[new_end_idx])
        new_end_offset = min(new_end_offset, block_text_len)

    if start_type == "equal" and (anchor_start == anchor_end or end_type == "equal"):
        status = "active"
        confidence = 1.0
    else:
        text_content = h.get("text_content", "")
        if new_start_idx < len(new_blocks):
            new_end_clamped = min(new_end_idx, len(new_blocks) - 1)
            region = "".join(new_blocks[new_start_idx : new_end_clamped + 1])
            if text_content and text_content in region:
                status = "active"
                confidence = 0.95
            else:
                # Блок изменился, цитаты целиком нет. Решаем по доле уцелевших
                # значащих символов цитаты в её блоках — тем же правилом, по
                # которому фронт показывает частичную подсветку
                # (findPartialRanges): уцелело ≥ половины → «Требует проверки»,
                # меньше → «Утрачено».
                needle, _ = _strip_with_map(text_content)
                region_stripped, _ = _strip_with_map(region)
                share = _surviving_share(needle, region_stripped)
                status = "outdated" if share >= PARTIAL_MIN_SURVIVAL else "lost"
                confidence = share
        else:
            status = "outdated"
            confidence = 0.5

    return {
        **h,
        "projected_status": status,
        "confidence": confidence,
        "new_anchor_block_start": new_start_idx,
        "new_anchor_block_end": new_end_idx,
        "new_start_char_offset": new_start_offset,
        "new_end_char_offset": new_end_offset,
    }
