"""
Highlight projection engine.

When a Confluence page is updated, this module determines
whether existing highlights from the baseline are still valid,
have changed (outdated), or are lost.
"""
import logging
from difflib import SequenceMatcher

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

CONTEXT_MATCH_THRESHOLD = 0.6
TEXT_MATCH_THRESHOLD = 0.7


def extract_text_from_html(html: str) -> str:
    """Extract plain text from HTML."""
    soup = BeautifulSoup(html, "lxml")
    for script in soup(["script", "style"]):
        script.decompose()
    return soup.get_text(separator=" ", strip=False)


def find_text_in_content(
    content: str,
    text_content: str,
    text_before: str = "",
    text_after: str = "",
) -> tuple[str, float]:
    """
    Try to find text_content within content using context matching.
    
    Returns (status, confidence):
    - ("active", 1.0) for exact match
    - ("outdated", confidence) for partial match
    - ("lost", 0.0) if not found
    """
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
                after_end = min(len(content), idx + len(text_content) + len(text_after))
                actual_after = content[idx + len(text_content):after_end]

                before_ratio = _similarity(text_before, actual_before) if text_before else 1.0
                after_ratio = _similarity(text_after, actual_after) if text_after else 1.0

                avg_context_match = (before_ratio + after_ratio) / 2
                if avg_context_match >= CONTEXT_MATCH_THRESHOLD:
                    return "active", avg_context_match

                idx = content.find(text_content, idx + 1)

        return "active", 0.9

    best_ratio = 0.0
    window_size = len(text_content)
    step = max(1, window_size // 4)

    for i in range(0, max(1, len(content) - window_size + 1), step):
        window = content[i:i + window_size + window_size // 2]
        ratio = _similarity(text_content, window)
        best_ratio = max(best_ratio, ratio)

        if best_ratio >= TEXT_MATCH_THRESHOLD:
            break

    if best_ratio >= TEXT_MATCH_THRESHOLD:
        return "outdated", best_ratio

    if text_before and text_after:
        context_str = text_before + text_after
        for i in range(0, max(1, len(content) - len(context_str) + 1), step):
            window = content[i:i + len(context_str) + len(context_str) // 2]
            ratio = _similarity(context_str, window)
            if ratio >= CONTEXT_MATCH_THRESHOLD:
                return "outdated", ratio * 0.7

    return "lost", 0.0


def _similarity(a: str, b: str) -> float:
    """Compute similarity ratio between two strings."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def project_highlights(
    highlights: list[dict],
    new_content_html: str,
) -> list[dict]:
    """
    Project all highlights from baseline onto new content.
    
    Each highlight dict must have: text_content, text_before, text_after.
    Returns list of dicts with added 'projected_status' field.
    """
    plain_text = extract_text_from_html(new_content_html)

    results = []
    for h in highlights:
        status, confidence = find_text_in_content(
            plain_text,
            h.get("text_content", ""),
            h.get("text_before", ""),
            h.get("text_after", ""),
        )

        result = {**h, "projected_status": status, "confidence": confidence}
        results.append(result)

        logger.debug(
            "Highlight '%s...' -> %s (confidence: %.2f)",
            h.get("text_content", "")[:50],
            status,
            confidence,
        )

    return results
