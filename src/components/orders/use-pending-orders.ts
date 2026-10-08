'use client';

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';

/**
 * Live count of pending (new) orders of the active workspace, for the
 * sidebar badge. 0 when the orders module is off.
 */
export function usePendingOrders(): number {
  const { workspace, modules } = useWorkspace();
  const workspaceId = modules.orders ? workspace?.id : undefined;
  const [count, setCount] = useState(0);
  // The browser client is a singleton: each subscriber needs its own channel name.
  const instance = useId();

  useEffect(() => {
    if (!workspaceId) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const { count: n } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending');
      if (!cancelled && typeof n === 'number') setCount(n);
    };
    load();

    const channel = supabase
      .channel(`orders-pending-count:${workspaceId}:${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `workspace_id=eq.${workspaceId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, 400);
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, instance]);

  return workspaceId ? count : 0;
}
