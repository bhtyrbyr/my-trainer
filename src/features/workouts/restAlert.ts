// Rest-end feedback: vibration (Android/Chrome; iOS ignores it) + a short two-tone beep via WebAudio.
// iOS only lets audio play after a user gesture, so primeAudio() is called from the "complete set" tap.

let ctx: AudioContext | null = null

export function primeAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

export function restEndAlert(): void {
  try {
    navigator.vibrate?.([220, 120, 220])
  } catch {
    /* not supported */
  }
  const ac = ctx
  if (!ac) return
  try {
    const t0 = ac.currentTime + 0.01
    for (const [offset, freq] of [
      [0, 880],
      [0.24, 1175],
    ] as const) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18)
      osc.connect(gain).connect(ac.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.2)
    }
  } catch {
    /* audio blocked */
  }
}
