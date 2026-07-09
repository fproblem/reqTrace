/** Тесты пословного диффа цитаты (quoteDiff) — блок «что изменилось» в панели. */
import { quoteDiff } from './quoteDiff';

function render(parts: ReturnType<typeof quoteDiff>): string {
  return (parts ?? [])
    .map(p => (p.kind === 'removed' ? `[-${p.text}-]` : p.kind === 'added' ? `[+${p.text}+]` : p.text))
    .join(' ');
}

describe('quoteDiff', () => {
  it('одинаковые тексты → один same-кусок', () => {
    expect(quoteDiff('Текст под уровнем.', 'Текст под уровнем.')).toEqual([
      { kind: 'same', text: 'Текст под уровнем.' },
    ]);
  });

  it('удалённое слово помечается removed', () => {
    expect(render(quoteDiff(
      'Текст под подзаголовок четвертого уровня.',
      'Текст под четвертого уровня.',
    ))).toBe('Текст под [-подзаголовок-] четвертого уровня.');
  });

  it('вставленное слово помечается added', () => {
    expect(render(quoteDiff(
      'Текст под четвертого уровня.',
      'Текст под подзаголовок четвертого уровня.',
    ))).toBe('Текст под [+подзаголовок+] четвертого уровня.');
  });

  it('замена слова → removed + added', () => {
    expect(render(quoteDiff(
      'Первое правило работы.',
      'Первое условие работы.',
    ))).toBe('Первое [-правило-] [+условие+] работы.');
  });

  it('соседние изменения склеиваются в один кусок', () => {
    const parts = quoteDiff('один два три конец', 'раз-два-три конец');
    expect(parts).toEqual([
      { kind: 'removed', text: 'один два три' },
      { kind: 'added', text: 'раз-два-три' },
      { kind: 'same', text: 'конец' },
    ]);
  });

  it('пустые строки не роняют', () => {
    expect(quoteDiff('', '')).toEqual([]);
    expect(quoteDiff('слово', '')).toEqual([{ kind: 'removed', text: 'слово' }]);
    expect(quoteDiff('', 'слово')).toEqual([{ kind: 'added', text: 'слово' }]);
  });

  it('слишком большой вход → null (панель покажет цитату без диффа)', () => {
    const big = Array.from({ length: 600 }, (_, i) => `слово${i}`).join(' ');
    expect(quoteDiff(big, big + ' хвост')).toBeNull();
    // Обычные цитаты далеки от потолка.
    expect(quoteDiff('раз два три', 'раз три')).not.toBeNull();
  });
});
