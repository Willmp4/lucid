import type { PromptDecoration } from 'claude-code'
import type { Mark } from '../types'

// The reading keywords in a prompt: `tldr` (or `tl;dr`) and `speak`, counted only in a run at
// the start or the end of the prompt, since `speak` is an ordinary word. Pure functions: the
// hooks live in register.tsx.

export type KeywordRange = { start: number; end: number }
// The prompt's counting keywords, where each one stands, and the text left for Claude.
export type Keywords = { marks: Mark[]; ranges: KeywordRange[]; rest: string }

// A keyword as a whole word: no letter, digit, `-`, or `_` follows it.
const WORD = String.raw`(?:tl;dr|tldr|speak)(?![\p{L}\p{N}_-])`
const RUN = String.raw`${WORD}(?:[\s,]+${WORD})*`
// A leading run ends in `:` or `,`, or at whitespace or the end of the prompt.
const LEADING = new RegExp(String.raw`^\s*(${RUN})(?:\s*[:,]|(?=\s|$))`, 'iu')
// A trailing run follows whitespace or `,`, and can end in `.`.
const TRAILING = new RegExp(String.raw`(?:^|(?<=[\s,]))(${RUN})\.?\s*$`, 'iu')
const EACH = /tl;dr|tldr|speak/giu

// The theme keys Claude Code paints `ultrathink` with, one letter each.
export const RAINBOW = ['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'] as const

const rangesIn = (run: string, at: number): KeywordRange[] =>
  [...run.matchAll(EACH)].map(found => ({ start: at + found.index, end: at + found.index + found[0].length }))

export function readKeywords(prompt: string): Keywords {
  const ranges: KeywordRange[] = []
  let from = 0
  const leading = LEADING.exec(prompt)
  if (leading !== null) {
    ranges.push(...rangesIn(leading[1]!, leading[0].indexOf(leading[1]!)))
    from = leading[0].length
  }
  let to = prompt.length
  const trailing = TRAILING.exec(prompt.slice(from))
  if (trailing !== null) {
    ranges.push(...rangesIn(trailing[1]!, from + trailing.index))
    to = from + trailing.index
  }
  if (ranges.length === 0) return { marks: [], ranges: [], rest: prompt }
  const words = ranges.map(range => prompt.slice(range.start, range.end).toLowerCase())
  const marks = (['tldr', 'speak'] as const).filter(mark => words.some(word => word.replace(';', '') === mark))
  return { marks, ranges, rest: prompt.slice(from, to).trim() }
}

// One decoration a letter, the colours starting again from red for each keyword.
export const keywordDecorations = (ranges: readonly KeywordRange[]): PromptDecoration[] =>
  ranges.flatMap(range => Array.from({ length: range.end - range.start }, (_, i) => ({
    start: range.start + i, end: range.start + i + 1, color: RAINBOW[i % RAINBOW.length]!,
  })))

// What a prompt of keywords alone shows in place of a turn.
export function dropReason(marks: readonly Mark[]): string {
  const summarize = marks.includes('tldr')
  const speak = marks.includes('speak')
  if (summarize && speak) return 'Summarizing and reading the previous reply'
  return summarize ? 'Summarizing the previous reply' : 'Reading the previous reply aloud'
}
