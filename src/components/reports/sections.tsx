'use client';

import Link from 'next/link';
import { Info } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { csvFileName } from '@/lib/reports/csv';
import { formatCount, formatDuration, formatPercent, formatUsd, minutesValue, shortDay } from '@/lib/reports/format';
import type { AgentRow, AiAgentRow, ChannelVolume, ReportPayload, StatusRow } from '@/lib/reports/types';
import { BarList, Heatmap, Legend, LineChart, StackBar, StatTile } from './charts';
import { DataTable, ReportCard } from './data-table';

const S_IN = 'var(--rpt-s1)';
const S_AGENT = 'var(--rpt-s2)';
const S_BOT = 'var(--rpt-s3)';
const S_BOTH = 'var(--rpt-s4)';
const S_NONE = 'var(--rpt-none)';

function useFmt(data: ReportPayload) {
  const { t, locale } = useI18n();
  const numLocale = moneyLocale({ locale, country: data.settings.country });
  const file = (name: string) => csvFileName(name, data.range.fromDate, data.range.toDate);
  return {
    t,
    locale,
    numLocale,
    file,
    n: (v: number) => formatCount(v, numLocale),
    pct: (v: number | null) => formatPercent(v, numLocale),
    dur: formatDuration,
    money: (v: number) => formatMoney(v, data.settings.currency, numLocale),
    usd: (v: number) => formatUsd(v, numLocale),
  };
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{children}</div>;
}

function Definitions({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
        <Info className="size-4" aria-hidden />
        {t('reports.definitions.title')}
      </summary>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------
// Attention
// ------------------------------------------------------------------
export function AttentionSection({ data }: { data: ReportPayload }) {
  const f = useFmt(data);
  const { t } = f;
  const a = data.attention;
  const basisKey = `reports.attention.basis.${a.resolution.basis}`;
  const since = (iso: string) => formatDuration(Date.parse(data.generatedAt) - Date.parse(iso));
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <StatTile label={t('reports.attention.started')} value={f.n(a.conversationsStarted)} sub={t('reports.attention.sessionsSub', { count: f.n(a.sessions) })} />
        <StatTile
          label={t('reports.attention.firstResponse')}
          value={f.dur(a.medianFirstResponseMs)}
          sub={t('reports.attention.p90', { value: f.dur(a.p90FirstResponseMs) })}
        />
        <StatTile
          label={t('reports.attention.firstHuman')}
          value={f.dur(a.medianHumanResponseMs)}
          sub={t('reports.attention.p90', { value: f.dur(a.p90HumanResponseMs) })}
        />
        <StatTile
          label={t('reports.attention.sla', { minutes: data.settings.slaMinutes })}
          value={f.pct(a.slaRate)}
          sub={t('reports.attention.slaSub', { within: f.n(a.withinSla), total: f.n(a.slaEligible) })}
        />
        <StatTile
          label={t('reports.attention.resolution')}
          value={f.dur(a.resolution.medianMs)}
          sub={t('reports.attention.resolutionSub', { p90: f.dur(a.resolution.p90Ms), count: f.n(a.resolution.resolved) })}
        />
        <StatTile label={t('reports.attention.answered')} value={f.n(a.answered)} sub={t('reports.attention.answeredSub', { bot: f.n(a.answeredByBot), agent: f.n(a.answeredByAgent) })} />
        <StatTile label={t('reports.attention.unansweredSessions')} value={f.n(a.unansweredSessions)} sub={t('reports.attention.unansweredSessionsSub')} />
        <StatTile
          label={t('reports.attention.unansweredNow')}
          value={f.n(a.unansweredNow.count)}
          sub={a.unansweredNow.oldestSince ? t('reports.attention.oldestWaiting', { value: since(a.unansweredNow.oldestSince) }) : t('reports.attention.nobodyWaiting')}
        />
      </Grid>

      {data.calls && (
        <ReportCard title={t('reports.calls.title')}>
          <Grid>
            <StatTile label={t('reports.calls.total')} value={f.n(data.calls.total)} />
            <StatTile
              label={t('reports.calls.answered')}
              value={f.n(data.calls.answered)}
              sub={t('reports.calls.answeredSub', { rate: f.pct(data.calls.answered / data.calls.total) })}
            />
            <StatTile label={t('reports.calls.missed')} value={f.n(data.calls.missed)} sub={t('reports.calls.missedSub', { rejected: f.n(data.calls.rejected) })} />
            <StatTile
              label={t('reports.calls.talk')}
              value={f.dur(data.calls.talkSeconds * 1000)}
              sub={t('reports.calls.talkSub', { value: f.dur(data.calls.medianSeconds === null ? null : data.calls.medianSeconds * 1000) })}
            />
          </Grid>
        </ReportCard>
      )}

      <ReportCard title={t('reports.attention.waitingTitle')} description={t('reports.attention.waitingDescription')}>
        <DataTable
          caption={t('reports.attention.waitingTitle')}
          csvName={f.file('sin-responder')}
          empty={t('reports.attention.nobodyWaiting')}
          rows={a.unansweredNow.waiting}
          rowKey={(r) => r.conversationId}
          columns={[
            {
              key: 'contact',
              label: t('reports.cols.contact'),
              render: (r) => (
                <Link href={`/inbox?c=${r.conversationId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {r.contact || t('reports.unknownContact')}
                </Link>
              ),
              csv: (r) => r.contact ?? '',
            },
            { key: 'channel', label: t('reports.cols.channel'), render: (r) => r.channelName ?? '—', csv: (r) => r.channelName ?? '' },
            { key: 'assignee', label: t('reports.cols.assignee'), render: (r) => r.assignee ?? t('reports.unassigned'), csv: (r) => r.assignee ?? '' },
            { key: 'waiting', label: t('reports.cols.waiting'), align: 'right', render: (r) => since(r.since), csv: (r) => minutesValue(Date.parse(data.generatedAt) - Date.parse(r.since)) },
            { key: 'since', label: t('reports.cols.since'), render: (r) => new Date(r.since).toLocaleString(f.numLocale, { timeZone: data.range.timeZone }), csv: (r) => r.since },
          ]}
        />
      </ReportCard>

      <Definitions>
        <p>{t('reports.definitions.session')}</p>
        <p>{t('reports.definitions.firstResponse')}</p>
        <p>{t('reports.definitions.sla', { minutes: data.settings.slaMinutes })}</p>
        <p>
          {t('reports.definitions.resolution')} <strong className="font-medium text-foreground">{t(basisKey)}</strong>
        </p>
        <p>{t('reports.definitions.unanswered')}</p>
      </Definitions>
    </div>
  );
}

// ------------------------------------------------------------------
// Volume
// ------------------------------------------------------------------
export function VolumeSection({ data }: { data: ReportPayload }) {
  const f = useFmt(data);
  const { t, locale } = f;
  const v = data.volume;
  const series = [
    { key: 'inbound', label: t('reports.volume.inbound'), color: S_IN },
    { key: 'agent', label: t('reports.volume.agent'), color: S_AGENT },
    { key: 'bot', label: t('reports.volume.bot'), color: S_BOT },
  ];
  const days = t('reports.days').split(',');
  let peak = { d: 0, h: 0, v: 0 };
  v.heatmap.forEach((row, d) => row.forEach((val, h) => (val > peak.v ? (peak = { d, h, v: val }) : null)));
  const channelName = (c: ChannelVolume) => c.name || t('reports.noChannel');
  const purposeLabel = (p: string) => (p === 'none' ? t('reports.purposeNone') : t(`channels.purposes.${p}`));
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <StatTile label={t('reports.volume.inbound')} value={f.n(v.totals.inbound)} />
        <StatTile label={t('reports.volume.agent')} value={f.n(v.totals.agent)} />
        <StatTile label={t('reports.volume.bot')} value={f.n(v.totals.bot)} />
        <StatTile
          label={t('reports.volume.peak')}
          value={peak.v > 0 ? `${days[peak.d]} ${hourLabel(peak.h)}` : '—'}
          sub={peak.v > 0 ? t('reports.volume.peakSub', { count: f.n(peak.v) }) : undefined}
        />
      </Grid>

      <ReportCard title={t('reports.volume.byDayTitle')} description={t('reports.volume.byDayDescription')} action={<Legend items={series} />}>
        <LineChart
          labels={v.byDay.map((d) => d.day)}
          series={series}
          data={v.byDay.map((d) => ({ inbound: d.inbound, agent: d.agent, bot: d.bot }))}
          ariaLabel={t('reports.volume.byDayAria', { inbound: f.n(v.totals.inbound), out: f.n(v.totals.agent + v.totals.bot) })}
          formatLabel={(l) => shortDay(l, locale)}
          formatValue={f.n}
        />
        <DataTable
          caption={t('reports.volume.byDayTitle')}
          csvName={f.file('mensajes-por-dia')}
          collapsible
          empty={t('reports.empty')}
          rows={v.byDay}
          rowKey={(r) => r.day}
          columns={[
            { key: 'day', label: t('reports.cols.day'), render: (r) => shortDay(r.day, locale), csv: (r) => r.day },
            { key: 'inbound', label: t('reports.volume.inbound'), align: 'right', render: (r) => f.n(r.inbound), csv: (r) => r.inbound },
            { key: 'agent', label: t('reports.volume.agent'), align: 'right', render: (r) => f.n(r.agent), csv: (r) => r.agent },
            { key: 'bot', label: t('reports.volume.bot'), align: 'right', render: (r) => f.n(r.bot), csv: (r) => r.bot },
          ]}
        />
      </ReportCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard title={t('reports.volume.byChannelTitle')} description={t('reports.volume.byChannelDescription')}>
          <BarList
            ariaLabel={t('reports.volume.byChannelTitle')}
            rows={v.byChannel.map((c) => ({ label: channelName(c), value: c.inbound + c.agent + c.bot }))}
            formatValue={f.n}
          />
          <DataTable
            caption={t('reports.volume.byChannelTitle')}
            csvName={f.file('mensajes-por-canal')}
            empty={t('reports.empty')}
            rows={v.byChannel}
            rowKey={(r, i) => r.channelId ?? `none-${i}`}
            columns={[
              { key: 'name', label: t('reports.cols.channel'), render: channelName },
              { key: 'purpose', label: t('reports.cols.purpose'), render: (r) => purposeLabel(r.purpose || 'none') },
              { key: 'conversations', label: t('reports.cols.conversations'), align: 'right', render: (r) => f.n(r.conversations), csv: (r) => r.conversations },
              { key: 'inbound', label: t('reports.volume.inbound'), align: 'right', render: (r) => f.n(r.inbound), csv: (r) => r.inbound },
              { key: 'agent', label: t('reports.volume.agent'), align: 'right', render: (r) => f.n(r.agent), csv: (r) => r.agent },
              { key: 'bot', label: t('reports.volume.bot'), align: 'right', render: (r) => f.n(r.bot), csv: (r) => r.bot },
            ]}
          />
        </ReportCard>

        <ReportCard title={t('reports.volume.byPurposeTitle')} description={t('reports.volume.byPurposeDescription')}>
          <BarList
            ariaLabel={t('reports.volume.byPurposeTitle')}
            rows={v.byPurpose.map((p) => ({ label: purposeLabel(p.purpose), value: p.inbound }))}
            formatValue={f.n}
          />
          <DataTable
            caption={t('reports.volume.byPurposeTitle')}
            csvName={f.file('mensajes-por-proposito')}
            empty={t('reports.empty')}
            rows={v.byPurpose}
            rowKey={(r) => r.purpose}
            columns={[
              { key: 'purpose', label: t('reports.cols.purpose'), render: (r) => purposeLabel(r.purpose) },
              { key: 'inbound', label: t('reports.volume.inbound'), align: 'right', render: (r) => f.n(r.inbound), csv: (r) => r.inbound },
              { key: 'outbound', label: t('reports.volume.outbound'), align: 'right', render: (r) => f.n(r.outbound), csv: (r) => r.outbound },
            ]}
          />
        </ReportCard>
      </div>

      <ReportCard title={t('reports.volume.heatmapTitle')} description={t('reports.volume.heatmapDescription', { tz: data.range.timeZone })}>
        <Heatmap
          matrix={v.heatmap}
          dayLabels={days}
          ariaLabel={
            peak.v > 0
              ? t('reports.volume.heatmapAria', { day: days[peak.d], hour: hourLabel(peak.h), count: f.n(peak.v) })
              : t('reports.empty')
          }
          cellTitle={(d, h, val) => `${days[d]} ${hourLabel(h)}: ${f.n(val)}`}
          lessLabel={t('reports.volume.less')}
          moreLabel={t('reports.volume.more')}
        />
        <DataTable
          caption={t('reports.volume.heatmapTitle')}
          csvName={f.file('horas-pico')}
          collapsible
          empty={t('reports.empty')}
          rows={v.heatmap.map((row, d) => ({ d, row }))}
          rowKey={(r) => String(r.d)}
          columns={[
            { key: 'day', label: t('reports.cols.dayOfWeek'), render: (r) => days[r.d] },
            ...Array.from({ length: 24 }, (_, h) => ({
              key: `h${h}`,
              label: String(h),
              align: 'right' as const,
              render: (r: { d: number; row: number[] }) => (r.row[h] ? f.n(r.row[h]) : '·'),
              csv: (r: { d: number; row: number[] }) => r.row[h],
            })),
          ]}
        />
      </ReportCard>
    </div>
  );
}

// ------------------------------------------------------------------
// Team
// ------------------------------------------------------------------
export function TeamSection({ data }: { data: ReportPayload }) {
  const f = useFmt(data);
  const { t } = f;
  const m = data.team.mix;
  const totalReplies = m.agentReplies + m.botReplies;
  const personal = data.scope === 'personal';
  return (
    <div className="flex flex-col gap-4">
      {!personal && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ReportCard title={t('reports.team.repliesTitle')} description={t('reports.team.repliesDescription')}>
            <StackBar
              ariaLabel={t('reports.team.repliesAria', { agent: f.pct(totalReplies ? m.agentReplies / totalReplies : null), bot: f.pct(totalReplies ? m.botReplies / totalReplies : null) })}
              formatValue={f.n}
              parts={[
                { label: t('reports.volume.agent'), value: m.agentReplies, color: S_AGENT },
                { label: t('reports.volume.bot'), value: m.botReplies, color: S_BOT },
              ]}
            />
          </ReportCard>
          <ReportCard title={t('reports.team.mixTitle')} description={t('reports.team.mixDescription', { handed: f.n(m.handedOver) })}>
            <StackBar
              ariaLabel={t('reports.team.mixAria', { ai: f.n(m.aiOnly), both: f.n(m.both), human: f.n(m.humanOnly), none: f.n(m.noReply) })}
              formatValue={f.n}
              parts={[
                { label: t('reports.team.aiOnly'), value: m.aiOnly, color: S_BOT },
                { label: t('reports.team.both'), value: m.both, color: S_BOTH },
                { label: t('reports.team.humanOnly'), value: m.humanOnly, color: S_AGENT },
                { label: t('reports.team.noReply'), value: m.noReply, color: S_NONE },
              ]}
            />
          </ReportCard>
        </div>
      )}

      <ReportCard title={personal ? t('reports.team.meTitle') : t('reports.team.agentsTitle')} description={t('reports.team.agentsDescription')}>
        <DataTable<AgentRow>
          caption={t('reports.team.agentsTitle')}
          csvName={f.file(personal ? 'mi-desempeno' : 'equipo')}
          empty={t('reports.team.noAgents')}
          rows={data.team.agents}
          rowKey={(r) => r.userId}
          columns={[
            { key: 'name', label: t('reports.cols.agent'), render: (r) => r.name || t('reports.unknownMember') },
            { key: 'conversations', label: t('reports.cols.conversationsHandled'), align: 'right', render: (r) => f.n(r.conversations), csv: (r) => r.conversations },
            { key: 'messages', label: t('reports.cols.messagesSent'), align: 'right', render: (r) => f.n(r.messages), csv: (r) => r.messages },
            { key: 'frt', label: t('reports.cols.medianFirstResponse'), align: 'right', render: (r) => f.dur(r.medianFirstResponseMs), csv: (r) => minutesValue(r.medianFirstResponseMs) },
            { key: 'firstResponses', label: t('reports.cols.firstResponses'), align: 'right', render: (r) => f.n(r.firstResponses), csv: (r) => r.firstResponses },
            { key: 'resolved', label: t('reports.cols.resolved'), align: 'right', render: (r) => f.n(r.resolved), csv: (r) => r.resolved },
            { key: 'open', label: t('reports.cols.openNow'), align: 'right', render: (r) => f.n(r.open), csv: (r) => r.open },
            { key: 'pending', label: t('reports.cols.pendingNow'), align: 'right', render: (r) => f.n(r.pending), csv: (r) => r.pending },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t('reports.team.csvMinutes')}</p>
      </ReportCard>
    </div>
  );
}

// ------------------------------------------------------------------
// AI
// ------------------------------------------------------------------
export function AiSection({ data }: { data: ReportPayload }) {
  const f = useFmt(data);
  const { t } = f;
  const ai = data.ai!;
  const totalReplies = ai.agents.reduce((s, r) => s + r.replies, 0);
  const totalHandovers = ai.agents.reduce((s, r) => s + r.handovers, 0);
  const totalConvs = ai.agents.reduce((s, r) => s + r.conversations, 0);
  const name = (r: AiAgentRow) => (r.aiAgentId ? r.name || t('reports.ai.deletedAgent') : t('reports.ai.noAgent'));
  const rate = data.settings.usdRate;
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <StatTile label={t('reports.ai.replies')} value={f.n(totalReplies)} />
        <StatTile label={t('reports.ai.handoverRate')} value={f.pct(totalConvs ? totalHandovers / totalConvs : null)} sub={t('reports.ai.handoverSub', { count: f.n(totalHandovers) })} />
        <StatTile label={t('reports.ai.costUsd')} value={f.usd(ai.totalCostUsd)} sub={t('reports.ai.calls', { count: f.n(ai.calls) })} />
        <StatTile
          label={t('reports.ai.costLocal', { currency: data.settings.currency })}
          value={ai.totalCostLocal !== null ? f.money(ai.totalCostLocal) : '—'}
          sub={rate !== null ? t('reports.ai.rate', { rate: String(rate), currency: data.settings.currency }) : t('reports.ai.noRate')}
        />
      </Grid>
      <ReportCard title={t('reports.ai.byAgentTitle')} description={t('reports.ai.internalCost')}>
        <BarList ariaLabel={t('reports.ai.byAgentTitle')} rows={ai.agents.filter((r) => r.aiAgentId).map((r) => ({ label: name(r), value: r.replies }))} color={S_BOT} formatValue={f.n} />
        <DataTable<AiAgentRow>
          caption={t('reports.ai.byAgentTitle')}
          csvName={f.file('agentes-ia')}
          empty={t('reports.empty')}
          rows={ai.agents}
          rowKey={(r) => r.aiAgentId ?? 'none'}
          columns={[
            { key: 'name', label: t('reports.cols.aiAgent'), render: name },
            { key: 'replies', label: t('reports.cols.replies'), align: 'right', render: (r) => f.n(r.replies), csv: (r) => r.replies },
            { key: 'conversations', label: t('reports.cols.conversations'), align: 'right', render: (r) => f.n(r.conversations), csv: (r) => r.conversations },
            { key: 'handovers', label: t('reports.cols.handovers'), align: 'right', render: (r) => f.n(r.handovers), csv: (r) => r.handovers },
            { key: 'handoverRate', label: t('reports.cols.handoverRate'), align: 'right', render: (r) => f.pct(r.handoverRate), csv: (r) => (r.handoverRate === null ? null : Math.round(r.handoverRate * 1000) / 10) },
            { key: 'calls', label: t('reports.cols.calls'), align: 'right', render: (r) => f.n(r.calls), csv: (r) => r.calls },
            { key: 'usd', label: t('reports.cols.costUsd'), align: 'right', render: (r) => f.usd(r.costUsd), csv: (r) => r.costUsd },
            {
              key: 'local',
              label: t('reports.cols.costLocal', { currency: data.settings.currency }),
              align: 'right',
              render: (r) => (r.costLocal !== null ? f.money(r.costLocal) : '—'),
              csv: (r) => (r.costLocal === null ? null : Math.round(r.costLocal * 10000) / 10000),
            },
          ]}
        />
      </ReportCard>
    </div>
  );
}

// ------------------------------------------------------------------
// Sales
// ------------------------------------------------------------------
export function SalesSection({ data }: { data: ReportPayload }) {
  const f = useFmt(data);
  const { t } = f;
  const s = data.sales!;
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        {s.modules.orders && <StatTile label={t('reports.sales.orders')} value={f.n(s.ordersCount)} />}
        {s.modules.orders && <StatTile label={t('reports.sales.revenue')} value={f.money(s.revenue)} sub={t('reports.sales.revenueSub')} />}
        {s.modules.orders && (
          <StatTile
            label={t('reports.sales.conversion')}
            value={f.pct(s.conversion.rate)}
            sub={t('reports.sales.conversionSub', { orders: f.n(s.conversion.withOrder), total: f.n(s.conversion.activeConversations) })}
          />
        )}
        {s.modules.bookings && <StatTile label={t('reports.sales.bookings')} value={f.n(s.bookingsByStatus.reduce((x, r) => x + r.count, 0))} />}
      </Grid>
      <div className="grid gap-4 xl:grid-cols-2">
        {s.modules.orders && (
          <ReportCard title={t('reports.sales.ordersByStatus')}>
            <DataTable<StatusRow>
              caption={t('reports.sales.ordersByStatus')}
              csvName={f.file('pedidos-por-estado')}
              empty={t('reports.empty')}
              rows={s.ordersByStatus}
              rowKey={(r) => r.status}
              columns={[
                { key: 'status', label: t('reports.cols.status'), render: (r) => t(`orders.status.${r.status}`) },
                { key: 'count', label: t('reports.cols.count'), align: 'right', render: (r) => f.n(r.count), csv: (r) => r.count },
                { key: 'total', label: t('reports.cols.total'), align: 'right', render: (r) => f.money(r.total ?? 0), csv: (r) => r.total ?? 0 },
              ]}
            />
          </ReportCard>
        )}
        {s.modules.bookings && (
          <ReportCard title={t('reports.sales.bookingsByStatus')}>
            <DataTable<StatusRow>
              caption={t('reports.sales.bookingsByStatus')}
              csvName={f.file('reservas-por-estado')}
              empty={t('reports.empty')}
              rows={s.bookingsByStatus}
              rowKey={(r) => r.status}
              columns={[
                { key: 'status', label: t('reports.cols.status'), render: (r) => t(`bookings.status.${r.status}`) },
                { key: 'count', label: t('reports.cols.count'), align: 'right', render: (r) => f.n(r.count), csv: (r) => r.count },
              ]}
            />
          </ReportCard>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('reports.sales.note')}</p>
    </div>
  );
}
