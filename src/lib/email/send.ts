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
  /** MailerSend API token: send over HTTPS (Railway Hobby blocks outbound SMTP). */
  mailersendKey: string
  host: string
  port: number
  user: string
  pass: string
  from: string
}

const DEFAULT_FROM = 'no-reply@whasalia.com'

function mailConfig(): MailConfig {
  const user = clean(process.env.SMTP_USER || process.env.EMAIL_USERNAME)
  const mailersendKey = clean(process.env.MAILERSEND_API_KEY)
  return {
    mailersendKey,
    host: clean(process.env.SMTP_HOST || process.env.EMAIL_HOST),
    port: parseInt(clean(process.env.SMTP_PORT || process.env.EMAIL_PORT) || '587', 10),
    user,
    pass: clean(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD),
    from: clean(process.env.MAIL_FROM || process.env.SMTP_FROM) || (mailersendKey ? DEFAULT_FROM : user),
  }
}

/** True when emails can actually leave the server. */
export function emailConfigured(): boolean {
  const c = mailConfig()
  return !!c.mailersendKey || !!(c.host && c.user && c.pass)
}

/** "Name <a@b.c>" or "a@b.c" → parts (name defaults to Whasalia). */
export function parseSender(from: string): { email: string; name: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  return m ? { name: m[1].replace(/^["']|["']$/g, '') || 'Whasalia', email: m[2].trim() } : { name: 'Whasalia', email: from.trim() }
}

/**
 * Sends through MailerSend's HTTP API (MAILERSEND_API_KEY) or plain SMTP
 * (SMTP_* / legacy EMAIL_*). Without either it logs the message and returns
 * `{ delivered: false }` so dev flows keep working. Throws when the provider
 * rejects the message.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  const c = mailConfig()
  const sender = parseSender(c.from)

  if (c.mailersendKey) {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.mailersendKey}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ from: sender, to: [{ email: input.to }], subject: input.subject, text: input.text, html: input.html }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string; errors?: Record<string, string[]> } | null
      const detail = body?.errors ? Object.values(body.errors).flat().join(' ') : ''
      throw new Error(`MailerSend ${res.status}: ${detail || body?.message || res.statusText}`)
    }
    // 202 without x-message-id = every recipient is on the suppression list.
    if (!res.headers.get('x-message-id')) {
      console.warn(`[email] MailerSend suppressed the message to ${input.to}`)
      return { delivered: false }
    }
    return { delivered: true }
  }

  if (!c.host || !c.user || !c.pass) {
    console.log(`\n--- [EMAIL not sent: email not configured] to=${input.to} subject="${input.subject}"\n${input.text}\n---\n`)
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
  await transporter.sendMail({ from: `${sender.name} <${sender.email}>`, to: input.to, subject: input.subject, text: input.text, html: input.html })
  return { delivered: true }
}
