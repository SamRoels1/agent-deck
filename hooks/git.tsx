// Git box: branch, ahead/behind and the dirty counts of the session's folder. Read-only git only.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { GitInfo } from '../types'
const git = atom({ plugin: 'agent-deck', key: 'git' } as const, null as GitInfo | null)
import { panel } from './ui'
import type { Colors, Els } from './ui'

const NONE: Omit<GitInfo, 'scannedMs' | 'error'> = { branch: null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0 }

/** Reads `git status --porcelain=v2 --branch` into a GitInfo; never throws. */
export async function refreshGit($: EngineInterface): Promise<void> {
  const scannedMs = Date.now()
  let info: GitInfo
  try {
    // --no-optional-locks: status must not write (it would refresh the index otherwise).
    const r = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 10000 })
    if (r.exitCode !== 0) {
      const msg = r.stderr.trim()
      info = { ...NONE, scannedMs, error: /not a git repository/i.test(msg) ? 'not a git repo' : msg.split('\n')[0] || 'git failed' }
    } else {
      info = { ...NONE, scannedMs, error: null }
      for (const line of r.stdout.split('\n')) {
        if (line.startsWith('# branch.head ')) info.branch = line.slice(14).trim()
        else if (line.startsWith('# branch.ab ')) {
          const m = /\+(\d+) -(\d+)/.exec(line)
          if (m) {
            info.ahead = Number(m[1])
            info.behind = Number(m[2])
          }
        } else if (line.startsWith('? ')) info.untracked++
        else if (line.startsWith('1 ') || line.startsWith('2 ')) {
          // XY after the marker: X is the index (staged), Y the worktree (modified); '.' = unchanged.
          if (line[2] !== '.') info.staged++
          if (line[3] !== '.') info.modified++
        } else if (line.startsWith('u ')) info.modified++
      }
    }
  } catch {
    info = { ...NONE, scannedMs, error: 'git unavailable' }
  }
  await update($, git, () => info).catch(() => undefined)
}

export function gitPanel(p: { els: Els; C: Colors; w: number; info: GitInfo | null; isOpen: boolean; onToggle: () => void }): RenderElement {
  const { Text } = p.els
  const { C, info } = p
  const isRepo = info !== null && info.error === null
  const dirty = isRepo ? info.staged + info.modified + info.untracked : 0
  const color = !info ? C.faint : !isRepo ? C.dim : dirty > 0 ? C.warn : C.gate
  const summary = !info ? 'reading…' : !isRepo ? '' : dirty > 0 ? `${dirty} changed` : 'clean'

  let body: RenderElement
  if (!info) body = <Text color={C.faint}>reading…</Text>
  else if (!isRepo) body = <Text color={C.dim} wrap="truncate">{info.error === 'not a git repo' ? 'not a git repo' : `git: ${info.error}`}</Text>
  else {
    const arrows = `${info.ahead > 0 ? ` ↑${info.ahead}` : ''}${info.behind > 0 ? ` ↓${info.behind}` : ''}`
    body = (
      <Text wrap="truncate">
        <Text color={C.main} bold>{`⎇ ${info.branch ?? '?'}`}</Text>
        <Text color={info.behind > 0 ? C.warn : C.dim}>{arrows}</Text>
        <Text color={dirty > 0 ? C.warn : C.gate}>{dirty > 0 ? `   +${info.staged} ~${info.modified} ?${info.untracked}` : '   ✓ clean'}</Text>
      </Text>
    )
  }
  return panel(p.els, { id: 'git', title: 'git', color, summary, isOpen: p.isOpen, onToggle: p.onToggle, width: p.w }, body)
}

export function registerGit(on: Parameters<Register>[0]): void {
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    void refreshGit($)
    return next(e)
  })
  on('turn.complete', { turnId: /^/ }, async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await refreshGit($)
    return done
  })
}
