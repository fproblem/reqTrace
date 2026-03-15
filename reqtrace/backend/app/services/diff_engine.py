import logging

from bs4 import BeautifulSoup, NavigableString
from diff_match_patch import diff_match_patch

logger = logging.getLogger(__name__)


def extract_text_from_html(html: str) -> str:
    """Extract plain text from HTML, preserving block structure."""
    soup = BeautifulSoup(html, "lxml")
    for script in soup(["script", "style"]):
        script.decompose()
    return soup.get_text(separator="\n", strip=False)


def compute_diff_html(baseline_html: str, current_html: str) -> str:
    """
    Compute a visual diff between baseline and current HTML content.
    Returns HTML with highlighted additions and deletions.
    """
    baseline_text = extract_text_from_html(baseline_html)
    current_text = extract_text_from_html(current_html)

    dmp = diff_match_patch()
    diffs = dmp.diff_main(baseline_text, current_text)
    dmp.diff_cleanupSemantic(diffs)

    result_parts = []
    for op, text in diffs:
        escaped = (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
        )

        if op == 0:
            result_parts.append(f'<span class="diff-equal">{escaped}</span>')
        elif op == 1:
            result_parts.append(
                f'<span class="diff-added" style="background-color: rgba(122,224,90,0.25); '
                f'padding: 1px 2px;">{escaped}</span>'
            )
        elif op == -1:
            result_parts.append(
                f'<span class="diff-removed" style="background-color: rgba(239,68,68,0.2); '
                f'text-decoration: line-through; padding: 1px 2px;">{escaped}</span>'
            )

    return "".join(result_parts)


def has_text_changed(old_html: str, new_html: str) -> bool:
    """Check if the meaningful text content has changed between two HTML versions."""
    old_text = extract_text_from_html(old_html).strip()
    new_text = extract_text_from_html(new_html).strip()
    return old_text != new_text
