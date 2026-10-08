'use client';

/**
 * Asks the server to push booking changes to Google Calendar now (the
 * cron would do it later anyway). Fire-and-forget; never throws. Without
 * bookingId it flushes the workspace's queue (e.g. after a delete).
 */
export function pushGoogleSync(bookingId?: string) {
  try {
    void fetch('/api/business/bookings/google-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingId ? { bookingId } : {}),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
