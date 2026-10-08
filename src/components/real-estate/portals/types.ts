import type { FeedMapping } from '@/lib/real-estate/portals/feed/mapping';
import type { FlatValue } from '@/lib/real-estate/portals/feed/parse';

export type PortalName = 'urbania' | 'adondevivir' | 'mercadolibre' | 'own_crm' | 'other';
export const PORTAL_NAMES: PortalName[] = ['urbania', 'adondevivir', 'mercadolibre', 'own_crm', 'other'];

export interface Feed {
  id: string;
  name: string;
  portal: PortalName;
  url: string;
  format: 'auto' | 'xml' | 'json' | 'csv';
  mapping: FeedMapping;
  item_path: string | null;
  schedule: 'manual' | 'daily';
  deactivate_missing: boolean;
  last_run_at: string | null;
}

export interface Run {
  id: string;
  source: 'mercadolibre' | 'feed' | 'file';
  feed_id: string | null;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'success' | 'partial' | 'error';
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  failed: number;
  errors: { ref: string; error: string }[];
  notes: { foreign_currency?: number; images_copied?: number; images_failed?: number; deactivation_skipped?: boolean };
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Overview {
  mercadolibre: {
    available: boolean;
    site_id: string;
    connection: {
      nickname: string | null;
      user_id: string;
      site_id: string | null;
      status: 'active' | 'error' | 'revoked';
      last_error: string | null;
      auto_import: boolean;
      last_import_at: string | null;
      connected_at: string;
    } | null;
  };
  feeds: Feed[];
  runs: Run[];
  imported: number;
}

export interface PreviewRow {
  row: number;
  ref: string;
  name: string;
  price: number | null;
  currency?: string | null;
  action: 'create' | 'update' | 'error';
  errors: { field: string; code: string }[];
  images: number;
}

export interface Preview {
  format: 'xml' | 'json' | 'csv';
  item_path: string;
  fields: string[];
  samples: Record<string, FlatValue>[];
  total: number;
  mapping: FeedMapping;
  plan: {
    creates: number;
    updates: number;
    errors: number;
    missing: number;
    foreign_currency: number;
    without_id: number;
    rows: PreviewRow[];
  };
}

/** Body sent to /preview and /file: a URL, raw text or records parsed in the browser. */
export type SourceBody = { url: string } | { text: string; format?: string } | { records: Record<string, FlatValue>[] };
