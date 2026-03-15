export interface User {
  id: string;
  name: string;
  created_at: string;
}

export interface PageListItem {
  id: string;
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
  confluence_page_id: string;
  confluence_url: string;
  title: string;
  space_key: string | null;
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
  text_before: string;
  text_after: string;
  status: 'active' | 'outdated' | 'lost';
  created_by: string;
  created_at: string;
  tests: TestLink[];
}

export interface DiffResponse {
  has_changes: boolean;
  diff_html: string;
  baseline_version: number;
  current_version: number;
}
