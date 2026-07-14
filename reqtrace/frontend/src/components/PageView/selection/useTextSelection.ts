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
  /** Выделение уехало за видимую область контента: попап скрыт, но выделение
   *  живо — вернётся на экран вместе с текстом. */
  hidden?: boolean;
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

  // Выделение может умереть и БЕЗ mouseup: в Chrome mousedown по <button>
  // (чипы статусов, кнопки бара) выделение не сбрасывает, попап на mouseup
  // остаётся, а выделение снимает уже автофокус поля в открывшейся панели —
  // и попап зависал над страницей без выделения. selectionchange накрывает
  // все причины разом: живого выделения больше нет → попап гаснет.
  const active = selection !== null;
  useEffect(() => {
    if (!active) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        anchorsRef.current = null;
        setSelection(null);
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [active]);

  // Попап следует за выделенным текстом, а не за экраном: при прокрутке
  // (capture — ловит и область контента, и вложенные скроллеры таблиц),
  // ресайзе окна и пере-вёрстке контента (анимация ширины панели) позиция
  // пересчитывается от живого Selection через rAF. Выделение за пределами
  // видимой области контента прячет попап, не гася его, — иначе кнопка
  // всплывала бы поверх шапки страницы. Deps — булев active: пересчёт сам
  // меняет selection, и зависимость от объекта пересоздавала бы слушатели
  // на каждом кадре прокрутки.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const reposition = () => {
      raf = 0;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const area = contentAreaRef.current?.getBoundingClientRect();
      const hidden = !!area && !(
        rect.bottom > area.top && rect.top < area.bottom &&
        rect.right > area.left && rect.left < area.right
      );
      setSelection(prev => prev && ({
        ...prev,
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        hidden,
      }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(reposition); };
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' && contentAreaRef.current
      ? new ResizeObserver(schedule)
      : null;
    if (ro && contentAreaRef.current) ro.observe(contentAreaRef.current);
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, contentAreaRef]);

  const dismiss = useCallback(() => {
    anchorsRef.current = null;
    setSelection(null);
  }, []);

  return { selection, anchorsRef, dismiss };
}
