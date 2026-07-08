import { Highlight } from '../../types';
import { HighlightRenderReport } from './HighlightLayer';

/** Решение о синхронизации статусов с фактической отрисовкой слоя.
 *
 * Чистая функция без DOM/React (как highlightMatching) — именно эта логика
 * при ложном отчёте слоя массово «теряла» привязки (баг v1.5.7), поэтому её
 * правила зафиксированы юнит-тестами statusSync.test.ts:
 *  • привязку обработали (considered), но ни одной метки нет → «Утрачено»;
 *  • утраченная снова отрисовалась (в т.ч. частично) → «Требует проверки»;
 *  • актуальная отрисовалась лишь ЧАСТИЧНО (цитату правили — на странице
 *    уцелевшие куски в якорном блоке, v1.5.8) → понизить до «Требует проверки»;
 *  • привязки НЕ из отчёта не трогаем: отчёт мог быть посчитан по другому
 *    набору привязок (смена страницы между прогонами слоя).
 */
export interface StatusSyncPlan {
  toLose: string[];
  toRecover: string[];
  /** «Актуальные», от цитаты которых на странице осталась лишь часть. */
  toReview: string[];
}

export function computeStatusSync(
  highlights: Highlight[],
  report: HighlightRenderReport,
): StatusSyncPlan {
  const toLose: string[] = [];
  const toRecover: string[] = [];
  const toReview: string[] = [];
  highlights.forEach(h => {
    if (!report.considered.has(h.id)) return;
    const isRendered = report.rendered.has(h.id);
    if (!isRendered && h.status !== 'lost') toLose.push(h.id);
    else if (isRendered && h.status === 'lost') toRecover.push(h.id);
    else if (isRendered && report.partial.has(h.id) && h.status === 'active') {
      toReview.push(h.id);
    }
  });
  return { toLose, toRecover, toReview };
}
