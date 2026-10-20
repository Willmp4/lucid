#!/usr/bin/env node
// Renders a .flow spec read from stdin to an .excalidraw scene, an SVG drawn with
// Excalidraw's own rough strokes, a PNG of that SVG, and a version in terminal cells, all
// under the cache folder as <id>.*. Prints one JSON line: the files and their sizes, with no
// `png` where the PNG could not be drawn, or { error }. Needs node alone: roughjs, resvg as
// WebAssembly, and the PNG's font sit in vendor/.
//   node render.mjs <id> < spec.flow
//   node render.mjs --dir          prints the cache folder and whether pixels can show

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildScene, parseFlow } from './mkflow.mjs'
import rough from './vendor/rough.mjs'
import { Resvg, initWasm } from './vendor/resvg.mjs'

const PAD = 24
const SCALE = 2
// resvg reads no system fonts as WebAssembly, so the PNG's text takes the vendored font. A
// viewer of the SVG falls back to Menlo, then any monospace font.
const FONT = 'JetBrains Mono'
const FONT_STACK = `'${FONT}', Menlo, monospace`
const VENDOR = new URL('./vendor/', import.meta.url)

const DIR =
  process.env.XDG_CACHE_HOME !== undefined
    ? join(process.env.XDG_CACHE_HOME, 'lucid')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'lucid')
      : join(homedir(), '.cache', 'lucid')

const [id] = process.argv.slice(2)

const escape = text =>
  String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const dashOf = el =>
  el.strokeStyle === 'dashed'
    ? [8, 8 + el.strokeWidth]
    : el.strokeStyle === 'dotted'
      ? [1.5, 6 + el.strokeWidth]
      : undefined

const optionsOf = el => ({
  seed: el.seed,
  roughness: el.roughness,
  stroke: el.strokeColor,
  strokeWidth: el.strokeWidth,
  fillWeight: el.strokeWidth / 2,
  hachureGap: el.strokeWidth * 4,
  disableMultiStroke: el.strokeStyle !== 'solid',
  preserveVertices: el.roughness < 2,
  ...(el.backgroundColor && el.backgroundColor !== 'transparent'
    ? { fill: el.backgroundColor, fillStyle: el.fillStyle }
    : {}),
})

const radiusOf = el => {
  const side = Math.min(el.width, el.height)
  return side <= 128 ? side * 0.25 : 32
}

function roundedPath(x, y, w, h, r) {
  return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`
}

function arrowhead(points, size) {
  const [tx, ty] = points[points.length - 1]
  const [px, py] = points[points.length - 2]
  const length = Math.hypot(tx - px, ty - py) || 1
  const reach = Math.min(size, length / 2)
  const ux = (tx - px) / length
  const uy = (ty - py) / length
  const side = angle => [
    tx - reach * (ux * Math.cos(angle) - uy * Math.sin(angle)),
    ty - reach * (uy * Math.cos(angle) + ux * Math.sin(angle)),
  ]
  return [side(Math.PI / 9), side(-Math.PI / 9)]
}

function shapesOf(gen, el, dx, dy) {
  const x = el.x + dx
  const y = el.y + dy
  const options = optionsOf(el)
  if (el.type === 'rectangle') {
    return el.roundness
      ? [gen.path(roundedPath(x, y, el.width, el.height, radiusOf(el)), options)]
      : [gen.rectangle(x, y, el.width, el.height, options)]
  }
  if (el.type === 'ellipse') {
    return [gen.ellipse(x + el.width / 2, y + el.height / 2, el.width, el.height, options)]
  }
  if (el.type === 'diamond') {
    const w = el.width / 2
    const h = el.height / 2
    return [gen.polygon([[x + w, y], [x + el.width, y + h], [x + w, y + el.height], [x, y + h]], options)]
  }
  if (el.type === 'arrow' || el.type === 'line') {
    const points = el.points.map(([px, py]) => [x + px, y + py])
    const line = { ...options, fill: undefined }
    const shapes = [gen.linearPath(points, line)]
    if (el.type === 'arrow' && el.endArrowhead && points.length > 1) {
      const tip = points[points.length - 1]
      for (const end of arrowhead(points, 18)) {
        shapes.push(gen.line(end[0], end[1], tip[0], tip[1], line))
      }
    }
    return shapes
  }
  return []
}

function textOf(el, dx, dy) {
  const lines = String(el.text).split('\n')
  const lineHeight = el.fontSize * (el.lineHeight ?? 1.25)
  const anchor = el.textAlign === 'left' ? 'start' : el.textAlign === 'right' ? 'end' : 'middle'
  const x = el.x + dx + (anchor === 'start' ? 0 : anchor === 'end' ? el.width : el.width / 2)
  const baseline = el.y + dy + (lineHeight - el.fontSize) / 2 + el.fontSize * 0.8
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${baseline + i * lineHeight}" font-family="${FONT_STACK}" font-size="${el.fontSize}" fill="${el.strokeColor}" text-anchor="${anchor}" xml:space="preserve">${escape(line)}</text>`,
    )
    .join('')
}

function boundsOf(elements) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    const xs = el.points ? el.points.map(p => el.x + p[0]) : [el.x, el.x + el.width]
    const ys = el.points ? el.points.map(p => el.y + p[1]) : [el.y, el.y + el.height]
    minX = Math.min(minX, ...xs)
    maxX = Math.max(maxX, ...xs)
    minY = Math.min(minY, ...ys)
    maxY = Math.max(maxY, ...ys)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

export function toSvg(scene) {
  const elements = scene.elements.filter(el => !el.isDeleted)
  const { minX, minY, width, height } = boundsOf(elements)
  const dx = PAD - minX
  const dy = PAD - minY
  const w = Math.ceil(width + PAD * 2)
  const h = Math.ceil(height + PAD * 2)
  const gen = rough.generator()
  const body = elements
    .map(el => {
      if (el.type === 'text') {
        return textOf(el, dx, dy)
      }
      const dash = dashOf(el)
      return shapesOf(gen, el, dx, dy)
        .flatMap(shape => gen.toPaths(shape))
        .map(
          p =>
            `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"${dash && p.stroke !== 'none' ? ` stroke-dasharray="${dash.join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`,
        )
        .join('')
    })
    .join('')
  const background = scene.appState?.viewBackgroundColor ?? '#ffffff'
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${background}"/>${body}</svg>`,
    width: w,
    height: h,
  }
}

// The same scene in terminal cells, for a terminal that cannot show pixels (a multiplexer
// in between, say). One column is the generator's character width and one row its line
// height, so box text lands inside its box. Lines of [text, color] runs; color null is the
// terminal's own foreground and 'dim' its dim one.
const CW = 9.6
const RH = 20
const H = { solid: '─', dashed: '╌', dotted: '┈' }
const V = { solid: '│', dashed: '╎', dotted: '┊' }
const CORNERS = { round: ['╭', '╮', '╰', '╯'], square: ['┌', '┐', '└', '┘'] }
const BEND = { 'left,down': '╮', 'right,down': '╭', 'left,up': '╯', 'right,up': '╰' }
const HEAD = { right: '▶', left: '◀', down: '▼', up: '▲' }
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' }

function wrapTo(text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    for (let rest = word; rest !== ''; ) {
      const piece = rest.slice(0, width)
      rest = rest.slice(width)
      if (line === '') {
        line = piece
      } else if (line.length + 1 + piece.length <= width) {
        line += ` ${piece}`
      } else {
        lines.push(line)
        line = piece
      }
    }
  }
  return line === '' ? lines : [...lines, line]
}

function bendOf(from, to) {
  const sides = [OPPOSITE[from], to]
  const h = sides.find(side => side === 'left' || side === 'right')
  const v = sides.find(side => side === 'up' || side === 'down')
  return BEND[`${h},${v}`] ?? '┼'
}

function toneOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) {
    return null
  }
  if (m[1].toLowerCase() === '6b7280') {
    return 'dim'
  }
  const n = parseInt(m[1], 16)
  const luma = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return luma < 0.25 ? null : hex
}

export function toCells(scene) {
  const elements = scene.elements.filter(el => !el.isDeleted && el.customData?.role !== 'title')
  const { minX, minY, width, height } = boundsOf(elements)
  const cols = Math.ceil(width / CW) + 3
  const rows = Math.ceil(height / RH) + 3
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: ' ', tone: null, kind: null })))
  const cx = x => Math.round((x - minX) / CW) + 1
  const cy = y => Math.round((y - minY) / RH) + 1
  const at = (c, r) => grid[r]?.[c]
  const put = (c, r, ch, tone, kind) => {
    if (at(c, r)) {
      grid[r][c] = { ch, tone, kind }
    }
  }

  const boxes = []
  for (const el of elements.filter(el => el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond')) {
    if (el.width < 40) {
      put(cx(el.x + el.width / 2), cy(el.y + el.height / 2), '■', toneOf(el.backgroundColor) ?? toneOf(el.strokeColor), 'box')
      continue
    }
    const x0 = cx(el.x)
    const y0 = cy(el.y)
    const x1 = Math.max(x0 + 2, cx(el.x + el.width))
    const y1 = Math.max(y0 + 2, cy(el.y + el.height))
    const style = el.strokeStyle in H ? el.strokeStyle : 'solid'
    if (style === 'solid') {
      boxes.push({ el, x0, y0, x1, y1, texts: [] })
    }
    const [tl, tr, bl, br] = el.roundness || el.type !== 'rectangle' ? CORNERS.round : CORNERS.square
    const tone = toneOf(el.strokeColor)
    for (let c = x0 + 1; c < x1; c++) {
      put(c, y0, H[style], tone, 'box')
      put(c, y1, H[style], tone, 'box')
    }
    for (let r = y0 + 1; r < y1; r++) {
      put(x0, r, V[style], tone, 'box')
      put(x1, r, V[style], tone, 'box')
    }
    put(x0, y0, tl, tone, 'box')
    put(x1, y0, tr, tone, 'box')
    put(x0, y1, bl, tone, 'box')
    put(x1, y1, br, tone, 'box')
  }

  for (const el of elements.filter(el => el.type === 'arrow' || el.type === 'line')) {
    const tone = toneOf(el.strokeColor)
    const points = el.points.map(([px, py]) => [cx(el.x + px), cy(el.y + py)])
    const path = []
    for (let i = 1; i < points.length; i++) {
      let [c, r] = points[i - 1]
      const [tc, tr] = points[i]
      while (c !== tc) {
        c += Math.sign(tc - c)
        path.push([c, r, c > points[i - 1][0] ? 'right' : 'left'])
      }
      while (r !== tr) {
        r += Math.sign(tr - r)
        path.push([c, r, r > points[i - 1][1] ? 'down' : 'up'])
      }
    }
    const [c0, r0] = points[0]
    let cells = [[c0, r0, path[0]?.[2] ?? 'right'], ...path]
    while (cells.length > 1 && at(cells[0][0], cells[0][1])?.kind === 'box') {
      cells = cells.slice(1)
    }
    while (cells.length > 1 && at(cells[cells.length - 1][0], cells[cells.length - 1][1])?.kind === 'box') {
      cells = cells.slice(0, -1)
    }
    cells.forEach(([c, r, dir], i) => {
      const cell = at(c, r)
      if (!cell || cell.kind === 'box') {
        return
      }
      const next = cells[i + 1]?.[2]
      const isLast = i === cells.length - 1
      const ch = isLast
        ? el.type === 'arrow' && el.endArrowhead
          ? HEAD[dir]
          : dir === 'left' || dir === 'right' ? '─' : '│'
        : next !== undefined && next !== dir
          ? bendOf(dir, next)
          : dir === 'left' || dir === 'right'
            ? cell.kind === 'arrow' && cell.ch === '│' ? '┼' : '─'
            : cell.kind === 'arrow' && cell.ch === '─' ? '┼' : '│'
      put(c, r, ch, tone, 'arrow')
    })
  }

  // A node's text is wrapped again to the node's inner width in cells and centred in it,
  // since a cell is coarser than the pixels the generator fitted it to.
  const holderOf = el => {
    const x = el.x + el.width / 2
    const y = el.y + el.height / 2
    return boxes
      .filter(b => b.el.x <= x && x <= b.el.x + b.el.width && b.el.y <= y && y <= b.el.y + b.el.height)
      .sort((a, b) => a.el.width * a.el.height - b.el.width * b.el.height)[0]
  }
  const loose = []
  for (const el of elements.filter(el => el.type === 'text')) {
    const holder = holderOf(el)
    if (holder) {
      holder.texts.push(el)
    } else {
      loose.push(el)
    }
  }
  for (const box of boxes) {
    const width = Math.max(1, box.x1 - box.x0 - 3)
    const lines = box.texts
      .sort((a, b) => a.y - b.y)
      .flatMap(el => wrapTo(String(el.text).replace(/\s+/g, ' ').trim(), width).map(line => [line, toneOf(el.strokeColor)]))
    const room = box.y1 - box.y0 - 1
    const top = box.y0 + 1 + Math.max(0, Math.floor((room - lines.length) / 2))
    lines.slice(0, room).forEach(([line, tone], i) => {
      const start = box.x0 + 1 + Math.floor((box.x1 - box.x0 - 1 - line.length) / 2)
      ;[...line].forEach((ch, j) => put(start + j, top + i, ch, tone, 'text'))
    })
  }

  for (const el of loose) {
    const lines = String(el.text).split('\n')
    const lineHeight = el.fontSize * (el.lineHeight ?? 1.25)
    const tone = el.customData?.role === 'title' ? 'bold' : toneOf(el.strokeColor)
    lines.forEach((line, i) => {
      const r = Math.floor((el.y + i * lineHeight + lineHeight / 2 - minY) / RH) + 1
      const start =
        el.textAlign === 'left'
          ? cx(el.x)
          : el.textAlign === 'right'
            ? cx(el.x + el.width) - line.length
            : Math.round((el.x + el.width / 2 - minX) / CW + 1 - line.length / 2)
      ;[...line].forEach((ch, j) => put(start + j, r, ch, tone, 'text'))
    })
  }

  const lines = grid.map(row => {
    const runs = []
    for (const cell of row) {
      const last = runs[runs.length - 1]
      if (last && last[1] === cell.tone) {
        last[0] += cell.ch
      } else {
        runs.push([cell.ch, cell.tone])
      }
    }
    const tail = runs[runs.length - 1]
    if (tail) {
      tail[0] = tail[0].trimEnd()
    }
    return runs.filter(run => run[0] !== '')
  })
  while (lines.length && lines[0].length === 0) {
    lines.shift()
  }
  while (lines.length && lines[lines.length - 1].length === 0) {
    lines.pop()
  }
  return { columns: cols, lines }
}

// The SVG as a PNG, or undefined where the WebAssembly or the font will not load; the SVG
// and the cells still serve then.
async function toPng(svg) {
  try {
    await initWasm(readFileSync(new URL('resvg.wasm', VENDOR)))
    const font = readFileSync(new URL('JetBrainsMono-Regular.ttf', VENDOR))
    return new Resvg(svg, {
      fitTo: { mode: 'zoom', value: SCALE },
      font: { fontBuffers: [font], defaultFontFamily: FONT, monospaceFamily: FONT },
    })
      .render()
      .asPng()
  } catch (error) {
    process.stderr.write(`no PNG: ${String(error?.message ?? error)}\n`)
    return undefined
  }
}

async function main() {
  try {
    if (!/^[a-z0-9]+$/.test(id)) {
      throw new Error(`the id must be lowercase letters and digits, got ${JSON.stringify(id)}`)
    }
    const source = readFileSync(0, 'utf8')
    const scene = buildScene(source.trimStart().startsWith('{') ? JSON.parse(source) : parseFlow(source))
    const { svg, width, height } = toSvg(scene)
    const png = await toPng(svg)
    const base = join(DIR, id)
    const title = scene.elements.find(el => el.customData?.role === 'title')?.text ?? ''
    const cells = toCells(scene)
    const result = {
      excalidraw: `${base}.excalidraw`,
      ...(png === undefined ? {} : { png: `${base}.png` }),
      svg: `${base}.svg`,
      cells: `${base}.cells.json`,
      columns: cells.columns,
      width: width * SCALE,
      height: height * SCALE,
      title,
    }
    mkdirSync(DIR, { recursive: true })
    writeFileSync(`${base}.flow`, source)
    writeFileSync(`${base}.excalidraw`, JSON.stringify(scene, null, 2))
    writeFileSync(`${base}.svg`, svg)
    if (png !== undefined) {
      writeFileSync(`${base}.png`, png)
    }
    writeFileSync(`${base}.cells.json`, JSON.stringify(cells))
    writeFileSync(`${base}.json`, JSON.stringify(result))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`)
    process.exitCode = 1
  }
}

// Pixels reach the screen only from kitty or Ghostty with no multiplexer in between; the
// engine draws an Image's alt anywhere else.
function canShowPixels(env) {
  const isMultiplexed = ['HERDR_ENV', 'TMUX', 'ZELLIJ', 'STY'].some(name => env[name])
  return !isMultiplexed && (env.TERM === 'xterm-kitty' || env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'ghostty')
}

if (id === '--dir') {
  process.stdout.write(`${JSON.stringify({ dir: DIR, pixels: canShowPixels(process.env) })}\n`)
} else if (id) {
  await main()
}
