import type { CallBody, CallRecord, CallStatus, TurnBlock, TurnItem, TurnRecord } from '../types'
import { errorLine, shortenPath } from './block'
import { cleanText, recordOf, textOf } from './card-model'
import { widthOf } from './reply-table'
import { shellActions } from './shell-command'
import type { ShellAction, ShellTarget } from './shell-command'

// At the blackbox level each run of a turn's calls folds into one block, and Claude's text
// between runs ends a block. These are the pure parts: what a row adds to a turn, a call's
// outcome, and a block's title and status line.

// The input field each editing tool names its file by.
const EDITING: Readonly<Record<string, string>> = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }
const SEARCHING: ReadonlySet<string> = new Set(['Grep', 'Glob'])
// The fields a label names a call by, the first one present winning.
const DETAIL_FIELDS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'skill', 'prompt']
// A record keeps this much of each input string: enough for a one-line title.
const RECORD_TEXT = 300

export type TurnTitle = { verb: string; subject: string; extra?: string }
export type RecordedCall = { id: string; record: CallRecord; body: CallBody }
export type CallResult = { id: string; status: CallStatus; text: string; error?: string }

// The first call of the block that holds a call: the row the block draws at.
export function anchorOf(turn: TurnRecord, id: string): string | undefined {
  return turn.blocks.find(block => block.ids.includes(id))?.ids[0]
}

// The block that takes the turn's next call: its last, until text or the turn's end closes it.
export function openBlock(turn: TurnRecord): TurnBlock | undefined {
  const last = turn.blocks.at(-1)
  return last === undefined || last.closed ? undefined : last
}

// A turn with a response row's items added at `now`: text closes the open block, and a call
// joins it or opens the next one.
export function addItems(turn: TurnRecord, items: readonly TurnItem[], now: number): TurnRecord {
  let blocks = turn.blocks
  for (const item of items) {
    const open = openBlock({ blocks })
    if (item.kind === 'text') {
      if (open !== undefined) blocks = [...blocks.slice(0, -1), { ...open, closed: true }]
    } else if (!blocks.some(block => block.ids.includes(item.id))) {
      blocks = open === undefined
        ? [...blocks, { ids: [item.id], startedAt: now, closed: false }]
        : [...blocks.slice(0, -1), { ...open, ids: [...open.ids, item.id] }]
    }
  }
  return blocks === turn.blocks ? turn : { blocks }
}

// A turn whose calls `ids` were answered at `now`: each block holding one ends then.
export function answerCalls(turn: TurnRecord, ids: readonly string[], now: number): TurnRecord {
  if (!turn.blocks.some(block => block.ids.some(id => ids.includes(id)))) return turn
  return { blocks: turn.blocks.map(block => (block.ids.some(id => ids.includes(id)) ? { ...block, endedAt: now } : block)) }
}

// A turn at its end: the open block closes, and ends now if it was aborted or never answered.
export function endTurn(turn: TurnRecord, now: number, aborted: boolean): TurnRecord {
  const open = openBlock(turn)
  if (open === undefined) return turn
  return { blocks: [...turn.blocks.slice(0, -1), { ...open, closed: true, endedAt: aborted ? now : open.endedAt ?? now }] }
}

// A closed block's elapsed time; an open block's is still running.
export const elapsedOf = (block: TurnBlock): number | undefined =>
  block.closed && block.endedAt !== undefined ? block.endedAt - block.startedAt : undefined

const firstLine = (value: string) => cleanText(value).split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
const baseName = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path

// A call's input as its record keeps it: strings cut, nested values dropped.
export function recordInput(input: unknown): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(recordOf(input))) {
    if (typeof value === 'string') kept[field] = value.length > RECORD_TEXT ? `${value.slice(0, RECORD_TEXT)}…` : value
    else if (typeof value === 'number' || typeof value === 'boolean') kept[field] = value
  }
  return kept
}

// A response row's text and calls, in the order the model wrote them. Thinking, and text that
// is only whitespace, add nothing.
export function responseItems(content: readonly { type: string; [field: string]: unknown }[]) {
  const items: TurnItem[] = []
  const calls: RecordedCall[] = []
  for (const block of content) {
    if (block.type === 'text' && textOf(block.text).trim() !== '') items.push({ kind: 'text' })
    if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
    items.push({ kind: 'call', id: block.id })
    calls.push({
      id: block.id,
      record: { tool: textOf(block.name), input: recordInput(block.input), status: 'running' },
      body: { input: block.input ?? {} },
    })
  }
  return { items, calls }
}

// The first line of a failure, past a shell's `Exit code N` header when more follows.
export function firstErrorLine(text: string): string {
  const lines = text.replace(/<\/?tool_use_error>/g, '').split('\n').map(line => line.trim()).filter(line => line !== '')
  const at = /^Exit code \d+$/.test(lines[0] ?? '') && lines.length > 1 ? 1 : 0
  return lines[at] ?? errorLine(text)
}

const EXIT_CODE = /^Exit code \d+$/
const outputLines = (text: string) => cleanText(text.replace(/<\/?tool_use_error>/g, ''))
  .split('\n').map(line => line.trim()).filter(line => line !== '' && !EXIT_CODE.test(line))

// A failed shell command's error: its first stderr line, else its last stdout line, where
// errors print after any status lines a wrapper prints first.
export function shellErrorLine(stdout: string, stderr: string): string {
  return outputLines(stderr)[0] ?? outputLines(stdout).at(-1) ?? 'Failed'
}

// The line a folded block shows for a failed call. A shell failure's error text holds its
// merged output and reads as stdout; a structured result keeps its streams apart.
export function failureLine(tool: string, text: string, output?: unknown): string {
  if (tool !== 'Bash') return firstErrorLine(text)
  const streams = recordOf(output)
  return typeof streams.stdout === 'string' && typeof streams.stderr === 'string'
    ? shellErrorLine(streams.stdout, streams.stderr)
    : shellErrorLine(text, '')
}

// A Bash result the engine moved to the background: on its timeout, or by `run_in_background`.
export function backgroundOf(output: unknown): { timedOutAfterMs?: number } | undefined {
  const result = recordOf(output)
  if (typeof result.backgroundTaskId !== 'string' || result.backgroundTaskId === '') return undefined
  return typeof result.timedOutAfterMs === 'number' ? { timedOutAfterMs: result.timedOutAfterMs } : {}
}

export const isBackgroundCall = (call: Pick<CallRecord, 'tool' | 'input' | 'background'>) =>
  call.tool === 'Bash' && (call.background !== undefined || call.input.run_in_background === true)

// `Bash: npm run build · moved to background after 120s`, or `· running in background`.
export function backgroundLabel(call: Pick<CallRecord, 'tool' | 'input' | 'background'>, cwd: string): string {
  const after = call.background?.timedOutAfterMs
  return `${callLabel(call, cwd)} · ${after === undefined ? 'running in background' : `moved to background after ${Math.round(after / 1000)}s`}`
}

// Parts of one line, cut by terminal cells to `width` and ended with `…` where cut.
export function fitParts(parts: readonly string[], width: number): string[] {
  if (parts.reduce((sum, part) => sum + widthOf(part), 0) <= width) return [...parts]
  let room = Math.max(0, width - 1)
  let cut = false
  return parts.map(part => {
    if (cut) return ''
    let kept = ''
    for (const char of part) {
      if (widthOf(char) > room) {
        cut = true
        return `${kept}…`
      }
      kept += char
      room -= widthOf(char)
    }
    return kept
  })
}

export const fitLine = (text: string, width: number) => fitParts([text], width)[0]!

const resultText = (content: unknown): string => typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.map(block => (recordOf(block).type === 'text' ? textOf(recordOf(block).text) : '')).join('') : ''

// A result row's outcome for each call it answers.
export function resultsOf(content: readonly { type: string; [field: string]: unknown }[]): CallResult[] {
  return content.filter(block => block.type === 'tool_result' && typeof block.tool_use_id === 'string').map(block => {
    const text = resultText(block.content)
    const id = block.tool_use_id as string
    if (block.is_error !== true) return { id, status: 'ok', text }
    if (/^\[Request interrupted/i.test(text.trim())) return { id, status: 'interrupted', text, error: 'Interrupted' }
    return { id, status: 'failed', text, error: firstErrorLine(text) }
  })
}

// `Bash: python3 toy.py`: the tool and the first line of what the call acts on.
export function callLabel(call: Pick<CallRecord, 'tool' | 'input'>, cwd: string): string {
  const field = DETAIL_FIELDS.find(name => typeof call.input[name] === 'string' && call.input[name] !== '')
  if (field === undefined) return call.tool
  const value = call.input[field] as string
  const detail = field === 'file_path' || field === 'notebook_path' ? cleanText(shortenPath(value, cwd)) : firstLine(value)
  return detail === '' ? call.tool : `${call.tool}: ${detail}`
}

function editingTitle(calls: readonly CallRecord[], cwd: string): TurnTitle | null {
  const touches = new Map<string, number>()
  for (const call of calls) {
    const field = EDITING[call.tool]
    const path = field === undefined ? '' : textOf(call.input[field])
    if (path !== '') touches.set(path, (touches.get(path) ?? 0) + 1)
  }
  if (touches.size === 0) return null
  // The map keeps first-touch order, so the first of a tie wins.
  let most = ''
  for (const [path, count] of touches) if (most === '' || count > touches.get(most)!) most = path
  const shared = [...touches.keys()].filter(path => baseName(path) === baseName(most)).length > 1
  const rest = touches.size - 1
  return {
    verb: 'Editing',
    subject: cleanText(shared ? shortenPath(most, cwd) : baseName(most)),
    ...(rest > 0 ? { extra: `+${rest} ${rest === 1 ? 'file' : 'files'}` } : {}),
  }
}

// What a call does, for the title: a shell command by its segments, Read as a read of its file,
// and Grep and Glob as a search of their path, else their pattern.
function actionsOf(call: CallRecord): ShellAction[] {
  if (call.tool === 'Bash') return shellActions(textOf(call.input.command))
  const path = textOf(call.tool === 'Read' ? call.input.file_path : call.input.path)
  const pattern = textOf(call.input.pattern)
  const target: ShellTarget[] = path !== '' ? [{ kind: 'path', text: path }] : pattern !== '' ? [{ kind: 'pattern', text: pattern }] : []
  if (call.tool === 'Read') return [{ kind: 'read', name: 'Read', targets: path === '' ? [] : target }]
  return SEARCHING.has(call.tool) ? [{ kind: 'search', name: call.tool, targets: target }] : []
}

// A path as the working directory resolves it, so two spellings of one file count once. `~`
// expands to the home directory the working directory sits under, where one shows.
function resolvePath(path: string, cwd: string): string {
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(\/|$)/.exec(cwd)?.[1]
  const expanded = home !== undefined && /^~(\/|$)/.test(path) ? `${home}${path.slice(1)}` : path
  const whole = expanded.startsWith('/') || expanded.startsWith('~') ? expanded : `${cwd}/${expanded}`
  const parts: string[] = []
  for (const part of whole.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return whole.startsWith('/') ? `/${parts.join('/')}` : parts.join('/')
}

// `Reading index.mjs +1 file`: the target the turn's reads and searches touch most, each call
// counting a target once. A path outranks a pattern, which counts in `+N` as one more target.
function touchedTitle(verb: 'Reading' | 'Searching', kind: 'read' | 'search', perCall: readonly ShellAction[][], cwd: string): TurnTitle {
  const touches = new Map<string, { target: ShellTarget; key: string; count: number }>()
  for (const actions of perCall) {
    const keys = new Set<string>()
    for (const action of actions) {
      if (action.kind === 'run') continue
      for (const target of action.targets) {
        const key = target.kind === 'path' ? resolvePath(target.text, cwd) : `\u0000${target.text}`
        if (keys.has(key)) continue
        keys.add(key)
        const touch = touches.get(key)
        if (touch === undefined) touches.set(key, { target, key, count: 1 })
        else touch.count++
      }
    }
  }
  const all = [...touches.values()]
  const named = all.filter(touch => touch.target.kind === 'path')
  let most: (typeof all)[number] | undefined
  for (const touch of named.length > 0 ? named : all) if (most === undefined || touch.count > most.count) most = touch
  if (most === undefined) return { verb, subject: cleanText(perCall.flat().find(action => action.kind === kind)?.name ?? '') }
  const shared = named.filter(touch => baseName(touch.key) === baseName(most.key)).length > 1
  const subject = most.target.kind === 'pattern' ? firstLine(most.target.text) : cleanText(shared ? shortenPath(most.key, cwd) : baseName(most.key))
  const rest = all.length - 1
  return { verb, subject, ...(rest > 0 ? { extra: `+${rest} ${rest === 1 ? 'file' : 'files'}` } : {}) }
}

// What the turn's work is about: its edits, else the first command it runs, else what it reads,
// searches, or uses.
export function titleOf(calls: readonly CallRecord[], cwd: string): TurnTitle {
  const editing = editingTitle(calls, cwd)
  if (editing !== null) return editing
  const perCall = calls.map(actionsOf)
  const actions = perCall.flat()
  const run = actions.find(action => action.kind === 'run')
  if (run !== undefined) return { verb: 'Running', subject: cleanText(run.name) }
  if (actions.some(action => action.kind === 'read')) return touchedTitle('Reading', 'read', perCall, cwd)
  if (actions.some(action => action.kind === 'search')) return touchedTitle('Searching', 'search', perCall, cwd)
  return { verb: 'Using', subject: calls[0]?.tool ?? '' }
}

export const isBrokenCall = (call: Pick<CallRecord, 'status'>) => call.status === 'failed' || call.status === 'interrupted'

export function formatElapsed(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}m ${total % 60}s`
}

// `10 calls · 1 failed · 6.1s`, and the call in progress while the turn runs.
export function statusLine(calls: readonly CallRecord[], durationMs: number | undefined, running?: string): string {
  const failed = calls.filter(isBrokenCall).length
  return [
    `${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`,
    failed > 0 ? `${failed} failed` : '',
    durationMs === undefined ? '' : formatElapsed(durationMs),
    running ?? '',
  ].filter(Boolean).join(' · ')
}
