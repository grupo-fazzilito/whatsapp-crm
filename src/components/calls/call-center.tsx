'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useRealtimeChanges } from '@/lib/realtime/client';
import { Button } from '@/components/ui/button';
import { formatDuration, isLive } from '@/lib/calls/model';
import { answerOffer, startRinging, type BrowserCall } from '@/lib/calls/webrtc';

interface LiveCall {
  id: string;
  conversation_id: string | null;
  status: string;
  answered_by: string | null;
  answered_at: string | null;
  created_at: string;
  contacts?: { name: string | null; phone: string | null } | null;
}

async function post(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/calls/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as { sdp_offer?: string; error?: string; message?: string | null } };
}

/**
 * WhatsApp calls for the whole dashboard: rings when a customer calls,
 * lets the first agent answer from the browser, and shows the call bar.
 */
export function CallCenter() {
  const t = useT();
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'connecting' | 'talking' | null>(null);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rtc = useRef<BrowserCall | null>(null);
  const userId = user?.id ?? null;

  const activeRef = useRef<string | null>(null);

  const fetchCalls = useCallback(
    () =>
      fetch('/api/calls')
        .then((res) => (res.ok ? (res.json() as Promise<{ calls?: LiveCall[] }>) : null))
        .catch(() => null),
    [],
  );

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    void fetchCalls().then((data) => {
      if (data && !cancelled) setCalls(data.calls ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, fetchCalls]);

  const cleanup = useCallback(() => {
    const current = rtc.current;
    rtc.current = null;
    activeRef.current = null;
    current?.close();
    setActiveId(null);
    setPhase(null);
    setMuted(false);
  }, []);

  useRealtimeChanges<LiveCall>({
    workspaceId: workspace?.id,
    tables: ['whatsapp_calls'],
    onChange: (change) => {
      const row = change.new;
      // A new call: reload to get the caller's name.
      if (change.eventType === 'INSERT') {
        void fetchCalls().then((data) => data && setCalls(data.calls ?? []));
        return;
      }
      // The other side hung up (or Meta ended it) while I was on it.
      if (row.id && row.id === activeRef.current && !isLive(row.status)) {
        toast(t('calls.ended'));
        cleanup();
      }
      setCalls((prev) => {
        const rest = prev.filter((c) => c.id !== row.id);
        if (!row.id || !isLive(row.status)) return rest;
        const old = prev.find((c) => c.id === row.id);
        return [...rest, { ...old, ...row, contacts: old?.contacts ?? null }].sort((x, y) => x.created_at.localeCompare(y.created_at));
      });
    },
  });

  const active = calls.find((c) => c.id === activeId) ?? null;
  const ringing = calls.filter((c) => c.status === 'ringing');
  const shouldRing = ringing.length > 0 && !activeId;
  useEffect(() => {
    if (!shouldRing) return;
    return startRinging();
  }, [shouldRing]);

  useEffect(() => {
    if (phase !== 'talking') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!activeId) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t('calls.leaveWarning');
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [activeId, t]);

  useEffect(() => () => rtc.current?.close(), []);

  async function answer(call: LiveCall) {
    if (activeId || !audioRef.current) return;
    activeRef.current = call.id;
    setActiveId(call.id);
    setPhase('connecting');
    const claim = await post(call.id, { action: 'claim' });
    if (!claim.ok || !claim.data.sdp_offer) {
      toast.error(claim.status === 409 ? t('calls.taken') : t('calls.goneAway'));
      return cleanup();
    }
    let browser: BrowserCall;
    try {
      browser = await answerOffer(claim.data.sdp_offer, audioRef.current);
    } catch (err) {
      await post(call.id, { action: 'release' });
      toast.error(err instanceof Error && err.message === 'microphone' ? t('calls.microphone') : t('calls.failed', { message: String(err) }));
      return cleanup();
    }
    rtc.current = browser;
    // The audio path died on its own (network): end the call for everyone.
    browser.onEnded(() => {
      if (rtc.current !== browser) return;
      cleanup();
      void post(call.id, { action: 'hangup' });
    });
    const sdp = browser.answerSdp;
    const pre = await post(call.id, { action: 'pre_accept', sdp });
    if (!pre.ok) {
      toast.error(t('calls.failed', { message: pre.data.message ?? pre.data.error ?? pre.status }));
      return cleanup();
    }
    await browser.connected;
    const acc = await post(call.id, { action: 'accept', sdp });
    if (!acc.ok) {
      toast.error(t('calls.failed', { message: acc.data.message ?? acc.data.error ?? acc.status }));
      return cleanup();
    }
    browser.startSending();
    setPhase('talking');
  }

  async function reject(call: LiveCall) {
    setCalls((prev) => prev.filter((c) => c.id !== call.id));
    await post(call.id, { action: 'reject' });
  }

  async function hangup() {
    if (!activeId) return;
    const id = activeId;
    cleanup();
    await post(id, { action: 'hangup' });
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    rtc.current?.setMuted(m);
  }

  const nameOf = (c: LiveCall) => c.contacts?.name || c.contacts?.phone || t('calls.unknown');
  const startedAt = active?.answered_at ? Date.parse(active.answered_at) : null;
  // Someone else's call in progress isn't shown; only ringing ones and mine.
  const visibleRinging = activeId ? [] : ringing;
  const mine = active && (active.answered_by === userId || phase) ? active : null;

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      {(visibleRinging.length > 0 || mine) && (
        <div className="fixed bottom-4 right-4 z-50 grid w-[min(22rem,calc(100vw-2rem))] gap-2" role="region" aria-label={t('calls.incoming')}>
          {visibleRinging.map((c) => (
            <div key={c.id} role="alertdialog" aria-label={t('calls.from', { name: nameOf(c) })} className="rounded-xl border border-emerald-500/40 bg-background p-3 shadow-lg">
              <p className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Phone className="size-3.5 animate-pulse" aria-hidden />
                {t('calls.incoming')}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">{t('calls.from', { name: nameOf(c) })}</p>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void answer(c)}>
                  <Phone className="size-4" aria-hidden />
                  {t('calls.answer')}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => void reject(c)}>
                  <PhoneOff className="size-4" aria-hidden />
                  {t('calls.reject')}
                </Button>
              </div>
            </div>
          ))}
          {mine && (
            <div role="status" className="rounded-xl border border-border bg-background p-3 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{phase === 'talking' ? t('calls.inCall') : t('calls.connecting')}</p>
                  <p className="truncate text-sm font-semibold text-foreground">{nameOf(mine)}</p>
                </div>
                {phase === 'talking' && startedAt && (
                  <span className="font-mono text-sm tabular-nums text-foreground">{formatDuration((now - startedAt) / 1000)}</span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={toggleMute} disabled={phase !== 'talking'} aria-pressed={muted}>
                  {muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
                  {muted ? t('calls.unmute') : t('calls.mute')}
                </Button>
                {mine.conversation_id && (
                  <Button variant="outline" size="sm" render={<Link href={`/inbox?c=${mine.conversation_id}`} />}>
                    {t('calls.openChat')}
                  </Button>
                )}
                <Button size="sm" className="ml-auto bg-red-600 text-white hover:bg-red-700" onClick={() => void hangup()}>
                  <PhoneOff className="size-4" aria-hidden />
                  {t('calls.hangup')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
