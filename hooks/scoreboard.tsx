// Routing scoreboard: counts each finished subagent per model and level, keeps all-time totals in $.store.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { AgentCard, Routing } from '../types'
import { kTokens, prettyModel } from './core'
const DEFAULT_ROUTING: Routing = { byModel: {}, byLevel: {} }
const routingAtom = atom({ plugin: 'agent-deck', key: 'routing' } as const, DEFAULT_ROUTING)
import { panel } from './ui'
import type { Colors, Els } from './ui'

export type Totals = { since: string; agents: number; routed: number; byModel: Record<string, number> }

const agents = atom({ plugin: 'agent-deck', key: 'agents' } as const, [])
const main = atom({ plugin: 'agent-deck', key: 'main' } as const, { model: '', effort: '', mode: '', steps: 0, isRunning: false })

const TOTALS_KEY = 'agent-deck.totals'

/** Agent ids already counted; a subagent can complete more than once. */
const counted = new Set<string>()

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const asTotals = (raw: unknown): Totals | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Totals>
  const byModel: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.byModel ?? {})) byModel[k] = num(v)
  return { since: typeof r.since === 'string' ? r.since : '', agents: num(r.agents), routed: num(r.routed), byModel }
}

export const readTotals = async ($: EngineInterface): Promise<Totals | null> => asTotals(await $.store.get(TOTALS_KEY))

export function registerScoreboard(on: Parameters<Register>[0]): void {
  on('turn.complete', { isAborted: [true, false] }, async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (!id || counted.has(id)) return done
    const list = await read($, agents)
    const card = (Array.isArray(list) ? (list as AgentCard[]) : []).find(c => c.id === id)
    if (!card) return done
    counted.add(id)
    const m = await read($, main)
    const model = card.model || 'unknown'
    const level = card.level || ''
    const routed = level !== '' && !!card.model && card.model !== (m?.model ?? '')
    await update($, routingAtom, r => {
      const cur: Routing = r ?? DEFAULT_ROUTING
      const s = cur.byModel[model] ?? { agents: 0, routed: 0, ctx: 0, out: 0 }
      return {
        byModel: {
          ...cur.byModel,
          [model]: { agents: s.agents + 1, routed: s.routed + (routed ? 1 : 0), ctx: s.ctx + num(card.ctx), out: s.out + num(card.out) },
        },
        byLevel: level ? { ...cur.byLevel, [level]: (cur.byLevel[level] ?? 0) + 1 } : cur.byLevel,
      }
    })
    const t = (await readTotals($)) ?? { since: new Date(await $.clock.now()).toISOString().slice(0, 10), agents: 0, routed: 0, byModel: {} }
    await $.store.set(TOTALS_KEY, {
      since: t.since,
      agents: t.agents + 1,
      routed: t.routed + (routed ? 1 : 0),
      byModel: { ...t.byModel, [model]: (t.byModel[model] ?? 0) + 1 },
    })
    return done
  })
}

export function scoreboardPanel(p: {
  els: Els
  C: Colors
  w: number
  routing: Routing
  totals: Totals | null
  isOpen: boolean
  onToggle: () => void
}): RenderElement {
  const { Box, Text } = p.els
  const { C } = p
  const rows = Object.entries(p.routing.byModel).sort((a, b) => b[1].agents - a[1].agents)
  const total = rows.reduce((n, [, s]) => n + s.agents, 0)
  const routed = rows.reduce((n, [, s]) => n + s.routed, 0)
  const max = Math.max(1, ...rows.map(([, s]) => s.agents))
  const barW = Math.max(4, Math.min(16, p.w - 40))
  const summary = total === 0 ? '' : `${routed} of ${total} agents on cheaper models`

  const body =
    total === 0 ? (
      <Text dimColor>{'No subagents yet. Simple tasks get sent to cheaper models; the tally shows up here.'}</Text>
    ) : (
      <Box flexDirection="column">
        {rows.map(([model, s]) => {
          const n = Math.max(1, Math.round((s.agents / max) * barW))
          return (
            <Box key={model}>
              <Text color={C.text} wrap="truncate">{`${prettyModel(model).padEnd(12)} ${String(s.agents).padStart(3)} `}</Text>
              <Text color={s.routed > 0 ? C.main : C.faint}>{'█'.repeat(n)}</Text>
              <Text color={C.faint}>{'░'.repeat(barW - n)}</Text>
              <Text dimColor wrap="truncate">{` ${kTokens(s.ctx)} in · ${kTokens(s.out)} out`}</Text>
            </Box>
          )
        })}
        {p.totals && p.totals.agents > 0 ? (
          <Text dimColor wrap="truncate">{`all time${p.totals.since ? ` since ${p.totals.since}` : ''}: ${p.totals.routed} of ${p.totals.agents} agents routed`}</Text>
        ) : null}
      </Box>
    )

  return panel(p.els, { id: 'routing', title: 'model routing', color: C.main, summary, isOpen: p.isOpen, onToggle: p.onToggle, width: p.w }, body)
}
