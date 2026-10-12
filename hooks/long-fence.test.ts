import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { MAX_MARKDOWN, fitsTree, piecesOf, replyLayout } from './long-fence'
import type { Table } from './reply-table'

// A fence whose raw text, markers included, is exactly `size` characters.
function fence(size: number, open = '```ts', line = (i: number) => `const value${i} = ${i} // line ${i}`) {
  const close = '```'
  const body: string[] = []
  let length = open.length + close.length + 1
  for (let i = 0; length + line(i).length + 1 <= size; i++) {
    body.push(line(i))
    length += line(i).length + 1
  }
  const pad = size - length
  if (pad > 0) body.push('x'.repeat(pad - 1))
  const raw = [open, ...body, close].join('\n')
  return { raw, open, body, close }
}

const bodyOf = (piece: string) => piece.split('\n').slice(1, -1)

test('the fence helper builds the size it is asked for', () => {
  expect(fence(MAX_MARKDOWN).raw.length).toBe(MAX_MARKDOWN)
  expect(fence(MAX_MARKDOWN + 1).raw.length).toBe(MAX_MARKDOWN + 1)
})

test('a reply whose only fence is at the cap keeps the drawing beneath', () => {
  expect(replyLayout(`Here it is.\n\n${fence(MAX_MARKDOWN).raw}\n\nDone.`)).toBeNull()
})

test('a fence one past the cap splits into pieces under it, each with the opening line and closing marker', () => {
  const long = fence(MAX_MARKDOWN + 1)
  const segments = replyLayout(`Here it is.\n\n${long.raw}\n\nDone.`)!
  expect(segments.map(segment => segment.kind)).toEqual(['text', 'text', 'text', 'text'])
  const texts = segments.map(segment => (segment.kind === 'text' ? segment.text : ''))
  expect(texts[0]!.trim()).toBe('Here it is.')
  expect(texts[3]!.trim()).toBe('Done.')
  for (const piece of texts.slice(1, 3)) {
    expect(piece.length).toBeLessThanOrEqual(MAX_MARKDOWN)
    expect(piece.startsWith('```ts\n')).toBe(true)
    expect(piece.endsWith('\n```')).toBe(true)
  }
  expect(texts.slice(1, 3).flatMap(bodyOf)).toEqual(long.body)
})

test('the pieces keep the language label and every line once, in order', () => {
  const long = fence(30000, '~~~~ python', i => `print(${i})`)
  const pieces = piecesOf(long.open, long.body, '~~~~')
  expect(pieces.length).toBe(4)
  for (const piece of pieces) {
    expect(piece.length).toBeLessThanOrEqual(MAX_MARKDOWN)
    expect(piece.split('\n')[0]).toBe('~~~~ python')
    expect(piece.split('\n').at(-1)).toBe('~~~~')
  }
  expect(pieces.flatMap(bodyOf)).toEqual(long.body)
})

test('a line longer than a piece can hold splits at that length', () => {
  const line = 'y'.repeat(20000)
  const pieces = piecesOf('```', ['first', line, 'last'], '```')
  for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_MARKDOWN)
  const lines = pieces.flatMap(bodyOf)
  expect(lines[0]).toBe('first')
  expect(lines.at(-1)).toBe('last')
  expect(lines.slice(1, -1).join('')).toBe(line)
  expect(Math.max(...lines.map(text => text.length))).toBe(MAX_MARKDOWN - '```'.length * 2 - 2)
})

test('a reply with a table and a long fence keeps both, in order', () => {
  const long = fence(12000)
  const segments = replyLayout(`| A | B |\n|---|---|\n| 1 | 2 |\n\n${long.raw}`)!
  expect(segments[0]!.kind).toBe('table')
  expect((segments[0] as Table).rows).toEqual([['1', '2']])
  expect(segments.slice(1).flatMap(segment => (segment.kind === 'text' ? bodyOf(segment.text) : []))).toEqual(long.body)
})

test('a reply with a short fence and a long one leaves the short one whole', () => {
  const short = '```sh\nls -la\n```'
  const segments = replyLayout(`${short}\n\n${fence(9500).raw}`)!
  expect(segments[0]).toEqual({ kind: 'text', text: `${short}\n` })
})

test('prose over the cap outside every fence keeps the drawing beneath', () => {
  const prose = 'Words in a long paragraph. '.repeat(400)
  expect(prose.length).toBeGreaterThan(MAX_MARKDOWN)
  expect(replyLayout(`${prose}\n\n${fence(9500).raw}`)).toBeNull()
})

test('a reply too large for the host tree keeps the drawing beneath', () => {
  expect(fitsTree('x'.repeat(40000))).toBe(true)
  expect(fitsTree('x'.repeat(60000))).toBe(false)
  const huge = Array.from({ length: 7 }, () => fence(9000).raw).join('\n\nNext file:\n\n') + `\n\n${fence(9500).raw}`
  expect(huge.length).toBeGreaterThan(60000)
  expect(replyLayout(huge)).toBeNull()
})

test('a streaming fence that has not closed stays text', () => {
  const open = fence(9500).raw.split('\n').slice(0, -1).join('\n')
  expect(replyLayout(`Here it comes.\n\n${open}`)).toBeNull()
})

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
const REPLY = { plugin: 'omp-blocks', component: 'AssistantMessage', viewport: { columns: 100, rows: 40 } } as const
const setup = (on: On) => on('ui.render', () => STOCK)

test('a terminal reply with a long fence draws each piece, where skins is absent, as Markdown', async ($, on) => {
  setup(on)
  const long = fence(MAX_MARKDOWN + 500)
  const ui = await $.ui.mount({ ...REPLY, surface: 'terminal', requestId: 'long1', props: { text: `The file:\n\n${long.raw}`, isFirstOfReply: true } })
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeUndefined()
  const drawn = await ui.findAll({ type: 'Markdown' })
  expect(drawn.map(element => element.text.split('\n')[0])).toEqual(['The file:', '```ts', '```ts'])
  expect(drawn.slice(1).flatMap(element => bodyOf(element.text))).toEqual(long.body)
  await ui.unmount()
})

test('a desktop reply with a long fence keeps the drawing beneath', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...REPLY, surface: 'desktop', requestId: 'long2', props: { text: fence(MAX_MARKDOWN + 500).raw, isFirstOfReply: true } })
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await ui.unmount()
})
