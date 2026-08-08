import { Highlight } from '../../types';
import { CONTEXT_WINDOW } from './selection/selectionAnchors';

// Реэкспорт для тестов: правило «окно в полный кап = обрезано» судится
// ровно той же величиной, которой захват режет контекст.
export { CONTEXT_WINDOW };

export interface QuoteContextParts {
  /** Текст-сосед слева от цитаты; null — соседа нет (или пустой). */
  before: string | null;
  /** Текст-сосед справа от цитаты; null — соседа нет (или пустой). */
  after: string | null;
  /** Окно упёрлось в кап CONTEXT_WINDOW — до/после было ещё, нужен «…». */
  beforeTruncated: boolean;
  afterTruncated: boolean;
}

/** Контекст вокруг утраченной цитаты — «где жило требование».
 *
 * Только для статуса «Утрачено»: у живых привязок место видно на самой
 * странице, а у outdated тело цитаты занято пословным диффом. Строки
 * отдаются КАК ЕСТЬ (без trim): text_before кончается ровно там, где
 * начиналась цитата, — обрезка съела бы законный пробел на стыке, и контекст
 * склеился бы с цитатой в одно слово. Чисто пробельный сосед — не контекст.
 *
 * null — показывать нечего: статус не «Утрачено» или оба соседа пусты
 * (например, привязка создана до появления захвата контекста). */
export function lostQuoteContext(
  h: Pick<Highlight, 'status' | 'text_before' | 'text_after'>,
): QuoteContextParts | null {
  if (h.status !== 'lost') return null;
  const before = h.text_before && h.text_before.trim() ? h.text_before : null;
  const after = h.text_after && h.text_after.trim() ? h.text_after : null;
  if (before == null && after == null) return null;
  return {
    before,
    after,
    beforeTruncated: (before ?? '').length >= CONTEXT_WINDOW,
    afterTruncated: (after ?? '').length >= CONTEXT_WINDOW,
  };
}
