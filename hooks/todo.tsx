// The shared todo list: tools agents call, a planner that fills it, a prompt block that points
// agents at it, a /todo command and a box for the dashboard.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Todo } from '../types'
import { panel } from './ui'
import type { Colors, Els } from './ui'

const todos = atom({ plugin: 'agent-deck', key: 'todos' } as const, [] as Todo[])

const PLANNER = 'agent-deck:planner'
const TOOL = (name: string) => `mcp__agent-deck__${name}`
const TOGGLE = 'todo-toggle-'
const ADD = 'todo-add'
const STORE_KEY = 'todos'
const STATUSES = ['open', 'doing', 'done'] as const

const listOf = (v: unknown): Todo[] => (Array.isArray(v) ? (v as Todo[]) : [])
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const GLYPH: Record<Todo['status'], string> = { open: '☐', doing: '◐', done: '☑' }

/** Waiters for a planner's answer, keyed by agent id; `finished` covers an answer that beat the waiter. */
const waiting = new Map<string, (answer: string) => void>()
const finished = new Map<string, string>()

/** Change the list, keep a copy in $.store (best effort), return the new list. */
async function change($: EngineInterface, fn: (list: Todo[]) => Todo[]): Promise<Todo[]> {
  const next = listOf(await update($, todos, l => fn(listOf(l))))
  $.store.set(STORE_KEY, next).catch(() => undefined)
  return next
}

const line = (t: Todo) => `${GLYPH[t.status]} ${t.id} ${t.title}${t.status === 'doing' ? ` (${t.progress}%)` : ''}`
const summary = (list: Todo[]) => (list.length === 0 ? 'The todo list is empty.' : list.map(line).join('\n'))

async function addTodo($: EngineInterface, title: string, source: Todo['source']): Promise<Todo> {
  const createdAt = await $.clock.now()
  let made!: Todo
  await change($, list => {
    const n = list.reduce((m, t) => Math.max(m, Number(t.id.slice(1)) || 0), 0) + 1
    made = { id: `t${n}`, title, status: 'open', progress: 0, agentId: null, note: '', source, createdAt, doneAt: null }
    return [...list, made]
  })
  return made
}

/** Set a todo's status the way a person does: done fills the bar, open empties it. */
async function setStatus($: EngineInterface, id: string, status: Todo['status']): Promise<Todo | null> {
  const now = await $.clock.now()
  const hit: Todo[] = []
  await change($, list =>
    list.map(t => {
      if (t.id !== id) return t
      const found = { ...t, status, progress: status === 'done' ? 100 : status === 'open' ? 0 : t.progress, doneAt: status === 'done' ? now : null, agentId: status === 'open' ? null : t.agentId }
      hit[0] = found
      return found
    }),
  )
  return hit[0] ?? null
}

export function registerTodo(on: Parameters<Register>[0]): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: 'The shared todo list: add, done, open, rm, clear, list, or plan a goal',
      argumentHint: 'add <title> | done <id> | open <id> | rm <id> | clear | list | plan <goal>',
    })
    await $.tool.register({
      name: 'todo_add',
      description: 'Add a line to the shared todo list. Returns its id.',
      inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'What needs doing, one concrete line' } }, required: ['title'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_update',
      description: "Update a todo: claim it with status 'doing', report progress 0-100 as you work, set status 'done' when finished.",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: "The todo's id, like t3" },
          status: { type: 'string', enum: [...STATUSES] },
          progress: { type: 'number', minimum: 0, maximum: 100 },
          note: { type: 'string', description: 'A short remark to keep on the todo' },
        },
        required: ['id'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_list',
      description: 'List the shared todo list with each status and progress.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.agent.register({
      name: 'planner',
      description: 'Splits a goal into 3 to 8 concrete todos on the shared todo list.',
      prompt:
        'You plan work. You get a goal. Look at the code only if you must (read-only tools), then create 3 to 8 concrete, ' +
        `separate, checkable todos by calling ${TOOL('todo_add')} once per todo, in the order they should be done. ` +
        `Call ${TOOL('todo_list')} first and do not repeat what is on it. Finish with one line saying what you planned. Do not do the work yourself.`,
      tools: ['Read', 'Glob', 'Grep', TOOL('todo_add'), TOOL('todo_list')],
      omitClaudeMd: true,
    })
    // A fresh session starts empty here; bring back the copy kept in $.store.
    if (listOf(await read($, todos)).length === 0) {
      const kept = listOf(await $.store.get(STORE_KEY).catch(() => undefined))
      if (kept.length > 0) await update($, todos, () => kept)
    }
    return next(e)
  })

  on('tool.call', { tool: TOOL('todo_add') }, async ($, e) => {
    const title = String((e as unknown as { title?: unknown }).title ?? '').trim()
    if (!title) return { result: 'todo_add needs a title.' }
    const caller = e.agentId ? (await $.agent.list()).find(a => a.id === e.agentId) : undefined
    const t = await addTodo($, title, caller?.type === PLANNER ? 'planner' : 'agent')
    return { result: `Added ${t.id}: ${t.title}` }
  })

  on('tool.call', { tool: TOOL('todo_update') }, async ($, e) => {
    const a = e as unknown as { id?: unknown; status?: unknown; progress?: unknown; note?: unknown }
    const id = String(a.id ?? '')
    const now = await $.clock.now()
    const hit: Todo[] = []
    await change($, list =>
      list.map(t => {
        if (t.id !== id) return t
        const status = STATUSES.find(s => s === a.status) ?? t.status
        let progress = typeof a.progress === 'number' && Number.isFinite(a.progress) ? clamp(a.progress) : t.progress
        if (status === 'done') progress = 100
        const found: Todo = {
          ...t,
          status,
          progress,
          note: typeof a.note === 'string' ? a.note : t.note,
          agentId: a.status === 'doing' ? (e.agentId ?? null) : t.agentId,
          doneAt: status === 'done' ? (t.doneAt ?? now) : status === t.status ? t.doneAt : null,
        }
        hit[0] = found
        return found
      }),
    )
    const found = hit[0]
    if (!found) return { result: `No todo with id ${id}. Use todo_list to see them.` }
    return { result: `Updated ${line(found)}` }
  })

  on('tool.call', { tool: TOOL('todo_list') }, async $ => ({ result: summary(listOf(await read($, todos))) }))

  on('command.run', { command: 'todo' }, async ($, e) => ({ text: await todoCommand($, e.args) }))

  // The panel's glyph buttons and add field, found by their keys.
  on('ui.press', async ($, e, next) => {
    if (e.element.startsWith(TOGGLE)) {
      const id = e.element.slice(TOGGLE.length)
      const t = listOf(await read($, todos)).find(x => x.id === id)
      if (t) await setStatus($, id, t.status === 'done' ? 'open' : 'done')
    }
    return next(e)
  })

  on('ui.input', async ($, e, next) => {
    if (e.element.startsWith(ADD) && e.kind === 'submit' && e.value.trim()) await addTodo($, e.value.trim(), 'you')
    return next(e)
  })

  // Tell every agent about the open items so it can claim one. The planner makes the list, so it skips it.
  on('agent.spawn', { prompt: /^/ }, async ($, e, next) => {
    if (e.subagentType === PLANNER || e.workflow) return next(e)
    const open = listOf(await read($, todos)).filter(t => t.status === 'open')
    if (open.length === 0) return next(e)
    const block =
      `\n\nShared todo list (open items):\n${open.map(t => `- ${t.id}: ${t.title}`).join('\n')}\n` +
      `If your work matches one of these, claim it with ${TOOL('todo_update')} (status 'doing'), report progress 0-100 as you go, ` +
      "and set status 'done' when you are finished. If nothing matches, ignore this list."
    return next({ ...e, prompt: e.prompt + block })
  })

  // The planner's answer is its turn.complete.
  on('turn.complete', { answer: /^/ }, async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) {
      const wake = waiting.get(e.agentId)
      if (wake) wake(e.answer)
      else {
        finished.set(e.agentId, e.answer)
        if (finished.size > 20) finished.delete(finished.keys().next().value as string)
      }
    }
    return done
  })
}

/** Start the planner on a goal and resolve with its one-line reply. */
async function planTodos($: EngineInterface, goal: string): Promise<string> {
  const { agentId, deny } = await $.agent.spawn({ subagentType: PLANNER, description: 'Plan todos', prompt: `Goal: ${goal}` })
  if (deny !== undefined) return `Planner refused: ${deny}`
  if (!agentId) return 'Planner did not start.'
  const early = finished.get(agentId)
  if (early !== undefined) {
    finished.delete(agentId)
    return early.trim() || 'Planned.'
  }
  return new Promise<string>(resolve => {
    const timer = $.clock.after(180_000, () => {
      waiting.delete(agentId)
      resolve('The planner took too long; what it added so far is on the list.')
    })
    waiting.set(agentId, answer => {
      timer.cancel()
      waiting.delete(agentId)
      resolve(answer.trim() || 'Planned.')
    })
  })
}

async function todoCommand($: EngineInterface, args: string): Promise<string> {
  const text = args.trim()
  const [verb = 'list', ...rest] = text.split(/\s+/)
  const arg = text.slice(verb.length).trim()
  const id = rest[0] ?? ''
  const need = (what: string) => `Usage: /todo ${what}`
  switch (verb || 'list') {
    case 'add': {
      if (!arg) return need('add <title>')
      const t = await addTodo($, arg, 'you')
      return `Added ${t.id}: ${t.title}`
    }
    case 'done':
    case 'open': {
      if (!id) return need(`${verb} <id>`)
      const t = await setStatus($, id, verb)
      return t ? line(t) : `No todo with id ${id}.`
    }
    case 'rm': {
      if (!id) return need('rm <id>')
      const before = listOf(await read($, todos)).length
      const after = await change($, l => l.filter(t => t.id !== id))
      return after.length < before ? `Removed ${id}.` : `No todo with id ${id}.`
    }
    case 'clear': {
      const before = listOf(await read($, todos)).length
      const after = await change($, l => l.filter(t => t.status !== 'done'))
      return `Cleared ${before - after.length} done.`
    }
    case 'plan':
      return arg ? planTodos($, arg) : need('plan <goal>')
    case 'list':
      return summary(listOf(await read($, todos)))
    default:
      return need('add <title> | done <id> | open <id> | rm <id> | clear | list | plan <goal>')
  }
}

export function todoPanel(p: {
  els: Els
  C: Colors
  w: number
  items: Todo[]
  isOpen: boolean
  onToggle: () => void
}): RenderElement {
  const { els, C, items } = p
  const { Box, Text, Button } = els
  const done = items.filter(t => t.status === 'done').length
  const colorOf = (t: Todo) => (t.status === 'done' ? C.faint : t.status === 'doing' ? C.agent : C.text)
  const body = (
    <Box flexDirection="column">
      {items.length === 0 ? <Text color={C.faint}>{'Nothing to do yet. Add a line below, or let the planner split a goal: /todo plan <goal>'}</Text> : null}
      {items.map(t => {
        const filled = Math.round((t.progress / 100) * 6)
        return (
          <Box>
            <Button key={`${TOGGLE}${t.id}`} plain label={GLYPH[t.status]} onPress={() => undefined} />
            <Text color={C.faint}>{` ${t.id} `}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={colorOf(t)} dimColor={t.status === 'done'} wrap="truncate">
                {t.title}
              </Text>
            </Box>
            {t.status === 'doing' ? (
              <Box flexShrink={0}>
                <Text color={C.agent}>{` ${'█'.repeat(filled)}${'░'.repeat(6 - filled)} ${t.progress}%`}</Text>
              </Box>
            ) : null}
            {t.agentId && t.status !== 'done' ? (
              <Box flexShrink={0}>
                <Text color={C.dim}>{` ${t.agentId.slice(0, 8)}`}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
      {'Input' in els ? (
        <els.Input
          key={`${ADD}-${items.length}`}
          placeholder="new todo"
          submitLabel="add"
          onSubmit={() => undefined}
        />
      ) : (
        <Text color={C.faint}>{'add one with /todo add <title>'}</Text>
      )}
    </Box>
  )
  return panel(els, { id: 'todo', title: 'todo', color: C.agent, summary: `${done}/${items.length} done`, isOpen: p.isOpen, onToggle: p.onToggle, width: p.w }, body)
}

/** The todo an agent is working on, for its progress bar. */
export function progressOf(items: Todo[], agentId: string): { id: string; title: string; progress: number } | null {
  const t = items.find(x => x.status === 'doing' && x.agentId === agentId)
  return t ? { id: t.id, title: t.title, progress: t.progress } : null
}
