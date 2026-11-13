import 'server-only'
import crypto from 'node:crypto'

// Sample data for TIKTOK_SANDBOX (local demos before TikTok approves the
// app). Nothing here reaches TikTok.

export const SANDBOX_CODE = 'sandbox'

export const SANDBOX_ACCOUNT = {
  openId: 'sandbox-open-id-sonrisadental',
  username: 'sonrisadental.pe',
  displayName: 'Sonrisa Dental',
}

const thumb = (from: string, to: string, label: string) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="360" height="480" fill="url(#g)"/>` +
      `<text x="24" y="440" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">${label}</text>` +
      `<circle cx="180" cy="220" r="44" fill="#ffffff33"/><path d="M168 198v44l36-22z" fill="#fff"/></svg>`,
  )

export const SANDBOX_VIDEOS = [
  { id: '7400000000000000001', caption: 'Whitening in 1 hour ✨ #smile #dentist', label: 'Whitening in 1 hour', from: '#12b886', to: '#0b7285', days: 1 },
  { id: '7400000000000000002', caption: 'Braces: before & after 😁', label: 'Braces before & after', from: '#f76707', to: '#d6336c', days: 3 },
  { id: '7400000000000000003', caption: 'November promo: -20% on cleanings', label: 'November promo -20%', from: '#2f9e44', to: '#5c940d', days: 6 },
  { id: '7400000000000000004', caption: 'Meet our team 👩‍⚕️', label: 'Meet our team', from: '#7048e8', to: '#1c7ed6', days: 9 },
  { id: '7400000000000000005', caption: 'Kids check-up day 🦷', label: 'Kids check-up day', from: '#1971c2', to: '#0c8599', days: 14 },
  { id: '7400000000000000006', caption: 'Tour of our clinic', label: 'Clinic tour', from: '#ae3ec9', to: '#e64980', days: 20 },
].map((v) => ({
  id: v.id,
  text: v.caption,
  imageUrl: thumb(v.from, v.to, v.label),
  permalink: null,
  createdAt: new Date(Date.now() - v.days * 86_400_000).toISOString(),
}))

/** People who "comment" when the demo button is pressed, in turn. */
const SAMPLE_COMMENTS = [
  { id: 'maria.lopez', name: 'María López', text: 'How much does the whitening cost? 😍' },
  { id: 'luis.fernandez', name: 'Luis Fernández', text: 'What is the price? 🙏' },
  { id: 'camila.v', name: 'Camila V.', text: 'Amazing results!! Do you open on Saturdays?' },
  { id: 'jorge_r', name: 'Jorge R.', text: 'Does it hurt? info please' },
]

export function sandboxComment(index: number) {
  const c = SAMPLE_COMMENTS[index % SAMPLE_COMMENTS.length]
  return {
    commentId: `sandbox-${crypto.randomBytes(6).toString('hex')}`,
    // A new "person" each round, so the one-reply-per-person rule doesn't hide the demo.
    authorId: `${c.id}-${Math.floor(index / SAMPLE_COMMENTS.length)}`,
    authorName: c.name,
    text: c.text,
  }
}
