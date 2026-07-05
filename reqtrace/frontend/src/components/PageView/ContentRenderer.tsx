import React, { useRef, useEffect } from 'react';
import { colors, radii } from '../../styles/tokens';

interface ContentRendererProps {
  html: string;
  onContentReady?: (container: HTMLDivElement) => void;
}

// Классы «контент обрезан слева/справа» — по ним CSS рисует теневую подсказку
// на краях прокручиваемой таблицы (как в Confluence). Без неё жёсткий обрез
// текста на границе прокрутки выглядит как баг вёрстки: у левого края — будто
// текст «уехал под» дерево страниц, у правого — под панель выделения.
function updateScrollClipClasses(wrap: HTMLElement) {
  wrap.classList.toggle('table-scroll--clip-left', wrap.scrollLeft > 1);
  wrap.classList.toggle(
    'table-scroll--clip-right',
    wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1,
  );
}

function updateAllScrollClipClasses(container: HTMLDivElement) {
  container.querySelectorAll<HTMLElement>('.table-scroll').forEach(updateScrollClipClasses);
}

// Таблицы ведут себя как в Confluence — по их собственной семантике ширины:
//  • фиксированная (инлайновые px от автора) — не сжимается; если не влезает,
//    прокручивается по горизонтали внутри собственной обёртки;
//  • относительная (проценты, class="relative-table") или без ширины (наш CSS
//    даёт 100%) — эластичная, пере-вёрстывается вместе с контейнером.
// Замораживать эластичные таблицы в px нельзя (пробовали): процентные
// «relative-table» переставали ужиматься при открытии панели, начинали
// скроллиться, и навигация к выделению утаскивала их вбок с обрезанной
// первой колонкой. Обёртка же нужна всем: негабаритная таблица не растягивает
// страницу и не «уходит под» соседние панели.
// Безопасность для привязок: обёртка-div не входит в BLOCK_SELECTOR
// HighlightLayer и не меняет textContent контейнера, поэтому блочные якоря
// (anchor_block_*) и текстовые смещения сохранённых подсветок не сдвигаются.
function wrapTables(container: HTMLDivElement) {
  container.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    // Уже обёрнута — либо вложена в обёрнутую (живёт в ячейке внешней и
    // прокручивается вместе с ней; идём в порядке документа).
    if (table.closest('.table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
    // Слушатель живёт вместе с DOM-узлом обёртки — отдельная очистка не нужна.
    wrap.addEventListener('scroll', () => updateScrollClipClasses(wrap));
  });
  updateAllScrollClipClasses(container);
}

export const ContentRenderer: React.FC<ContentRendererProps> = ({ html, onContentReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      // До onContentReady: потребители (HighlightLayer, обработчики выделения)
      // должны видеть уже обёрнутые таблицы.
      wrapTables(containerRef.current);
      onContentReady?.(containerRef.current);
    }
  }, [html, onContentReady]);

  // Теневые подсказки на краях таблиц зависят от ширины обёрток — обновляем
  // при любом ресайзе контента (панель выделения, зум, сайдбар, окно).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateAllScrollClipClasses(container));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="confluence-content"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        padding: '32px',
        fontSize: '14px',
        // Межстрочный интервал как в Confluence (≈1.43 = 20px при 14px),
        // раньше было 1.6 — текст выглядел заметно «разгонистее» оригинала.
        lineHeight: '1.45',
        color: colors.textPrimary,
        wordBreak: 'break-word',
      }}
    />
  );
};

export const contentStyles = `
  .confluence-content table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
  }
  /* Обёртка таблицы (stabilizeTables): внешние отступы переезжают с таблицы
     на неё, широкая таблица скроллится внутри, не растягивая страницу. */
  .confluence-content .table-scroll {
    overflow-x: auto;
    max-width: 100%;
    margin: 12px 0;
    transition: box-shadow 0.15s;
  }
  .confluence-content .table-scroll table {
    margin: 0;
  }
  /* Теневая подсказка на краях (классы вешает updateScrollClipClasses):
     скрытый прокруткой контент «уходит в тень», а не обрезается как попало. */
  .confluence-content .table-scroll--clip-left {
    box-shadow: inset 18px 0 14px -14px rgba(0, 0, 0, 0.22);
  }
  .confluence-content .table-scroll--clip-right {
    box-shadow: inset -18px 0 14px -14px rgba(0, 0, 0, 0.22);
  }
  .confluence-content .table-scroll--clip-left.table-scroll--clip-right {
    box-shadow:
      inset 18px 0 14px -14px rgba(0, 0, 0, 0.22),
      inset -18px 0 14px -14px rgba(0, 0, 0, 0.22);
  }
  .confluence-content th,
  .confluence-content td {
    border: 1px solid rgba(0,0,0,0.1);
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }
  .confluence-content th {
    background: rgba(0,0,0,0.03);
    font-weight: 600;
  }
  .confluence-content img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }
  .confluence-content h1 { font-size: 22px; margin: 20px 0 10px; }
  .confluence-content h2 { font-size: 18px; margin: 18px 0 8px; }
  .confluence-content h3 { font-size: 16px; margin: 14px 0 6px; }
  .confluence-content p { margin: 6px 0; }
  .confluence-content ul, .confluence-content ol {
    margin: 6px 0;
    padding-left: 24px;
  }
  .confluence-content li { margin: 2px 0; }
  .confluence-content code {
    background: rgba(0,0,0,0.04);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 13px;
  }
  .confluence-content a {
    color: #2563EB;
    text-decoration: none;
  }
  .confluence-content a:hover {
    text-decoration: underline;
  }

  /* Highlight overlays */
  .highlight-mark {
    position: relative;
    cursor: pointer;
    border-radius: 3px;
    transition: background-color 0.15s;
  }
  .highlight-mark--active {
    background-color: rgba(122, 224, 90, 0.15);
  }
  .highlight-mark--outdated {
    background-color: rgba(255, 180, 0, 0.15);
  }
  .highlight-mark--lost {
    background-color: rgba(239, 68, 68, 0.1);
  }
  /* Ховер единый для всей привязки: при наведении на любую её часть класс
     --hover навешивается на ВСЕ её <mark> сразу (см. createMark в
     HighlightLayer). Иначе (через :hover) подсвечивался бы только фрагмент под
     курсором, а выделение, разбитое форматированием, мерцало бы по частям. */
  .highlight-mark--active.highlight-mark--hover {
    background-color: rgba(122, 224, 90, 0.3);
  }
  .highlight-mark--outdated.highlight-mark--hover {
    background-color: rgba(255, 180, 0, 0.3);
  }
  .highlight-mark--lost.highlight-mark--hover {
    background-color: rgba(239, 68, 68, 0.2);
  }
  /* Выбранная привязка обводится ЕДИНОЙ рамкой поверх текста (overlay-слой
     drawSelectionOutline в HighlightLayer). Раньше здесь был outline на каждом
     <mark>, из-за чего рамка «рвалась» на каждой границе форматирования
     (полужирный/курсив/код/индексы) — выделение смотрелось рвано. Класс
     оставлен на случай доп. стилизации выбранного состояния. */
`;

export default ContentRenderer;
