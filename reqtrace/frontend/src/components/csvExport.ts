// Чистая логика CSV-выгрузки среза покрытия (v1.8.2) — без DOM/React,
// тесты csvExport.test.ts. Сама модалка — CoverageCsvModal.tsx.

export type CsvStatus = 'active' | 'outdated' | 'lost';

/** Фиксированный порядок статусов — и в модалке, и в суффиксе имени файла:
 *  имя не должно зависеть от порядка кликов по чекбоксам. */
export const CSV_STATUS_ORDER: CsvStatus[] = ['active', 'outdated', 'lost'];

// Суффиксы имени файла — теми же словами, что статусы в интерфейсе.
const FILE_SUFFIX: Record<CsvStatus, string> = {
  active: 'актуально',
  outdated: 'требует-проверки',
  lost: 'утрачено',
};

/** Имя скачиваемого файла: проект + дата; при частичной выгрузке — суффиксы
 *  выбранных статусов. Символы, запрещённые в именах файлов, — в дефис. */
export function buildCoverageCsvFilename(
  projectName: string,
  dateIso: string,
  statuses: CsvStatus[],
): string {
  const safeName = (projectName || 'project').replace(/[\\/:*?"<>|]/g, '-').trim();
  const partial = CSV_STATUS_ORDER.some(s => !statuses.includes(s));
  const suffix = partial
    ? CSV_STATUS_ORDER.filter(s => statuses.includes(s)).map(s => `-${FILE_SUFFIX[s]}`).join('')
    : '';
  return `reqtrace-покрытие-${safeName}-${dateIso}${suffix}.csv`;
}

/** Статусы для запроса: полный набор — undefined (эндпоинт без фильтра —
 *  «все» это отсутствие фильтра, а не перечисление), иначе — выбранные в
 *  фиксированном порядке. */
export function statusesForRequest(statuses: CsvStatus[]): CsvStatus[] | undefined {
  const picked = CSV_STATUS_ORDER.filter(s => statuses.includes(s));
  return picked.length === CSV_STATUS_ORDER.length ? undefined : picked;
}
