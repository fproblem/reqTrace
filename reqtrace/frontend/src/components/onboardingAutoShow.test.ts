// Правила автопоказа инструкции «Как работает ReqTrace» (v1.6.5):
// один раз за вход, только пользователю без подключённых проектов.
import {
  markOnboardingShown,
  resetOnboardingAutoShow,
  shouldAutoShowOnboarding,
} from './onboardingAutoShow';

describe('shouldAutoShowOnboarding', () => {
  beforeEach(() => {
    // Чистый «первый вход»: и sessionStorage, и резервный флаг в памяти.
    window.sessionStorage.clear();
    resetOnboardingAutoShow();
  });

  it('показывает новичку без проектов при первом заходе', () => {
    expect(shouldAutoShowOnboarding(0)).toBe(true);
  });

  it('не показывает пользователю с подключёнными проектами', () => {
    expect(shouldAutoShowOnboarding(1)).toBe(false);
    expect(shouldAutoShowOnboarding(5)).toBe(false);
  });

  it('после показа не открывается повторно в той же сессии', () => {
    markOnboardingShown();
    expect(shouldAutoShowOnboarding(0)).toBe(false);
  });

  it('ручное открытие тоже считается показом', () => {
    // markOnboardingShown вызывается и кнопкой — сценарий тот же,
    // но фиксируем смысл отдельным кейсом.
    expect(shouldAutoShowOnboarding(0)).toBe(true);
    markOnboardingShown();
    expect(shouldAutoShowOnboarding(0)).toBe(false);
  });

  it('выход из аккаунта сбрасывает флаг — следующий вход снова первый', () => {
    markOnboardingShown();
    resetOnboardingAutoShow();
    expect(shouldAutoShowOnboarding(0)).toBe(true);
  });

  it('флаг переживает «навигацию» (повторные проверки без сброса)', () => {
    markOnboardingShown();
    expect(shouldAutoShowOnboarding(0)).toBe(false);
    expect(shouldAutoShowOnboarding(0)).toBe(false);
  });

  it('живёт на резервном флаге в памяти, когда sessionStorage недоступен', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('storage disabled'); },
    });
    try {
      expect(shouldAutoShowOnboarding(0)).toBe(true);
      markOnboardingShown();
      expect(shouldAutoShowOnboarding(0)).toBe(false);
      resetOnboardingAutoShow();
      expect(shouldAutoShowOnboarding(0)).toBe(true);
    } finally {
      Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
