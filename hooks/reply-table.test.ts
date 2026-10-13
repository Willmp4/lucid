import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { cellsOf, fitWidths, splitReply, tableLines, widthOf, wrapRuns } from './reply-table'
import type { Table } from './reply-table'

const plain = (lines: ReturnType<typeof tableLines>) => lines.map(line => line.map(span => span.text).join(''))
const LONG = 'Each phase has its own pool and model; the watchdog fails over to the next pool when a quota runs out'

test('splitReply finds a table between paragraphs', () => {
  const segments = splitReply('Intro.\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\nOutro.')
  expect(segments.map(segment => segment.kind)).toEqual(['text', 'table', 'text'])
  const table = segments[1] as Table
  expect(table.header).toEqual(['A', 'B'])
  expect(table.align).toEqual(['left', 'center'])
  expect(table.rows).toEqual([['1', '2']])
})

test('splitReply leaves a table inside a fenced code block as text', () => {
  const text = '```md\n| A | B |\n|---|---|\n| 1 | 2 |\n```'
  expect(splitReply(text)).toEqual([{ kind: 'text', text }])
})

test('splitReply needs a delimiter row whose cell count matches the header', () => {
  const text = '| A | B |\n|---|\n| 1 | 2 |'
  expect(splitReply(text)).toEqual([{ kind: 'text', text }])
})

test('cellsOf keeps escaped pipes and pads nothing', () => {
  expect(cellsOf('| a \\| b | `c` |')).toEqual(['a | b', '`c`'])
  expect(cellsOf('a | b')).toEqual(['a', 'b'])
})

test('fitWidths keeps natural widths that fit and narrows the widest first', () => {
  expect(fitWidths([5, 10], [5, 10], 20)).toEqual([5, 10])
  expect(fitWidths([10, 40], [4, 4], 30)).toEqual([10, 20])
  expect(fitWidths([30, 30], [4, 4], 30)).toEqual([15, 15])
})

test('wrapRuns breaks at spaces and splits a word longer than the column', () => {
  const lines = wrapRuns([{ text: 'alpha beta gamma', style: 'plain' }], 10)
  expect(lines.map(line => line.map(run => run.text).join(''))).toEqual(['alpha beta', 'gamma'])
  const split = wrapRuns([{ text: 'abcdefghij', style: 'plain' }], 4)
  expect(split.map(line => line.map(run => run.text).join(''))).toEqual(['abcd', 'efgh', 'ij'])
})

test('widthOf counts wide characters as two cells', () => {
  expect(widthOf('ab')).toBe(2)
  expect(widthOf('漢字')).toBe(4)
})

test('tableLines wraps a long cell onto more lines and never cuts text', () => {
  const table: Table = { kind: 'table', header: ['Topic', 'Loops run'], align: ['left', 'left'], rows: [['Accounts and models', LONG]] }
  const lines = plain(tableLines(table, 50))
  for (const line of lines) expect(widthOf(line)).toBe(50)
  expect(lines.join('\n')).not.toContain('…')
  const body = lines.slice(3, -1).map(line => line.split('│').slice(1, -1).map(cell => cell.trim()))
  expect(body.map(cells => cells[0]).filter(Boolean).join(' ')).toBe('Accounts and models')
  expect(body.map(cells => cells[1]).filter(Boolean).join(' ')).toBe(LONG)
})

test('tableLines keeps natural widths when the table fits', () => {
  const table: Table = { kind: 'table', header: ['A', 'Bee'], align: ['left', 'right'], rows: [['x', '1']] }
  expect(plain(tableLines(table, 80))).toEqual([
    '╭───┬─────╮',
    '│ A │ Bee │',
    '├───┼─────┤',
    '│ x │   1 │',
    '╰───┴─────╯',
  ])
})

test('tableLines draws inline code without backticks and bold without markers', () => {
  const table: Table = { kind: 'table', header: ['Key'], align: ['left'], rows: [['`a|b` and **c**']] }
  const spans = tableLines(table, 80)[3]!
  expect(spans.map(span => span.text).join('')).toBe('│ a|b and c │')
  expect(spans.find(span => span.text === 'a|b')?.style).toBe('code')
  expect(spans.find(span => span.text === 'c')?.style).toBe('bold')
})

test('tableLines separates body rows with a rule whether or not a row wraps', () => {
  const table: Table = { kind: 'table', header: ['A', 'B'], align: ['left', 'left'], rows: [['one', LONG], ['two', 'short']] }
  expect(plain(tableLines(table, 40)).filter(line => line.startsWith('├')).length).toBe(2)
  expect(plain(tableLines({ ...table, rows: [['one', 'x'], ['two', 'y']] }, 80))).toEqual([
    '╭─────┬───╮',
    '│ A   │ B │',
    '├─────┼───┤',
    '│ one │ x │',
    '├─────┼───┤',
    '│ two │ y │',
    '╰─────┴───╯',
  ])
})

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
const REPLY = { plugin: 'omp-blocks', component: 'AssistantMessage', viewport: { columns: 60, rows: 40 } } as const
const setup = (on: On) => on('ui.render', () => STOCK)

test('a terminal reply with a table draws the whole cell text', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...REPLY, surface: 'terminal', requestId: 'reply1', props: {
    text: `Before.\n\n| Topic | Loops run |\n|---|---|\n| Accounts | ${LONG} |`, isFirstOfReply: true,
  } })
  expect(await ui.find({ type: 'Text', text: /quota runs out/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeUndefined()
  await ui.unmount()
})

for (const [surface, text] of [['terminal', 'No table here.'], ['desktop', '| A | B |\n|---|---|\n| 1 | 2 |']] as const) {
  test(`a ${surface} reply ${surface === 'terminal' ? 'without a table' : 'with a table'} keeps the drawing beneath`, async ($, on) => {
    setup(on)
    const ui = await $.ui.mount({ ...REPLY, surface, requestId: `pass-${surface}`, props: { text, isFirstOfReply: true } })
    expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
    await ui.unmount()
  })
}
