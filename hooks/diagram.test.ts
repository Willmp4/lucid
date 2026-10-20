import { expect, test } from 'claude-code/testing'
import type { Diagram, DiagramFiles } from '../types'
import {
  CORRECTIONS, DIAGRAM_HINT, SPEC_GUIDE, diagramOf, diagramsCommand, diagramsOf, idOf, isFlow, isOrphan, isStale, pictureSize, roomOf, specRequest,
  unfenced, widthProblem,
} from './diagram'
import { MAX_MARKDOWN, diagramParts, diagramsIn, replyLayout } from './long-fence'

const BRIEF = 'Two boxes: client and server, an arrow from client to server labelled request.'
const REPLY = `Here is the design.\n\n\`\`\`excalidraw\n${BRIEF}\n\`\`\`\n\nThat is the whole flow.`
const FILES: DiagramFiles = {
  png: '/cache/d.png', svg: '/cache/d.svg', cells: '/cache/d.cells.json', columns: 60, excalidraw: '/cache/d.excalidraw', width: 1600, height: 800, title: 'T',
}

// Fences.

test('idOf keys a brief the same way every time, and two briefs apart', () => {
  expect(idOf(BRIEF)).toBe('26pdlc76v78')
  expect(idOf(BRIEF)).toBe(idOf(BRIEF))
  expect(idOf('a')).not.toBe(idOf('b'))
})

test('a closed fence whose info string is excalidraw is a diagram, keyed by its trimmed brief', () => {
  expect(diagramOf('```excalidraw', ['', BRIEF, ''])).toEqual({ kind: 'diagram', id: idOf(BRIEF), brief: BRIEF })
  expect(diagramOf('~~~~ excalidraw before and after', [BRIEF])?.brief).toBe(BRIEF)
  expect(diagramOf('   ```excalidraw', [BRIEF])).not.toBeNull()
})

test('any other fence, and a diagram fence with no brief, is not a diagram', () => {
  for (const open of ['```', '```mermaid', '```excalidraw2', '```json excalidraw', '    ```excalidraw']) expect(diagramOf(open, [BRIEF])).toBeNull()
  expect(diagramOf('```excalidraw', ['', '  '])).toBeNull()
})

test('diagramsIn finds each closed diagram fence in order, and none still streaming', () => {
  const two = `${REPLY}\n\n\`\`\`excalidraw\nA second one.\n\`\`\``
  expect(diagramsIn(two).map(fence => fence.brief)).toEqual([BRIEF, 'A second one.'])
  expect(diagramsIn(`Here it comes.\n\n\`\`\`excalidraw\n${BRIEF}`)).toEqual([])
  expect(diagramsIn('```md\n```excalidraw\nnot a fence of its own\n```')).toEqual([])
})

// The reply's layout.

test('with diagrams on, a reply splits into its text and a diagram part between', () => {
  expect(replyLayout(REPLY, true)).toEqual([
    { kind: 'text', text: 'Here is the design.\n' },
    { kind: 'diagram', id: idOf(BRIEF), brief: BRIEF },
    { kind: 'text', text: '\nThat is the whole flow.' },
  ])
})

test('with diagrams off, or with the fence still streaming, the reply keeps the drawing beneath', () => {
  expect(replyLayout(REPLY)).toBeNull()
  expect(replyLayout(REPLY, false)).toBeNull()
  expect(replyLayout(`Here it comes.\n\n\`\`\`excalidraw\n${BRIEF}`, true)).toBeNull()
})

test('a diagram sits among tables and long fences in reply order', () => {
  const long = `\`\`\`ts\n${'const x = 1\n'.repeat(900)}\`\`\``
  expect(long.length).toBeGreaterThan(MAX_MARKDOWN)
  const parts = replyLayout(`| A | B |\n|---|---|\n| 1 | 2 |\n\n${REPLY}\n\n${long}`, true)!
  expect(parts.map(part => part.kind)).toEqual(['table', 'text', 'diagram', 'text', 'text', 'text'])
})

test('prose over the cap outside every fence keeps the drawing beneath, diagram and all', () => {
  const prose = 'Words in a long paragraph. '.repeat(400)
  expect(replyLayout(`${prose}\n\n${REPLY}`, true)).toBeNull()
})

test('diagramParts cuts a reply at its diagrams alone, tables left in the text', () => {
  const table = '| A | B |\n|---|---|\n| 1 | 2 |'
  expect(diagramParts(`${table}\n\n${REPLY}`)).toEqual([
    { kind: 'text', text: `${table}\n\nHere is the design.\n` },
    { kind: 'diagram', id: idOf(BRIEF), brief: BRIEF },
    { kind: 'text', text: '\nThat is the whole flow.' },
  ])
  expect(diagramParts('No diagram here.')).toBeNull()
})

// The spec.

test('a brief written as .flow is a spec already, and a fenced spec loses its fence', () => {
  expect(isFlow('title: T\nnode a: A\npanel One\n  a')).toBe(true)
  expect(isFlow(BRIEF)).toBe(false)
  expect(unfenced('```flow\ntitle: T\npanel A\n  a\n```')).toBe('title: T\npanel A\n  a')
  expect(unfenced('title: T')).toBe('title: T')
})

test('the spec request sends the brief to Sonnet with the guide, and a width budget where cells show', () => {
  const cells = specRequest(BRIEF, { pixels: false, columns: 100 })
  expect(cells).toMatchObject({ model: 'sonnet', system: SPEC_GUIDE, maxTokens: 4000, timeoutMs: 120000 })
  expect(cells.prompt).toBe(`Brief:\n${BRIEF}\n\nThe terminal draws the diagram in 94 columns. A box at width 200 takes about 25 columns and each panel adds about 6, so keep at most 3 boxes side by side across all panels together; stack rows instead of widening them.`)
  expect(specRequest(BRIEF, { pixels: true, columns: 100 }).prompt).toBe(`Brief:\n${BRIEF}`)
})

test('a correction sends the last spec and what was wrong with it', () => {
  const { prompt } = specRequest(BRIEF, { pixels: true, columns: 100 }, { spec: 'title: T', problem: 'line 2: no panel' })
  expect(prompt).toBe(`Brief:\n${BRIEF}\n\nYour spec:\ntitle: T\n\nThe generator refused it:\nline 2: no panel\n\nReply with a corrected spec.`)
  expect(CORRECTIONS).toBe(2)
})

test('the guide keeps panels apart and diagrams narrow, and the hint keeps mermaid for data charts', () => {
  expect(SPEC_GUIDE).toContain('No arrow crosses from one panel to another')
  expect(SPEC_GUIDE).toContain('Keep the diagram narrow')
  expect(DIAGRAM_HINT).toContain('One diagram per reply, in the final answer')
  expect(DIAGRAM_HINT).toContain('keep mermaid for data charts')
})

// Width.

test('a diagram wider than the card is a problem only where cells show it', () => {
  expect(roomOf(100)).toBe(94)
  expect(roomOf(20)).toBe(40)
  const wide = { ...FILES, columns: 120 }
  expect(widthProblem(wide, { pixels: false, columns: 100 })).toBe('The diagram is 120 columns wide and the terminal has 94. Put fewer boxes side by side: fewer panels, fewer cells per row, more rows.')
  expect(widthProblem(FILES, { pixels: false, columns: 100 })).toBeUndefined()
  expect(widthProblem(wide, { pixels: true, columns: 100 })).toBeUndefined()
  const { png: _, ...noPng } = wide
  expect(widthProblem(noPng, { pixels: true, columns: 100 })).toBeDefined()
})

test('a PNG takes a column per 16 pixels, at most the room, and rows from its shape', () => {
  expect(pictureSize(FILES, 200)).toEqual({ columns: 100, rows: 24 })
  expect(pictureSize(FILES, 60)).toEqual({ columns: 54, rows: 13 })
  expect(pictureSize({ ...FILES, width: 32, height: 3200 }, 100)).toEqual({ columns: 2, rows: 96 })
})

// Staleness.

test('a member drawing under another load is an orphan, drawn again; one under this load waits', () => {
  const drawing = (load: string): Diagram => ({ status: 'drawing', step: 'drawing', load })
  expect(isOrphan(drawing('old'), 'now')).toBe(true)
  expect(isOrphan(drawing('now'), 'now')).toBe(false)
  expect(isStale(undefined, 'now')).toBe(true)
  expect(isStale(drawing('old'), 'now')).toBe(true)
  expect(isStale(drawing('now'), 'now')).toBe(false)
  expect(isStale({ status: 'ready', ...FILES }, 'now')).toBe(false)
  expect(isStale({ status: 'failed', reason: 'no' }, 'now')).toBe(false)
})

// The setting.

test('diagramsOf reads a stored off, and anything else as on', () => {
  expect(diagramsOf('off')).toBe(false)
  for (const value of [undefined, null, 'on', '', 'OFF', false, 0]) expect(diagramsOf(value)).toBe(true)
})

test('diagramsCommand turns diagrams on or off, reports them, and refuses anything else', () => {
  expect(diagramsCommand('diagrams off', true)).toEqual({ diagrams: false, text: 'diagrams: off' })
  expect(diagramsCommand('  DIAGRAMS   On ', false)).toEqual({ diagrams: true, text: 'diagrams: on' })
  expect(diagramsCommand('diagrams', true)).toEqual({ text: 'diagrams: on' })
  for (const args of ['diagrams maybe', 'diagrams on now', 'diagram on', '']) expect(diagramsCommand(args, true)).toEqual({ text: 'usage: /lucid diagrams on|off' })
})
