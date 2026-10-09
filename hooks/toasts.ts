import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Quiet toasts: subagent finished, call denied, context / rate limit crossing a threshold.
// At most one per MIN_GAP_MS; module-level state is lost on reload, which is fine.

const MIN_GAP_MS = 3000
const CONTEXT_AT = 85
const LIMIT_AT = 90

const agents = atom({ plugin: 'agent-deck', key: 'agents' } as const, [])

let lastToastAt = 0
let contextArmed = true
const limitArmed = new Map<string, boolean>()

const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// Returns whether the toast was shown, so a threshold held back by the gap is retried next time.
async function show($: EngineInterface, text: string): Promise<boolean> {
  const now = await $.clock.now()
  if (now - lastToastAt < MIN_GAP_MS) return false
  lastToastAt = now
  $.ui.toast(text)
  return true
}

export function registerToasts(on: Parameters<Register>[0]): void {
  on('turn.complete', { durationMs: /^/ }, async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) return done
    const id = e.agentId
    const cards = (await read($, agents)) as unknown
    const card = (Array.isArray(cards) ? cards : []).find((c: { id?: string }) => c?.id === id) as
      | { description?: string; type?: string; spawnedAt?: number }
      | undefined
    if (!card) return done
    const now = await $.clock.now()
    const ms = typeof e.durationMs === 'number' ? e.durationMs : card.spawnedAt ? now - card.spawnedAt : 0
    const name = short(card.description || card.type || 'agent', 50)
    const verb = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    await show($, `${name}: ${verb} in ${dur(ms)}`)
    return done
  })

  on('tool.check', { tool: /^/ }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny' && e.tool_use_id) {
      await show($, `Denied: ${e.tool}${verdict.reason ? ` (${short(verdict.reason, 60)})` : ''}`)
    }
    return verdict
  })

  // Denials by the user or the auto-mode classifier; the gap drops a duplicate of a tool.check toast.
  on('classic.PermissionDenied', async ($, e, next) => {
    await show($, `Denied: ${e.tool_name}${e.reason ? ` (${short(e.reason, 60)})` : ''}`)
    return next(e)
  })

  on('session.measure', { context: { window: /^/ } }, async ($, e, next) => {
    const pct = e.context.percent
    if (typeof pct === 'number') {
      if (pct < CONTEXT_AT) contextArmed = true
      else if (contextArmed && (await show($, `Context at ${Math.round(pct)}%`))) contextArmed = false
    }
    for (const r of e.rateLimits) {
      const armed = limitArmed.get(r.kind) ?? true
      if (r.percentUsed < LIMIT_AT) limitArmed.set(r.kind, true)
      else if (armed && (await show($, `Rate limit ${r.kind} at ${Math.round(r.percentUsed)}%`))) limitArmed.set(r.kind, false)
    }
    return next(e)
  })
}
