'use client';

import { useEffect } from 'react';
import { useGcalReturnToast } from './use-gcal';

/** Renders nothing; announces the OAuth result. Mount inside <Suspense>. */
export function GcalReturnToast({ onConnected }: { onConnected?: () => void }) {
  const result = useGcalReturnToast();
  useEffect(() => {
    if (result === 'connected') onConnected?.();
  }, [result, onConnected]);
  return null;
}
