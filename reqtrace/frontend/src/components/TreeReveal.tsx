// Каскадное раскрытие/сворачивание вложенных списков (как в Confluence).
// Родился в дереве страниц (PageTree), вынесен в общий модуль: та же мягкость
// нужна и другим спискам-аккордеонам (ярус 2 «Тестов»).
import React, { useEffect, useState } from 'react';

const REVEAL_MS = 160;           // высота+прозрачность одной строки
const REVEAL_STEP_MS = 26;       // шаг «волны» между соседними строками
const REVEAL_TOTAL_CAP_MS = 240; // потолок волны, чтобы длинные списки не тянулись

// Стили — один раз на документ (паттерн RefreshIcon): строк много, по <style>
// на каждую плодить не хочется. Высота строки анимируется через
// grid-template-rows 0fr↔1fr — без измерения содержимого в JS.
const TREE_STYLES_ID = 'reqtrace-tree-reveal-styles';
if (typeof document !== 'undefined' && !document.getElementById(TREE_STYLES_ID)) {
  const style = document.createElement('style');
  style.id = TREE_STYLES_ID;
  style.textContent = `
.tree-reveal {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows ${REVEAL_MS}ms ease, opacity ${REVEAL_MS}ms ease;
}
.tree-reveal--open { grid-template-rows: 1fr; opacity: 1; }
.tree-reveal-inner { overflow: hidden; min-height: 0; }
@media (prefers-reduced-motion: reduce) {
  .tree-reveal { transition: none; }
}
`;
  document.head.appendChild(style);
}

// Обёртка каскада: монтирует детей при раскрытии и держит их в DOM на время
// анимации сворачивания. Появление — плавно с первой строки до последней,
// сворачивание — в обратном порядке (задержки зеркалятся). Каждый прямой
// ребёнок анимируется как строка; его собственное раскрытое поддерево едет
// внутри этой строки единым блоком.
export const TreeReveal: React.FC<{ expanded: boolean; children: React.ReactNode }> = ({ expanded, children }) => {
  const [mounted, setMounted] = useState(expanded);
  const [open, setOpen] = useState(expanded);
  const items = React.Children.toArray(children);
  const count = items.length;
  const step = count > 1
    ? Math.min(REVEAL_STEP_MS, Math.round(REVEAL_TOTAL_CAP_MS / (count - 1)))
    : 0;

  useEffect(() => {
    if (expanded) {
      setMounted(true);
      // Два кадра: закрытое состояние должно попасть в раскладку до снятия,
      // иначе transition не запустится и список раскроется скачком.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpen(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setOpen(false);
    const timer = setTimeout(() => setMounted(false), (count - 1) * step + REVEAL_MS);
    return () => clearTimeout(timer);
  }, [expanded, count, step]);

  if (!mounted) return null;
  return (
    <>
      {items.map((item, i) => (
        <div
          key={React.isValidElement(item) && item.key != null ? item.key : i}
          className={open ? 'tree-reveal tree-reveal--open' : 'tree-reveal'}
          style={{ transitionDelay: `${(open ? i : count - 1 - i) * step}ms` }}
        >
          <div className="tree-reveal-inner">{item}</div>
        </div>
      ))}
    </>
  );
};
