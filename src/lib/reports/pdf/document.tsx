// The PDF report: a main cover, then for each section (Atención, Volumen,
// Equipo, IA, Ventas, WhatsApp) a cover page that explains it with its key
// numbers, and the detail pages with charts and tables. Every page has the
// footer «Generado por Whasalia CRM · whasalia.com» and its page number.
import { Document, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { Translator } from '@/i18n/translate'
import { formatMoney } from '@/lib/workspace/countries'
import { formatCount, formatDuration, formatPercent, formatUsd, shortDay } from '../format'
import type { MetaUsage } from '../meta-usage-data'
import type { ReportPayload } from '../types'
import { GroupedBars, HBars, Heatmap, Legend, StackBar } from './charts'
import { C, pdfText as p } from './theme'

export type PdfSection = 'attention' | 'volume' | 'team' | 'ai' | 'sales' | 'meta'

export interface PdfInput {
  report: ReportPayload
  meta: MetaUsage | null
  businessName: string
  t: Translator
  /** Number locale (es-PE…). */
  numLocale: string
  siteUrl: string
  /** "Canal: Tienda" lines for the cover. */
  filters: string[]
}

const W = 515 // content width (A4 595 − 2 × 40)

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 62, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 9, color: C.text },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.6, borderTopColor: C.grid, paddingTop: 7, fontSize: 7.5, color: C.muted },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 3 },
  desc: { fontSize: 8.5, color: C.muted, marginBottom: 8, lineHeight: 1.4 },
  card: { borderWidth: 0.6, borderColor: C.grid, borderRadius: 6, padding: 12, marginBottom: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 },
  tile: { width: (W + 8) / 4 - 8, margin: 4, padding: 9, backgroundColor: C.card, borderRadius: 6, minHeight: 58 },
  tileLabel: { fontSize: 7.5, color: C.muted, marginBottom: 4 },
  tileValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.text },
  tileSub: { fontSize: 7, color: C.muted, marginTop: 3 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.muted, paddingVertical: 5, paddingHorizontal: 4 },
  td: { fontSize: 8, paddingVertical: 4.5, paddingHorizontal: 4 },
})

function Footer({ t, siteUrl }: { t: Translator; siteUrl: string }) {
  const host = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return (
    <View style={s.footer} fixed>
      <Text>
        {p(t('reports.pdf.generatedBy'))} ·{' '}
        <Link src={siteUrl} style={{ color: C.primaryDark, textDecoration: 'none' }}>
          {host}
        </Link>
      </Text>
      <Text render={({ pageNumber, totalPages }) => p(t('reports.pdf.page', { n: pageNumber, total: totalPages }))} />
    </View>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.tile} wrap={false}>
      <Text style={s.tileLabel}>{p(label)}</Text>
      <Text style={s.tileValue}>{p(value)}</Text>
      {sub ? <Text style={s.tileSub}>{p(sub)}</Text> : null}
    </View>
  )
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <View style={s.card} wrap={false}>
      <Text style={s.h2}>{p(title)}</Text>
      {desc ? <Text style={s.desc}>{p(desc)}</Text> : null}
      {children}
    </View>
  )
}

function Table<T>({ cols, rows, empty }: { cols: { label: string; w: number; align?: 'right'; get: (r: T) => string }[]; rows: T[]; empty: string }) {
  if (!rows.length) return <Text style={{ fontSize: 8.5, color: C.muted }}>{p(empty)}</Text>
  return (
    <View>
      <View style={{ flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: C.grid }}>
        {cols.map((c) => (
          <Text key={c.label} style={[s.th, { width: `${c.w}%`, textAlign: c.align ?? 'left' }]}>
            {p(c.label)}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', backgroundColor: i % 2 ? C.card : C.white }} wrap={false}>
          {cols.map((c) => (
            <Text key={c.label} style={[s.td, { width: `${c.w}%`, textAlign: c.align ?? 'left' }]}>
              {p(c.get(r))}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

/** Cover of one section: number, title, what it measures, the numbers that matter. */
function SectionCover({ n, title, intro, how, highlights, t, siteUrl }: { n: number; title: string; intro: string; how: string; highlights: { label: string; value: string; sub?: string }[]; t: Translator; siteUrl: string }) {
  return (
    <Page size="A4" style={[s.page, { paddingTop: 0, paddingHorizontal: 0 }]}>
      <View style={{ backgroundColor: C.primary, paddingHorizontal: 40, paddingTop: 70, paddingBottom: 40 }}>
        <Text style={{ fontSize: 60, fontFamily: 'Helvetica-Bold', color: C.white, opacity: 0.35 }}>{String(n).padStart(2, '0')}</Text>
        <Text style={{ fontSize: 30, fontFamily: 'Helvetica-Bold', color: C.white, marginTop: 4 }}>{p(title)}</Text>
      </View>
      <View style={{ paddingHorizontal: 40, paddingTop: 28 }}>
        <Text style={{ fontSize: 11, lineHeight: 1.55, color: C.text }}>{p(intro)}</Text>
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.primaryDark, marginTop: 26, marginBottom: 6 }}>{p(t('reports.pdf.highlights'))}</Text>
        <View style={s.tiles}>
          {highlights.map((h) => (
            <View key={h.label} style={{ width: (W + 8) / 2 - 8, margin: 4, padding: 14, backgroundColor: C.primarySoft, borderRadius: 8 }}>
              <Text style={{ fontSize: 8.5, color: C.primaryDark }}>{p(h.label)}</Text>
              <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', color: C.text, marginTop: 4 }}>{p(h.value)}</Text>
              {h.sub ? <Text style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>{p(h.sub)}</Text> : null}
            </View>
          ))}
        </View>
        <View style={{ marginTop: 18, padding: 12, borderLeftWidth: 3, borderLeftColor: C.primary, backgroundColor: C.card }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>{p(t('reports.pdf.howToRead'))}</Text>
          <Text style={{ fontSize: 8.5, color: C.muted, lineHeight: 1.5 }}>{p(how)}</Text>
        </View>
      </View>
      <Footer t={t} siteUrl={siteUrl} />
    </Page>
  )
}

export function ReportDocument({ report: r, meta, businessName, t, numLocale, siteUrl, filters }: PdfInput) {
  const n = (v: number) => formatCount(v, numLocale)
  const pct = (v: number | null) => formatPercent(v, numLocale)
  const dur = formatDuration
  const money = (v: number) => formatMoney(v, r.settings.currency, numLocale)
  const usd = (v: number) => formatUsd(v, numLocale)
  const days = t('reports.days').split(',')
  const date = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number)
    return new Intl.DateTimeFormat(numLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)))
  }
  const generated = new Intl.DateTimeFormat(numLocale, { dateStyle: 'long', timeStyle: 'short', timeZone: r.range.timeZone }).format(new Date(r.generatedAt))
  const period = r.range.fromDate === r.range.toDate ? date(r.range.fromDate) : t('reports.pdf.period', { from: date(r.range.fromDate), to: date(r.range.toDate) })
  const personal = r.scope === 'personal'
  const a = r.attention
  const v = r.volume
  const sectionsList: PdfSection[] = ['attention', 'volume', 'team', ...(r.ai ? (['ai'] as const) : []), ...(r.sales ? (['sales'] as const) : []), ...(meta ? (['meta'] as const) : [])]
  const titleOf = (k: PdfSection) => (k === 'meta' ? t('metaUsage.tab') : k === 'team' && personal ? t('reports.tabs.me') : t(`reports.tabs.${k}`))
  const num = (k: PdfSection) => sectionsList.indexOf(k) + 1
  const cover = (k: PdfSection, highlights: { label: string; value: string; sub?: string }[]) => (
    <SectionCover n={num(k)} title={titleOf(k)} intro={t(`reports.pdf.sections.${k}.intro`)} how={t(`reports.pdf.sections.${k}.how`)} highlights={highlights} t={t} siteUrl={siteUrl} />
  )

  // Volume
  let peak = { d: 0, h: 0, v: 0 }
  v.heatmap.forEach((row, d) => row.forEach((val, h) => (val > peak.v ? (peak = { d, h, v: val }) : null)))
  const peakText = peak.v > 0 ? `${days[peak.d]} ${String(peak.h).padStart(2, '0')}:00` : '—'
  const purposeLabel = (x: string) => (x === 'none' || !x ? t('reports.purposeNone') : t(`channels.purposes.${x}`))
  const outbound = v.totals.agent + v.totals.bot
  const since = (iso: string) => dur(Date.parse(r.generatedAt) - Date.parse(iso))
  const mix = r.team.mix

  return (
    <Document title={p(`${t('reports.pdf.title')} - ${businessName}`)} author="Whasalia CRM" creator="Whasalia CRM" producer="Whasalia CRM">
      {/* Main cover */}
      <Page size="A4" style={[s.page, { paddingTop: 0, paddingHorizontal: 0 }]}>
        <View style={{ backgroundColor: C.primary, height: 380, paddingHorizontal: 40, paddingTop: 56 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 1 }}>WHASALIA CRM</Text>
          <Text style={{ fontSize: 36, fontFamily: 'Helvetica-Bold', color: C.white, marginTop: 90, lineHeight: 1.15 }}>{p(t(personal ? 'reports.pdf.titlePersonal' : 'reports.pdf.title'))}</Text>
          <Text style={{ fontSize: 17, color: C.white, marginTop: 12 }}>{p(businessName)}</Text>
          <Text style={{ fontSize: 11, color: C.white, opacity: 0.85, marginTop: 6 }}>{p(period)}</Text>
        </View>
        <View style={{ paddingHorizontal: 40, paddingTop: 30 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.primaryDark, marginBottom: 10 }}>{p(t('reports.pdf.contents'))}</Text>
          {sectionsList.map((k) => (
            <View key={k} style={{ flexDirection: 'row', marginBottom: 9 }}>
              <Text style={{ width: 28, fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.primary }}>{String(num(k)).padStart(2, '0')}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>{p(titleOf(k))}</Text>
                <Text style={{ fontSize: 8.5, color: C.muted, marginTop: 1 }}>{p(t(`reports.pdf.sections.${k}.short`))}</Text>
              </View>
            </View>
          ))}
          <View style={{ marginTop: 14, paddingTop: 10, borderTopWidth: 0.6, borderTopColor: C.grid }}>
            <Text style={{ fontSize: 8.5, color: C.muted }}>{p(t('reports.pdf.generatedAt', { date: generated, tz: r.range.timeZone }))}</Text>
            {filters.length > 0 && <Text style={{ fontSize: 8.5, color: C.muted, marginTop: 2 }}>{p(t('reports.pdf.filters', { list: filters.join(' · ') }))}</Text>}
            {r.truncated && <Text style={{ fontSize: 8.5, color: C.amber, marginTop: 2 }}>{p(t('reports.truncated'))}</Text>}
          </View>
        </View>
        <Footer t={t} siteUrl={siteUrl} />
      </Page>

      {/* 1. Attention */}
      {cover('attention', [
        { label: t('reports.attention.started'), value: n(a.conversationsStarted), sub: t('reports.attention.sessionsSub', { count: n(a.sessions) }) },
        { label: t('reports.attention.firstResponse'), value: dur(a.medianFirstResponseMs), sub: t('reports.attention.p90', { value: dur(a.p90FirstResponseMs) }) },
        { label: t('reports.attention.sla', { minutes: r.settings.slaMinutes }), value: pct(a.slaRate), sub: t('reports.attention.slaSub', { within: n(a.withinSla), total: n(a.slaEligible) }) },
        { label: t('reports.attention.unansweredNow'), value: n(a.unansweredNow.count), sub: a.unansweredNow.oldestSince ? t('reports.attention.oldestWaiting', { value: since(a.unansweredNow.oldestSince) }) : t('reports.attention.nobodyWaiting') },
      ])}
      <Page size="A4" style={s.page}>
        <View style={s.tiles}>
          <Tile label={t('reports.attention.started')} value={n(a.conversationsStarted)} sub={t('reports.attention.sessionsSub', { count: n(a.sessions) })} />
          <Tile label={t('reports.attention.firstResponse')} value={dur(a.medianFirstResponseMs)} sub={t('reports.attention.p90', { value: dur(a.p90FirstResponseMs) })} />
          <Tile label={t('reports.attention.firstHuman')} value={dur(a.medianHumanResponseMs)} sub={t('reports.attention.p90', { value: dur(a.p90HumanResponseMs) })} />
          <Tile label={t('reports.attention.sla', { minutes: r.settings.slaMinutes })} value={pct(a.slaRate)} sub={t('reports.attention.slaSub', { within: n(a.withinSla), total: n(a.slaEligible) })} />
          <Tile label={t('reports.attention.resolution')} value={dur(a.resolution.medianMs)} sub={t('reports.attention.resolutionSub', { p90: dur(a.resolution.p90Ms), count: n(a.resolution.resolved) })} />
          <Tile label={t('reports.attention.answered')} value={n(a.answered)} sub={t('reports.attention.answeredSub', { bot: n(a.answeredByBot), agent: n(a.answeredByAgent) })} />
          <Tile label={t('reports.attention.unansweredSessions')} value={n(a.unansweredSessions)} sub={t('reports.attention.unansweredSessionsSub')} />
          <Tile label={t('reports.attention.unansweredNow')} value={n(a.unansweredNow.count)} />
        </View>
        <Card title={t('reports.pdf.whoAnswered')} desc={t('reports.pdf.whoAnsweredDesc')}>
          <StackBar
            width={W - 24}
            parts={[
              { label: t('reports.volume.bot'), value: a.answeredByBot, color: C.violet },
              { label: t('reports.volume.agent'), value: a.answeredByAgent, color: C.blue },
              { label: t('reports.team.noReply'), value: a.unansweredSessions, color: C.slate },
            ]}
          />
        </Card>
        {r.calls && (
          <Card title={t('reports.calls.title')}>
            <View style={s.tiles}>
              <Tile label={t('reports.calls.total')} value={n(r.calls.total)} />
              <Tile label={t('reports.calls.answered')} value={n(r.calls.answered)} sub={t('reports.calls.answeredSub', { rate: pct(r.calls.total ? r.calls.answered / r.calls.total : null) })} />
              <Tile label={t('reports.calls.missed')} value={n(r.calls.missed)} sub={t('reports.calls.missedSub', { rejected: n(r.calls.rejected) })} />
              <Tile label={t('reports.calls.talk')} value={dur(r.calls.talkSeconds * 1000)} sub={t('reports.calls.talkSub', { value: dur(r.calls.medianSeconds === null ? null : r.calls.medianSeconds * 1000) })} />
            </View>
          </Card>
        )}
        <Card title={t('reports.attention.waitingTitle')} desc={t('reports.attention.waitingDescription')}>
          <Table
            empty={t('reports.attention.nobodyWaiting')}
            rows={a.unansweredNow.waiting}
            cols={[
              { label: t('reports.cols.contact'), w: 32, get: (w) => w.contact ?? t('reports.unknownContact') },
              { label: t('reports.cols.channel'), w: 24, get: (w) => w.channelName ?? t('reports.noChannel') },
              { label: t('reports.cols.assignee'), w: 24, get: (w) => w.assignee ?? t('reports.unassigned') },
              { label: t('reports.cols.waiting'), w: 20, align: 'right', get: (w) => since(w.since) },
            ]}
          />
        </Card>
        <Card title={t('reports.definitions.title')}>
          {(['session', 'firstResponse', 'unanswered'] as const).map((k) => (
            <Text key={k} style={[s.desc, { marginBottom: 4 }]}>
              {p(t(`reports.definitions.${k}`))}
            </Text>
          ))}
          <Text style={[s.desc, { marginBottom: 4 }]}>{p(t('reports.definitions.sla', { minutes: r.settings.slaMinutes }))}</Text>
          <Text style={[s.desc, { marginBottom: 0 }]}>{p(`${t('reports.definitions.resolution')} ${t(`reports.attention.basis.${a.resolution.basis}`)}.`)}</Text>
        </Card>
        <Footer t={t} siteUrl={siteUrl} />
      </Page>

      {/* 2. Volume */}
      {cover('volume', [
        { label: t('reports.volume.inbound'), value: n(v.totals.inbound) },
        { label: t('reports.volume.outbound'), value: n(outbound), sub: `${t('reports.volume.agent')}: ${n(v.totals.agent)} · ${t('reports.volume.bot')}: ${n(v.totals.bot)}` },
        { label: t('reports.volume.peak'), value: peakText, sub: peak.v > 0 ? t('reports.volume.peakSub', { count: n(peak.v) }) : undefined },
        { label: t('reports.volume.byChannelTitle'), value: n(v.byChannel.length), sub: t('reports.pdf.channelsActive') },
      ])}
      <Page size="A4" style={s.page}>
        <Card title={t('reports.volume.byDayTitle')} desc={t('reports.volume.byDayDescription')}>
          <Legend items={[{ label: t('reports.volume.inbound'), color: C.primary }, { label: t('reports.volume.agent'), color: C.blue }, { label: t('reports.volume.bot'), color: C.violet }]} />
          <GroupedBars
            width={W - 24}
            labels={v.byDay.map((d) => shortDay(d.day, numLocale))}
            series={[
              { name: 'in', color: C.primary, values: v.byDay.map((d) => d.inbound) },
              { name: 'agent', color: C.blue, values: v.byDay.map((d) => d.agent) },
              { name: 'bot', color: C.violet, values: v.byDay.map((d) => d.bot) },
            ]}
          />
        </Card>
        <Card title={t('reports.volume.byChannelTitle')} desc={t('reports.volume.byChannelDescription')}>
          <HBars width={W - 24} format={n} rows={[...v.byChannel].sort((x, y) => y.inbound + y.agent + y.bot - (x.inbound + x.agent + x.bot)).slice(0, 12).map((c) => ({ label: c.name || t('reports.noChannel'), value: c.inbound + c.agent + c.bot }))} />
        </Card>
        <Card title={t('reports.volume.heatmapTitle')} desc={t('reports.volume.heatmapDescription', { tz: r.range.timeZone })}>
          <Heatmap width={W - 24} data={v.heatmap} days={days} />
        </Card>
        {v.byPurpose.length > 0 && (
          <Card title={t('reports.volume.byPurposeTitle')} desc={t('reports.volume.byPurposeDescription')}>
            <Table
              empty={t('reports.empty')}
              rows={v.byPurpose}
              cols={[
                { label: t('reports.cols.purpose'), w: 50, get: (x) => purposeLabel(x.purpose) },
                { label: t('reports.volume.inbound'), w: 25, align: 'right', get: (x) => n(x.inbound) },
                { label: t('reports.volume.outbound'), w: 25, align: 'right', get: (x) => n(x.outbound) },
              ]}
            />
          </Card>
        )}
        <Footer t={t} siteUrl={siteUrl} />
      </Page>

      {/* 3. Team */}
      {cover('team', [
        { label: t('reports.volume.agent'), value: n(mix.agentReplies) },
        { label: t('reports.volume.bot'), value: n(mix.botReplies) },
        { label: t('reports.team.aiOnly'), value: n(mix.aiOnly), sub: t('reports.pdf.conversations') },
        { label: t('reports.pdf.handedOver'), value: n(mix.handedOver), sub: t('reports.pdf.conversations') },
      ])}
      <Page size="A4" style={s.page}>
        <Card title={t('reports.team.repliesTitle')} desc={t('reports.team.repliesDescription')}>
          <StackBar width={W - 24} parts={[{ label: t('reports.volume.agent'), value: mix.agentReplies, color: C.blue }, { label: t('reports.volume.bot'), value: mix.botReplies, color: C.violet }]} />
        </Card>
        <Card title={t('reports.team.mixTitle')} desc={t('reports.team.mixDescription', { handed: n(mix.handedOver) })}>
          <StackBar
            width={W - 24}
            parts={[
              { label: t('reports.team.aiOnly'), value: mix.aiOnly, color: C.violet },
              { label: t('reports.team.both'), value: mix.both, color: C.primary },
              { label: t('reports.team.humanOnly'), value: mix.humanOnly, color: C.blue },
              { label: t('reports.team.noReply'), value: mix.noReply, color: C.slate },
            ]}
          />
        </Card>
        <Card title={personal ? t('reports.team.meTitle') : t('reports.team.agentsTitle')} desc={t('reports.team.agentsDescription')}>
          <Table
            empty={t('reports.team.noAgents')}
            rows={r.team.agents}
            cols={[
              { label: t('reports.cols.agent'), w: 22, get: (x) => x.name || t('reports.unknownMember') },
              { label: t('reports.cols.conversationsHandled'), w: 12, align: 'right', get: (x) => n(x.conversations) },
              { label: t('reports.cols.messagesSent'), w: 12, align: 'right', get: (x) => n(x.messages) },
              { label: t('reports.cols.firstResponses'), w: 12, align: 'right', get: (x) => n(x.firstResponses) },
              { label: t('reports.cols.medianFirstResponse'), w: 14, align: 'right', get: (x) => dur(x.medianFirstResponseMs) },
              { label: t('reports.cols.resolved'), w: 10, align: 'right', get: (x) => n(x.resolved) },
              { label: t('reports.cols.openNow'), w: 9, align: 'right', get: (x) => n(x.open) },
              { label: t('reports.cols.pendingNow'), w: 9, align: 'right', get: (x) => n(x.pending) },
            ]}
          />
        </Card>
        <Footer t={t} siteUrl={siteUrl} />
      </Page>

      {/* 4. AI */}
      {r.ai &&
        cover('ai', [
          { label: t('reports.ai.replies'), value: n(r.ai.agents.reduce((x, g) => x + g.replies, 0)) },
          {
            label: t('reports.ai.handoverRate'),
            value: pct(r.ai.agents.reduce((x, g) => x + g.conversations, 0) ? r.ai.agents.reduce((x, g) => x + g.handovers, 0) / r.ai.agents.reduce((x, g) => x + g.conversations, 0) : null),
            sub: t('reports.ai.handoverSub', { count: n(r.ai.agents.reduce((x, g) => x + g.handovers, 0)) }),
          },
          { label: t('reports.ai.costUsd'), value: usd(r.ai.totalCostUsd), sub: t('reports.ai.calls', { count: n(r.ai.calls) }) },
          { label: t('reports.ai.costLocal', { currency: r.settings.currency }), value: r.ai.totalCostLocal === null ? '—' : money(r.ai.totalCostLocal), sub: r.settings.usdRate ? t('reports.ai.rate', { rate: r.settings.usdRate, currency: r.settings.currency }) : t('reports.ai.noRate') },
        ])}
      {r.ai && (
        <Page size="A4" style={s.page}>
          <Card title={t('reports.ai.byAgentTitle')} desc={t('reports.ai.internalCost')}>
            <HBars width={W - 24} color={C.violet} format={n} rows={r.ai.agents.map((g) => ({ label: g.name || (g.aiAgentId ? t('reports.ai.deletedAgent') : t('reports.ai.noAgent')), value: g.replies }))} />
          </Card>
          <Card title={t('reports.pdf.aiDetail')}>
            <Table
              empty={t('reports.empty')}
              rows={r.ai.agents}
              cols={[
                { label: t('reports.cols.aiAgent'), w: 26, get: (g) => g.name || (g.aiAgentId ? t('reports.ai.deletedAgent') : t('reports.ai.noAgent')) },
                { label: t('reports.cols.replies'), w: 12, align: 'right', get: (g) => n(g.replies) },
                { label: t('reports.cols.conversations'), w: 13, align: 'right', get: (g) => n(g.conversations) },
                { label: t('reports.cols.handovers'), w: 12, align: 'right', get: (g) => n(g.handovers) },
                { label: t('reports.cols.handoverRate'), w: 12, align: 'right', get: (g) => pct(g.handoverRate) },
                { label: t('reports.cols.costUsd'), w: 13, align: 'right', get: (g) => usd(g.costUsd) },
                { label: t('reports.cols.costLocal', { currency: r.settings.currency }), w: 12, align: 'right', get: (g) => (g.costLocal === null ? '—' : money(g.costLocal)) },
              ]}
            />
          </Card>
          <Footer t={t} siteUrl={siteUrl} />
        </Page>
      )}

      {/* 5. Sales */}
      {r.sales &&
        cover('sales', [
          ...(r.sales.modules.orders
            ? [
                { label: t('reports.sales.orders'), value: n(r.sales.ordersCount) },
                { label: t('reports.sales.revenue'), value: money(r.sales.revenue), sub: t('reports.sales.revenueSub') },
                { label: t('reports.sales.conversion'), value: pct(r.sales.conversion.rate), sub: t('reports.sales.conversionSub', { orders: n(r.sales.conversion.withOrder), total: n(r.sales.conversion.activeConversations) }) },
              ]
            : []),
          ...(r.sales.modules.bookings ? [{ label: t('reports.sales.bookings'), value: n(r.sales.bookingsByStatus.reduce((x, b) => x + b.count, 0)) }] : []),
        ])}
      {r.sales && (
        <Page size="A4" style={s.page}>
          {r.sales.modules.orders && (
            <Card title={t('reports.sales.ordersByStatus')}>
              <HBars width={W - 24} format={n} rows={r.sales.ordersByStatus.map((x) => ({ label: t(`orders.status.${x.status}`), value: x.count }))} />
            </Card>
          )}
          {r.sales.modules.bookings && (
            <Card title={t('reports.sales.bookingsByStatus')}>
              <HBars width={W - 24} color={C.blue} format={n} rows={r.sales.bookingsByStatus.map((x) => ({ label: t(`bookings.status.${x.status}`), value: x.count }))} />
            </Card>
          )}
          <Text style={s.desc}>{p(t('reports.sales.note'))}</Text>
          <Footer t={t} siteUrl={siteUrl} />
        </Page>
      )}

      {/* 6. WhatsApp (Meta) */}
      {meta &&
        cover('meta', [
          { label: t('metaUsage.serviceSent'), value: n(meta.totals.service), sub: t('metaUsage.freePerNumber', { n: n(meta.freePerNumber) }) },
          { label: t('metaUsage.templatesSent'), value: n(meta.totals.templates), sub: t('metaUsage.templatesSub') },
          { label: t('metaUsage.costUsd'), value: usd(meta.totals.costUsd), sub: t('metaUsage.estimate') },
          { label: t('metaUsage.costLocal', { currency: meta.currency }), value: meta.totals.costLocal === null ? '—' : money(meta.totals.costLocal), sub: meta.usdRate ? t('metaUsage.rate', { rate: meta.usdRate, currency: meta.currency }) : undefined },
        ])}
      {meta && (
        <Page size="A4" style={s.page}>
          <Text style={s.desc}>
            {p(t('reports.pdf.metaMonth', { month: new Intl.DateTimeFormat(numLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${meta.month}-01T12:00:00Z`)) }))}
          </Text>
          {meta.numbers.map((num) => (
            <Card key={num.channelId} title={`${num.name}${num.phone ? ` · ${num.phone}` : ''}`}>
              <StackBar
                width={W - 24}
                parts={[
                  { label: t('reports.pdf.freeUsed'), value: num.estimate.freeUsed, color: C.primary },
                  { label: t('reports.pdf.freeLeft'), value: num.estimate.freeLeft, color: C.grid },
                  { label: t('reports.pdf.billable'), value: num.estimate.billableService, color: C.amber },
                ]}
              />
              <View style={{ marginTop: 8 }}>
                <Table
                  empty=""
                  rows={[
                    { k: t('metaUsage.service'), c: num.usage.service, u: num.estimate.costUsd.service },
                    { k: t('metaUsage.marketing'), c: num.usage.marketing, u: num.estimate.costUsd.marketing },
                    { k: t('metaUsage.utility'), c: num.usage.utility + num.usage.other_template, u: num.estimate.costUsd.utility },
                    { k: t('metaUsage.authentication'), c: num.usage.authentication, u: num.estimate.costUsd.authentication },
                  ]}
                  cols={[
                    { label: t('reports.pdf.type'), w: 50, get: (x) => x.k },
                    { label: t('reports.cols.count'), w: 25, align: 'right', get: (x) => n(x.c) },
                    { label: t('metaUsage.estimatedCost'), w: 25, align: 'right', get: (x) => usd(x.u) },
                  ]}
                />
              </View>
              {num.projectedOverFree && <Text style={[s.desc, { color: C.amber, marginTop: 6, marginBottom: 0 }]}>{p(t('metaUsage.projection', { n: n(num.projectedService) }))}</Text>}
            </Card>
          ))}
          {meta.numbers.length === 0 && <Text style={s.desc}>{p(t('metaUsage.noNumbers'))}</Text>}
          <Text style={s.desc}>
            {p(t('metaUsage.disclaimer', { market: meta.market, service: usd(meta.rates.service), utility: usd(meta.rates.utility), marketing: usd(meta.rates.marketing) }))}
          </Text>
          <Footer t={t} siteUrl={siteUrl} />
        </Page>
      )}
    </Document>
  )
}
