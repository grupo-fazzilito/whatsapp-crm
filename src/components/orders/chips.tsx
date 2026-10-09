'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';
import { signFile } from '@/lib/storage/client';
import { storagePathFromUrl } from '@/lib/storage/paths';
import { cn } from '@/lib/utils';
import { PAYMENT_TONE, STATUS_TONE, type OrderStatus, type PaymentStatus } from './types';

export function StatusChip({ status, className }: { status: OrderStatus; className?: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap', STATUS_TONE[status], className)}>
      {t(`orders.status.${status}`)}
    </span>
  );
}

export function PaymentChip({ status, className }: { status: PaymentStatus; className?: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap', PAYMENT_TONE[status], className)}>
      {t(`orders.payment.${status}`)}
    </span>
  );
}

/**
 * Renderable src for a stored media URL (payment proof): proxied media is
 * fetched with the session cookie, private attachments are re-signed,
 * anything else is used as is.
 */
export function useMediaSrc(url: string | null) {
  const [state, setState] = useState<{ src: string | null; error: boolean }>({ src: null, error: false });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    (async () => {
      try {
        if (url.startsWith('/api/whatsapp/media/') || url.startsWith('/api/media/')) {
          const res = await fetch(url);
          if (!res.ok) throw new Error('media');
          blobUrl = URL.createObjectURL(await res.blob());
          if (!cancelled) setState({ src: blobUrl, error: false });
          return;
        }
        // Private attachment (new /api/files or legacy Supabase URL): re-sign it.
        const path = storagePathFromUrl(url, 'attachments');
        if (path) {
          const signed = await signFile('attachments', path, { expiresIn: 3600 });
          if (!signed) throw new Error('sign');
          if (!cancelled) setState({ src: signed, error: false });
          return;
        }
        if (!cancelled) setState({ src: url, error: false });
      } catch {
        if (!cancelled) setState({ src: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  return state;
}
