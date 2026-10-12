import type { CallBody, CallRecord, CallStatus, TurnItem, TurnRecord } from '../types'
import { errorLine, shortenPath } from './block'
import { cleanText, recordOf, textOf } from './card-model'

// At the blackbox level a turn's calls and the text between them fold into one block. These
// are the pure parts: what a row adds to a turn, which text a later call follows, and the
// block's title and status line.

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

export function anchorOf(turn: TurnRecord): string | undefined {
  return turn.items.find(item => item.kind === 'call')?.id
}

// Text that a later call of the same turn follows folds into the block.
export function isInBetween(turn: TurnRecord, id: string): boolean {
  const at = turn.items.findIndex(item => item.kind === 'text' && item.id === id)
  return at !== -1 && turn.items.slice(at + 1).some(item => item.kind === 'call')
}

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

// A response row's text and calls, in the order the model wrote them.
export function responseItems(id: string, content: readonly { type: string; [field: string]: unknown }[]) {
  const items: TurnItem[] = []
  const calls: RecordedCall[] = []
  const text = content.filter(block => block.type === 'text').map(block => textOf(block.text)).join('')
  if (text.trim() !== '') items.push({ kind: 'text', id, text })
  for (const block of content) {
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

// What the turn's work is about: its edits, else its first command, read, search, or tool.
export function titleOf(calls: readonly CallRecord[], cwd: string): TurnTitle {
  const editing = editingTitle(calls, cwd)
  if (editing !== null) return editing
  const shell = calls.find(call => call.tool === 'Bash')
  if (shell !== undefined) return { verb: 'Running', subject: firstLine(textOf(shell.input.command)) }
  const read = calls.find(call => call.tool === 'Read')
  if (read !== undefined) return { verb: 'Reading', subject: cleanText(baseName(textOf(read.input.file_path))) }
  const search = calls.find(call => SEARCHING.has(call.tool))
  if (search !== undefined) return { verb: 'Searching', subject: firstLine(textOf(search.input.pattern)) }
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
