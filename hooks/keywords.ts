import type { PromptDecoration } from 'claude-code'
import type { Mark } from '../types'

// The reading keywords in a prompt: `tldr` (or `tl;dr`) and `speak`, counted only in a run at
// the start or the end of the prompt, since `speak` is an ordinary word. While speech is off,
// only `tldr` counts. Pure functions: the hooks live in register.tsx.

export type KeywordRange = { start: number; end: number }
// The prompt's counting keywords, where each one stands, and the text left for Claude.
export type Keywords = { marks: Mark[]; ranges: KeywordRange[]; rest: string }

export const MARKS: readonly Mark[] = ['tldr', 'speak']
const SPELLINGS: Readonly<Record<Mark, string>> = { tldr: 'tl;dr|tldr', speak: 'speak' }

type Patterns = { leading: RegExp; trailing: RegExp; each: RegExp }

// The patterns for the keywords that count, built once for each set.
const built = new Map<string, Patterns>()
function patternsOf(marks: readonly Mark[]): Patterns {
  const spellings = marks.map(mark => SPELLINGS[mark]).join('|')
  const known = built.get(spellings)
  if (known !== undefined) return known
  // A keyword as a whole word: no letter, digit, `-`, or `_` follows it.
  const word = String.raw`(?:${spellings})(?![\p{L}\p{N}_-])`
  const run = String.raw`${word}(?:[\s,]+${word})*`
  const patterns = {
    // A leading run ends in `:` or `,`, or at whitespace or the end of the prompt.
    leading: new RegExp(String.raw`^\s*(${run})(?:\s*[:,]|(?=\s|$))`, 'iu'),
    // A trailing run follows whitespace or `,`, and can end in `.`.
    trailing: new RegExp(String.raw`(?:^|(?<=[\s,]))(${run})\.?\s*$`, 'iu'),
    each: new RegExp(spellings, 'giu'),
  }
  built.set(spellings, patterns)
  return patterns
}

// The theme keys Claude Code paints `ultrathink` with, one letter each.
export const RAINBOW = ['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'] as const

const rangesIn = (run: string, at: number, each: RegExp): KeywordRange[] =>
  [...run.matchAll(each)].map(found => ({ start: at + found.index, end: at + found.index + found[0].length }))

// The prompt's keywords among those that count: both, or `tldr` alone while speech is off.
export function readKeywords(prompt: string, counting: readonly Mark[] = MARKS): Keywords {
  const patterns = patternsOf(counting)
  const ranges: KeywordRange[] = []
  let from = 0
  const leading = patterns.leading.exec(prompt)
  if (leading !== null) {
    ranges.push(...rangesIn(leading[1]!, leading[0].indexOf(leading[1]!), patterns.each))
    from = leading[0].length
  }
  let to = prompt.length
  const trailing = patterns.trailing.exec(prompt.slice(from))
  if (trailing !== null) {
    ranges.push(...rangesIn(trailing[1]!, from + trailing.index, patterns.each))
    to = from + trailing.index
  }
  if (ranges.length === 0) return { marks: [], ranges: [], rest: prompt }
  const words = ranges.map(range => prompt.slice(range.start, range.end).toLowerCase())
  const marks = MARKS.filter(mark => words.some(word => word.replace(';', '') === mark))
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
