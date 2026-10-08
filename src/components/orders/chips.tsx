'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';
import { createClient } from '@/lib/supabase/client';
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

const ATTACHMENT_SIGN_MARKER = '/storage/v1/object/sign/attachments/';

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
        const idx = url.indexOf(ATTACHMENT_SIGN_MARKER);
        if (idx >= 0) {
          const path = decodeURIComponent(url.slice(idx + ATTACHMENT_SIGN_MARKER.length).split('?')[0]);
          const { data, error } = await createClient().storage.from('attachments').createSignedUrl(path, 3600);
          if (error || !data?.signedUrl) throw error ?? new Error('sign');
          if (!cancelled) setState({ src: data.signedUrl, error: false });
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
