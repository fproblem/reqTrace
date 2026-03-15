import React, { useEffect, useCallback } from 'react';
import { Highlight } from '../../types';

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

    for (const highlight of highlights) {
      if (highlight.status === 'lost') continue;

      try {
        const textContent = highlight.text_content;
        if (!textContent) continue;

        const fullText = container.textContent || '';
        const idx = findBestMatchIndex(
          fullText, textContent, highlight.text_before, highlight.text_after,
        );
        if (idx === -1) continue;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let charCount = 0;
        let startNode: Text | null = null;
        let startOffset = 0;
        let endNode: Text | null = null;
        let endOffset = 0;
        let node: Node | null;

        while ((node = walker.nextNode())) {
          const len = (node.textContent || '').length;
          if (!startNode && charCount + len > idx) {
            startNode = node as Text;
            startOffset = idx - charCount;
          }
          if (startNode && charCount + len >= idx + textContent.length) {
            endNode = node as Text;
            endOffset = idx + textContent.length - charCount;
            break;
          }
          charCount += len;
        }

        if (!startNode || !endNode) continue;

        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        const mark = document.createElement('mark');
        mark.className = `highlight-mark highlight-mark--${highlight.status}`;
        if (highlight.id === selectedHighlightId) {
          mark.classList.add('highlight-mark--selected');
        }
        mark.dataset.highlightId = highlight.id;
        mark.addEventListener('click', (e) => {
          e.stopPropagation();
          onHighlightClick(highlight);
        });

        if (startNode === endNode) {
          range.surroundContents(mark);
        } else {
          const fragment = range.extractContents();
          mark.appendChild(fragment);
          range.insertNode(mark);
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
