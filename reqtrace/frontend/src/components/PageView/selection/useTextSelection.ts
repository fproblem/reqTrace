// Хук выделения текста для создания привязки (v1.5.9, вынос из PageDetailPage):
// слушает mouseup, валидирует выделение и захватывает якоря
// (captureSelectionAnchors). Попап «Привязать тесты» показывается ТОЛЬКО когда
// у выделения есть блочные якоря — безъякорным выделениям в модели «маркер в
// снимке» жить негде (сервер отклонил бы создание).

import { useCallback, useEffect, useRef, useState } from 'react';
import { SelectionAnchors, captureSelectionAnchors } from './selectionAnchors';

export interface PendingSelection {
  /** Обрезанный текст выделения — цитата будущей привязки. */
  text: string;
  /** Точка для попапа (fixed-координаты, центр верхней грани выделения). */
  x: number;
  y: number;
}

export function useTextSelection(opts: {
  /** Внешняя область контента: выделения вне неё игнорируются. */
  contentAreaRef: React.RefObject<HTMLDivElement | null>;
  /** Контейнер отрисованного контента — по нему считаются якоря. */
  getContainer: () => HTMLDivElement | null;
}) {
  const { contentAreaRef, getContainer } = opts;
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const anchorsRef = useRef<SelectionAnchors | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelection(null);
      return;
    }

    const rawText = sel.toString();
    const text = rawText.trim();
    if (!text || text.length < 2) {
      setSelection(null);
      return;
    }

    if (contentAreaRef.current && !contentAreaRef.current.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }

    const container = getContainer();
    if (!container) {
      setSelection(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const anchors = captureSelectionAnchors(container, range, rawText);
    if (!anchors || anchors.anchorBlockStart == null) {
      setSelection(null);
      return;
    }

    anchorsRef.current = anchors;
    const rect = range.getBoundingClientRect();
    setSelection({ text, x: rect.left + rect.width / 2, y: rect.top - 10 });
  }, [contentAreaRef, getContainer]);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  const dismiss = useCallback(() => {
    anchorsRef.current = null;
    setSelection(null);
  }, []);

  return { selection, anchorsRef, dismiss };
}
