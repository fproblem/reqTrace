/** Тесты решения о смене статуса «Утрачено» по отчёту слоя (computeStatusSync).
 *
 * Эта логика при ложном отчёте массово «теряла» привязки (баг v1.5.7), поэтому
 * её правила зафиксированы: терять — только обработанные и не отрисованные,
 * возвращать — только утраченные и отрисованные, чужие отчёты игнорировать.
 */
import { Highlight } from '../../types';
import { computeStatusSync } from './statusSync';

function h(id: string, status: Highlight['status']): Highlight {
  return { id, status } as Highlight;
}

function report(considered: string[], rendered: string[]) {
  return { considered: new Set(considered), rendered: new Set(rendered) };
}

describe('computeStatusSync', () => {
  it('обработана, но не отрисована и не lost → в «Утрачено»', () => {
    const plan = computeStatusSync(
      [h('a', 'active'), h('b', 'outdated')],
      report(['a', 'b'], []),
    );
    expect(plan.toLose).toEqual(['a', 'b']);
    expect(plan.toRecover).toEqual([]);
  });

  it('утраченная снова отрисовалась → возврат в «Требует проверки»', () => {
    const plan = computeStatusSync([h('a', 'lost')], report(['a'], ['a']));
    expect(plan.toRecover).toEqual(['a']);
    expect(plan.toLose).toEqual([]);
  });

  it('привязка не из отчёта не трогается (отчёт другого набора привязок)', () => {
    // Отчёт посчитан по прошлой странице: id не пересекаются.
    const plan = computeStatusSync(
      [h('new-1', 'active'), h('new-2', 'lost')],
      report(['old-1', 'old-2'], []),
    );
    expect(plan.toLose).toEqual([]);
    expect(plan.toRecover).toEqual([]);
  });

  it('устоявшиеся состояния не трогаются: lost без отрисовки, active с отрисовкой', () => {
    const plan = computeStatusSync(
      [h('a', 'lost'), h('b', 'active')],
      report(['a', 'b'], ['b']),
    );
    expect(plan.toLose).toEqual([]);
    expect(plan.toRecover).toEqual([]);
  });

  it('смешанный сценарий: и потери, и возвраты одним планом', () => {
    const plan = computeStatusSync(
      [h('gone', 'active'), h('back', 'lost'), h('ok', 'outdated'), h('alien', 'active')],
      report(['gone', 'back', 'ok'], ['back', 'ok']),
    );
    expect(plan.toLose).toEqual(['gone']);
    expect(plan.toRecover).toEqual(['back']);
  });

  it('пустой отчёт → пустой план', () => {
    const plan = computeStatusSync([h('a', 'active')], report([], []));
    expect(plan.toLose).toEqual([]);
    expect(plan.toRecover).toEqual([]);
  });
});
