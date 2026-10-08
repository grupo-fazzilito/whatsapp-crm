'use client';

import { useCallback, useState } from 'react';
import type { FeedMapping } from '@/lib/real-estate/portals/feed/mapping';
import type { Preview, SourceBody } from './types';

/** Calls POST /api/real-estate/portals/preview and keeps the mapping being edited. */
export function usePreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<FeedMapping>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (source: SourceBody, extra: { item_path?: string | null; feed_id?: string; label?: string; mapping?: FeedMapping; deactivate_missing?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/real-estate/portals/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...source, ...extra }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(data.error ?? res.status));
          return null;
        }
        setPreview(data as Preview);
        setMapping((data as Preview).mapping);
        return data as Preview;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPreview(null);
    setMapping({});
    setError(null);
  }, []);

  return { preview, mapping, setMapping, loading, error, run, reset };
}
