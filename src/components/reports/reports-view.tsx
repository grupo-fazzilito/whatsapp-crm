'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingBlock, Notice, PageHeader, selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import type { Preset } from '@/lib/reports/range';
import type { ReportPayload } from '@/lib/reports/types';
import { VizStyles } from './charts';
import { AiSection, AttentionSection, SalesSection, TeamSection, VolumeSection } from './sections';
import { ReportSettingsDialog } from './settings-dialog';

const PRESET_OPTIONS: Exclude<Preset, 'custom'>[] = ['today', '7d', '30d', 'month'];
type Tab = 'attention' | 'volume' | 'team' | 'ai' | 'sales';
const KNOWN_ERRORS = new Set(['invalid_range', 'invalid_filter', 'Forbidden', 'Unauthorized']);

export function ReportsView() {
  const { t, locale } = useI18n();
  const { workspace, can, loading: wsLoading } = useWorkspace();
  const isAdmin = can('admin');

  const [preset, setPreset] = useState<Preset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [channel, setChannel] = useState('');
  const [agent, setAgent] = useState('');
  const [team, setTeam] = useState('');
  const [tab, setTab] = useState<Tab>('attention');
  const [data, setData] = useState<ReportPayload | null>(null);
  const [done, setDone] = useState<{ key: string; error: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === 'custom') {
      if (!applied) return null;
      p.set('from', applied.from);
      p.set('to', applied.to);
    }
    if (channel) p.set('channel', channel);
    if (agent) p.set('agent', agent);
    if (team) p.set('team', team);
    return p.toString();
  }, [preset, applied, channel, agent, team]);

  const requestKey = query === null || !workspace ? null : `${workspace.id}|${query}#${reloadKey}`;
  const loading = wsLoading || (requestKey !== null && done?.key !== requestKey);
  const error = done?.key === requestKey ? done.error : null;

  useEffect(() => {
    if (wsLoading || query === null || requestKey === null) return;
    const ctrl = new AbortController();
    fetch(`/api/reports?${query}`, { signal: ctrl.signal, cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? 'error');
        setData(json as ReportPayload);
        setDone({ key: requestKey, error: null });
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setDone({ key: requestKey, error: e.message });
      });
    return () => ctrl.abort();
  }, [query, requestKey, wsLoading]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const customInvalid = preset === 'custom' && (!customFrom || !customTo || customFrom > customTo);
  const personal = data?.scope === 'personal' || (!wsLoading && !isAdmin);
  const showAi = !personal && !!data?.ai;
  const showSales = !personal && !!data?.sales;
  const activeTab: Tab = (tab === 'ai' && !showAi) || (tab === 'sales' && !showSales) ? 'attention' : tab;

  const rangeText = data
    ? `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${data.range.fromDate}T00:00:00Z`))} – ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${data.range.toDate}T00:00:00Z`))}`
    : '';

  return (
    <div className="rpt-viz flex flex-col gap-5">
      <VizStyles />
      <PageHeader
        title={personal ? t('reports.personalTitle') : t('reports.title')}
        description={personal ? t('reports.personalDescription') : t('reports.description')}
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden />
              {t('reports.refresh')}
            </Button>
            {isAdmin && (
              <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-3.5" aria-hidden />
                {t('reports.settings.button')}
              </Button>
            )}
          </>
        }
      />

      <form
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        aria-label={t('reports.filters.label')}
        onSubmit={(e) => {
          e.preventDefault();
          if (!customInvalid) setApplied({ from: customFrom, to: customTo });
        }}
      >
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{t('reports.filters.period')}</legend>
          {PRESET_OPTIONS.map((p) => (
            <Button key={p} type="button" size="sm" variant={preset === p ? 'default' : 'outline'} aria-pressed={preset === p} onClick={() => setPreset(p)}>
              {t(`reports.presets.${p}`)}
            </Button>
          ))}
          <Button type="button" size="sm" variant={preset === 'custom' ? 'default' : 'outline'} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            <CalendarRange className="size-3.5" aria-hidden />
            {t('reports.presets.custom')}
          </Button>
        </fieldset>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rpt-from">{t('reports.filters.from')}</Label>
              <Input id="rpt-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rpt-to">{t('reports.filters.to')}</Label>
              <Input id="rpt-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" />
            </div>
            <Button type="submit" size="sm" disabled={customInvalid}>
              {t('reports.filters.apply')}
            </Button>
            {!applied && <p className="text-xs text-muted-foreground">{t('reports.filters.customHint')}</p>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rpt-channel">{t('reports.filters.channel')}</Label>
            <select id="rpt-channel" className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">{t('reports.filters.allChannels')}</option>
              {data?.options.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {!personal && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rpt-agent">{t('reports.filters.agent')}</Label>
              <select id="rpt-agent" className={selectClass} value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">{t('reports.filters.allAgents')}</option>
                {data?.options.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || t('reports.unknownMember')}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!personal && !!data?.options.teams?.length && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rpt-team">{t('reports.filters.team')}</Label>
              <select id="rpt-team" className={selectClass} value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">{t('reports.filters.allTeams')}</option>
                {data.options.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {data && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('reports.rangeInfo', { range: rangeText, tz: data.range.timeZone })}
          </p>
        )}
      </form>

      {error && (
        <Notice className="flex items-center gap-2 border-destructive/40 text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {t(KNOWN_ERRORS.has(error) ? `reports.errors.${error}` : 'reports.errors.generic')}
        </Notice>
      )}
      {data?.truncated && <Notice>{t('reports.truncated')}</Notice>}

      {query === null ? (
        <Notice>{t('reports.filters.customHint')}</Notice>
      ) : !data ? (
        loading ? <LoadingBlock /> : null
      ) : (
        <div className={cn('relative', loading && 'opacity-60 transition-opacity')} aria-busy={loading}>
          {loading && (
            <span className="sr-only" role="status">
              {t('reports.loading')}
            </span>
          )}
          {loading && <Loader2 className="absolute right-2 top-2 size-4 animate-spin text-muted-foreground" aria-hidden />}
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="h-auto w-full max-w-full justify-start overflow-x-auto sm:w-fit">
              <TabsTrigger value="attention" className="min-h-8 flex-none px-3">{t('reports.tabs.attention')}</TabsTrigger>
              <TabsTrigger value="volume" className="min-h-8 flex-none px-3">{t('reports.tabs.volume')}</TabsTrigger>
              <TabsTrigger value="team" className="min-h-8 flex-none px-3">{personal ? t('reports.tabs.me') : t('reports.tabs.team')}</TabsTrigger>
              {showAi && <TabsTrigger value="ai" className="min-h-8 flex-none px-3">{t('reports.tabs.ai')}</TabsTrigger>}
              {showSales && <TabsTrigger value="sales" className="min-h-8 flex-none px-3">{t('reports.tabs.sales')}</TabsTrigger>}
            </TabsList>
            <TabsContent value="attention" className="mt-4">
              <AttentionSection data={data} />
            </TabsContent>
            <TabsContent value="volume" className="mt-4">
              <VolumeSection data={data} />
            </TabsContent>
            <TabsContent value="team" className="mt-4">
              <TeamSection data={data} />
            </TabsContent>
            {showAi && (
              <TabsContent value="ai" className="mt-4">
                <AiSection data={data} />
              </TabsContent>
            )}
            {showSales && (
              <TabsContent value="sales" className="mt-4">
                <SalesSection data={data} />
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}

      {isAdmin && data && (
        <ReportSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          slaMinutes={data.settings.slaMinutes}
          usdRate={data.settings.usdRate}
          currency={data.settings.currency}
          onSaved={reload}
        />
      )}
    </div>
  );
}
