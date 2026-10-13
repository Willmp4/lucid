// Markdown tables in a reply, laid out as box-drawn lines whose cells wrap onto extra
// lines instead of losing text. Pure functions: the drawing lives in reply.tsx.

export type Align = 'left' | 'center' | 'right'
export type Table = { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
export type Segment = { kind: 'text'; text: string } | Table

export type Style = 'plain' | 'header' | 'code' | 'bold' | 'border'
export type Run = { text: string; style: Style }

export const FENCE = /^ {0,3}(`{3,}|~{3,})/
const DELIMITER_CELL = /^:?-+:?$/
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}]/u
// A column narrows to its longest word, up to this many cells, before words break.
const WORD_FLOOR = 20

export function widthOf(text: string): number {
  let width = 0
  for (const char of text) width += WIDE.test(char) ? 2 : 1
  return width
}

// A table row's cells: outer pipes dropped, `\|` kept as a literal pipe.
export function cellsOf(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (row[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += row[i]
    }
  }
  cells.push(cell.trim())
  return cells
}

const alignOf = (cell: string): Align =>
  cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left'

// A header line, then a delimiter row with the same cell count, starts a table.
function tableAt(lines: readonly string[], at: number): { table: Table; end: number } | null {
  const head = lines[at] ?? ''
  const delimiter = lines[at + 1]
  if (!head.includes('|') || /^ {4}/.test(head) || delimiter === undefined || !delimiter.includes('-')) return null
  const header = cellsOf(head)
  const marks = cellsOf(delimiter)
  if (marks.length !== header.length || !marks.every(mark => DELIMITER_CELL.test(mark))) return null
  const rows: string[][] = []
  let end = at + 2
  while (end < lines.length && lines[end]!.trim() !== '' && lines[end]!.includes('|') && !FENCE.test(lines[end]!)) {
    const cells = cellsOf(lines[end]!)
    rows.push(header.map((_, col) => cells[col] ?? ''))
    end++
  }
  return { table: { kind: 'table', header, align: marks.map(alignOf), rows }, end }
}

// The reply as text and tables, in order. Fenced code is never searched for tables.
export function splitReply(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let pending: string[] = []
  let fence: { char: string; length: number } | null = null
  const flush = () => {
    if (pending.join('').trim() !== '') segments.push({ kind: 'text', text: pending.join('\n') })
    pending = []
  }
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    const marker = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null
    } else if (marker !== undefined) {
      fence = { char: marker[0]!, length: marker.length }
    } else {
      const found = tableAt(lines, i)
      if (found !== null) {
        flush()
        segments.push(found.table)
        i = found.end
        continue
      }
    }
    pending.push(line)
    i++
  }
  flush()
  return segments
}

// A cell's inline markdown as styled runs: code spans, bold, links as their text, and
// backslash escapes. Other markers stay as written.
export function inlineRuns(cell: string, base: Style): Run[] {
  const runs: Run[] = []
  const push = (text: string, style: Style) => {
    if (text === '') return
    const last = runs.at(-1)
    if (last?.style === style) last.text += text
    else runs.push({ text, style })
  }
  let bold = false
  for (let i = 0; i < cell.length;) {
    const char = cell[i]!
    const rest = cell.slice(i)
    if (char === '\\' && /^\\[\\`*_[\]()#+\-.!~<>]/.test(rest)) {
      push(cell[i + 1]!, bold ? 'bold' : base)
      i += 2
      continue
    }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)![0]
      const close = cell.indexOf(ticks, i + ticks.length)
      if (close !== -1) {
        const code = cell.slice(i + ticks.length, close)
        push(/^ .* $/.test(code) ? code.slice(1, -1) : code, 'code')
        i = close + ticks.length
        continue
      }
    }
    if ((rest.startsWith('**') || rest.startsWith('__')) && (bold || cell.indexOf(rest.slice(0, 2), i + 2) !== -1)) {
      bold = !bold
      i += 2
      continue
    }
    const link = /^\[([^\]]*)\]\([^)\s]*\)/.exec(rest)
    if (link !== null) {
      push(link[1]!, bold ? 'bold' : base)
      i += link[0].length
      continue
    }
    push(char, bold ? 'bold' : base)
    i++
  }
  return runs
}

type Cell = { char: string; style: Style }

const runsOf = (cells: readonly Cell[]): Run[] => {
  const runs: Run[] = []
  for (const { char, style } of cells) {
    const last = runs.at(-1)
    if (last?.style === style) last.text += char
    else runs.push({ text: char, style })
  }
  return runs
}

const widthOfCells = (cells: readonly Cell[]) => cells.reduce((sum, cell) => sum + widthOf(cell.char), 0)

// Greedy word wrap to `width` cells. Runs of spaces collapse to one; a word longer than
// the column breaks across lines.
export function wrapRuns(runs: readonly Run[], width: number): Run[][] {
  const chars: Cell[] = runs.flatMap(run => [...run.text].map(char => ({ char, style: run.style })))
  const lines: Cell[][] = []
  let line: Cell[] = []
  let lineWidth = 0
  for (let i = 0; i < chars.length;) {
    if (/\s/.test(chars[i]!.char)) {
      i++
      continue
    }
    let end = i
    while (end < chars.length && !/\s/.test(chars[end]!.char)) end++
    const before = i > 0 ? chars[i - 1]!.style : undefined
    let word = chars.slice(i, end)
    i = end
    while (word.length > 0) {
      const wordWidth = widthOfCells(word)
      const gap = line.length > 0 ? 1 : 0
      if (lineWidth + gap + wordWidth <= width) {
        if (gap === 1) line.push({ char: ' ', style: before === word[0]!.style && before === line.at(-1)!.style ? before : 'plain' })
        line.push(...word)
        lineWidth += gap + wordWidth
        word = []
      } else if (line.length > 0) {
        lines.push(line)
        line = []
        lineWidth = 0
      } else {
        let take = 0
        let taken = 0
        while (take < word.length && (take === 0 || taken + widthOf(word[take]!.char) <= width)) taken += widthOf(word[take++]!.char)
        lines.push(word.slice(0, take))
        word = word.slice(take)
      }
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line)
  return lines.map(runsOf)
}

// Natural widths, narrowed one cell at a time from the widest column still above its
// floor until they fit the budget.
export function fitWidths(natural: readonly number[], floors: readonly number[], budget: number): number[] {
  const widths = [...natural]
  let total = widths.reduce((sum, width) => sum + width, 0)
  while (total > budget) {
    let pick = -1
    for (let col = 0; col < widths.length; col++) {
      if (widths[col]! > floors[col]! && (pick === -1 || widths[col]! > widths[pick]!)) pick = col
    }
    if (pick === -1) break
    widths[pick]!--
    total--
  }
  return widths
}

const runsWidth = (runs: readonly Run[]) => runs.reduce((sum, run) => sum + widthOf(run.text), 0)

function padded(runs: readonly Run[], width: number, align: Align): Run[] {
  const room = Math.max(0, width - runsWidth(runs))
  const left = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0
  return [{ text: ' '.repeat(left + 1), style: 'plain' }, ...runs, { text: ' '.repeat(room - left + 1), style: 'plain' }]
}

const merged = (runs: readonly Run[]): Run[] => runsOf(runs.flatMap(run => [...run.text].map(char => ({ char, style: run.style }))))

// The table as box-drawn lines `columns` cells wide at most, with a rule between body rows
// so the frame holds at every width.
export function tableLines(table: Table, columns: number): Run[][] {
  const cellsOfRow = (row: readonly string[], base: Style) => table.header.map((_, col) => inlineRuns(row[col] ?? '', base))
  const header = cellsOfRow(table.header, 'header')
  const body = table.rows.map(row => cellsOfRow(row, 'plain'))
  const all = [header, ...body]
  const natural = table.header.map((_, col) => Math.max(1, ...all.map(row => runsWidth(row[col]!))))
  const longestWord = table.header.map((_, col) =>
    Math.max(1, ...all.flatMap(row => row[col]!.map(run => run.text).join('').split(/\s+/).map(widthOf))))
  const budget = columns - (table.header.length + 1) - table.header.length * 2
  let widths = fitWidths(natural, natural.map((width, col) => Math.min(width, Math.max(3, Math.min(longestWord[col]!, WORD_FLOOR)))), budget)
  widths = fitWidths(widths, natural.map(width => Math.min(width, 3)), budget)

  const rule = (left: string, joint: string, right: string): Run[] =>
    [{ text: left + widths.map(width => '─'.repeat(width + 2)).join(joint) + right, style: 'border' }]
  const rowLines = (row: readonly Run[][]): Run[][] => {
    const wrapped = row.map((runs, col) => wrapRuns(runs, widths[col]!))
    const height = Math.max(...wrapped.map(lines => lines.length))
    return Array.from({ length: height }, (_, at) => merged([
      { text: '│', style: 'border' },
      ...wrapped.flatMap((lines, col) => [
        ...padded(lines[at] ?? [], widths[col]!, table.align[col] ?? 'left'),
        { text: '│', style: 'border' as const },
      ]),
    ]))
  }
  return [
    rule('╭', '┬', '╮'),
    ...rowLines(header),
    rule('├', '┼', '┤'),
    ...body.flatMap((row, i) => (i > 0 ? [rule('├', '┼', '┤'), ...rowLines(row)] : rowLines(row))),
    rule('╰', '┴', '╯'),
  ]
}
