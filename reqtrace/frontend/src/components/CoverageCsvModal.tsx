/**
 * Модалка CSV-выгрузки среза покрытия (v1.8.2).
 *
 * Мгновенное скачивание v1.8.1 выросло в выбор: какие статусы привязок
 * выгружать. Срез — сырьё для внешней ИИ-системы актуализации тестов, и
 * частичные файлы («только требующие проверки») — её основной рацион.
 * Дифф изменившихся цитат в файле ВСЕГДА (стабильный состав колонок —
 * парсеру не нужно два формата), поэтому опций про дифф здесь нет —
 * только строка-справка.
 *
 * Счётчики у чекбоксов — будущие строки файла (привязка × тест + строки
 * привязок без тестов), а не количество привязок: человек видит, какого
 * размера файл получит. Чекбоксы со счётчиком 0 не блокируются: пустой
 * статус в фильтре безвреден, а логика «что заблокировано и почему»
 * здесь не окупается.
 */
import React, { useState } from 'react';
import { api } from '../api/client';
import { colors, radii } from '../styles/tokens';
import { Modal, ModalButton, modalTextStyle } from './Modal';
import { RefreshIcon } from './RefreshIcon';
import { useToast } from './Toast';
import {
  buildCoverageCsvFilename, CSV_STATUS_ORDER, CsvStatus, statusesForRequest,
} from './csvExport';

// Ярлыки — те же слова, что у статусов везде в интерфейсе (statusLabels).
const STATUS_LABEL: Record<CsvStatus, string> = {
  active: 'Актуально',
  outdated: 'Требует проверки',
  lost: 'Утрачено',
};

export const CoverageCsvModal: React.FC<{
  projectId: string;
  projectName: string;
  /** Строк файла на статус: привязка × тест + привязки без тестов. */
  counts: Record<CsvStatus, number>;
  onClose: () => void;
}> = ({ projectId, projectName, counts, onClose }) => {
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
    <Modal title="Выгрузка среза покрытия" onClose={onClose}>
      <p style={{ ...modalTextStyle, margin: '0 0 14px' }}>
        Строка файла — пара «привязка × тест»; привязки без тестов входят
        отдельными строками. У изменившихся привязок «Требует проверки»
        в файле есть текущий текст и пословный дифф цитаты.
      </p>

      <div style={{
        fontSize: '12px', fontWeight: 600, color: colors.textSecondary,
        margin: '0 0 8px',
      }}>
        Статусы привязок
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '18px' }}>
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
            <input
              type="checkbox"
              checked={picked.has(s)}
              onChange={() => toggle(s)}
              style={{
                width: '15px', height: '15px', margin: 0,
                accentColor: colors.greenAccent, cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: '13px', color: colors.textPrimary, flex: 1 }}>
              {STATUS_LABEL[s]}
            </span>
            {/* Счётчик строк — нейтральная пилюля, как у фильтров «Тестов». */}
            <span style={{
              padding: '1px 7px', borderRadius: radii.pill,
              background: 'rgba(0,0,0,0.05)', color: colors.textSecondary,
              fontSize: '11px', fontWeight: 600, lineHeight: 1.4,
            }}>
              {counts[s]}
            </span>
          </label>
        ))}
      </div>

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
