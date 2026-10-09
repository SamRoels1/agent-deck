export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = { model: string; effort: string; mode: string; steps: number; isRunning: boolean }

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  limits: { kind: string; pct: number }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
  /** Difficulty the router rated the task, when it did: simple, moderate or complex. */
  level: string
  /** How many runs this box stands for: a repeat of the same task reuses the box. */
  runs: number
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
  /** The chat row this line is about (a tool call's id, a message id), so a press can scroll to it. */
  rowId: string | null
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null; logOpen: boolean }

export type Roster = { architectTypes: string[] }

export type VaultInfo = {
  notes: number
  areas: { name: string; notes: number }[]
  recent: { name: string; mtimeMs: number }[]
  scannedMs: number
}

/** One line of the shared todo list. Agents set progress and status through the todo tool. */
export type Todo = {
  id: string
  title: string
  status: 'open' | 'doing' | 'done'
  /** 0-100, reported by the agent working on it. */
  progress: number
  /** The agent working on it, once one claimed it. */
  agentId: string | null
  note: string
  source: 'you' | 'planner' | 'agent'
  createdAt: number
  doneAt: number | null
}

export type ModelStat = { agents: number; routed: number; ctx: number; out: number }

/** Routing scoreboard for this session: per model and per difficulty level. */
export type Routing = { byModel: Record<string, ModelStat>; byLevel: Record<string, number> }

export type GitInfo = {
  branch: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  scannedMs: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      vault: VaultInfo | null
      todos: Todo[]
      routing: Routing
      git: GitInfo | null
      /** Ids of boxes the person folded with the arrow button. */
      folded: string[]
    }
  }
}
