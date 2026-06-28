import type {
  User, PageListItem, PageDetail,
  Highlight, TestLink, DiffResponse, BaselineInfo,
  SpaceTree, TreeSyncResult,
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
    return 'Не удалось подключиться к Confluence. Проверьте настройки подключения (URL, логин, пароль)';
  }

  // Generic fallbacks by status code
  if (status === 401 || status === 403) {
    return 'Ошибка авторизации. Проверьте учётные данные Confluence в настройках';
  }
  if (status === 404) {
    return 'Ресурс не найден';
  }
  if (status === 409) {
    return 'Конфликт: ресурс уже существует';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'Сервис временно недоступен. Попробуйте позже';
  }
  if (status >= 500) {
    return 'Внутренняя ошибка сервера. Обратитесь к администратору';
  }

  return detail || 'Неизвестная ошибка';
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
  // Users
  loginUser: (name: string) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify({ name }) }),

  listUsers: () =>
    request<User[]>('/users'),

  // Pages
  addPage: (confluence_url: string, user_id: string) =>
    request<PageDetail>('/pages', {
      method: 'POST',
      body: JSON.stringify({ confluence_url, user_id }),
    }),

  addDemoPage: (user_id: string) =>
    request<PageDetail>('/pages/demo', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  listPages: () =>
    request<PageListItem[]>('/pages'),

  getPageTree: () =>
    request<SpaceTree[]>('/pages/tree'),

  syncTree: (user_id: string) =>
    request<TreeSyncResult>('/pages/sync-tree', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  getPage: (pageId: string) =>
    request<PageDetail>(`/pages/${pageId}`),

  promotePage: (pageId: string, user_id: string) =>
    request<PageDetail>(`/pages/${pageId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  refreshPage: (pageId: string, user_id: string) =>
    request<PageDetail>(`/pages/${pageId}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  setBaseline: (pageId: string, user_id: string) =>
    request<BaselineInfo>(`/pages/${pageId}/baseline`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

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
    user_id: string;
  }) =>
    request<Highlight>(`/pages/${pageId}/highlights`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listHighlights: (pageId: string) =>
    request<Highlight[]>(`/pages/${pageId}/highlights`),

  deleteHighlight: (highlightId: string) =>
    request<void>(`/highlights/${highlightId}`, { method: 'DELETE' }),

  reanchorHighlight: (highlightId: string, user_id: string) =>
    request<Highlight>(`/highlights/${highlightId}/reanchor`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  markHighlightLost: (highlightId: string) =>
    request<Highlight>(`/highlights/${highlightId}/mark-lost`, { method: 'POST' }),

  // Test links
  addTestLink: (highlightId: string, test_key: string, user_id: string) =>
    request<TestLink>(`/highlights/${highlightId}/tests`, {
      method: 'POST',
      body: JSON.stringify({ test_key, user_id }),
    }),

  removeTestLink: (linkId: string) =>
    request<void>(`/highlight-tests/${linkId}`, { method: 'DELETE' }),

  // Diff
  getDiff: (pageId: string) =>
    request<DiffResponse>(`/pages/${pageId}/diff`),

  // Settings
  getSettings: () =>
    request<{
      confluence_base_url: string;
      confluence_username: string;
      confluence_password_set: boolean;
      jira_base_url: string;
    }>('/settings'),

  updateSettings: (data: {
    confluence_base_url: string;
    confluence_username: string;
    confluence_password: string;
    jira_base_url: string;
  }) =>
    request<{
      confluence_base_url: string;
      confluence_username: string;
      confluence_password_set: boolean;
      jira_base_url: string;
    }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
