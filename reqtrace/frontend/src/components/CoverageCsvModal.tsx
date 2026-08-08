/**
 * Модалка CSV-выгрузки среза покрытия (v1.8.2; двухшаговая — v1.8.3).
 *
 * Срез — сырьё для внешней ИИ-системы актуализации тестов, и модалка ведёт
 * по процессу пользователя двумя видимыми сразу шагами (без листания):
 *
 *   1. «Что войдёт в файл» — чекбоксы статусов привязок со счётчиками
 *      будущих СТРОК файла (привязка × тест + привязки без тестов).
 *   2. «Эти тесты — в Jira» — живой JQL-фильтр по УНИКАЛЬНЫМ тестам
 *      выгрузки: скопировать или открыть в поиске Jira, найти все тесты
 *      одним запросом и выгрузить их оттуда с шагами. В CSV один тест
 *      встречается у многих привязок — это норма; здесь он один раз.
 *
 * Дифф изменившихся цитат в файле ВСЕГДА (стабильный состав колонок —
 * парсеру не нужно два формата), поэтому опций про дифф здесь нет.
 * Счётчики у чекбоксов — строки файла, а не привязки: человек видит,
 * какого размера файл получит. Чекбоксы со счётчиком 0 не блокируются.
 */
import React, { useMemo, useState } from 'react';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';
import { Modal, ModalButton, modalTextStyle } from './Modal';
import { RefreshIcon } from './RefreshIcon';
import { KeyIssueInformer } from './KeyIssueInformer';
import { useToast } from './Toast';
import {
  buildCoverageCsvFilename, buildJiraFilter, CSV_STATUS_ORDER, CsvStatus,
  JqlSourceTest, statusesForRequest,
} from './csvExport';

const MONO = 'SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Ярлыки — те же слова, что у статусов везде в интерфейсе (statusLabels).
const STATUS_LABEL: Record<CsvStatus, string> = {
  active: 'Актуально',
  outdated: 'Требует проверки',
  lost: 'Утрачено',
};

// Свой мягкий чекбокс: нативный accent-color рисует системный квадрат —
// резкий, кислотный, с чёрной галочкой (замечание пользователя). Здесь —
// пастельный язык «выбранного» ReqTrace (как активные чипы фильтра дерева):
// greenLight-заливка, greenDark-галочка, мягкая рамка focusBorder. Нативный
// input остаётся в DOM невидимым поверх бокса — клик по label и клавиатура
// (Tab/пробел) живут как раньше; фокус — рамкой и кольцом, как у полей.
const SoftCheckbox: React.FC<{ checked: boolean; onChange: () => void }> = ({
  checked, onChange,
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <span style={{
      position: 'relative', width: '18px', height: '18px',
      display: 'inline-flex', flexShrink: 0,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          margin: 0, opacity: 0, cursor: 'pointer',
        }}
      />
      <span aria-hidden="true" style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        borderRadius: '6px',
        border: `1px solid ${checked ? colors.focusBorder
          : focused ? colors.borderHover : colors.border}`,
        background: checked ? colors.greenLight : colors.white,
        boxShadow: focused ? shadows.focusRing : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
        transition: 'all 0.15s',
      }}>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke={colors.greenDark} strokeWidth="3.2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            opacity: checked ? 1 : 0,
            transform: checked ? 'scale(1)' : 'scale(0.6)',
            transition: 'all 0.15s',
          }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    </span>
  );
};

// Номер шага — кружок в языке степпера онбординга.
const StepLabel: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <span style={{
      width: '20px', height: '20px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      background: 'rgba(0,0,0,0.05)', color: colors.textSecondary,
      fontSize: '11px', fontWeight: 700,
    }}>
      {n}
    </span>
    <span style={{ fontSize: '12px', fontWeight: 600, color: colors.textSecondary }}>
      {children}
    </span>
  </div>
);

// Компактная вторичная кнопка блока JQL (штатная ModalButton великовата
// для внутренностей секции).
const smallButtonStyle: React.CSSProperties = { padding: '7px 14px', fontSize: '13px' };

// Пилюля-счётчик — единый вид и габарит для строк статусов и шапки шага 2:
// minWidth выравнивает 1- и 2-значные счётчики в ровную колонку (ревью:
// «чипы кривые»); marginRight 10px у шапки задаётся снаружи — правые края
// всех пилюль стоят на одной вертикали (строки имеют паддинг 10px).
const CountPill: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children, style,
}) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '28px', boxSizing: 'border-box',
    padding: '1px 7px', borderRadius: radii.pill,
    background: 'rgba(0,0,0,0.05)', color: colors.textSecondary,
    fontSize: '11px', fontWeight: 600, lineHeight: 1.4,
    flexShrink: 0,
    ...style,
  }}>
    {children}
  </span>
);

export const CoverageCsvModal: React.FC<{
  projectId: string;
  projectName: string;
  /** Строк файла на статус: привязка × тест + привязки без тестов. */
  counts: Record<CsvStatus, number>;
  /** Лёгкий индекс тестов проекта (TestIndexEntry) — источник JQL-фильтра. */
  tests: JqlSourceTest[];
  jiraBaseUrl: string | null;
  onClose: () => void;
}> = ({ projectId, projectName, counts, tests, jiraBaseUrl, onClose }) => {
  const { showToast } = useToast();
  // По умолчанию — всё: полная выгрузка остаётся сценарием «в один клик»,
  // как была кнопка v1.8.1.
  const [picked, setPicked] = useState<Set<CsvStatus>>(new Set(CSV_STATUS_ORDER));
  const [exporting, setExporting] = useState(false);

  const toggle = (s: CsvStatus) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const selected = CSV_STATUS_ORDER.filter(s => picked.has(s));
  const rowsTotal = selected.reduce((n, s) => n + counts[s], 0);
  // JQL живёт вместе с чекбоксами: снял статус — фильтр пересобрался.
  const filter = useMemo(() => buildJiraFilter(tests, selected), [tests, selected]);

  const jiraSearchUrl = jiraBaseUrl && filter.jql
    ? `${jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(filter.jql)}`
    : null;

  const handleCopyJql = async () => {
    try {
      await navigator.clipboard.writeText(filter.jql);
      showToast('success', 'JQL скопирован', 'Вставьте его в поиск задач Jira');
    } catch {
      showToast('error', 'Не удалось скопировать', 'Выделите текст фильтра и скопируйте вручную');
    }
  };

  const handleExport = async () => {
    if (!selected.length || exporting) return;
    setExporting(true);
    try {
      const blob = await api.downloadCoverageCsv(projectId, statusesForRequest(selected));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildCoverageCsvFilename(
        projectName, new Date().toISOString().slice(0, 10), selected,
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
      showToast('success', 'Скачивание началось', 'Файл ушёл в загрузки браузера');
    } catch (e: any) {
      // Модалка остаётся открытой: выбор не потерян, можно повторить.
      showToast('error', 'Не удалось выгрузить CSV', e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal title="Выгрузка среза покрытия" width="500px" onClose={onClose}>
      <p style={{ ...modalTextStyle, margin: '0 0 16px' }}>
        Строка файла — пара «привязка × тест»; привязки без тестов входят
        отдельными строками. У изменившихся привязок «Требует проверки»
        в файле есть текущий текст и пословный дифф цитаты.
      </p>

      {/* Шаг 1: статусы привязок. */}
      <StepLabel n={1}>Что войдёт в файл</StepLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', margin: '8px 0 16px' }}>
        {CSV_STATUS_ORDER.map(s => (
          <label
            key={s}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '7px 10px', borderRadius: radii.md,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <SoftCheckbox checked={picked.has(s)} onChange={() => toggle(s)} />
            <span style={{ fontSize: '13px', color: colors.textPrimary, flex: 1 }}>
              {STATUS_LABEL[s]}
            </span>
            {/* Счётчик строк — нейтральная пилюля, как у фильтров «Тестов». */}
            <CountPill>{counts[s]}</CountPill>
          </label>
        ))}
      </div>

      {/* Шаг 2 (v1.8.3): мост в Jira — JQL по уникальным тестам выгрузки.
          Процесс пользователя: найти ВСЕ тесты будущего файла одним поиском
          Jira и выгрузить их оттуда с шагами для ИИ-актуализации. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
        <StepLabel n={2}>Эти тесты — в Jira</StepLabel>
        <KeyIssueInformer
          variant="help"
          size={13}
          ariaLabel="Зачем нужен JQL-фильтр и как выгрузить тесты из Jira"
          text={'JQL — фильтр поиска задач Jira, собранный по уникальным тестам этой '
            + 'выгрузки. Вставьте его в поиск задач или откройте сразу. Выгрузка оттуда: '
            + 'Export → «CSV (All fields)» — ключ (Key), название (Summary) и шаги '
            + '(Manual Test Steps) будут колонками файла; компактнее — добавить эти '
            + 'колонки в таблицу (Columns) и выбрать «CSV (Current fields)».'}
        />
        {filter.keys.length > 0 && (
          <CountPill style={{ marginLeft: 'auto', marginRight: '10px' }}>
            {filter.keys.length}
          </CountPill>
        )}
      </div>
      {filter.keys.length > 0 ? (
        <div style={{ marginBottom: '18px' }}>
          {/* Простая копируемая строка (решение пользователя: чипы-ключи
              отклонены, форматирование ЕДИНОЕ — жирные ключи «выглядели
              странно»). Неразрывные звенья: «key in (» приклеен к ПЕРВОМУ
              ключу, «)» — к последнему, каждый ключ несёт свою запятую —
              перенос возможен только между звеньями, дефис внутри SI-12834
              и скобки строку не рвут (пробелы в голом тексте давали разрыв
              после «in» — ревью). Выделение и копирование дают ровно
              filter.jql. */}
          <div
            className="island-scroll"
            style={{
              fontFamily: MONO, fontSize: '12px', lineHeight: 1.7,
              color: colors.textSecondary,
              background: 'rgba(0,0,0,0.03)',
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
              padding: '9px 12px',
              maxHeight: '96px', overflowY: 'auto',
              userSelect: 'all',
            }}
          >
            {filter.keys.map((k, i) => (
              <span key={k} style={{ whiteSpace: 'nowrap' }}>
                {i === 0 && 'key in ('}
                {k}
                {i < filter.keys.length - 1 ? ', ' : ')'}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
            <ModalButton variant="secondary" style={smallButtonStyle} onClick={() => { void handleCopyJql(); }}>
              Скопировать JQL
            </ModalButton>
            {jiraSearchUrl && (
              <ModalButton
                variant="secondary"
                style={smallButtonStyle}
                onClick={() => { window.open(jiraSearchUrl, '_blank', 'noopener,noreferrer'); }}
              >
                Открыть в Jira
              </ModalButton>
            )}
          </div>
          {filter.skipped > 0 && (
            <div style={{ fontSize: '11.5px', color: colors.textTertiary, marginTop: '8px', lineHeight: 1.45 }}>
              Не вошли в фильтр: {filter.skipped} — ключ не по формату или задачи нет
              в Jira (такие ключи ломали бы весь запрос)
            </div>
          )}
        </div>
      ) : (
        <div style={{
          fontSize: '12.5px', color: colors.textTertiary, lineHeight: 1.5,
          padding: '10px 12px', marginBottom: '18px',
          border: `1px dashed ${colors.borderHover}`, borderRadius: radii.sm,
        }}>
          {filter.skipped > 0
            ? 'У тестов этой выгрузки не осталось ключей, пригодных для поиска в Jira: не по формату или задач уже нет'
            : 'В выбранных статусах нет привязок с тестами — фильтру не из чего собраться'}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
        <ModalButton variant="secondary" onClick={onClose}>Отмена</ModalButton>
        <ModalButton
          variant="primary"
          onClick={() => { void handleExport(); }}
          disabled={exporting || selected.length === 0}
          title={selected.length === 0 ? 'Выберите хотя бы один статус' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          {exporting && <RefreshIcon size={14} spinning />}
          {exporting ? 'Готовим файл…'
            : `Выгрузить CSV${rowsTotal > 0 ? ` · ${rowsTotal}` : ''}`}
        </ModalButton>
      </div>
    </Modal>
  );
};
