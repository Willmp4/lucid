import { FENCE, splitReply } from './reply-table'
import type { Segment } from './reply-table'

// A fenced code block too long for skins, split into pieces skins draws in colour. skins
// draws a reply only when each of its text runs and fences is at most 9,000 characters;
// one longer block hands the whole reply back to Claude Code's plain drawing. Pure
// functions: the drawing lives in reply.tsx.

// skins' cap on a block it draws (`MAX_MARKDOWN` in its hooks/reply.ts).
export const MAX_MARKDOWN = 9000
// Nodes per character of skins' drawing of a 9,000-character fence, measured on skins 0.5.0
// for TypeScript, Python, Markdown, and JSON (0.06 to 0.27): the densest, rounded up.
const NODES_PER_CHARACTER = 0.3
// The host refuses a tree of more than 20,000 nodes and draws its own instead.
const TREE_NODES = 20000

type Block = { kind: 'prose'; lines: string[] } | { kind: 'fence'; open: string; body: string[]; close: string }

const rawOf = (block: Block) => (block.kind === 'prose' ? block.lines : [block.open, ...block.body, block.close]).join('\n')
const isLong = (block: Block) => block.kind === 'fence' && rawOf(block).length > MAX_MARKDOWN

// Text as runs of prose and closed fences, read as the table splitter reads fences. A fence
// still streaming, with no closing marker yet, stays prose, as skins keeps it.
function blocksOf(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  const prose = (line: string) => {
    const last = blocks.at(-1)
    if (last?.kind === 'prose') last.lines.push(line)
    else blocks.push({ kind: 'prose', lines: [line] })
  }
  for (let i = 0; i < lines.length; i++) {
    const marker = FENCE.exec(lines[i]!)?.[1]
    const close = marker === undefined ? -1 : lines.findIndex((line, j) => {
      if (j <= i) return false
      const end = FENCE.exec(line)?.[1]
      return end !== undefined && end[0] === marker[0] && end.length >= marker.length && line.trim() === end
    })
    if (close === -1) {
      prose(lines[i]!)
      continue
    }
    blocks.push({ kind: 'fence', open: lines[i]!, body: lines.slice(i + 1, close), close: lines[close]! })
    i = close
  }
  return blocks
}

// A line cut into chunks of `size`, never between the halves of a surrogate pair.
function chunksOf(line: string, size: number): string[] {
  const chunks: string[] = []
  let rest = line
  while (rest.length > size) {
    const cut = /[\uD800-\uDBFF]/.test(rest[size - 1]!) ? size - 1 : size
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  chunks.push(rest)
  return chunks
}

// A long fence as pieces whose raw text stays within the cap, each with the opening line
// and the closing marker. Every line lands once, in order; a line longer than a piece can
// hold splits at that length.
export function piecesOf(open: string, body: readonly string[], close: string, cap = MAX_MARKDOWN): string[] {
  const room = cap - open.length - close.length - 2
  if (room < 1) return []
  const pieces: string[][] = []
  let lines: string[] = []
  let size = 0
  for (const chunk of body.flatMap(line => chunksOf(line, room))) {
    const grown = lines.length === 0 ? chunk.length : size + 1 + chunk.length
    if (lines.length > 0 && grown > room) {
      pieces.push(lines)
      lines = [chunk]
      size = chunk.length
    } else {
      lines.push(chunk)
      size = grown
    }
  }
  if (lines.length > 0) pieces.push(lines)
  return pieces.map(piece => [open, ...piece, close].join('\n'))
}

// Whether the reply's drawing stays under 80 % of the host's node limit.
export const fitsTree = (text: string) => text.length * NODES_PER_CHARACTER <= TREE_NODES * 0.8

// What this mod draws of a reply: its text, tables, and the pieces of each long fence, in
// order. Null keeps the drawing beneath: a reply with neither a table nor a long fence, and
// a reply with a long fence whose prose outside the fences outgrows the cap or whose tree
// would outgrow the host's.
export function replyLayout(text: string): Segment[] | null {
  const segments = splitReply(text)
  const out: Segment[] = []
  let tables = false
  let long = false
  let overflow = false
  for (const segment of segments) {
    if (segment.kind === 'table') {
      tables = true
      out.push(segment)
      continue
    }
    const blocks = blocksOf(segment.text)
    overflow ||= blocks.some(block => block.kind === 'prose' && rawOf(block).length > MAX_MARKDOWN)
    if (!blocks.some(isLong)) {
      out.push(segment)
      continue
    }
    long = true
    let held: string[] = []
    const flush = () => {
      if (held.join('').trim() !== '') out.push({ kind: 'text', text: held.join('\n') })
      held = []
    }
    for (const block of blocks) {
      if (block.kind === 'fence' && isLong(block)) {
        flush()
        const pieces = piecesOf(block.open, block.body, block.close)
        // An opening line that fills a piece on its own leaves no room to split.
        overflow ||= pieces.length === 0
        out.push(...pieces.map(piece => ({ kind: 'text' as const, text: piece })))
      } else {
        held.push(...rawOf(block).split('\n'))
      }
    }
    flush()
  }
  if (!long) return tables ? out : null
  return overflow || !fitsTree(text) ? null : out
}
