import { useState, useCallback, useEffect } from 'react';

interface SelectionInfo {
  text: string;
  startXPath: string;
  startOffset: number;
  endXPath: string;
  endOffset: number;
  textBefore: string;
  textAfter: string;
  rect: DOMRect;
}

export function getXPath(node: Node): string {
  if (node.nodeType === Node.DOCUMENT_NODE) return '/';

  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current !== document) {
    if (current.nodeType === Node.TEXT_NODE) {
      const parent: Node | null = current.parentNode;
      if (parent) {
        let textIndex = 0;
        for (let i = 0; i < parent.childNodes.length; i++) {
          if (parent.childNodes[i] === current) break;
          if (parent.childNodes[i].nodeType === Node.TEXT_NODE) textIndex++;
        }
        parts.unshift(`text()[${textIndex + 1}]`);
        current = parent;
        continue;
      }
    }

    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      const tag = el.tagName.toLowerCase();
      let index = 1;
      let sibling: Element | null = el.previousElementSibling;

      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) index++;
        sibling = sibling.previousElementSibling;
      }

      parts.unshift(`${tag}[${index}]`);
    }

    current = current.parentNode;
  }

  return '/' + parts.join('/');
}

export function useTextSelection(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      setSelection(null);
      return;
    }

    if (!containerRef.current.contains(sel.anchorNode)) {
      return;
    }

    const rawText = sel.toString();
    const text = rawText.trim();
    if (text.length < 2) {
      setSelection(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const container = containerRef.current;
    const fullText = container.textContent || '';
    const leadingTrimmed = rawText.length - rawText.trimStart().length;

    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const offsetInContainer = preRange.toString().length + leadingTrimmed;
    preRange.detach();

    const textBefore = fullText.substring(Math.max(0, offsetInContainer - 100), offsetInContainer);
    const textAfter = fullText.substring(
      offsetInContainer + text.length,
      offsetInContainer + text.length + 100,
    );

    setSelection({
      text,
      startXPath: getXPath(range.startContainer),
      startOffset: range.startOffset,
      endXPath: getXPath(range.endContainer),
      endOffset: range.endOffset,
      textBefore,
      textAfter,
      rect,
    });
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return { selection, clearSelection };
}

export default useTextSelection;
