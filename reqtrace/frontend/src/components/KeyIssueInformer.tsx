// Информер проблемного ключа теста (v1.7.0): янтарный значок-кнопка, по
// клику — поповер с причиной («ключ не похож на формат» / «задачи нет в
// Jira»). Кликабельность вместо тултипа: наведение не живёт на тачах и
// плохо обнаружимо, а поповер — в языке меню «ещё действия».
//
// Поповер — портал в body с fixed-координатами от кнопки: absolute внутри
// строки не работает (карточки яруса 2 клипают overflow: hidden), а fixed
// без портала сломала бы панель привязки (backdrop-filter делает её
// containing block для fixed — ловушка v1.5.2). Скролл/ресайз закрывают
// поповер — позиция не пересчитывается. role="dialog" — слоистая
// Escape-логика приложения (SidePanel и др.) уступает верхнему слою.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFadeToggle } from './fadePresence';
import { StatusAlertIcon } from './icons';
import { colors, radii, shadows } from '../styles/tokens';

const POPOVER_WIDTH = 280;
// В контейнере с data-popover-center (панель привязки) поповер центруется
// по его ширине с полями 20px — как поповер удаления привязки.
const CENTERED_MAX_WIDTH = 320;

// size — размер значка (кнопка на 8px больше): ярус 2 «Тестов» носит
// информеры крупнее рядового (v1.7.5) — они несут предупреждающую функцию.
// pill — вид чипа-ключа из панели привязки (постоянная заливка 15 + рамка 33,
// радиус-пилюля): строка «Привязки без тестов» носит информер на месте ключа,
// и голому значку там одиноко (ревью; пунктирная капсула отклонена — пунктир
// внутри пунктирной рамки строки). width — явная ширина кнопки: пилюля
// растягивается на ширину колонки ключей.
export const KeyIssueInformer: React.FC<{
  text: string;
  size?: number;
  pill?: boolean;
  width?: number;
}> = ({ text, size = 14, pill = false, width }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const { mounted, fadeStyle } = useFadeToggle(open);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    // Информер живёт и внутри кликабельной строки аккордеона («Тесты»,
    // ярус 2) — клик не должен раскрывать строку.
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Панель привязки объявляет себя центром (data-popover-center):
    // поповер встаёт по её ширине, как поповер удаления. Вне таких
    // контейнеров (ярус 2 «Тестов») — якорится к кнопке.
    const host = btnRef.current?.closest('[data-popover-center]');
    if (host) {
      const hostRect = host.getBoundingClientRect();
      const width = Math.min(CENTERED_MAX_WIDTH, hostRect.width - 40);
      setPos({
        top: rect.bottom + 6,
        left: hostRect.left + (hostRect.width - width) / 2,
        width,
      });
    } else {
      setPos({
        top: rect.bottom + 6,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8),
        width: POPOVER_WIDTH,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !btnRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Состояния кнопки — янтарная лестница заливок 15/26/33 (как у чипов
  // ключей): ховер, пресс и «нажато» (открытый поповер держит заливку
  // ховера — принадлежность видна, пока поповер жив). Пилюля носит нижнюю
  // ступень (15) постоянно — покой у неё уже залит, ступени сдвигаются.
  const tint = colors.statusOutdated;
  const restBg = pill ? `${tint}15` : 'transparent';
  const hoverBg = pill ? `${tint}26` : `${tint}15`;
  const openBg = `${tint}26`;
  const pressBg = `${tint}33`;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Почему ключ не ведёт в Jira"
        style={{
          width: width !== undefined ? `${width}px` : `${size + 8}px`,
          height: `${size + 8}px`,
          borderRadius: pill ? radii.pill : radii.sm,
          border: pill ? `1px solid ${tint}33` : 'none',
          background: open ? openBg : restBg,
          color: tint, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, padding: 0, transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = open ? openBg : hoverBg; }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? openBg : restBg; }}
        onMouseDown={e => { e.currentTarget.style.background = pressBg; }}
        onMouseUp={e => { e.currentTarget.style.background = openBg; }}
      >
        <StatusAlertIcon kind="warning" size={size} />
      </button>
      {mounted && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            width: `${pos.width}px`,
            zIndex: 1000,
            background: colors.cardBgSolid,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.md,
            boxShadow: shadows.panel,
            padding: '10px 12px',
            fontSize: '12.5px',
            fontWeight: 400,
            color: colors.textSecondary,
            lineHeight: 1.5,
            textAlign: 'left',
            boxSizing: 'border-box',
            ...fadeStyle,
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
};
