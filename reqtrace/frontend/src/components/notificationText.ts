// Тексты панели уведомлений (v1.6.3): бэкенд отдаёт структурированные записи
// журнала прогонов, человеческие фразы собираются здесь — как humanizeError
// в api/client.ts. Чистые функции, покрыты notificationText.test.ts.
import { FinishedRunSummary, NotificationEntry } from '../types';
import { formatCheckedAt, plural } from '../pages/TestsPage';

/** Сколько ключей тестов называем в дайджесте поимённо; остальные — «и ещё N». */
const MAX_TEST_KEYS = 2;

export function notificationTitle(e: NotificationEntry): string {
  if (e.kind === 'cred_invalid') return `Подключение к «${e.project_name}» отклонено`;
  // Состояние, а не событие: строка живёт, пока прогон не удался.
  if (e.kind === 'run_skipped') return `Обновление «${e.project_name}» не выполняется`;
  // Нейтрально, без «ночное»: после добора или ручного запуска прогон
  // случается и днём, и вечером.
  return `Обновление · ${e.project_name}`;
}

export function notificationBody(e: NotificationEntry): string {
  if (e.kind === 'cred_invalid') {
    return 'Confluence не принял ваши логин/пароль — обновление прошло без них. '
      + 'Обновите креды в профиле';
  }
  if (e.kind === 'run_skipped') {
    const reason = e.skipped_reason === 'confluence_unreachable'
      ? 'Confluence недоступен — доберём, как только появится связь'
      : 'Не осталось работающих подключений — проверьте креды в профиле';
    const attempts = e.attempts ?? 1;
    if (attempts > 1 && e.first_attempt_at) {
      // Серия неудач схлопнута в одну живую строку — показываем её размах.
      return `${reason}. Попыток: ${attempts} — первая ${formatCheckedAt(e.first_attempt_at)}, `
        + `последняя ${formatCheckedAt(e.happened_at)}`;
    }
    return reason;
  }
  if (e.kind === 'run_quiet') {
    // Подтверждение тишины (v1.6.5): ReqTrace следил, изменений не нашёл.
    // Страницы могли меняться — важно, что привязки не задеты.
    const what = e.pages_changed > 0
      ? 'Страницы менялись, но привязки не задеты'
      : 'Изменений нет';
    const checked = `страницы проверены ${formatCheckedAt(e.happened_at)}`;
    const attempts = e.attempts ?? 1;
    if (attempts > 1 && e.first_attempt_at) {
      // Неделя тишины — одна строка с её размахом, а не семь одинаковых
      // (ярлык счёта — как «Попыток: N» у серии неудач).
      return `${what} — ${checked}. Спокойных прогонов: ${attempts}, `
        + `тишина с ${formatCheckedAt(e.first_attempt_at)}`;
    }
    return `${what} — ${checked}`;
  }

  const parts: string[] = [];
  if (e.pages_changed > 0) {
    parts.push(
      `${plural(e.pages_changed, ['Изменилась', 'Изменились', 'Изменились'])} `
      + `${e.pages_changed} ${plural(e.pages_changed, ['страница', 'страницы', 'страниц'])}`
      + ` из ${e.pages_total}`,
    );
  }
  const transitions: string[] = [];
  if (e.to_outdated > 0) transitions.push(`${e.to_outdated} → «Требует проверки»`);
  if (e.to_lost > 0) transitions.push(`${e.to_lost} → «Утрачено»`);
  if (transitions.length) parts.push(`Привязки: ${transitions.join(', ')}`);
  if (e.affected_tests.length > 0) {
    const shown = e.affected_tests.slice(0, MAX_TEST_KEYS);
    const rest = e.affected_tests.length - shown.length;
    parts.push(`Затронуты тесты ${shown.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`);
  }
  if (e.pages_failed > 0) {
    parts.push(
      `${e.pages_failed} ${plural(e.pages_failed,
        ['страница не обновилась', 'страницы не обновились', 'страниц не обновились'])}`,
    );
  }
  if (e.skipped_reason === 'no_valid_credentials') {
    parts.push('Прогон прерван: закончились работающие подключения');
  } else if (e.skipped_reason === 'confluence_unreachable') {
    parts.push('Прогон прерван: Confluence стал недоступен, доберём при появлении связи');
  }
  return parts.join('. ');
}

/** Куда ведёт клик: дайджест — к худшему на экране «Тесты» (фильтры v1.6.1),
 * проблемы кред и пропуски — в профиль, чиниться. */
export function notificationLink(e: NotificationEntry): string {
  if (e.kind === 'cred_invalid' || e.kind === 'run_skipped') return '/settings';
  if (e.to_lost > 0) return `/tests/${e.project_id}?f=lost`;
  if (e.to_outdated > 0) return `/tests/${e.project_id}?f=outdated`;
  return `/tests/${e.project_id}`;
}

/** Оттенок значка записи — только фирменные цвета (ICON_TINTS):
 * красный — потери/ошибки/битые креды, янтарный — «требует проверки» и
 * пропуски, зелёный — остальное. */
export function notificationTint(e: NotificationEntry): 'green' | 'amber' | 'red' {
  if (e.kind === 'cred_invalid') return 'red';
  if (e.kind === 'run_skipped') return 'amber';
  if (e.to_lost > 0 || e.pages_failed > 0) return 'red';
  if (e.to_outdated > 0) return 'amber';
  return 'green';
}

/** Краткий итог завершённого прогона для индикатора у колокольчика:
 * говорит результат даже там, где бейджу загораться не от чего
 * («изменений нет», «Confluence недоступен»). */
export function runResultText(
  run: FinishedRunSummary,
): { text: string; tone: 'ok' | 'quiet' | 'warn' } {
  if (run.status === 'skipped') {
    return {
      text: run.skipped_reason === 'no_valid_credentials'
        ? 'Не удалось: нет работающих подключений'
        : 'Не удалось: Confluence недоступен',
      tone: 'warn',
    };
  }
  const findings: string[] = [];
  if (run.to_outdated > 0) findings.push(`${run.to_outdated} на проверку`);
  if (run.to_lost > 0) {
    findings.push(`${run.to_lost} ${plural(run.to_lost, ['утрачена', 'утрачены', 'утрачено'])}`);
  }
  if (findings.length > 0) return { text: `Готово: ${findings.join(', ')}`, tone: 'ok' };
  if (run.pages_failed > 0) {
    return {
      text: `Готово, но ${run.pages_failed} ${plural(run.pages_failed,
        ['страница не обновилась', 'страницы не обновились', 'страниц не обновились'])}`,
      tone: 'warn',
    };
  }
  if (run.pages_changed > 0) {
    return { text: 'Готово: страницы изменились, привязки целы', tone: 'quiet' };
  }
  return { text: 'Готово — изменений нет', tone: 'quiet' };
}
