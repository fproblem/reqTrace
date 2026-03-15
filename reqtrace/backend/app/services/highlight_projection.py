"""
Highlight projection engine – block-based approach.

When a Confluence page is updated, this module aligns the block structure
of the old and new HTML and projects highlight anchors to the new version.
This mirrors how Confluence inline comments survive edits.
"""
import logging
from difflib import SequenceMatcher

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BLOCK_TAGS = frozenset(
    ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "pre", "dt", "dd"]
)

CONTEXT_MATCH_THRESHOLD = 0.6
TEXT_MATCH_THRESHOLD = 0.7


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


def project_highlights(
    highlights: list[dict],
    new_content_html: str,
    old_content_html: str | None = None,
) -> list[dict]:
    """
    Project all highlights onto new content.

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
        return {**h, "projected_status": "lost", "confidence": 0.0}

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
            new_block_text = new_blocks[new_start_idx]
            sim = _similarity(text_content, new_block_text)
            if text_content in new_block_text:
                status = "active"
                confidence = 0.95
            elif sim >= TEXT_MATCH_THRESHOLD:
                status = "outdated"
                confidence = sim
            else:
                status = "outdated"
                confidence = max(sim, 0.5)
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
