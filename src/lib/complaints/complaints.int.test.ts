// Libro de Reclamaciones against a real Postgres. TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/complaints
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const sent: { to: string; subject: string; text: string }[] = []
vi.mock('@/lib/email/send', () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { delivered: true } } }))
const pg = await pgTest()

describe.skipIf(!pg)('complaints book', async () => {
  if (!pg) return
  const { fileComplaint, adminListComplaints, answerComplaint } = await import('./server')
  const { parseComplaint } = await import('./input')
  const { COMPANY } = await import('@/lib/company')
  const made: string[] = []
  const stamp = Date.now()
  const admin = await pg.workspace()
  afterAll(async () => {
    await pg.prisma.complaints.deleteMany({ where: { id: { in: made } } })
    await pg.cleanup(admin)
  })

  const form = (n: number) => {
    const r = parseComplaint({
      kind: 'reclamo', consumer_name: `Test ${stamp} ${n}`, doc_type: 'dni', doc_number: '12345678', address: 'Av. Test 1, Huancayo',
      email: `c${n}-${stamp}@test.local`, item_type: 'servicio', item_description: 'Recarga de tokens', amount: '50', detail: 'No recibí los tokens pagados.', request: 'Acreditar los tokens.', accepted: true,
    })
    if (!r.ok) throw new Error('bad fixture')
    return r.value
  }

  it('numbers complaints correlatively per year, also when filed at once', async () => {
    const all = await Promise.all([1, 2, 3].map((n) => fileComplaint(form(n), { locale: 'es', ip: '127.0.0.1' })))
    made.push(...all.map((c) => c.id))
    const numbers = all.map((c) => c.number).sort((a, b) => a - b)
    expect(numbers[1]).toBe(numbers[0] + 1)
    expect(numbers[2]).toBe(numbers[0] + 2)
    expect(all[0].code).toMatch(/^\d{6}-\d{4}$/)
    expect(all[0].status).toBe('pending')
  })

  it('emails the receipt to the consumer and a notice to the company', () => {
    const receipt = sent.find((m) => m.to === `c1-${stamp}@test.local`)
    expect(receipt?.subject).toMatch(/Constancia de tu hoja de reclamación N\.° \d{6}-\d{4}/)
    expect(receipt?.text).toContain(COMPANY.legalName)
    expect(receipt?.text).toContain('quince (15) días hábiles')
    expect(sent.filter((m) => m.to === COMPANY.email).length).toBeGreaterThanOrEqual(3)
  })

  it('answers a complaint and emails the answer', async () => {
    const id = made[0]
    const c = await answerComplaint(id, 'Acreditamos 1000 tokens en tu cuenta.', admin.userId)
    expect(c).toMatchObject({ status: 'answered', response: 'Acreditamos 1000 tokens en tu cuenta.' })
    const mail = sent.at(-1)!
    expect(mail.subject).toMatch(/Respuesta a tu hoja de reclamación/)
    expect(mail.text).toContain('Acreditamos 1000 tokens')
    const { complaints } = await adminListComplaints('answered')
    expect(complaints.some((x) => x.id === id)).toBe(true)
  })
})
