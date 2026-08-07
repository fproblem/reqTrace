// Логика глобального поиска (Cmd+K): подбор и ранжирование строк палитры.
// Чистая функция без DOM — рендер и клавиатура живут в CommandPalette.tsx.

export type PaletteKind = 'page' | 'test' | 'project';

export interface PaletteEntry {
  kind: PaletteKind;
  /** page → id страницы, test → ключ теста, project → id проекта. */
  id: string;
  /** Заголовок строки: название страницы / ключ теста / имя проекта. */
  title: string;
  /** Вторая строка: «проект · спейс» у страниц, название из Jira у тестов. */
  subtitle?: string;
  projectId: string;
}

/** Групп в выдаче — по потолку на вид: палитра отвечает первым экраном,
 * а не простынёй (полные списки живут на своих экранах — дерево, «Тесты»). */
export const GROUP_LIMITS: Record<PaletteKind, number> = { page: 8, test: 6, project: 3 };

/** Порядок групп в выдаче: страницы — главный сценарий, тесты — второй. */
export const GROUP_ORDER: PaletteKind[] = ['page', 'test', 'project'];

/** Ранг совпадения строки с запросом: меньше — лучше.
 * 0 — префикс, 1 — префикс слова, 2 — вхождение; -1 — не подходит. */
export function matchScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const idx = t.indexOf(query);
  if (idx === -1) return -1;
  if (idx === 0) return 0;
  // Границей слова считаем любой не-буквенно-цифровой символ (пробел,
  // дефис, скобка, «-» в ключах TEST-123).
  const prev = t[idx - 1];
  if (!/[0-9a-zа-яё]/i.test(prev)) return 1;
  return 2;
}

/** Подбор по запросу: совпадение по заголовку (в полную силу) или по
 * подзаголовку (слабее — название из Jira у тестов тоже ищется, но ключ
 * главнее). Внутри группы — по рангу, затем по алфавиту; группы — в
 * фиксированном порядке страницы → тесты → проекты, каждая под потолком. */
export function searchPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const entry of entries) {
    const titleScore = matchScore(entry.title, q);
    const subtitleScore = entry.subtitle ? matchScore(entry.subtitle, q) : -1;
    // Подзаголовок — слабее любого совпадения по заголовку (+10).
    const score = titleScore !== -1
      ? titleScore
      : subtitleScore !== -1 ? subtitleScore + 10 : -1;
    if (score !== -1) scored.push({ entry, score });
  }

  const result: PaletteEntry[] = [];
  for (const kind of GROUP_ORDER) {
    const group = scored
      .filter(s => s.entry.kind === kind)
      .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title, 'ru'))
      .slice(0, GROUP_LIMITS[kind])
      .map(s => s.entry);
    result.push(...group);
  }
  return result;
}
