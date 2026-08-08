// «Недавнее» — пустое состояние глобального поиска (Cmd+K) и список на
// стартовом экране «/». Живёт в localStorage: история локальна для браузера
// и переживает перезагрузку, серверного следа у неё нет.
//
// Ключ ПЕРСОНАЛЬНЫЙ — с id пользователя сессии (v1.8.1, отзыв пользователя):
// под общим ключом два аккаунта в одном браузере видели одну историю — и
// чужие названия страниц, и чужой порядок. Смена аккаунта теперь означает
// свою, отдельную историю; данные соседа из UI не видны.
//
// Записи двух видов (v1.8.1, идея пользователя): страницы (пишутся при
// визите) и тесты (пишутся при выборе теста в палитре) — один хронологический
// список, свежее сверху. Старые записи без поля kind читаются как страницы.

const KEY_PREFIX = 'reqtrace_recent_pages';
// Общий ключ времён первой итерации фичи — вычищается при первой записи.
const LEGACY_KEY = 'reqtrace_recent_pages';
const LIMIT = 10;

export type RecentKind = 'page' | 'test';

export interface RecentEntry {
  kind: RecentKind;
  /** page → id страницы, test → ключ теста. */
  id: string;
  /** Название страницы / ключ теста. */
  title: string;
  /** Только у тестов: проект (навигация на ярус 2) и название из Jira на
   * момент выбора — палитра при живом индексе показывает свежее. */
  projectId?: string;
  subtitle?: string;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

/** Идентичность записи для дедупликации: одинаковый ключ теста в двух
 * проектах — две разные записи. */
function identity(e: Pick<RecentEntry, 'kind' | 'id' | 'projectId'>): string {
  return `${e.kind}:${e.projectId ?? ''}:${e.id}`;
}

export function listRecentEntries(userId: string): RecentEntry[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is RecentEntry =>
        !!p && typeof p.id === 'string' && typeof p.title === 'string')
      // Записи до появления тестов в истории не несут kind — это страницы.
      .map(p => ({ ...p, kind: p.kind === 'test' ? 'test' as const : 'page' as const }));
  } catch {
    return [];
  }
}

/** Общая запись события истории: наверх списка, без дублей, хвост за
 * лимитом отпадает; повторное событие обновляет название/подпись. */
function record(userId: string, entry: RecentEntry): void {
  if (!userId) return;
  const rest = listRecentEntries(userId).filter(p => identity(p) !== identity(entry));
  const next = [entry, ...rest].slice(0, LIMIT);
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
    // Дожившая общая история доперсональной эпохи никому не принадлежит —
    // безопаснее удалить, чем гадать, чья она.
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Хранилище недоступно (приватный режим и т.п.) — история просто не ведётся.
  }
}

/** Визит страницы; title обновляется при каждом визите — переименованная
 * страница не остаётся в истории под старым названием. */
export function recordRecentPage(userId: string, id: string, title: string): void {
  record(userId, { kind: 'page', id, title });
}

/** Выбор теста в палитре: ключ + проект (для перехода на ярус 2) + название
 * из Jira на момент выбора. */
export function recordRecentTest(
  userId: string, key: string, projectId: string, subtitle?: string,
): void {
  record(userId, { kind: 'test', id: key, title: key, projectId, subtitle });
}
