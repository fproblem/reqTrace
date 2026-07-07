import type {
  AuthUser, PageDetail,
  Highlight, TestLink, DiffResponse, BaselineInfo,
  ProjectTree, TreeSyncResult,
  Project, CredentialCheckResult,
} from '../types';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Map known backend errors to user-friendly Russian messages. */
function humanizeError(status: number, detail: string): string {
  // Exact match on detail message from backend
  const detailLower = detail.toLowerCase();

  if (status === 409 && detailLower.includes('already tracked')) {
    return 'Эта страница уже отслеживается';
  }
  if (status === 400 && detailLower.includes('cannot extract page id')) {
    return 'Не удалось распознать URL страницы Confluence. Проверьте ссылку';
  }
  if (status === 400 && detailLower.includes('page is already tracked')) {
    return 'Эта страница уже отслеживается';
  }
  if (status === 400 && detailLower.includes('no snapshots available')) {
    return 'Нет доступных снимков страницы';
  }
  if (status === 400 && detailLower.includes('no baseline set')) {
    return 'Для этой страницы ещё не установлен baseline';
  }
  if (status === 400 && detailLower.includes('no snapshot available')) {
    return 'Нет снимка страницы для этого действия';
  }
  if (status === 400 && detailLower.includes('only outdated highlights')) {
    return 'Актуализировать можно только привязки в статусе «Требует проверки»';
  }
  if (status === 400 && detailLower.includes('name cannot be empty')) {
    return 'Имя не может быть пустым';
  }
  if (status === 404 && detailLower.includes('page not found')) {
    return 'Страница не найдена. Возможно, она была удалена';
  }
  if (status === 404 && detailLower.includes('highlight not found')) {
    return 'Привязка не найдена. Возможно, она была удалена';
  }
  if (status === 404 && detailLower.includes('test link not found')) {
    return 'Связь с тестом не найдена. Возможно, она была удалена';
  }
  if (status === 502 && detailLower.includes('failed to fetch')) {
    return 'Не удалось подключиться к Confluence. Проверьте адрес сервера и креды проекта в профиле';
  }

  // Generic fallbacks by status code
  if (status === 401) {
    // Бэкенд шлёт русские сообщения («Требуется вход», «Не удалось подтвердить
    // вход через Google») — показываем их как есть.
    return detail && /[а-яё]/i.test(detail) ? detail : 'Требуется вход. Сессия могла истечь';
  }
  if (status === 403) {
    return detail && /[а-яё]/i.test(detail) ? detail : 'Доступ запрещён';
  }
  if (status === 404) {
    // Бэкенд шлёт осмысленные русские сообщения (например, «Вы не подключены
    // к этому проекту») — не подменяем их общей фразой.
    return detail && /[а-яё]/i.test(detail) ? detail : 'Ресурс не найден';
  }
  if (status === 409) {
    // Бэкенд шлёт осмысленные русские сообщения (например, про занятое имя
    // проекта) — не подменяем их общей фразой.
    return detail && /[а-яё]/i.test(detail) ? detail : 'Конфликт: ресурс уже существует';
  }
  if (status === 502 || status === 503 || status === 504) {
    // Русские 502 от бэкенда («Не удалось подключиться к Confluence (url).
    // Проверьте адрес сервера») точнее общей фразы — иначе кажется, что
    // недоступен сам reqtrace, а не Confluence проекта.
    return detail && /[а-яё]/i.test(detail) ? detail : 'Сервис временно недоступен. Попробуйте позже';
  }
  if (status >= 500) {
    return 'Внутренняя ошибка сервера. Обратитесь к администратору';
  }

  return detail || 'Неизвестная ошибка';
}

// Глобальная реакция на 401 (сессия истекла где угодно → экран входа);
// регистрируется AuthProvider'ом.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (e) {
    // Network error — server unreachable
    throw new ApiError(0, 'Сервер недоступен. Проверьте подключение к сети');
  }

  if (res.status === 401 && !path.startsWith('/auth/')) {
    unauthorizedHandler?.();
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiError(res.status, humanizeError(res.status, detail));
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  getAuthConfig: () =>
    request<{ google_client_id: string }>('/auth/config'),

  loginWithGoogle: (credential: string) =>
    request<AuthUser>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),

  getMe: () =>
    request<AuthUser>('/auth/me'),

  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }),

  // Pages
  addPage: (confluence_url: string, project_id?: string) =>
    request<PageDetail>('/pages', {
      method: 'POST',
      body: JSON.stringify(project_id ? { confluence_url, project_id } : { confluence_url }),
    }),

  addDemoPage: () =>
    request<PageDetail>('/pages/demo', { method: 'POST' }),

  getPageTree: () =>
    request<ProjectTree[]>('/pages/tree'),

  syncTree: () =>
    request<TreeSyncResult>('/pages/sync-tree', { method: 'POST' }),

  getPage: (pageId: string) =>
    request<PageDetail>(`/pages/${pageId}`),

  promotePage: (pageId: string) =>
    request<PageDetail>(`/pages/${pageId}/promote`, { method: 'POST' }),

  refreshPage: (pageId: string) =>
    request<PageDetail>(`/pages/${pageId}/refresh`, { method: 'POST' }),

  setBaseline: (pageId: string) =>
    request<BaselineInfo>(`/pages/${pageId}/baseline`, { method: 'POST' }),

  deletePage: (pageId: string) =>
    request<void>(`/pages/${pageId}`, { method: 'DELETE' }),

  // Highlights
  createHighlight: (pageId: string, data: {
    text_content: string;
    text_before: string;
    text_after: string;
    anchor_block_start: number | null;
    anchor_block_end: number | null;
    start_char_offset: number | null;
    end_char_offset: number | null;
  }) =>
    request<Highlight>(`/pages/${pageId}/highlights`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listHighlights: (pageId: string) =>
    request<Highlight[]>(`/pages/${pageId}/highlights`),

  deleteHighlight: (highlightId: string) =>
    request<void>(`/highlights/${highlightId}`, { method: 'DELETE' }),

  reanchorHighlight: (highlightId: string) =>
    request<Highlight>(`/highlights/${highlightId}/reanchor`, { method: 'POST' }),

  markHighlightLost: (highlightId: string) =>
    request<Highlight>(`/highlights/${highlightId}/mark-lost`, { method: 'POST' }),

  unmarkHighlightLost: (highlightId: string) =>
    request<Highlight>(`/highlights/${highlightId}/unmark-lost`, { method: 'POST' }),

  // Test links
  addTestLink: (highlightId: string, test_key: string) =>
    request<TestLink>(`/highlights/${highlightId}/tests`, {
      method: 'POST',
      body: JSON.stringify({ test_key }),
    }),

  removeTestLink: (linkId: string) =>
    request<void>(`/highlight-tests/${linkId}`, { method: 'DELETE' }),

  // Diff
  getDiff: (pageId: string) =>
    request<DiffResponse>(`/pages/${pageId}/diff`),

  // Projects (v1.5.1): личные креды, живая проверка подключения
  listProjects: () =>
    request<Project[]>('/projects'),

  createProject: (data: {
    name: string;
    confluence_base_url: string;
    jira_base_url?: string;
    confluence_username: string;
    confluence_password: string;
  }) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProject: (projectId: string, data: { name?: string; jira_base_url?: string }) =>
    request<Project>(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** Апсерт своих кред; первое сохранение = присоединиться к проекту.
   *  Пустой пароль у уже подключённого участника = не менять пароль. */
  saveProjectCredentials: (projectId: string, data: {
    confluence_username: string;
    confluence_password?: string;
  }) =>
    request<Project>(`/projects/${projectId}/credentials`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  checkProjectCredentials: (projectId: string) =>
    request<CredentialCheckResult>(`/projects/${projectId}/credentials/check`, {
      method: 'POST',
    }),

  disconnectProject: (projectId: string) =>
    request<void>(`/projects/${projectId}/credentials`, { method: 'DELETE' }),

  /** Удалить проект целиком — для всех участников, со страницами и привязками. */
  deleteProject: (projectId: string) =>
    request<void>(`/projects/${projectId}`, { method: 'DELETE' }),
};
