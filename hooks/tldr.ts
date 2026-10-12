import type { ModelCompleteRequest, ModelCompleteResult } from 'claude-code'
import type { Summary } from '../types'

// A reply's summary: one Haiku call, its result cut to a few lines, or the reason it failed.
// Pure functions: the call lives in register.tsx.

export const SUMMARY_SYSTEM = "Summarize a coding assistant's reply for the person who asked for it. Write one to three short lines of plain text with no headings or lists. Lead with the outcome. Copy any question the reply asks the reader, and any failure it reports, word for word."
// The summary keeps at most this many nonblank lines.
export const SUMMARY_LINES = 6

export const summaryRequest = (reply: string): ModelCompleteRequest => ({
  model: 'haiku',
  system: SUMMARY_SYSTEM,
  prompt: `<reply>\n${reply}\n</reply>`,
  maxTokens: 300,
  effort: 'low',
  timeoutMs: 30000,
})

export type Settled = Extract<Summary, { state: 'ready' | 'failed' }>

// The model's answer as a summary: its first nonblank lines, trimmed, or why there is none.
export function summaryOf(result: ModelCompleteResult): Settled {
  if (!result.isAnswered) {
    if (result.reason === 'aborted') return { state: 'failed', reason: 'timed out' }
    if (result.reason === 'api-error') return { state: 'failed', reason: `API error ${result.error}${result.status === null ? '' : ` (${result.status})`}` }
    return { state: 'failed', reason: 'no text' }
  }
  const lines = result.text.split('\n').map(line => line.trim()).filter(line => line !== '').slice(0, SUMMARY_LINES)
  return lines.length === 0 ? { state: 'failed', reason: 'no text' } : { state: 'ready', text: lines.join('\n') }
}
