import React, { useRef, useEffect } from 'react';
import { colors, radii } from '../../styles/tokens';

interface ContentRendererProps {
  html: string;
  onContentReady?: (container: HTMLDivElement) => void;
}

export const ContentRenderer: React.FC<ContentRendererProps> = ({ html, onContentReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && onContentReady) {
      onContentReady(containerRef.current);
    }
  }, [html, onContentReady]);

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
