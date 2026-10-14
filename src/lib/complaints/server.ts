import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { sendEmail } from '@/lib/email/send'
import { createTranslator } from '@/i18n/translate'
import type { AppLocale } from '@/i18n/config'
import { COMPANY, companyAddress } from '@/lib/company'
import { complaintCode, limaDate, responseDueDate, type NewComplaint } from './input'

const SELECT = {
  id: true, year: true, number: true, kind: true, consumer_name: true, doc_type: true, doc_number: true, address: true, phone: true, email: true,
  is_minor: true, guardian_name: true, item_type: true, item_description: true, amount: true, detail: true, request: true, status: true,
  response: true, responded_at: true, locale: true, created_at: true,
} as const

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>
const findRow = (id: string) => prisma.complaints.findUnique({ where: { id }, select: SELECT })

export interface ComplaintView extends Omit<Row, 'amount'> {
  code: string
  amount: number | null
  due_date: string
}

function view(r: Row): ComplaintView {
  return {
    ...r,
    code: complaintCode(r.number, r.year),
    amount: r.amount === null ? null : Number(r.amount),
    due_date: responseDueDate(new Date(r.created_at)),
  }
}

/** Saves a hoja de reclamación with the next number of the year and emails the receipt. */
export async function fileComplaint(input: NewComplaint, meta: { locale: AppLocale; ip: string | null }): Promise<ComplaintView> {
  const now = new Date()
  const { y } = limaDate(now)
  const row = await prisma.$transaction(async (tx) => {
    // One writer at a time per year so numbers stay correlative without gaps.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('complaints'), ${y}::int)`
    const last = await tx.complaints.aggregate({ where: { year: y }, _max: { number: true } })
    return tx.complaints.create({
      data: { ...input, year: y, number: (last._max.number ?? 0) + 1, locale: meta.locale, ip: meta.ip, created_at: now },
      select: SELECT,
    })
  })
  const c = view(row)
  await Promise.all([
    sendEmail({ to: c.email, ...receiptEmail(c, meta.locale) }).catch((e) => console.error('[complaints] receipt email failed:', e instanceof Error ? e.message : e)),
    sendEmail({ to: COMPANY.email, ...receiptEmail(c, 'es', true) }).catch((e) => console.error('[complaints] notice email failed:', e instanceof Error ? e.message : e)),
  ])
  return c
}

export async function adminListComplaints(status: 'pending' | 'answered' | null) {
  const [rows, grouped] = await Promise.all([
    prisma.complaints.findMany({ where: status ? { status } : {}, select: SELECT, orderBy: [{ year: 'desc' }, { number: 'desc' }], take: 500 }),
    prisma.complaints.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const counts: Record<string, number> = {}
  for (const g of grouped) counts[g.status] = g._count._all
  return { complaints: rows.map(view), counts }
}

export async function adminGetComplaint(id: string): Promise<ComplaintView | null> {
  const r = await findRow(id)
  return r ? view(r) : null
}

/** Records the provider's answer and emails it to the consumer. */
export async function answerComplaint(id: string, response: string, adminId: string): Promise<ComplaintView | null> {
  const updated = await prisma.complaints.updateMany({ where: { id }, data: { response, status: 'answered', responded_at: new Date(), responded_by: adminId } })
  if (!updated.count) return null
  const c = (await adminGetComplaint(id))!
  const locale: AppLocale = c.locale === 'en' ? 'en' : 'es'
  const t = createTranslator(locale)
  await sendEmail({
    to: c.email,
    subject: t('complaints.email.answerSubject', { code: c.code }),
    text: [t('complaints.email.answerIntro', { name: c.consumer_name, code: c.code }), '', response, '', provider(locale)].join('\n'),
  }).catch((e) => console.error('[complaints] answer email failed:', e instanceof Error ? e.message : e))
  return c
}

function provider(locale: AppLocale): string {
  return `${COMPANY.legalName} · ${COMPANY.taxIdLabel} ${COMPANY.taxId}\n${companyAddress(locale)}\n${COMPANY.email}`
}

/** The receipt (constancia) sent to the consumer, or the notice sent to the company. */
function receiptEmail(c: ComplaintView, locale: AppLocale, forCompany = false): { subject: string; text: string } {
  const t = createTranslator(locale)
  const dateFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Lima' })
  const lines = [
    forCompany ? t('complaints.email.noticeIntro', { code: c.code, date: c.due_date }) : t('complaints.email.receiptIntro', { name: c.consumer_name, code: c.code }),
    '',
    `${t('complaints.sheet.number')}: ${c.code}`,
    `${t('complaints.sheet.date')}: ${dateFmt.format(new Date(c.created_at))}`,
    '',
    `— ${t('complaints.sheet.provider')} —`,
    provider(locale),
    '',
    `— ${t('complaints.sheet.consumer')} —`,
    `${c.consumer_name} · ${t(`complaints.docTypes.${c.doc_type}`)} ${c.doc_number}`,
    c.address,
    [c.phone, c.email].filter(Boolean).join(' · '),
    ...(c.is_minor ? [`${t('complaints.fields.guardian_name')}: ${c.guardian_name}`] : []),
    '',
    `— ${t('complaints.sheet.item')} —`,
    `${t(`complaints.itemTypes.${c.item_type}`)}: ${c.item_description}`,
    ...(c.amount !== null ? [`${t('complaints.sheet.amount')}: S/ ${c.amount.toFixed(2)}`] : []),
    '',
    `— ${t(`complaints.kinds.${c.kind}`)} —`,
    `${t('complaints.fields.detail')}: ${c.detail}`,
    `${t('complaints.fields.request')}: ${c.request}`,
    '',
    t('complaints.legal.deadline'),
    t('complaints.legal.otherWays'),
  ]
  return { subject: forCompany ? t('complaints.email.noticeSubject', { code: c.code }) : t('complaints.email.receiptSubject', { code: c.code }), text: lines.join('\n') }
}
