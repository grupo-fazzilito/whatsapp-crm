import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { createTranslator } from '@/i18n/translate'
import type { ReportPayload } from '../types'
import type { MetaUsage } from '../meta-usage-data'
import { ReportDocument } from './document'
import { pdfText } from './theme'

const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 10).padStart(2, '0')}`)
const report: ReportPayload = {
  scope: 'workspace',
  generatedAt: '2026-11-27T20:00:00Z',
  range: { preset: '30d', fromDate: days[0], toDate: days[days.length - 1], timeZone: 'America/Lima', days },
  settings: { slaMinutes: 15, usdRate: 3.75, currency: 'PEN', locale: 'es', country: 'PE' },
  filters: { channelId: null, agentId: null, teamId: null },
  options: { channels: [], agents: [], teams: [] },
  truncated: false,
  attention: {
    conversationsStarted: 412, sessions: 530, answered: 498, unansweredSessions: 32, answeredByBot: 351, answeredByAgent: 147,
    medianFirstResponseMs: 42_000, p90FirstResponseMs: 600_000, humanAnswered: 147, medianHumanResponseMs: 380_000, p90HumanResponseMs: 3_600_000,
    slaEligible: 520, withinSla: 461, slaRate: 461 / 520,
    resolution: { basis: 'events', resolved: 300, measured: 300, medianMs: 5_400_000, p90Ms: 86_400_000 },
    unansweredNow: { count: 3, oldestSince: '2026-11-27T15:00:00Z', waiting: [{ conversationId: 'c1', since: '2026-11-27T15:00:00Z', contact: 'María Pérez 😊', channelName: 'WhatsApp Tienda', assignee: null }] },
  },
  volume: {
    totals: { inbound: 5210, agent: 1830, bot: 3120 },
    byDay: days.map((day, i) => ({ day, inbound: 300 + ((i * 37) % 120), agent: 100 + ((i * 13) % 60), bot: 200 + ((i * 29) % 90) })),
    byChannel: [
      { channelId: 'a', name: 'WhatsApp Tienda', type: 'whatsapp', purpose: 'sales', inbound: 3100, agent: 900, bot: 2000, conversations: 260 },
      { channelId: 'b', name: 'Instagram', type: 'instagram', purpose: null, inbound: 1500, agent: 600, bot: 800, conversations: 110 },
      { channelId: 'c', name: 'Messenger', type: 'messenger', purpose: null, inbound: 610, agent: 330, bot: 320, conversations: 42 },
    ],
    byPurpose: [{ purpose: 'sales', inbound: 3100, outbound: 2900 }, { purpose: 'none', inbound: 2110, outbound: 2050 }],
    heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 21 ? ((d + 1) * (h % 7)) * 3 : 0))),
  },
  team: {
    agents: [{ userId: 'u1', name: 'Ana Torres', conversations: 90, messages: 700, firstResponses: 80, medianFirstResponseMs: 240_000, resolved: 60, open: 4, pending: 2 }],
    mix: { agentReplies: 1830, botReplies: 3120, aiOnly: 250, humanOnly: 60, both: 80, noReply: 22, handedOver: 74 },
  },
  ai: { agents: [{ aiAgentId: 'x', name: 'Sofía', replies: 3120, conversations: 330, handovers: 74, handoverRate: 74 / 330, calls: 3500, costUsd: 4.21, costLocal: 15.79 }], totalCostUsd: 4.21, totalCostLocal: 15.79, calls: 3500 },
  calls: { total: 20, answered: 15, missed: 5, rejected: 1, talkSeconds: 3600, medianSeconds: 180 },
  sales: {
    modules: { orders: true, bookings: true },
    ordersByStatus: [{ status: 'pending', count: 12 }, { status: 'delivered', count: 40 }, { status: 'cancelled', count: 3 }],
    ordersCount: 55, revenue: 8450.5,
    bookingsByStatus: [{ status: 'confirmed', count: 30 }, { status: 'completed', count: 25 }],
    conversion: { activeConversations: 412, withOrder: 52, rate: 52 / 412 },
  },
}
const meta = {
  month: '2026-11', current: true, market: 'Perú', rates: { service: 0.0045, utility: 0.0045, marketing: 0.0703, authentication: 0.0261 }, freePerNumber: 1000,
  currency: 'PEN', usdRate: 3.75,
  numbers: [{ channelId: 'a', name: 'WhatsApp Tienda', phone: '+51 999 111 222', status: 'connected', usage: { service: 1340, marketing: 500, utility: 120, authentication: 0, other_template: 0 }, estimate: { freeUsed: 1000, freeLeft: 0, billableService: 340, costUsd: { service: 1.53, utility: 0.54, authentication: 0, marketing: 35.15, total: 37.22 } }, projectedService: 1500, projectedOverFree: true }],
  totals: { service: 1340, templates: 620, costUsd: 37.22, costLocal: 139.58 },
} as unknown as MetaUsage

describe('PDF report', () => {
  it('renders every section to a PDF', async () => {
    const pdf = await renderToBuffer(
      <ReportDocument report={report} meta={meta} businessName="Barbería Don Lucho" t={createTranslator('es')} numLocale="es-PE" siteUrl="https://whasalia.com" filters={['Canal: WhatsApp Tienda']} />,
    )
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf)
  }, 30_000)

  it('keeps only characters the PDF font can print', () => {
    expect(pdfText('Respondidas en ≤ 15 min')).toBe('Respondidas en <= 15 min')
    expect(pdfText('María 😊')).toBe('María ')
  })
})
