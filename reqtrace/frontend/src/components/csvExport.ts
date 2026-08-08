// Чистая логика CSV-выгрузки среза покрытия (v1.8.2) — без DOM/React,
// тесты csvExport.test.ts. Сама модалка — CoverageCsvModal.tsx.
import { isLikelyJiraKey } from './PageView/testKeyFormat';
import { compareTestKeys } from './PageView/testOrder';

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

/** Тест из лёгкого индекса яруса 2 (TestIndexEntry подходит структурно) —
 *  источник JQL-фильтра (v1.8.3). */
export interface JqlSourceTest {
  key: string;
  active: number;
  outdated: number;
  lost: number;
  jira_status?: 'ok' | 'not_found' | 'error' | null;
}

/** JQL-фильтр по УНИКАЛЬНЫМ тестам будущей выгрузки — мост «CSV → Jira»
 *  (v1.8.3, процесс пользователя: найти все тесты выгрузки одним поиском и
 *  выгрузить их из Jira с шагами). Тест попадает в фильтр, если хотя бы
 *  одна его привязка — в выбранном статусе (в CSV он может встречаться
 *  много раз, здесь — один). Ключи не по формату и задачи, которых нет в
 *  Jira (not_found), исключаются: один такой ключ валит весь запрос
 *  «key in (…)» ошибкой Jira; error/null не исключаются — задача, скорее
 *  всего, существует, просто не проверена. skipped — сколько тестов
 *  выгрузки пришлось исключить (для честной подписи в модалке). */
export function buildJiraFilter(
  tests: JqlSourceTest[],
  statuses: CsvStatus[],
): { jql: string; keys: string[]; skipped: number } {
  const inExport = tests.filter(t => statuses.some(s => t[s] > 0));
  const keys = inExport
    .filter(t => isLikelyJiraKey(t.key) && t.jira_status !== 'not_found')
    .map(t => t.key)
    .sort(compareTestKeys);
  return {
    keys,
    skipped: inExport.length - keys.length,
    jql: keys.length ? `key in (${keys.join(', ')})` : '',
  };
}
