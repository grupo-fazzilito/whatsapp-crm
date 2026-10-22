'use client'

// How a new notification gets someone's attention besides the bell: a short
// chime and, when the tab isn't in front, the system notification. Both are
// per-browser preferences (localStorage; defaults: sound on, desktop off
// until the browser grants permission).

const SOUND_KEY = 'whasalia.notify.sound'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode / blocked storage: the preference just isn't kept
  }
}

export function soundEnabled(): boolean {
  return read(SOUND_KEY) !== 'off'
}

export function setSoundEnabled(on: boolean) {
  write(SOUND_KEY, on ? 'on' : 'off')
}

export type DesktopPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function desktopPermission(): DesktopPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === 'unsupported') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return desktopPermission()
  }
}

/** Two soft rising notes (WebAudio, no sound file). */
export function playChime() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  try {
    const ctx = new Ctx()
    const t = ctx.currentTime
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain).connect(ctx.destination)
      const start = t + i * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
      osc.start(start)
      osc.stop(start + 0.32)
    })
    setTimeout(() => void ctx.close().catch(() => {}), 800)
  } catch {
    // audio blocked until the user interacts with the page
  }
}

/** System notification while the tab isn't visible; clicking it brings the tab back. */
export function showDesktop(n: { id: string; title: string; body?: string | null }, onClick: () => void) {
  if (desktopPermission() !== 'granted' || document.visibilityState === 'visible') return
  try {
    const note = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: '/favicon.ico' })
    note.onclick = () => {
      window.focus()
      onClick()
      note.close()
    }
  } catch {
    // some mobile browsers only allow notifications from a service worker
  }
}

/** Notification types worth a sound: someone needs this person now. */
export const ALERT_TYPES = new Set(['assigned', 'transferred', 'handover', 'mention'])
