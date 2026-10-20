// Converts a terminal screen saved as ANSI text into an SVG picture of a terminal window.
//
// The README's pictures come from a Claude Code session in a Herdr pane of 100 columns and 30
// rows. Capture a screen with `herdr pane read <pane> --source visible --format ansi`, save it
// under docs/screens/, then convert it with Bun:
//
//   bun scripts/screenshot-svg.ts docs/screens/balanced.ansi docs/balanced.svg [title]
//
// To redraw every picture in docs/ from the screens in docs/screens/, run:
//
//   bun scripts/screenshot-svg.ts --all
//
// docs/diagram.png is the renderer's own picture of docs/screens/diagram.flow, the brief behind
// the diagram screen. To redraw it, run `XDG_CACHE_HOME=<dir> node renderer/render.mjs
// 2ee825g24oq < docs/screens/diagram.flow` and copy <dir>/lucid/2ee825g24oq.png.
//
// The picture keeps the terminal's grid: each character sits at its own column, and box-drawing
// lines and block elements draw as shapes, so borders line up whatever font the viewer uses.

// The parts of Bun's API this script uses. The mod's type setup carries no Bun or Node types.
declare const Bun: {
  argv: string[]
  file(path: string): { text(): Promise<string> }
  write(path: string, data: string): Promise<number>
  Glob: new (pattern: string) => { scanSync(options: { cwd: string }): Iterable<string> }
}

declare const console: { log(...values: unknown[]): void }

declare global {
  interface ImportMeta {
    main: boolean
    dir: string
  }
}

export type Style = {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  inverse: boolean
}

// One terminal column. A wide character fills two columns; the second holds a cell of width 0.
export type Cell = { text: string; width: 0 | 1 | 2; style: Style }
export type Row = (Cell | undefined)[]

export const PLAIN: Style = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strike: false,
  inverse: false,
}

export const THEME = {
  fg: '#cdd6f4',
  bg: '#1e1e2e',
  frame: '#ffffff',
  title: '#9399b2',
}

// The 16 standard colours, as a dark Catppuccin-style terminal draws them.
export const ANSI16 = [
  '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
  '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
]

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const rgb = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`

// A colour of the 256-colour palette: the 16 standard colours, a 6×6×6 cube, and 24 greys.
export function color256(n: number): string {
  if (n < 16) return ANSI16[n] ?? THEME.fg
  if (n < 232) {
    const levels = [0, 95, 135, 175, 215, 255]
    const i = n - 16
    return rgb(levels[Math.floor(i / 36)] ?? 0, levels[Math.floor(i / 6) % 6] ?? 0, levels[i % 6] ?? 0)
  }
  const grey = 8 + (Math.min(n, 255) - 232) * 10
  return rgb(grey, grey, grey)
}

// Reads an extended colour (`5;n` or `2;r;g;b`) from the parameters after a 38, 48, or 58.
// Returns the colour, or null, and how many parameters it used.
function extendedColor(values: number[], colonForm: boolean): [string | null, number] {
  const mode = values[0]
  if (mode === 5) return [values[1] === undefined ? null : color256(values[1]), 2]
  if (mode === 2) {
    // The colon form may carry a colour-space ID before the three channels.
    const channels = colonForm && values.length >= 5 ? values.slice(2, 5) : values.slice(1, 4)
    const [r, g, b] = channels
    if (r === undefined || g === undefined || b === undefined) return [null, values.length]
    return [rgb(r, g, b), 4]
  }
  return [null, 1]
}

// Applies the parameters of one SGR sequence (`ESC [ <params> m`) to a style.
export function applySgr(style: Style, params: string): Style {
  const next = { ...style }
  const parts = params === '' ? ['0'] : params.split(';')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (part.includes(':')) {
      const values = part.split(':').map(value => Number(value || 0))
      const code = values[0]
      if (code === 38) next.fg = extendedColor(values.slice(1), true)[0]
      else if (code === 48) next.bg = extendedColor(values.slice(1), true)[0]
      else if (code === 4) next.underline = values[1] !== 0
      continue
    }
    const code = Number(part || 0)
    if (code === 38 || code === 48 || code === 58) {
      const rest = parts.slice(i + 1).map(value => Number(value || 0))
      const [color, used] = extendedColor(rest, false)
      if (code === 38) next.fg = color
      if (code === 48) next.bg = color
      i += used
      continue
    }
    if (code === 0) Object.assign(next, PLAIN)
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4 || code === 21) next.underline = true
    else if (code === 7) next.inverse = true
    else if (code === 9) next.strike = true
    else if (code === 22) next.bold = next.dim = false
    else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 27) next.inverse = false
    else if (code === 29) next.strike = false
    else if (code >= 30 && code <= 37) next.fg = ANSI16[code - 30] ?? null
    else if (code === 39) next.fg = null
    else if (code >= 40 && code <= 47) next.bg = ANSI16[code - 40] ?? null
    else if (code === 49) next.bg = null
    else if (code >= 90 && code <= 97) next.fg = ANSI16[code - 90 + 8] ?? null
    else if (code >= 100 && code <= 107) next.bg = ANSI16[code - 100 + 8] ?? null
  }
  return next
}

const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]

const ZERO: [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
]

const within = (ranges: [number, number][], code: number) => ranges.some(([lo, hi]) => code >= lo && code <= hi)

// How many terminal columns a character fills: 0 for a combining mark, 2 for a wide character.
export function charWidth(code: number): 0 | 1 | 2 {
  if (within(ZERO, code)) return 0
  if (within(WIDE, code)) return 2
  return 1
}

// Parses ANSI text into rows of cells. SGR sequences set the style; other escape sequences are
// skipped, except cursor-forward, which leaves blank columns.
export function parseAnsi(input: string): Row[] {
  const chars = Array.from(input)
  const rows: Row[] = [[]]
  let row = 0
  let col = 0
  let style = PLAIN
  const put = (cell: Cell) => {
    const line = rows[row] ?? (rows[row] = [])
    line[col] = cell
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    if (ch === '\x1b') {
      const kind = chars[i + 1]
      if (kind === '[') {
        let j = i + 2
        let params = ''
        while (j < chars.length && /[\x20-\x3f]/.test(chars[j] ?? '')) params += chars[j++]
        const final = chars[j] ?? ''
        if (final === 'm' && /^[\d;:]*$/.test(params)) style = applySgr(style, params)
        if (final === 'C') col += Math.max(1, Number(params) || 1)
        i = j
      } else if (kind === ']' || kind === 'P' || kind === '_' || kind === '^') {
        let j = i + 2
        while (j < chars.length && chars[j] !== '\x07' && !(chars[j] === '\x1b' && chars[j + 1] === '\\')) j++
        i = chars[j] === '\x07' ? j : j + 1
      } else if (kind === '(' || kind === ')' || kind === '#') {
        i += 2
      } else {
        i += 1
      }
      continue
    }
    if (ch === '\n') {
      row++
      col = 0
      rows[row] ??= []
      continue
    }
    if (ch === '\r') {
      col = 0
      continue
    }
    if (ch === '\t') {
      col = (Math.floor(col / 8) + 1) * 8
      continue
    }
    if (ch === '\b') {
      col = Math.max(0, col - 1)
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
    const width = charWidth(code)
    if (width === 0) {
      // A combining mark joins the character before it; ZWJ and variation selectors drop.
      const line = rows[row] ?? []
      let prev = col - 1
      while (prev >= 0 && line[prev]?.width === 0) prev--
      const base = line[prev]
      if (base && code !== 0x200d && !(code >= 0xfe00 && code <= 0xfe0f) && code < 0x200b) {
        base.text += ch
      }
      continue
    }
    put({ text: ch, width, style })
    col++
    if (width === 2) {
      put({ text: '', width: 0, style })
      col++
    }
  }
  return rows
}

const blankCell = (cell: Cell | undefined) =>
  !cell || ((cell.text === ' ' || cell.text === '') && !cell.style.bg && !cell.style.inverse && !cell.style.underline)

// Drops blank rows from the end of a screen.
export function trimRows(rows: Row[]): Row[] {
  let end = rows.length
  while (end > 0 && (rows[end - 1] ?? []).every(blankCell)) end--
  return rows.slice(0, end)
}

const rowWidth = (row: Row) => {
  let end = row.length
  while (end > 0 && blankCell(row[end - 1])) end--
  return end
}

// Escapes text for XML content and attribute values, and drops characters XML cannot hold.
export function escapeXml(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function mix(color: string, base: string, amount: number): string {
  const channel = (value: string, at: number) => parseInt(value.slice(at, at + 2), 16)
  const blend = (at: number) => channel(color, at) * amount + channel(base, at) * (1 - amount)
  return rgb(blend(1), blend(3), blend(5))
}

// The colours a cell draws with once inverse video and dim apply.
export function colorsOf(style: Style): { fg: string; bg: string | null } {
  let fg = style.fg ?? THEME.fg
  let bg = style.bg
  if (style.inverse) {
    const swapped = bg ?? THEME.bg
    bg = fg
    fg = swapped
  }
  if (style.dim) fg = mix(fg, bg ?? THEME.bg, 0.6)
  return { fg, bg }
}

// Grid units: the font is 10 units high and each column 6 units wide, so every x is a whole
// number. SCALE sets the size the picture displays at.
const FONT = 10
const CELL_W = 6
const CELL_H = 12
const BASELINE = 9.4
const PAD_X = 14
const TITLE_H = 24
const PAD_TOP = 8
const PAD_BOTTOM = 10
const SCALE = 1.4
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

const styleKey = (cell: Cell) => {
  const { fg } = colorsOf(cell.style)
  const s = cell.style
  return `${fg}|${s.bold ? 'b' : ''}${s.italic ? 'i' : ''}${s.underline ? 'u' : ''}${s.strike ? 's' : ''}`
}

function tspanOpen(cell: Cell): string {
  const { fg } = colorsOf(cell.style)
  const s = cell.style
  const attrs = [fg === THEME.fg ? '' : ` fill="${fg}"`]
  if (s.bold) attrs.push(' font-weight="700"')
  if (s.italic) attrs.push(' font-style="italic"')
  const lines = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean)
  if (lines.length > 0) attrs.push(` text-decoration="${lines.join(' ')}"`)
  const joined = attrs.join('')
  return joined === '' ? '' : `<tspan${joined}>`
}

// Box-drawing lines, by the arms each draws from its cell's centre: up, down, left, and right.
// Lines draw as strokes rather than glyphs, so they meet across rows and columns whatever the
// font's line height.
const LIGHT: Record<string, string> = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ur', '┘': 'ul', '├': 'udr', '┤': 'udl',
  '┬': 'lrd', '┴': 'lru', '┼': 'udlr', '╴': 'l', '╵': 'u', '╶': 'r', '╷': 'd',
  '╭': 'rd', '╮': 'ld', '╯': 'ul', '╰': 'ur',
}
const HEAVY: Record<string, string> = {
  '━': 'lr', '┃': 'ud', '┏': 'rd', '┓': 'ld', '┗': 'ur', '┛': 'ul', '┣': 'udr', '┫': 'udl',
  '┳': 'lrd', '┻': 'lru', '╋': 'udlr',
}
const ROUNDED = '╭╮╯╰'

// Block elements, by the parts of the cell they fill: x, y, width, and height as fractions.
const BLOCKS: Record<string, [number, number, number, number][]> = {
  '▀': [[0, 0, 1, 0.5]], '▄': [[0, 0.5, 1, 0.5]], '█': [[0, 0, 1, 1]], '▌': [[0, 0, 0.5, 1]],
  '▐': [[0.5, 0, 0.5, 1]], '▖': [[0, 0.5, 0.5, 0.5]], '▗': [[0.5, 0.5, 0.5, 0.5]],
  '▘': [[0, 0, 0.5, 0.5]], '▝': [[0.5, 0, 0.5, 0.5]], '▙': [[0, 0, 0.5, 1], [0.5, 0.5, 0.5, 0.5]],
  '▚': [[0, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], '▛': [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5]],
  '▜': [[0, 0, 1, 0.5], [0.5, 0.5, 0.5, 0.5]], '▞': [[0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5]],
  '▟': [[0.5, 0, 0.5, 1], [0, 0.5, 0.5, 0.5]], '▁': [[0, 0.875, 1, 0.125]], '▂': [[0, 0.75, 1, 0.25]],
  '▃': [[0, 0.625, 1, 0.375]], '▅': [[0, 0.375, 1, 0.625]], '▆': [[0, 0.25, 1, 0.75]],
  '▇': [[0, 0.125, 1, 0.875]], '▉': [[0, 0, 0.875, 1]], '▊': [[0, 0, 0.75, 1]], '▋': [[0, 0, 0.625, 1]],
  '▍': [[0, 0, 0.375, 1]], '▎': [[0, 0, 0.25, 1]], '▏': [[0, 0, 0.125, 1]], '▔': [[0, 0, 1, 0.125]],
  '▕': [[0.875, 0, 0.125, 1]],
}
const SHADES: Record<string, number> = { '░': 0.25, '▒': 0.5, '▓': 0.75 }

// Whether a cell draws as shapes instead of text.
const drawn = (cell: Cell) => cell.text in LIGHT || cell.text in HEAVY || cell.text in BLOCKS || cell.text in SHADES

type Range = [number, number]

// Collects box-drawing strokes and merges touching ones, so a border is one line, not one per cell.
class Strokes {
  private across = new Map<string, Range[]>()
  private down = new Map<string, Range[]>()
  private arcs = new Map<string, string[]>()

  add(cell: Cell, col: number, top: number) {
    const arms = LIGHT[cell.text] ?? HEAVY[cell.text]
    if (arms === undefined) return
    const pen = `${colorsOf(cell.style).fg}|${cell.text in HEAVY ? 2 : 1}`
    const x0 = PAD_X + col * CELL_W
    const cx = x0 + CELL_W / 2
    const cy = top + CELL_H / 2
    const r = CELL_W / 2
    if (ROUNDED.includes(cell.text)) {
      const right = arms.includes('r')
      const up = arms.includes('u')
      const hx: Range = right ? [cx + r, x0 + CELL_W] : [x0, cx - r]
      const vy: Range = up ? [top, cy - r] : [cy + r, top + CELL_H]
      this.line(this.across, `${pen}|${cy}`, hx)
      this.line(this.down, `${pen}|${cx}`, vy)
      // A quarter circle from the vertical arm to the horizontal one: clockwise at ╭ and ╯,
      // anticlockwise at ╮ and ╰.
      const from = `${cx} ${up ? cy - r : cy + r}`
      const to = `${right ? cx + r : cx - r} ${cy}`
      const sweep = right === up ? 0 : 1
      this.arcs.set(pen, [...(this.arcs.get(pen) ?? []), `M${from}A${r} ${r} 0 0 ${sweep} ${to}`])
      return
    }
    if (arms.includes('l')) this.line(this.across, `${pen}|${cy}`, [x0, cx])
    if (arms.includes('r')) this.line(this.across, `${pen}|${cy}`, [cx, x0 + CELL_W])
    if (arms.includes('u')) this.line(this.down, `${pen}|${cx}`, [top, cy])
    if (arms.includes('d')) this.line(this.down, `${pen}|${cx}`, [cy, top + CELL_H])
  }

  private line(map: Map<string, Range[]>, key: string, range: Range) {
    if (range[1] - range[0] <= 0) return
    map.set(key, [...(map.get(key) ?? []), range])
  }

  // One <path> per colour and weight.
  paths(): string[] {
    const pieces = new Map<string, string[]>()
    const push = (pen: string, piece: string) => pieces.set(pen, [...(pieces.get(pen) ?? []), piece])
    for (const [map, draw] of [
      [this.across, (at: string, [a, b]: Range) => `M${a} ${at}H${b}`],
      [this.down, (at: string, [a, b]: Range) => `M${at} ${a}V${b}`],
    ] as const) {
      for (const [key, ranges] of map) {
        const at = key.slice(key.lastIndexOf('|') + 1)
        const pen = key.slice(0, key.lastIndexOf('|'))
        for (const range of merge(ranges)) push(pen, draw(at, range))
      }
    }
    for (const [pen, arcs] of this.arcs) for (const arc of arcs) push(pen, arc)
    return [...pieces].map(([pen, parts]) => {
      const [color, weight] = pen.split('|')
      return `<path d="${parts.join('')}" stroke="${color}" stroke-width="${weight}"/>`
    })
  }
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range[0] <= last[1] + 0.001) last[1] = Math.max(last[1], range[1])
    else out.push([range[0], range[1]])
  }
  return out
}

// Block elements and shades as filled rectangles.
function blocksOf(cell: Cell, col: number, top: number): string[] {
  const color = colorsOf(cell.style).fg
  const x0 = PAD_X + col * CELL_W
  const shade = SHADES[cell.text]
  if (shade !== undefined) {
    return [`<rect x="${x0}" y="${top}" width="${CELL_W}" height="${CELL_H}" fill="${color}" fill-opacity="${shade}"/>`]
  }
  return (BLOCKS[cell.text] ?? []).map(
    ([x, y, w, h]) =>
      `<rect x="${round(x0 + x * CELL_W)}" y="${round(top + y * CELL_H)}" width="${round(w * CELL_W)}" ` +
      `height="${round(h * CELL_H)}" fill="${color}"/>`,
  )
}

type Placed = { col: number; cell: Cell }

// Splits a row's text characters into pieces that each become one <text>: a piece ends at a run
// of three or more plain spaces or shapes, and a character outside the Basic Multilingual Plane
// stands alone, since viewers disagree on how it counts against a list of x positions.
function piecesOf(row: Row, width: number): Placed[][] {
  const pieces: Placed[][] = []
  let piece: Placed[] = []
  let spaces: Placed[] = []
  const flush = () => {
    if (piece.length > 0) pieces.push(piece)
    piece = []
  }
  for (let col = 0; col < width; col++) {
    const cell = row[col] ?? { text: ' ', width: 1, style: PLAIN }
    if (cell.width === 0) continue
    const plainSpace = (cell.text === ' ' && !cell.style.underline && !cell.style.strike) || drawn(cell)
    if (plainSpace) {
      spaces.push({ col, cell })
      continue
    }
    if (spaces.length >= 3 || piece.length === 0) flush()
    else piece.push(...spaces)
    spaces = []
    if ((cell.text.codePointAt(0) ?? 0) > 0xffff) {
      flush()
      pieces.push([{ col, cell }])
      continue
    }
    piece.push({ col, cell })
  }
  flush()
  return pieces
}

function textOf(piece: Placed[], y: number): string {
  const xs: number[] = []
  let body = ''
  let open = ''
  let key = ''
  for (const { col, cell } of piece) {
    for (const _ of Array.from(cell.text)) xs.push(PAD_X + col * CELL_W)
    const next = styleKey(cell)
    if (next !== key) {
      if (open) body += '</tspan>'
      open = tspanOpen(cell)
      body += open
      key = next
    }
    body += escapeXml(cell.text)
  }
  if (open) body += '</tspan>'
  return `<text x="${xs.join(' ')}" y="${y}" xml:space="preserve">${body}</text>`
}

function backgroundsOf(row: Row, width: number, top: number): string[] {
  const rects: string[] = []
  let start = -1
  let color: string | null = null
  const close = (end: number) => {
    if (color && start >= 0) {
      const x = PAD_X + start * CELL_W
      rects.push(`<rect x="${x}" y="${top}" width="${(end - start) * CELL_W}" height="${CELL_H}" fill="${color}"/>`)
    }
  }
  for (let col = 0; col <= width; col++) {
    const cell = row[col]
    const bg = col < width && cell ? colorsOf(cell.style).bg : null
    if (bg !== color) {
      close(col)
      start = col
      color = bg
    }
  }
  return rects
}

export type SvgOptions = { title?: string; cols?: number }

// Draws rows of cells as an SVG terminal window with a small title.
export function renderSvg(input: Row[], options: SvgOptions = {}): string {
  const rows = trimRows(input)
  const cols = options.cols ?? Math.max(1, ...rows.map(row => row.length))
  const title = options.title ?? ''
  const width = PAD_X * 2 + cols * CELL_W
  const gridTop = TITLE_H + PAD_TOP
  const height = gridTop + rows.length * CELL_H + PAD_BOTTOM
  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width * SCALE)}" height="${round(height * SCALE)}" ` +
      `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
  )
  if (title) out.push(`<title>${escapeXml(title)}</title>`)
  out.push(`<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="8" fill="${THEME.bg}"/>`)
  out.push(
    `<g transform="translate(${PAD_X - 2} 6.5) scale(0.5)" fill="none" stroke="${THEME.title}" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5-5 5"/><path d="M12 18h7"/></g>`,
  )
  out.push(
    `<text x="${PAD_X + 13}" y="${TITLE_H / 2 + 3}" font-family="${SANS}" font-size="8.5" fill="${THEME.title}" ` +
      `letter-spacing=".3">${escapeXml(title)}</text>`,
  )
  out.push(`<line x1="0" y1="${TITLE_H - 0.5}" x2="${width}" y2="${TITLE_H - 0.5}" stroke="${THEME.frame}" stroke-opacity=".1"/>`)
  const rects: string[] = []
  const blocks: string[] = []
  const strokes = new Strokes()
  const texts: string[] = []
  rows.forEach((row, index) => {
    const top = gridTop + index * CELL_H
    const used = Math.min(cols, row.length)
    rects.push(...backgroundsOf(row, used, top))
    for (let col = 0; col < used; col++) {
      const cell = row[col]
      if (!cell || !drawn(cell)) continue
      blocks.push(...blocksOf(cell, col, top))
      strokes.add(cell, col, top)
    }
    const end = Math.min(cols, rowWidth(row))
    for (const piece of piecesOf(row, end)) texts.push(textOf(piece, round(top + BASELINE)))
  })
  if (rects.length > 0) out.push(`<g shape-rendering="crispEdges">${rects.join('')}</g>`)
  if (blocks.length > 0) out.push(`<g shape-rendering="crispEdges">${blocks.join('')}</g>`)
  const paths = strokes.paths()
  if (paths.length > 0) out.push(`<g fill="none" stroke-linecap="square">${paths.join('')}</g>`)
  out.push(`<g font-family="${MONO}" font-size="${FONT}" fill="${THEME.fg}">`)
  out.push(...texts)
  out.push('</g>')
  out.push(
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="8" fill="none" stroke="${THEME.frame}" stroke-opacity=".16"/>`,
  )
  out.push('</svg>')
  return out.join('\n') + '\n'
}

const round = (value: number) => Math.round(value * 100) / 100

// Titles for the pictures the README shows, by screen name.
export const TITLES: Record<string, string> = {
  balanced: '/lucid density balanced',
  compact: '/lucid density compact',
  full: '/lucid density full',
  'blackbox-folded': '/lucid density blackbox · folded',
  'blackbox-open': '/lucid density blackbox · open',
  tldr: 'tldr · a reply with its summary beneath',
  'reply-table': 'a reply table wider than the pane',
  'long-code': 'a reply code block past 9,000 characters',
  diagram: 'a reply diagram drawn in terminal cells',
  'usage-below': '/lucid usage below',
}

const USAGE = 'usage: bun scripts/screenshot-svg.ts <screen.ansi> <picture.svg> [title]\n' +
  '       bun scripts/screenshot-svg.ts --all'

async function main(args: string[]) {
  if (args[0] === '--all') {
    const docs = `${import.meta.dir}/../docs`
    for (const file of new Bun.Glob('*.ansi').scanSync({ cwd: `${docs}/screens` })) {
      const name = file.replace(/\.ansi$/, '')
      const svg = renderSvg(parseAnsi(await Bun.file(`${docs}/screens/${file}`).text()), { title: TITLES[name] ?? name })
      await Bun.write(`${docs}/${name}.svg`, svg)
      console.log(`docs/${name}.svg`)
    }
    return
  }
  const [input, output, title] = args
  if (!input || !output) throw new Error(USAGE)
  const name = input.replace(/^.*\//, '').replace(/\.ansi$/, '')
  await Bun.write(output, renderSvg(parseAnsi(await Bun.file(input).text()), { title: title ?? TITLES[name] ?? name }))
}

if (import.meta.main) await main(Bun.argv.slice(2))
