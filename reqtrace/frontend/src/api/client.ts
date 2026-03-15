import type {
  User, PageListItem, PageDetail,
  Highlight, TestLink, DiffResponse, BaselineInfo,
} from '../types';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
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

  getPage: (pageId: string) =>
    request<PageDetail>(`/pages/${pageId}`),

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
    anchor_block_start: number;
    anchor_block_end: number;
    start_char_offset: number;
    end_char_offset: number;
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
