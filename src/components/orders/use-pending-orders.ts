'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useRealtimeChanges } from '@/lib/realtime/client';

/**
 * Live count of pending (new) orders of the active workspace, for the
 * sidebar badge. 0 when the orders module is off.
 */
export function usePendingOrders(): number {
  const { workspace, modules } = useWorkspace();
  const workspaceId = modules.orders ? workspace?.id : undefined;
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetch('/api/orders/pending-count', { cache: 'no-store' }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { count?: number } | null) : null;
      if (!cancelled && typeof body?.count === 'number') setCount(body.count);
    };
    loadRef.current = () => void load();
    void load();
    return () => {
      cancelled = true;
      loadRef.current = () => undefined;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workspaceId]);

  useRealtimeChanges({
    workspaceId,
    tables: ['orders'],
    onChange: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => loadRef.current(), 400);
    },
  });

  return workspaceId ? count : 0;
}
