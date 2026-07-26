export interface User {
  id: string;
  name: string;
  created_at: string;
}

/** Пользователь текущей сессии (GET /api/auth/me). */
export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
}

/** Проект: Confluence-сервер + личные креды участников (v1.5.1). */
export interface Project {
  id: string;
  name: string;
  confluence_base_url: string;
  jira_base_url: string | null;
  joined: boolean;
  my_status: 'ok' | 'invalid' | 'unchecked' | null;
  my_username: string | null;
  last_check_at: string | null;
  /** Исход последней попытки проверки; unreachable — Confluence был недоступен (VPN, сеть). */
  my_last_check_result: 'ok' | 'invalid' | 'unreachable' | null;
  /** Jira-токен участника (v1.7.0): ok | invalid; null — токена нет. */
  my_jira_token_status?: 'ok' | 'invalid' | null;
}

export interface CredentialCheckResult {
  status: 'ok' | 'invalid';
  last_check_at: string;
}

export interface PageListItem {
  id: string;
  project_id: string;
  confluence_page_id: string;
  confluence_url: string;
  title: string;
  space_key: string | null;
  created_at: string;
  last_snapshot_at: string | null;
  baseline_at: string | null;
  coverage_percent: number;
  has_updates: boolean;
}

export interface SnapshotInfo {
  id: string;
  confluence_version: number;
  fetched_at: string;
}

export interface BaselineInfo {
  id: string;
  snapshot_id: string;
  confirmed_by: string;
  confirmed_at: string;
}

export interface PageDetail {
  id: string;
  project_id: string;
  project_name: string;
  /** Jira проекта страницы — из него строятся ссылки на тест-кейсы. */
  jira_base_url: string;
  confluence_page_id: string;
  confluence_url: string;
  title: string;
  space_key: string | null;
  is_virtual: boolean;
  created_at: string;
  current_snapshot: SnapshotInfo | null;
  baseline: BaselineInfo | null;
  content_html: string | null;
}

export interface TestLink {
  id: string;
  test_key: string;
  created_by: string;
  created_at: string;
  /** Название теста из Jira (v1.7.0); нет — показывается только ключ. */
  summary?: string | null;
  /** Итог похода в Jira: not_found — задачи нет (чип серый, без ссылки);
   *  null/undefined — в Jira не ходили. */
  jira_status?: 'ok' | 'not_found' | 'error' | null;
  /** Ответ создания привязки: false — Jira не нашла задачу (вероятна
   *  опечатка), null/undefined — проверка не выполнялась (нет токена). */
  jira_found?: boolean | null;
}

export interface Highlight {
  id: string;
  page_id: string;
  snapshot_id: string;
  start_xpath: string;
  start_offset: number;
  end_xpath: string;
  end_offset: number;
  text_content: string;
  /** Текущий текст под маркером в актуальном снимке (v1.5.9); text_content —
   * замороженная цитата. null — привязка ещё не проходила refresh по новой
   * модели, читатели используют text_content. */
  anchored_text: string | null;
  text_before: string;
  text_after: string;
  anchor_block_start: number | null;
  anchor_block_end: number | null;
  start_char_offset: number | null;
  end_char_offset: number | null;
  status: 'active' | 'outdated' | 'lost';
  created_by: string;
  created_by_name: string;
  created_at: string;
  reanchored_by: string | null;
  reanchored_by_name: string | null;
  reanchored_at: string | null;
  tests: TestLink[];
}

export interface TreeNodeItem {
  id: string;
  confluence_page_id: string;
  title: string;
  space_key: string | null;
  is_virtual: boolean;
  parent_confluence_page_id: string | null;
  highlights_active: number;
  highlights_outdated: number;
  highlights_lost: number;
  has_updates: boolean;
}

export interface SpaceTree {
  space_key: string;
  pages: TreeNodeItem[];
}

/** Верхний уровень дерева — проект пользователя (v1.5.1).
 *  no_access=true (креды невалидны) — спейсы не приходят, UI показывает замок. */
export interface ProjectTree {
  project_id: string;
  project_name: string;
  is_demo: boolean;
  no_access: boolean;
  spaces: SpaceTree[];
}

export interface TreeSyncResult {
  spaces: number;
  moved: number;
  added: number;
  removed: number;
  missing_tracked: number;
}

export interface DiffResponse {
  has_changes: boolean;
  diff_html: string;
  baseline_version: number;
  current_version: number;
}

// --- Экран «Тесты» (v1.6.1): реверс-индекс «ключ → привязки» ---

export interface ProjectTestsStats {
  project_id: string;
  project_name: string;
  is_demo: boolean;
  pages: number;
  highlights: number;
  covered: number;
  tests: number;
  active: number;
  outdated: number;
  lost: number;
  /** Когда автообновление в последний раз проверяло проект (v1.6.2); null — ещё ни разу. */
  last_auto_refresh_at?: string | null;
  /** Последняя попытка любого исхода (v1.6.4); reason заполнен
   *  (confluence_unreachable | no_valid_credentials) — попытка не удалась,
   *  и свежесть застыла не просто так. */
  last_attempt_at?: string | null;
  last_attempt_reason?: string | null;
}

// --- Уведомления (v1.6.3): дайджест ночных прогонов ---

export interface NotificationEntry {
  /** Стабильный ключ записи: "<run_id>:digest|cred|skip|quiet". */
  id: string;
  kind: 'digest' | 'cred_invalid' | 'run_skipped' | 'run_quiet';
  project_id: string;
  project_name: string;
  happened_at: string;
  unseen: boolean;
  pages_total: number;
  pages_changed: number;
  pages_failed: number;
  to_outdated: number;
  to_lost: number;
  affected_tests: string[];
  /** Названия страниц, не обновившихся в прогоне, — дайджест называет их
   *  поимённо, а не абстрактным числом (v1.7.2). */
  failed_pages?: string[];
  /** confluence_unreachable | no_valid_credentials (у digest — если прогон прерван). */
  skipped_reason?: string | null;
  /** run_skipped и run_quiet — состояния («не обновляется» / «изменений нет,
   *  слежение живо», v1.6.5): длина хвостовой серии одинаковых исходов —
   *  и неудачи, и тихие дни схлопываются в одну живую строку. */
  attempts?: number;
  /** Начало серии; happened_at — её последняя попытка/прогон. */
  first_attempt_at?: string | null;
}

export interface NotificationsResponse {
  unseen_count: number;
  entries: NotificationEntry[];
}

/** Прогон, идущий прямо сейчас (индикатор у колокольчика, v1.6.4). */
export interface RunningRun {
  id: string;
  project_id: string;
  project_name: string;
  trigger: string;
  started_at: string;
}

/** Итог последнего завершённого прогона — показывается индикатором пару
 *  секунд, даже когда бейджу загораться не от чего. */
export interface FinishedRunSummary {
  id: string;
  project_id: string;
  project_name: string;
  status: string;
  finished_at: string;
  pages_changed: number;
  pages_failed: number;
  to_outdated: number;
  to_lost: number;
  skipped_reason?: string | null;
}

export interface RefreshStatusResponse {
  running: RunningRun[];
  last_finished?: FinishedRunSummary | null;
}

export interface TestLinkRef {
  link_id: string;
  highlight_id: string;
  page_id: string;
  page_title: string;
  status: 'active' | 'outdated' | 'lost';
  excerpt: string;
}

export interface TestIndexEntry {
  key: string;
  links: TestLinkRef[];
  /** Название теста из Jira (v1.7.0); нет — показывается только ключ. */
  summary?: string | null;
  /** not_found — задачи нет в Jira: ключ серый, без ссылки. */
  jira_status?: 'ok' | 'not_found' | 'error' | null;
}

export interface ProjectTestIndex {
  project_id: string;
  project_name: string;
  jira_base_url: string | null;
  tests: TestIndexEntry[];
}
