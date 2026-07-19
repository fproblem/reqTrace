import React, { useRef, useEffect } from 'react';
import { colors, radii } from '../../styles/tokens';

interface ContentRendererProps {
  html: string;
  onContentReady?: (container: HTMLDivElement) => void;
  /** true — правая панель открыта или анимируется. Пока это так, пере-заморозка
   *  ширин таблиц не выполняется: сужение контента самой панелью не должно
   *  пере-вёрстывать таблицы (в этом весь смысл заморозки). */
  suspendTableRefreeze?: boolean;
}

// Таблицы не пере-вёрстываются при изменении ширины контента (открытие правой
// панели, ресайз сайдбара/окна): фактическая ширина каждой таблицы
// замораживается в момент рендера контента, а таблица оборачивается в
// контейнер с собственным горизонтальным скроллом — как в Confluence. Широкая
// таблица не «уходит под панель», а скроллится внутри себя.
// Безопасность для привязок: обёртка-div не входит в BLOCK_SELECTOR
// HighlightLayer и не меняет textContent контейнера, поэтому блочные якоря
// (anchor_block_*) и текстовые смещения сохранённых подсветок не сдвигаются.
// Классы «контент обрезан слева/справа» — по ним CSS рисует теневую подсказку
// на краях прокручиваемой таблицы (как в Confluence). Без неё жёсткий обрез
// текста на границе прокрутки выглядит как баг вёрстки: у левого края — будто
// текст «уехал под» дерево страниц, у правого — под панель выделения.
function updateScrollClipClasses(wrap: HTMLElement) {
  // У bleed-обёртки есть внутренние боковые паддинги (data-pad-x): контент
  // достигает края и начинает обрезаться, только пройдя прокруткой свой
  // паддинг — до этого тень не нужна.
  const pad = Number(wrap.dataset.padX || 0);
  wrap.classList.toggle('table-scroll--clip-left', wrap.scrollLeft > pad + 1);
  wrap.classList.toggle(
    'table-scroll--clip-right',
    wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - pad - 1,
  );
}

function updateAllScrollClipClasses(container: HTMLDivElement) {
  container.querySelectorAll<HTMLElement>('.table-scroll').forEach(updateScrollClipClasses);
}

function stabilizeTables(container: HTMLDivElement) {
  container.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    // Уже обработана — либо вложена в обработанную (внешняя заморожена,
    // значит внутренняя пере-вёрстываться не может; идём в порядке документа).
    if (table.closest('.table-scroll')) return;
    // Авторская инлайновая ширина из Confluence запоминается: пере-заморозка
    // должна отталкиваться от исходного правила, а не от прошлого фриза.
    table.dataset.origWidth = table.style.width;
    const width = table.getBoundingClientRect().width;
    if (width > 0) table.style.width = `${width}px`;
    const wrap = document.createElement('div');
    // Таблице верхнего уровня — прокрутка во всю ширину страницы (bleed:
    // обёртка съедает боковые паддинги контейнера, обрез и тень прилегают
    // вплотную к боковым панелям). Таблицам внутри макросов/цитат — обычная
    // обёртка: их родитель уже даёт свои рамки и паддинги.
    const bleed = table.parentElement === container;
    wrap.className = bleed ? 'table-scroll table-scroll--bleed' : 'table-scroll';
    if (bleed) wrap.dataset.padX = '32'; // = боковой паддинг .confluence-content
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
    // Слушатель живёт вместе с DOM-узлом обёртки — отдельная очистка не нужна.
    wrap.addEventListener('scroll', () => updateScrollClipClasses(wrap));
  });
  container.dataset.tablesFrozenAt = String(Math.round(container.clientWidth));
  updateAllScrollClipClasses(container);
}

// Пере-заморозка под новую ширину контейнера: зум браузера, ресайз окна,
// сворачивание/растяжение левого сайдбара — «эталонная» ширина изменилась, и
// замороженные размеры пора пересчитать. Возвращаем таблицам исходное правило
// ширины, даём раскладке пересчитаться и замораживаем заново. Чтения и записи
// батчами в одном синхронном проходе — промежуточное состояние не пейнтится.
// При неизменной ширине (напр., цикл открыл-закрыл панель) — ничего не делаем.
function refreezeTables(container: HTMLDivElement) {
  const width = Math.round(container.clientWidth);
  if (container.dataset.tablesFrozenAt === String(width)) return;
  const tables = Array.from(
    container.querySelectorAll<HTMLTableElement>('.table-scroll > table'),
  );
  tables.forEach(t => { t.style.width = t.dataset.origWidth ?? ''; });
  const widths = tables.map(t => t.getBoundingClientRect().width);
  tables.forEach((t, i) => { if (widths[i] > 0) t.style.width = `${widths[i]}px`; });
  container.dataset.tablesFrozenAt = String(width);
  updateAllScrollClipClasses(container);
}

// --- Битые картинки (v1.6.6) ---
// Бэкенд резервирует место под картинки известными размерами (иначе контент
// «едет» при первом открытии), но если картинка НЕ загрузилась (удалена, нет
// прав, сеть) — зарезервированное место не должно остаться пустой дырой.
// Подменяем src на инлайн-SVG-заглушку и ужимаем размеры. Сам элемент <img>
// остаётся в DOM: замена его на div с текстом добавила бы текстовые узлы и
// сдвинула текстовые смещения якорей привязок.
const BROKEN_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="72" viewBox="0 0 260 72">
  <rect x="0.5" y="0.5" width="259" height="71" rx="8" fill="rgba(0,0,0,0.03)" stroke="rgba(0,0,0,0.12)"/>
  <g transform="translate(20 20)" fill="none" stroke="${colors.textTertiary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="0" y="0" width="32" height="32" rx="4"/>
    <circle cx="10.5" cy="10.5" r="2.6"/>
    <path d="M32 23l-8.5-8.5L5 33"/>
  </g>
  <text x="68" y="41" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" fill="${colors.textSecondary}">Изображение недоступно</text>
</svg>`;
const BROKEN_IMAGE_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BROKEN_IMAGE_SVG)}`;

export function replaceBrokenImage(img: HTMLImageElement): void {
  if (img.dataset.broken === '1') return;
  img.dataset.broken = '1';
  const name = img.getAttribute('alt') || '';
  img.title = name
    ? `Не удалось загрузить «${name}»`
    : 'Не удалось загрузить изображение';
  // Сброс зарезервированных размеров: заглушка компактная, а «дыра» в
  // полный рост несуществующей картинки — ровно то, чего избегаем.
  img.removeAttribute('width');
  img.removeAttribute('height');
  img.style.width = '260px';
  img.style.height = '72px';
  img.style.aspectRatio = 'auto';
  img.src = BROKEN_IMAGE_SRC;
}

export const ContentRenderer: React.FC<ContentRendererProps> = ({
  html, onContentReady, suspendTableRefreeze,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Актуальное значение флага для отложенного (дебаунс) колбэка обсервера.
  const suspendRef = useRef(!!suspendTableRefreeze);
  useEffect(() => { suspendRef.current = !!suspendTableRefreeze; }, [suspendTableRefreeze]);

  useEffect(() => {
    if (containerRef.current) {
      // До onContentReady: потребители (HighlightLayer, обработчики выделения)
      // должны видеть уже стабилизированный DOM.
      stabilizeTables(containerRef.current);
      // Картинки, успевшие упасть до подписки на error (мгновенный отказ из
      // кэша) — добираем разово по факту: complete без natural-размеров.
      containerRef.current.querySelectorAll('img').forEach(img => {
        if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
          replaceBrokenImage(img);
        }
      });
      onContentReady?.(containerRef.current);
    }
  }, [html, onContentReady]);

  // Ошибки загрузки картинок: error не всплывает, но ловится на capture-фазе
  // контейнера — по слушателю на каждый <img> из dangerouslySetInnerHTML не
  // навесить.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onError = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'IMG') replaceBrokenImage(target as HTMLImageElement);
    };
    container.addEventListener('error', onError, true);
    return () => container.removeEventListener('error', onError, true);
  }, []);

  // Пере-заморозка при изменении ширины контейнера. Дебаунс пережидает шквал
  // событий от анимации панели (RO стреляет каждый кадр) и плавных ресайзов;
  // при открытой/анимирующейся панели пересчёт подавлен (suspendRef), а цикл
  // «открыл-закрыл» без прочих изменений отсеет проверка ширины в refreeze.
  // Так пересчёт срабатывает на зум, ресайз окна и левого сайдбара — но не на
  // правую панель. Заодно самолечится заморозка на суженной ширине, если
  // контент перезагрузили при открытой панели: закрытие её пересчитает.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      // Теневые подсказки на краях таблиц зависят от ширины обёрток — обновляем
      // сразу (в т.ч. во время анимации панели), это дёшево.
      updateAllScrollClipClasses(container);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (suspendRef.current) return;
        refreezeTables(container);
      }, 200);
    });
    ro.observe(container);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
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
  /* Таблицы верхнего уровня прокручиваются во всю ширину страницы: обёртка
     съедает боковые паддинги .confluence-content (32px — числа должны
     совпадать с padding контейнера и data-pad-x) отрицательными маргинами и
     возвращает их внутренними. Обрез контента и тень прилегают вплотную к
     дереву страниц и панели выделения — без пустых полос по краям, — а
     непрокрученная таблица по-прежнему стоит в своей текстовой колонке. */
  .confluence-content .table-scroll--bleed {
    max-width: none;
    margin: 12px -32px;
    padding: 0 32px;
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
