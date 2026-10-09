import 'server-only'
import nodemailer from 'nodemailer'

const clean = (v: string | undefined) => (v ?? '').replace(/^["']|["']$/g, '')

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html?: string
}

interface MailConfig {
  /** Resend API key: send over HTTPS (Railway Hobby blocks outbound SMTP). */
  resendKey: string
  host: string
  port: number
  user: string
  pass: string
  from: string
}

function mailConfig(): MailConfig {
  const host = clean(process.env.SMTP_HOST || process.env.EMAIL_HOST)
  const pass = clean(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD)
  const user = clean(process.env.SMTP_USER || process.env.EMAIL_USERNAME)
  // A Resend key given as SMTP credentials also goes through the HTTP API.
  const resendKey = clean(process.env.RESEND_API_KEY) || (host === 'smtp.resend.com' && pass.startsWith('re_') ? pass : '')
  return {
    resendKey,
    host,
    port: parseInt(clean(process.env.SMTP_PORT || process.env.EMAIL_PORT) || '587', 10),
    user,
    pass,
    from: clean(process.env.SMTP_FROM) || (resendKey ? 'onboarding@resend.dev' : user),
  }
}

/** True when emails can actually leave the server. */
export function emailConfigured(): boolean {
  const c = mailConfig()
  return !!c.resendKey || !!(c.host && c.user && c.pass)
}

/**
 * Sends through Resend's HTTP API (RESEND_API_KEY, or Resend SMTP
 * credentials) or plain SMTP (SMTP_* / legacy EMAIL_*). Without either it
 * logs the message and returns `{ delivered: false }` so dev flows keep
 * working. Throws when the provider rejects the message.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  const c = mailConfig()
  const from = c.from.includes('<') ? c.from : `Whasalia <${c.from}>`

  if (c.resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(`Resend ${res.status}: ${body?.message ?? res.statusText}`)
    }
    return { delivered: true }
  }

  if (!c.host || !c.user || !c.pass) {
    console.log(`\n--- [EMAIL not sent: SMTP not configured] to=${input.to} subject="${input.subject}"\n${input.text}\n---\n`)
    return { delivered: false }
  }

  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    // Fail fast instead of hanging the request when the port is blocked.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  await transporter.sendMail({ from, to: input.to, subject: input.subject, text: input.text, html: input.html })
  return { delivered: true }
}
