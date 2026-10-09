import 'server-only'
import nodemailer from 'nodemailer'

const clean = (v: string | undefined) => (v ?? '').replace(/^["']|["']$/g, '')

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Sends through SMTP_* (or legacy EMAIL_*) env vars. Without SMTP it logs
 * the message and returns `{ delivered: false }` so dev flows keep working.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  const host = clean(process.env.SMTP_HOST || process.env.EMAIL_HOST)
  const port = parseInt(clean(process.env.SMTP_PORT || process.env.EMAIL_PORT) || '587', 10)
  const user = clean(process.env.SMTP_USER || process.env.EMAIL_USERNAME)
  const pass = clean(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD)
  const from = clean(process.env.SMTP_FROM) || user

  if (!host || !user || !pass) {
    console.log(`\n--- [EMAIL not sent: SMTP not configured] to=${input.to} subject="${input.subject}"\n${input.text}\n---\n`)
    return { delivered: false }
  }

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  await transporter.sendMail({
    from: from.includes('<') ? from : `Whasalia <${from}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  })
  return { delivered: true }
}
