'use client'

// Browser side of a WhatsApp call: WhatsApp sends a WebRTC offer, the agent's
// browser answers it and the audio flows directly between the two. Our
// server only relays the SDP to Meta (pre_accept / accept).

export interface BrowserCall {
  /** SDP answer to send to Meta (complete: ICE candidates included, no trickle). */
  answerSdp: string
  /** Resolves once the media path is up (or after the timeout). */
  connected: Promise<boolean>
  /** Audio goes out only after Meta confirms accept, to avoid clipping. */
  startSending(): void
  setMuted(muted: boolean): void
  close(): void
  onEnded(cb: () => void): void
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

function iceGatheringDone(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

function waitConnected(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  const ok = () => pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
  if (ok()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    const onChange = () => {
      if (ok()) finish(true)
      else if (pc.connectionState === 'failed') finish(false)
    }
    function finish(v: boolean) {
      clearTimeout(timer)
      pc.removeEventListener('connectionstatechange', onChange)
      pc.removeEventListener('iceconnectionstatechange', onChange)
      resolve(v)
    }
    pc.addEventListener('connectionstatechange', onChange)
    pc.addEventListener('iceconnectionstatechange', onChange)
  })
}

/** Asks for the microphone and builds the answer to WhatsApp's offer. Throws 'microphone' when access is denied. */
export async function answerOffer(offerSdp: string, audio: HTMLAudioElement): Promise<BrowserCall> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
  } catch {
    throw new Error('microphone')
  }
  const track = stream.getAudioTracks()[0]
  track.enabled = false
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  pc.addTrack(track, stream)
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0] ?? new MediaStream([e.track])
    void audio.play().catch(() => {})
  }
  const endedCbs: (() => void)[] = []
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    stream.getTracks().forEach((t) => t.stop())
    pc.close()
    audio.srcObject = null
    endedCbs.forEach((cb) => cb())
  }
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') close()
  })

  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    await pc.setLocalDescription(await pc.createAnswer())
    await iceGatheringDone(pc, 3000)
  } catch (err) {
    close()
    throw err
  }
  let muted = false
  let sending = false
  return {
    answerSdp: pc.localDescription?.sdp ?? '',
    connected: waitConnected(pc, 8000),
    startSending() {
      sending = true
      track.enabled = !muted
    },
    setMuted(m) {
      muted = m
      track.enabled = sending && !m
    },
    close,
    onEnded(cb) {
      endedCbs.push(cb)
    },
  }
}

/** Phone-like ring with WebAudio (no sound file). Returns stop(). */
export function startRinging(): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  const ctx = new Ctx()
  let stopped = false
  const ring = () => {
    if (stopped) return
    const t = ctx.currentTime
    for (const offset of [0, 0.4]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440
      osc.connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001, t + offset)
      gain.gain.exponentialRampToValueAtTime(0.15, t + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.35)
      osc.start(t + offset)
      osc.stop(t + offset + 0.36)
    }
  }
  ring()
  const timer = setInterval(ring, 2500)
  return () => {
    stopped = true
    clearInterval(timer)
    void ctx.close().catch(() => {})
  }
}
