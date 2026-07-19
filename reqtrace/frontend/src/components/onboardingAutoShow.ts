// Автопоказ инструкции «Как работает ReqTrace» (v1.6.5).
//
// Правило: пользователю без единого подключённого проекта модалка-инструкция
// открывается сама, но только ОДИН раз за вход. «Вход» — вкладка браузера:
// флаг живёт в sessionStorage и переживает перезагрузку страницы и навигацию,
// а новая вкладка или перезапуск браузера считаются новым входом. Выход из
// аккаунта сбрасывает флаг — следующий вход снова «первый». Пользователю с
// проектами модалка сама не открывается никогда — только кнопкой.

const KEY = 'reqtrace:onboarding-auto-shown';

// Резерв на случай недоступного sessionStorage (приватные режимы, запрет
// хранилищ): флаг в памяти модуля — «один раз за загрузку страницы».
let memoryFlag = false;

export function shouldAutoShowOnboarding(joinedCount: number): boolean {
  if (joinedCount > 0) return false;
  try {
    return window.sessionStorage.getItem(KEY) === null;
  } catch {
    return !memoryFlag;
  }
}

/** Показ состоялся — любым способом: автоматически или кнопкой. */
export function markOnboardingShown(): void {
  memoryFlag = true;
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch { /* хранилище недоступно — достаточно флага в памяти */ }
}

/** Выход из аккаунта: следующий вход — снова «первый». */
export function resetOnboardingAutoShow(): void {
  memoryFlag = false;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch { /* хранилище недоступно — некритично */ }
}
