import { CONTEXT_WINDOW, lostQuoteContext } from './quoteContext';

const base = { text_before: 'до ', text_after: ' после' };

describe('lostQuoteContext', () => {
  it('не для «Утрачено» — null: у живых привязок место видно на странице', () => {
    expect(lostQuoteContext({ status: 'active', ...base })).toBeNull();
    expect(lostQuoteContext({ status: 'outdated', ...base })).toBeNull();
  });

  it('оба соседа пусты — null (привязка до появления захвата контекста)', () => {
    expect(lostQuoteContext({ status: 'lost', text_before: '', text_after: '' })).toBeNull();
  });

  it('чисто пробельный сосед — не контекст', () => {
    const ctx = lostQuoteContext({ status: 'lost', text_before: '  \n ', text_after: ' после' });
    expect(ctx).not.toBeNull();
    expect(ctx!.before).toBeNull();
    expect(ctx!.after).toBe(' после');
  });

  it('строки отдаются как есть — пробел на стыке с цитатой выживает', () => {
    const ctx = lostQuoteContext({ status: 'lost', ...base });
    expect(ctx!.before).toBe('до ');
    expect(ctx!.after).toBe(' после');
  });

  it('окно в полный кап — обрезано, нужен «…»; короче — целое', () => {
    const full = 'х'.repeat(CONTEXT_WINDOW);
    const short = 'х'.repeat(CONTEXT_WINDOW - 1);
    const truncated = lostQuoteContext({ status: 'lost', text_before: full, text_after: full });
    expect(truncated!.beforeTruncated).toBe(true);
    expect(truncated!.afterTruncated).toBe(true);
    const whole = lostQuoteContext({ status: 'lost', text_before: short, text_after: short });
    expect(whole!.beforeTruncated).toBe(false);
    expect(whole!.afterTruncated).toBe(false);
  });
});
