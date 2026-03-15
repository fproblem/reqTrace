import React, { useEffect, useCallback } from 'react';
import { Highlight } from '../../types';

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, dt, dd';

export function getContentBlocks(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
  return all.filter(el => !el.querySelector(BLOCK_SELECTOR));
}

interface HighlightLayerProps {
  container: HTMLDivElement | null;
  highlights: Highlight[];
  selectedHighlightId: string | null;
  onHighlightClick: (highlight: Highlight) => void;
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  container,
  highlights,
  selectedHighlightId,
  onHighlightClick,
}) => {
  const applyHighlights = useCallback(() => {
    if (!container) return;

    container.querySelectorAll('.highlight-mark').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      }
    });
    container.normalize();

    const blocks = getContentBlocks(container);

    for (const highlight of highlights) {
      if (highlight.status === 'lost') continue;

      try {
        if (highlight.anchor_block_start != null) {
          applyBlockAnchored(container, blocks, highlight, selectedHighlightId, onHighlightClick);
        } else {
          applyLegacyTextSearch(container, highlight, selectedHighlightId, onHighlightClick);
        }
      } catch (err) {
        console.warn('Failed to apply highlight:', highlight.id, err);
      }
    }
  }, [container, highlights, selectedHighlightId, onHighlightClick]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  return null;
};

function applyBlockAnchored(
  container: HTMLElement,
  blocks: HTMLElement[],
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
) {
  const startBlockIdx = highlight.anchor_block_start!;
  const endBlockIdx = highlight.anchor_block_end ?? startBlockIdx;
  const startCharOffset = highlight.start_char_offset ?? 0;
  const endCharOffset = highlight.end_char_offset ?? 0;

  if (startBlockIdx >= blocks.length) return;

  if (startBlockIdx === endBlockIdx) {
    const block = blocks[startBlockIdx];
    const blockText = block.textContent || '';
    const clampedStart = Math.min(startCharOffset, blockText.length);
    const clampedEnd = Math.min(endCharOffset, blockText.length);
    if (clampedStart >= clampedEnd) return;

    const { startNode, startOff, endNode, endOff } = findNodesForOffsets(
      block, clampedStart, clampedEnd,
    );
    if (!startNode || !endNode) return;

    wrapRange(startNode, startOff, endNode, endOff, highlight, selectedId, onClick);
  } else {
    const clampedEndBlockIdx = Math.min(endBlockIdx, blocks.length - 1);

    for (let bi = startBlockIdx; bi <= clampedEndBlockIdx; bi++) {
      const block = blocks[bi];
      const blockText = block.textContent || '';
      let bStart: number;
      let bEnd: number;

      if (bi === startBlockIdx) {
        bStart = Math.min(startCharOffset, blockText.length);
        bEnd = blockText.length;
      } else if (bi === clampedEndBlockIdx) {
        bStart = 0;
        bEnd = Math.min(endCharOffset, blockText.length);
      } else {
        bStart = 0;
        bEnd = blockText.length;
      }

      if (bStart >= bEnd) continue;

      const { startNode, startOff, endNode, endOff } = findNodesForOffsets(
        block, bStart, bEnd,
      );
      if (!startNode || !endNode) continue;

      wrapRange(startNode, startOff, endNode, endOff, highlight, selectedId, onClick);
    }
  }
}

function applyLegacyTextSearch(
  container: HTMLElement,
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
) {
  const textContent = highlight.text_content;
  if (!textContent) return;

  const fullText = container.textContent || '';
  const idx = findBestMatchIndex(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );
  if (idx === -1) return;

  const { startNode, startOff, endNode, endOff } = findNodesForOffsets(
    container, idx, idx + textContent.length,
  );
  if (!startNode || !endNode) return;

  wrapRange(startNode, startOff, endNode, endOff, highlight, selectedId, onClick);
}

function findNodesForOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
): { startNode: Text | null; startOff: number; endNode: Text | null; endOff: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let charCount = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const len = (node.textContent || '').length;
    if (!startNode && charCount + len > startOffset) {
      startNode = node as Text;
      startOff = startOffset - charCount;
    }
    if (startNode && charCount + len >= endOffset) {
      endNode = node as Text;
      endOff = endOffset - charCount;
      break;
    }
    charCount += len;
  }

  return { startNode, startOff, endNode, endOff };
}

function wrapRange(
  startNode: Text,
  startOff: number,
  endNode: Text,
  endOff: number,
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
) {
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);

  const mark = document.createElement('mark');
  mark.className = `highlight-mark highlight-mark--${highlight.status}`;
  if (highlight.id === selectedId) {
    mark.classList.add('highlight-mark--selected');
  }
  mark.dataset.highlightId = highlight.id;
  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(highlight);
  });

  if (startNode === endNode) {
    range.surroundContents(mark);
  } else {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

function findBestMatchIndex(
  fullText: string,
  textContent: string,
  textBefore: string,
  textAfter: string,
): number {
  const indices: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = fullText.indexOf(textContent, searchFrom);
    if (idx === -1) break;
    indices.push(idx);
    searchFrom = idx + 1;
  }

  if (indices.length === 0) return -1;
  if (indices.length === 1) return indices[0];

  let bestIdx = indices[0];
  let bestScore = -1;

  for (const idx of indices) {
    let score = 0;
    if (textBefore) {
      const actualBefore = fullText.substring(Math.max(0, idx - textBefore.length), idx);
      const minLen = Math.min(actualBefore.length, textBefore.length);
      for (let i = 1; i <= minLen; i++) {
        if (actualBefore[actualBefore.length - i] === textBefore[textBefore.length - i]) {
          score++;
        } else {
          break;
        }
      }
    }
    if (textAfter) {
      const actualAfter = fullText.substring(
        idx + textContent.length,
        idx + textContent.length + textAfter.length,
      );
      const minLen = Math.min(actualAfter.length, textAfter.length);
      for (let i = 0; i < minLen; i++) {
        if (actualAfter[i] === textAfter[i]) {
          score++;
        } else {
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  return bestIdx;
}

export default HighlightLayer;
