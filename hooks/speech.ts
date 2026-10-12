import { FENCE, splitReply } from './reply-table'

// A reply's markdown as sentences for the system synthesizer: code, tables, and HTML drop out,
// and markers fall away so they are not read aloud. Pure functions: the hooks live in
// register.tsx.

// The synthesizer speaks the first 4,096 characters of an utterance.
export const SPEECH_CAP = 4096

const RULE = /^\s*([-*_=])(\s*\1){2,}\s*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(\s+#+)?\s*$/
const QUOTE = /^\s*(>\s?)+/
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

// Fenced code out, open or closed; every other line kept.
function withoutFences(lines: readonly string[]): string[] {
  const kept: string[] = []
  let fence: { char: string; length: number } | null = null
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null
    } else if (marker !== undefined) {
      fence = { char: marker[0]!, length: marker.length }
    } else {
      kept.push(line)
    }
  }
  return kept
}

// Links as their text, inline code as its text, a bare URL as `link`, and emphasis without
// its markers. Code keeps its characters as written.
function inline(text: string): string {
  const code: string[] = []
  const held = text.replace(/(`+)(.+?)\1/g, (_, _ticks, inner: string) => `\u0000${code.push(inner.trim()) - 1}\u0000`)
  return held
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\bhttps?:\/\/[^\s<>()\]]*[^\s<>()\].,;:!?'"]/g, 'link')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .replace(/\u0000(\d+)\u0000/g, (_, at: string) => code[Number(at)] ?? '')
}

// Paragraphs of plain text: blank lines, rules, headings, and list items each end one.
function paragraphsOf(markdown: string): string[] {
  const text = splitReply(markdown)
    .flatMap(segment => (segment.kind === 'text' ? [segment.text] : []))
    .join('\n\n')
  const lines = withoutFences(text.split('\n'))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(https?:\/\/[^>\s]+)>/g, 'link')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .split('\n')
  const paragraphs: string[] = []
  let current: string[] = []
  const end = () => {
    const paragraph = current.join(' ').replace(/\s+/g, ' ').trim()
    if (paragraph !== '') paragraphs.push(paragraph)
    current = []
  }
  for (const raw of lines) {
    if (raw.trim() === '' || RULE.test(raw)) {
      end()
      continue
    }
    const line = raw.replace(QUOTE, '')
    const heading = HEADING.exec(line)
    if (heading !== null || ITEM.test(line)) {
      end()
      current.push(inline(heading !== null ? heading[1]! : line.replace(ITEM, '')))
      end()
      continue
    }
    current.push(inline(line))
  }
  end()
  return paragraphs
}

// A sentence over the cap, cut at the last whitespace under it, or at the cap itself.
function capped(sentence: string): string[] {
  const parts: string[] = []
  let rest = sentence
  while (rest.length > SPEECH_CAP) {
    const head = rest.slice(0, SPEECH_CAP + 1)
    const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'))
    const cut = space > 0 ? space : SPEECH_CAP
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

// The reply's sentences in order: split after `.`, `!`, or `?` and whitespace, and between
// paragraphs.
export const speechSentences = (markdown: string): string[] =>
  paragraphsOf(markdown).flatMap(paragraph => paragraph.split(/(?<=[.!?])\s+/).flatMap(capped))
