import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CallRecord, TurnRecord } from '../types'
import { densityCommand, densityOf } from './density'
import { COLORS } from './text-style'
import { widthOf } from './reply-table'
import {
  addItems, anchorOf, answerCalls, callLabel, elapsedOf, endTurn, failureLine, fitLine, openBlock, responseItems, resultsOf, shellErrorLine,
  statusLine, titleOf,
} from './turn-model'

const omp = (args: string) => ({
  command: 'omp', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})
const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }

// The test clock moves only when a call runs or a test waits.
let now = 0
const wait = (ms: number) => {
  now += ms
}

function setup(on: On) {
  const store = new Map<string, unknown>()
  now = 0
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: now }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', (_$, e) => e.component === 'ToolGroup' && e.props.isExpanded
    ? { type: 'Text', props: {}, children: ['expanded group'] }
    : STOCK)
  return { store }
}

const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

async function level($: Engine, density: string) {
  return $.command.run(omp(`density ${density}`))
}

// The setting.

test('densityOf reads blackbox as a level', () => {
  expect(densityOf('blackbox')).toBe('blackbox')
})

test('densityCommand sets and reports blackbox, and lists it in the usage line', () => {
  expect(densityCommand('density blackbox', 'balanced')).toEqual({ density: 'blackbox', text: 'card density: blackbox' })
  expect(densityCommand('density', 'blackbox')).toEqual({ text: 'card density: blackbox' })
  expect(densityCommand('density loud', 'balanced')).toEqual({ text: 'usage: /omp density full|balanced|compact|blackbox' })
})

test('/omp density blackbox persists in the store', async ($, on) => {
  const { store } = setup(on)
  expect(await level($, 'blackbox')).toMatchObject({ text: 'card density: blackbox' })
  expect(store.get('density')).toBe('blackbox')
  expect(await $.command.run(omp('density'))).toMatchObject({ text: 'card density: blackbox' })
})

// The turn model.

const rec = (tool: string, input: Record<string, unknown>, status: CallRecord['status'] = 'ok'): CallRecord => ({ tool, input, status })
const titleText = (calls: CallRecord[]) => {
  const title = titleOf(calls, '/work')
  return [title.verb, title.subject, title.extra].filter(Boolean).join(' ')
}

const EMPTY: TurnRecord = { blocks: [] }

test('text closes the open block, and the next call opens the next one', () => {
  let turn = addItems(EMPTY, [{ kind: 'text' }, { kind: 'call', id: 'c1' }, { kind: 'call', id: 'c2' }], 100)
  expect(turn.blocks).toEqual([{ ids: ['c1', 'c2'], startedAt: 100, closed: false }])
  turn = addItems(turn, [{ kind: 'text' }, { kind: 'call', id: 'c3' }], 300)
  expect(turn.blocks).toEqual([
    { ids: ['c1', 'c2'], startedAt: 100, closed: true },
    { ids: ['c3'], startedAt: 300, closed: false },
  ])
  expect(addItems(turn, [{ kind: 'call', id: 'c3' }], 400)).toEqual(turn)
})

test('a block anchors at its first call, and only the last block takes more calls', () => {
  const turn = addItems(EMPTY, [{ kind: 'call', id: 'c1' }, { kind: 'call', id: 'c2' }, { kind: 'text' }, { kind: 'call', id: 'c3' }], 0)
  expect(anchorOf(turn, 'c2')).toBe('c1')
  expect(anchorOf(turn, 'c3')).toBe('c3')
  expect(anchorOf(turn, 'c9')).toBeUndefined()
  expect(openBlock(turn)?.ids).toEqual(['c3'])
  expect(openBlock(addItems(turn, [{ kind: 'text' }], 0))).toBeUndefined()
  expect(openBlock(EMPTY)).toBeUndefined()
})

test('a block’s time runs from its first call to its last answer, and shows once the block closes', () => {
  let turn = addItems(EMPTY, [{ kind: 'call', id: 'c1' }, { kind: 'call', id: 'c2' }], 1000)
  turn = answerCalls(turn, ['c1'], 1500)
  turn = answerCalls(turn, ['c2', 'c9'], 2200)
  expect(elapsedOf(turn.blocks[0]!)).toBeUndefined()
  turn = addItems(turn, [{ kind: 'text' }], 2600)
  expect(elapsedOf(turn.blocks[0]!)).toBe(1200)
  expect(answerCalls(turn, ['c9'], 5000)).toEqual(turn)
})

test('the turn’s end closes the open block, and an aborted turn’s block ends with it', () => {
  const open = addItems(EMPTY, [{ kind: 'call', id: 'c1' }], 1000)
  expect(elapsedOf(endTurn(answerCalls(open, ['c1'], 1400), 9000, false).blocks[0]!)).toBe(400)
  expect(elapsedOf(endTurn(open, 3000, false).blocks[0]!)).toBe(2000)
  expect(elapsedOf(endTurn(answerCalls(open, ['c1'], 1400), 3000, true).blocks[0]!)).toBe(2000)
  const closed = addItems(answerCalls(open, ['c1'], 1400), [{ kind: 'text' }], 1600)
  expect(endTurn(closed, 9000, true)).toEqual(closed)
})

test('a turn that edits is titled by the file it touches most and counts the rest', () => {
  expect(titleText([
    rec('Read', { file_path: '/work/src/a.py' }),
    rec('Edit', { file_path: '/work/src/inventory.py' }),
    rec('Write', { file_path: '/work/notes.md' }),
    rec('Edit', { file_path: '/work/src/inventory.py' }),
    rec('Bash', { command: 'pytest' }),
  ])).toBe('Editing inventory.py +1 file')
  expect(titleText([
    rec('Edit', { file_path: '/work/a.py' }),
    rec('Edit', { file_path: '/work/b.py' }),
    rec('Write', { file_path: '/work/c.py' }),
  ])).toBe('Editing a.py +2 files')
  expect(titleText([rec('NotebookEdit', { notebook_path: '/work/run.ipynb' })])).toBe('Editing run.ipynb')
})

test('an edited file shows its basename only when no other touched file shares it', () => {
  expect(titleText([
    rec('Edit', { file_path: '/work/src/index.ts' }),
    rec('Edit', { file_path: '/work/lib/index.ts' }),
  ])).toBe('Editing src/index.ts +1 file')
  expect(titleOf([rec('Edit', { file_path: '/work/src/index.ts' })], '/work')).toEqual({ verb: 'Editing', subject: 'index.ts' })
})

test('without edits the title names the first command run, then the read, the search, or the tool', () => {
  expect(titleText([
    rec('Read', { file_path: '/work/a.py' }),
    rec('Bash', { command: 'python3 toy.py\necho done' }),
    rec('Bash', { command: 'ls' }),
  ])).toBe('Running python3 toy.py')
  expect(titleText([rec('Grep', { pattern: 'TODO' }), rec('Read', { file_path: '/work/src/a.py' })])).toBe('Reading a.py +1 file')
  expect(titleText([rec('Glob', { pattern: '**/*.ts' }), rec('Grep', { pattern: 'TODO' })])).toBe('Searching **/*.ts +1 file')
  expect(titleText([rec('Grep', { pattern: 'TODO', path: '/work/src' }), rec('Glob', { pattern: '*.md', path: '/work/src' })])).toBe('Searching src')
  expect(titleText([rec('Agent', { description: 'Find the bug' }), rec('TodoWrite', { todos: [] })])).toBe('Using Agent')
})

test('a turn that reads and greps through the shell is titled by the file it touches most', () => {
  expect(titleText([
    rec('Read', { file_path: '/work/.mcp.json' }),
    rec('Bash', { command: 'grep -nE "name:|registerTool|tool\\(|description" /work/mcp/docs-server/index.mjs | head -40; wc -l /work/mcp/docs-server/index.mjs' }),
    rec('Read', { file_path: '/work/mcp/docs-server/index.mjs' }),
  ])).toBe('Reading index.mjs +1 file')
})

test('a command the turn runs titles it ahead of its searches, with no count', () => {
  expect(titleText([
    rec('Bash', { command: 'grep -rn TODO src' }),
    rec('Bash', { command: 'cd /tmp/x && npm test' }),
    rec('Bash', { command: 'grep -rn FIXME lib' }),
  ])).toBe('Running npm test')
  expect(titleText([rec('Read', { file_path: '/work/a.py' }), rec('Bash', { command: 'rtk proxy timeout 60 python3 tools/toy.py --fast' })]))
    .toBe('Running python3 toy.py')
})

test('a turn that only searches is titled by a path ahead of a pattern, the pattern counted as one more', () => {
  expect(titleText([rec('Bash', { command: "rtk proxy find . -name '*.ts'" }), rec('Bash', { command: 'ls -la src' })])).toBe('Searching src +1 file')
  expect(titleText([rec('Bash', { command: 'grep -rn TODO' })])).toBe('Searching TODO')
})

test('a relative and an absolute path to one file count as one file', () => {
  expect(titleText([
    rec('Bash', { command: 'cat src/a.py' }),
    rec('Read', { file_path: '/work/src/a.py' }),
    rec('Read', { file_path: '/work/b.py' }),
  ])).toBe('Reading a.py +1 file')
})

test('a path under ~ counts as the same file as its absolute spelling', () => {
  const title = titleOf([
    rec('Bash', { command: 'grep -n export ~/project/hooks/density.ts | head -5' }),
    rec('Read', { file_path: '/Users/me/project/hooks/density.ts' }),
  ], '/Users/me/project')
  expect(title).toEqual({ verb: 'Reading', subject: 'density.ts' })
})

test('a read that names no file is titled by its command, and trivial commands by their tool', () => {
  expect(titleText([rec('Bash', { command: 'git status' }), rec('Bash', { command: 'git log --oneline -5' })])).toBe('Reading git status')
  expect(titleText([rec('Bash', { command: 'sleep 3 && echo done' })])).toBe('Using Bash')
})

test('the status line counts calls and failures and gives the elapsed time', () => {
  const calls = [...Array.from({ length: 9 }, () => rec('Read', { file_path: '/work/a.py' })), rec('Bash', { command: 'cat x' }, 'failed')]
  expect(statusLine(calls, 6100)).toBe('10 calls · 1 failed · 6.1s')
  expect(statusLine([rec('Read', {})], undefined)).toBe('1 call')
  expect(statusLine([rec('Bash', {}, 'interrupted'), rec('Read', {})], 1200)).toBe('2 calls · 1 failed · 1.2s')
  expect(statusLine([rec('Read', {}), rec('Read', {})], 64000)).toBe('2 calls · 1m 4s')
})

test('the status line names the call in progress while the turn runs', () => {
  expect(statusLine([rec('Read', {}), rec('Bash', { command: 'python3 toy.py' }, 'running')], undefined, 'Bash: python3 toy.py'))
    .toBe('2 calls · Bash: python3 toy.py')
})

test('a call label is the tool and the first line of what it acts on', () => {
  expect(callLabel(rec('Bash', { command: 'python3 toy.py\nls' }), '/work')).toBe('Bash: python3 toy.py')
  expect(callLabel(rec('Edit', { file_path: '/work/src/a.py' }), '/work')).toBe('Edit: src/a.py')
  expect(callLabel(rec('Read', { file_path: '/work/notes.txt' }), '/work')).toBe('Read: notes.txt')
  expect(callLabel(rec('Grep', { pattern: 'TODO', path: '/work/src' }), '/work')).toBe('Grep: TODO')
  expect(callLabel(rec('Agent', { description: 'Reply with done', prompt: 'Reply with the word done' }), '/work')).toBe('Agent: Reply with done')
  expect(callLabel(rec('TodoWrite', { todos: [] }), '/work')).toBe('TodoWrite')
})

test('a response row yields its text and calls in order, with long inputs cut for the record', () => {
  const content = 'x'.repeat(1000)
  const { items, calls } = responseItems([
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Writing it.' },
    { type: 'tool_use', id: 'c1', name: 'Write', input: { file_path: '/work/a.txt', content } },
  ])
  expect(items).toEqual([{ kind: 'text' }, { kind: 'call', id: 'c1' }])
  expect(calls).toHaveLength(1)
  expect(calls[0]!.id).toBe('c1')
  expect(calls[0]!.record.tool).toBe('Write')
  expect(calls[0]!.record.status).toBe('running')
  expect(calls[0]!.record.input.file_path).toBe('/work/a.txt')
  expect(String(calls[0]!.record.input.content).length).toBeLessThan(400)
  expect(calls[0]!.body.input).toEqual({ file_path: '/work/a.txt', content })
  expect(responseItems([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Only text.' }])).toEqual({ items: [{ kind: 'text' }], calls: [] })
  expect(responseItems([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: ' \n' }])).toEqual({ items: [], calls: [] })
})

test('a result row yields each result, its error state, and its text', () => {
  expect(resultsOf([
    { type: 'tool_result', tool_use_id: 'c1', content: 'fine' },
    { type: 'tool_result', tool_use_id: 'c2', is_error: true, content: [{ type: 'text', text: '<tool_use_error>cat: x: No such file</tool_use_error>' }] },
    { type: 'tool_result', tool_use_id: 'c3', is_error: true, content: '[Request interrupted by user for tool use]' },
  ])).toEqual([
    { id: 'c1', status: 'ok', text: 'fine' },
    { id: 'c2', status: 'failed', text: '<tool_use_error>cat: x: No such file</tool_use_error>', error: 'cat: x: No such file' },
    { id: 'c3', status: 'interrupted', text: '[Request interrupted by user for tool use]', error: 'Interrupted' },
  ])
})

// The block, drawn through the events a session raises.

const SITE = { plugin: 'omp-blocks', surface: 'terminal', viewport: { columns: 100, rows: 40 } } as const
type Block = { type: string; [field: string]: unknown }
// What a hidden row draws: an empty Box, with no text and no children.
const NOTHING = { type: 'Box' }
// A call's result, and how long it runs: a second unless `ms` says otherwise.
type Outcome = { result: unknown; text?: string; isError?: true; ms?: number }

function session(on: On) {
  const outcomes = new Map<string, Outcome>()
  on('tool.call', (_$, e) => {
    const { ms, ...outcome } = outcomes.get(e.tool_use_id) ?? { result: { stdout: 'done', stderr: '', interrupted: false }, text: 'done' }
    wait(ms ?? 1000)
    return outcome
  })
  return outcomes
}

const response = ($: Engine, uuid: string, content: Block[]) => $.session.append({
  message: { type: 'assistant', role: 'assistant', content }, door: 'response', origin: { kind: 'model', model: 'test-model' }, uuid,
})
const say = ($: Engine, uuid: string, text: string) => response($, uuid, [{ type: 'text', text }])
const use = ($: Engine, id: string, name: string, input: Record<string, unknown>) =>
  response($, `row-${id}`, [{ type: 'tool_use', id, name, input }])
const answer = ($: Engine, id: string, content: string, isError = false) => $.session.append({
  message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] },
  door: 'tool-result', origin: { kind: 'tool', tool: 'Bash' }, uuid: `result-${id}`,
})
// A call the model makes, its run, and its result row.
async function call($: Engine, outcomes: Map<string, Outcome>, id: string, name: string, input: Record<string, unknown>, outcome: Outcome) {
  await use($, id, name, input)
  outcomes.set(id, outcome)
  await $.tool.call({ tool: name, tool_use_id: id, ...input } as never)
  await answer($, id, outcome.text ?? '', outcome.isError === true)
}

const READ_NOTES = { type: 'text', file: { filePath: '/work/notes.txt', content: 'alpha\nbeta', startLine: 1, numLines: 2, totalLines: 2 } }
const EDIT_INVENTORY = {
  filePath: '/work/inventory.py',
  structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
}
const MISSING = 'cat: missing.txt: No such file or directory'

// Text, a read, text, an edit, a failing command, and the final reply: two blocks, the read's
// and the edit's, each call running a second.
async function editingTurn($: Engine, outcomes: Map<string, Outcome>) {
  await $.turn.start({ text: 'go', turnId: 'turn1' })
  await say($, 'text1', 'Step one reads the notes.')
  await call($, outcomes, 'c1', 'Read', { file_path: '/work/notes.txt' }, { result: READ_NOTES, text: 'alpha\nbeta' })
  await say($, 'text2', 'Step two edits the inventory.')
  await call($, outcomes, 'c2', 'Edit', { file_path: '/work/inventory.py', old_string: 'old', new_string: 'new' }, { result: EDIT_INVENTORY, text: 'ok' })
  await call($, outcomes, 'c3', 'Bash', { command: 'cat missing.txt' }, { isError: true, result: MISSING, text: MISSING })
  await say($, 'text3', 'All steps ran; cat failed as planned.')
  await $.turn.complete({ answer: 'All steps ran; cat failed as planned.', durationMs: 6100, isAborted: false, turnId: 'turn1', reason: 'answer' })
}

const tool = (id: string, name: string, input: Record<string, unknown>, output: unknown, extra: object = {}) => ({
  tool_use_id: id, tool: name, input, output, isRunning: false, isErrored: false, isInterrupted: false, ...extra,
})
const mountUse = ($: Engine, props: ReturnType<typeof tool>) =>
  $.ui.mount({ ...SITE, component: 'ToolUse', requestId: props.tool_use_id, props })
const mountResult = ($: Engine, id: string, name: string, output: unknown) =>
  $.ui.mount({ ...SITE, component: 'ToolResult', requestId: id, props: { tool_use_id: id, tool: name, output, isErrored: false } })
const mountGroup = ($: Engine, requestId: string, calls: ReturnType<typeof tool>[], isActive = false) =>
  $.ui.mount({ ...SITE, component: 'ToolGroup', requestId, props: { calls, isActive, isExpanded: false } })
const mountText = ($: Engine, id: string, text: string) =>
  $.ui.mount({ ...SITE, component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true } })

const READ_ROW = tool('c1', 'Read', { file_path: '/work/notes.txt' }, READ_NOTES)
const EDIT_ROW = tool('c2', 'Edit', { file_path: '/work/inventory.py' }, EDIT_INVENTORY)
const BASH_ROW = tool('c3', 'Bash', { command: 'cat missing.txt' }, MISSING, { isErrored: true })

async function blackbox($: Engine, on: On) {
  setup(on)
  const outcomes = session(on)
  await level($, 'blackbox')
  return outcomes
}

test('folded, the block at a block’s first call shows the title and the status line only', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Reading notes.txt')
  expect(await ui.find({ type: 'Text', text: exactly('1 call · 1.0s') })).toBeDefined()
  for (const hidden of ['Step one reads the notes.', 'Read: notes.txt', 'Edit: inventory.py', 'alpha']) {
    expect(await ui.find({ text: hidden })).toBeUndefined()
  }
  expect(await ui.find({ type: 'Button', text: 'Show ▸' })).toBeUndefined()
  await ui.unmount()
})

test('text ends a block, and the next call opens a new one with its own title, count, and time', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, EDIT_ROW)
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Editing inventory.py')
  expect(await ui.find({ type: 'Text', text: exactly('2 calls · 1 failed · 2.0s') })).toBeDefined()
  await ui.unmount()
  const text = await mountText($, 'text2', 'Step two edits the inventory.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  expect(await text.find({ key: 'turn-fold' })).toBeUndefined()
  await text.unmount()
})

test('the title and status lines keep to one line each', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, EDIT_ROW)
  expect((await ui.find({ type: 'Text', text: exactly('2 calls · 1 failed · 2.0s') }))?.props.wrap).toBe('truncate-end')
  expect((await ui.find({ type: 'Text', text: exactly('▸ Editing inventory.py') }))?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('a failed call turns its block’s border red and shows its header and first error line while folded', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, EDIT_ROW)
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.borderErr } })
  expect(await ui.find({ type: 'Text', text: '✗ Bash: cat missing.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: MISSING })).toBeDefined()
  await ui.unmount()
  const earlier = await mountUse($, READ_ROW)
  expect(await earlier.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.border } })
  expect(await earlier.find({ text: /✗/ })).toBeUndefined()
  await earlier.unmount()
})

test('calls with no text between them share one block, with the plain border and no calls listed', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'calm' })
  await call($, outcomes, 'k1', 'Bash', { command: 'python3 toy.py' }, { result: { stdout: '5', stderr: '', interrupted: false }, text: '5' })
  await call($, outcomes, 'k2', 'Bash', { command: 'ls' }, { result: { stdout: 'toy.py', stderr: '', interrupted: false }, text: 'toy.py' })
  await say($, 'calm-end', 'Both ran.')
  await $.turn.complete({ answer: 'Both ran.', durationMs: 900, isAborted: false, turnId: 'calm', reason: 'answer' })
  const ui = await mountUse($, tool('k1', 'Bash', { command: 'python3 toy.py' }, { stdout: '5', stderr: '', interrupted: false }))
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.border } })
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Running python3 toy.py')
  expect(await ui.find({ type: 'Text', text: exactly('2 calls · 2.0s') })).toBeDefined()
  expect(await ui.find({ text: /✗/ })).toBeUndefined()
  await ui.unmount()
})

test('every later call row of a block draws nothing: calls, groups, and results', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const rows = [
    await mountUse($, BASH_ROW),
    await mountResult($, 'c1', 'Read', READ_NOTES),
    await mountResult($, 'c2', 'Edit', EDIT_INVENTORY),
    await mountGroup($, 'collapsed-row-c3', [BASH_ROW]),
  ]
  for (const row of rows) {
    expect(await row.drawn()).toEqual(NOTHING)
    await row.unmount()
  }
})

test('text before the first call draws above the block, which draws at that call', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const text = await mountText($, 'text1', 'Step one reads the notes.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  expect(await text.find({ key: 'turn-fold' })).toBeUndefined()
  await text.unmount()
  const anchor = await mountUse($, READ_ROW)
  expect((await anchor.find({ key: 'turn-fold' }))?.text).toBe('▸ Reading notes.txt')
  await anchor.unmount()
})

test('a group that holds a block’s first call draws that block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const first = await mountGroup($, 'collapsed-row-c1', [READ_ROW])
  expect((await first.find({ key: 'turn-fold' }))?.text).toBe('▸ Reading notes.txt')
  await first.unmount()
  const second = await mountGroup($, 'collapsed-row-c2', [EDIT_ROW, BASH_ROW])
  expect((await second.find({ key: 'turn-fold' }))?.text).toBe('▸ Editing inventory.py')
  await second.unmount()
})

test('a group whose calls span two blocks draws both, in turn order', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountGroup($, 'collapsed-row-c1', [READ_ROW, EDIT_ROW, BASH_ROW])
  const titles = (await ui.findAll({ key: 'turn-fold' })).map(found => found.text)
  expect(titles).toEqual(['▸ Reading notes.txt', '▸ Editing inventory.py'])
  await ui.unmount()
})

test('a group of calls no card formats draws its block, so an MCP call folds with the calls after it', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'mcp' })
  await response($, 'row-m1', [
    { type: 'tool_use', id: 'm1', name: 'mcp__docs__index', input: { query: 'greengrass deploy' } },
    { type: 'tool_use', id: 'm2', name: 'Artifact', input: { action: 'list' } },
  ])
  for (const [id, name, input, text] of [['m1', 'mcp__docs__index', { query: 'greengrass deploy' }, 'hits'], ['m2', 'Artifact', { action: 'list' }, 'none']] as const) {
    outcomes.set(id, { result: text, text })
    await $.tool.call({ tool: name, tool_use_id: id, ...input } as never)
    await answer($, id, text)
  }
  await call($, outcomes, 'm3', 'Bash', { command: 'python3 toy.py' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  await say($, 'mcp-end', 'Done.')
  await $.turn.complete({ answer: 'Done.', durationMs: 3000, isAborted: false, turnId: 'mcp', reason: 'answer' })
  const group = await mountGroup($, 'collapsed-row-m1', [
    tool('m1', 'mcp__docs__index', { query: 'greengrass deploy' }, 'hits'),
    tool('m2', 'Artifact', { action: 'list' }, 'none'),
  ])
  expect((await group.find({ key: 'turn-fold' }))?.text).toBe('▸ Running python3 toy.py')
  expect(await group.find({ type: 'Text', text: exactly('3 calls · 3.0s') })).toBeDefined()
  expect(await group.find({ text: 'native rendering' })).toBeUndefined()
  await group.unmount()
  const later = await mountUse($, tool('m3', 'Bash', { command: 'python3 toy.py' }, { stdout: 'a', stderr: '', interrupted: false }))
  expect(await later.drawn()).toEqual(NOTHING)
  await later.unmount()
})

test('text after the last call draws', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountText($, 'text3', 'All steps ran; cat failed as planned.')
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await ui.unmount()
})

test('expanded, a block lists a compact card per call of its own in turn order and no text', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, EDIT_ROW)
  await ui.press({ key: 'turn-fold' })
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▾ Editing inventory.py')
  const whole = (await ui.findAll({}))[0]!.text
  const at = ['Edit: inventory.py', 'Bash: cat missing.txt'].map(text => whole.indexOf(text))
  for (const index of at) expect(index).toBeGreaterThan(-1)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  for (const text of ['Read: notes.txt', 'Step one reads the notes.', 'Step two edits the inventory.', 'All steps ran']) expect(whole.includes(text)).toBe(false)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ key: 'open-card-c1' })).toBeUndefined()
  expect(await ui.find({ key: 'open-card-c2' })).toBeDefined()
  await ui.press({ key: 'turn-fold' })
  expect(await ui.find({ text: 'Edit: inventory.py' })).toBeUndefined()
  await ui.unmount()
})

test('each block opens and closes on its own', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const second = await mountUse($, EDIT_ROW)
  await second.press({ key: 'turn-fold' })
  await second.unmount()
  const first = await mountUse($, READ_ROW)
  expect((await first.find({ key: 'turn-fold' }))?.text).toBe('▸ Reading notes.txt')
  await first.unmount()
  const again = await mountUse($, EDIT_ROW)
  expect((await again.find({ key: 'turn-fold' }))?.text).toBe('▾ Editing inventory.py')
  await again.unmount()
})

test('each call in an expanded block opens its balanced body on its own Show ▸', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const first = await mountUse($, READ_ROW)
  await first.press({ key: 'turn-fold' })
  expect(await first.find({ type: 'Button', text: 'Show all (2 rows)' })).toBeUndefined()
  await first.press({ key: 'open-card-c1' })
  expect(await first.find({ type: 'Button', text: 'Show all (2 rows)' })).toBeDefined()
  await first.unmount()
  const second = await mountUse($, EDIT_ROW)
  await second.press({ key: 'turn-fold' })
  expect(await second.find({ key: 'open-card-c2' })).toMatchObject({ text: 'Show ▸' })
  await second.press({ key: 'open-card-c2' })
  expect(await second.find({ type: 'Text', text: 'new' })).toBeDefined()
  await second.unmount()
})

test('while the turn runs, the status line names the call in progress and omits the time', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'live' })
  await say($, 'live1', 'Running the script.')
  await use($, 'l1', 'Bash', { command: 'python3 toy.py' })
  const ui = await mountUse($, tool('l1', 'Bash', { command: 'python3 toy.py' }, undefined, { isRunning: true }))
  expect(await ui.find({ type: 'Text', text: '1 call · Bash: python3 toy.py' })).toBeDefined()
  outcomes.set('l1', { result: { stdout: '5', stderr: '', interrupted: false }, text: '5', ms: 400 })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'l1', command: 'python3 toy.py' })
  await answer($, 'l1', '5')
  expect(await ui.find({ type: 'Text', text: exactly('1 call') })).toBeDefined()
  await $.turn.complete({ answer: '', durationMs: 400, isAborted: false, turnId: 'live', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: exactly('1 call · 0.4s') })).toBeDefined()
  await ui.unmount()
})

test('while the turn runs, a closed block shows its time and only the open block names the call in progress', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'two' })
  await call($, outcomes, 'o1', 'Bash', { command: 'ls' }, { result: { stdout: 'toy.py', stderr: '', interrupted: false }, text: 'toy.py' })
  await say($, 'two-text', 'Now the script.')
  await use($, 'o2', 'Bash', { command: 'python3 toy.py' })
  const closed = await mountUse($, tool('o1', 'Bash', { command: 'ls' }, { stdout: 'toy.py', stderr: '', interrupted: false }))
  expect(await closed.find({ type: 'Text', text: exactly('1 call · 1.0s') })).toBeDefined()
  await closed.unmount()
  const open = await mountUse($, tool('o2', 'Bash', { command: 'python3 toy.py' }, undefined, { isRunning: true }))
  expect((await open.find({ key: 'turn-fold' }))?.text).toBe('▸ Running python3 toy.py')
  expect(await open.find({ type: 'Text', text: exactly('1 call · Bash: python3 toy.py') })).toBeDefined()
  await open.unmount()
})

test('an answer followed by one more call draws, and the call opens a new block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'pull' })
  await call($, outcomes, 'p1', 'Bash', { command: 'ls' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  await say($, 'pull-text', 'The answer is a.')
  const text = await mountText($, 'pull-text', 'The answer is a.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await call($, outcomes, 'p2', 'Bash', { command: 'python3 toy.py' }, { result: { stdout: '5', stderr: '', interrupted: false }, text: '5' })
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 'pull', reason: 'answer' })
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await text.unmount()
  const later = await mountUse($, tool('p2', 'Bash', { command: 'python3 toy.py' }, { stdout: '5', stderr: '', interrupted: false }))
  expect((await later.find({ key: 'turn-fold' }))?.text).toBe('▸ Running python3 toy.py')
  expect(await later.find({ type: 'Text', text: exactly('1 call · 1.0s') })).toBeDefined()
  await later.unmount()
})

test('a later call still streaming in draws nothing while its block is open', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'stream' })
  await call($, outcomes, 's1', 'Bash', { command: 'ls' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  const streaming = await mountUse($, tool('s2', 'Write', { file_path: '/work/out.txt' }, undefined, { isRunning: true }))
  expect(await streaming.drawn()).toEqual(NOTHING)
  await streaming.unmount()
  const group = await mountGroup($, 'collapsed-toolu_s3', [tool('s3', 'Read', { file_path: '/work/a.txt' }, undefined, { isRunning: true })], true)
  expect(await group.drawn()).toEqual(NOTHING)
  await group.unmount()
})

test('a call streaming in after text opens a new block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'after' })
  await call($, outcomes, 'n1', 'Bash', { command: 'ls' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  await say($, 'after-text', 'Writing the result.')
  const streaming = await mountUse($, tool('n2', 'Write', { file_path: '/work/out.txt' }, undefined, { isRunning: true }))
  expect((await streaming.find({ key: 'turn-fold' }))?.text).toBe('▸ Editing out.txt')
  expect(await streaming.find({ type: 'Text', text: exactly('1 call · Write: out.txt') })).toBeDefined()
  await streaming.unmount()
})

test('thinking and empty text close no block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'quiet' })
  await call($, outcomes, 'h1', 'Bash', { command: 'ls' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  await response($, 'quiet-thinking', [{ type: 'thinking', thinking: 'Next, the script.' }, { type: 'text', text: '  \n' }])
  await call($, outcomes, 'h2', 'Bash', { command: 'python3 toy.py' }, { result: { stdout: '5', stderr: '', interrupted: false }, text: '5' })
  await say($, 'quiet-end', 'Done.')
  const ui = await mountUse($, tool('h1', 'Bash', { command: 'ls' }, { stdout: 'a', stderr: '', interrupted: false }))
  expect(await ui.find({ type: 'Text', text: exactly('2 calls · 2.0s') })).toBeDefined()
  await ui.unmount()
  const later = await mountUse($, tool('h2', 'Bash', { command: 'python3 toy.py' }, { stdout: '5', stderr: '', interrupted: false }))
  expect(await later.drawn()).toEqual(NOTHING)
  await later.unmount()
})

test('an interrupted turn marks its running call and turns the border red', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'stop' })
  await use($, 'i1', 'Bash', { command: 'sleep 30' })
  wait(2000)
  await $.turn.complete({ answer: '', durationMs: 2000, isAborted: true, turnId: 'stop', reason: 'aborted' })
  void outcomes
  const ui = await mountUse($, tool('i1', 'Bash', { command: 'sleep 30' }, undefined, { isInterrupted: true }))
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.borderErr } })
  expect(await ui.find({ type: 'Text', text: exactly('1 call · 1 failed · 2.0s') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✗ Bash: sleep 30' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exactly('Interrupted') })).toBeDefined()
  await ui.unmount()
})

test('an Agent call counts as a call and its result opens in the expanded block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'agent' })
  await call($, outcomes, 'a1', 'Agent', { description: 'Reply with done', prompt: 'Reply with the word done' }, {
    result: { status: 'completed', content: [{ type: 'text', text: 'done' }] }, text: 'done', ms: 1500,
  })
  await say($, 'agent-end', 'The agent replied.')
  await $.turn.complete({ answer: 'The agent replied.', durationMs: 1500, isAborted: false, turnId: 'agent', reason: 'answer' })
  const ui = await mountUse($, tool('a1', 'Agent', { description: 'Reply with done' }, { status: 'completed' }))
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Using Agent')
  expect(await ui.find({ type: 'Text', text: exactly('1 call · 1.5s') })).toBeDefined()
  await ui.press({ key: 'turn-fold' })
  expect(await ui.find({ text: 'Agent: Reply with done' })).toBeDefined()
  await ui.press({ key: 'open-card-a1' })
  await ui.press({ key: 'expand-output-a1' })
  expect(await ui.find({ type: 'Text', text: exactly('done') })).toBeDefined()
  const result = await mountResult($, 'a1', 'Agent', { status: 'completed' })
  expect(await result.drawn()).toEqual(NOTHING)
  await result.unmount()
  await ui.unmount()
})

test('a result the block cannot show keeps its own row', async ($, on) => {
  const outcomes = await blackbox($, on)
  const image = { type: 'image', file: { base64: 'AAAA', type: 'image/png', originalSize: 4 } }
  await $.turn.start({ text: 'go', turnId: 'image' })
  await call($, outcomes, 'g1', 'Bash', { command: 'ls' }, { result: { stdout: 'a.png', stderr: '', interrupted: false }, text: 'a.png' })
  await call($, outcomes, 'g2', 'Read', { file_path: '/work/a.png' }, { result: image, text: '[image]' })
  const row = await mountUse($, tool('g2', 'Read', { file_path: '/work/a.png' }, image))
  expect(await row.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await row.unmount()
  const result = await mountResult($, 'g2', 'Read', image)
  expect(await result.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await result.unmount()
})

test('rows of a turn the level did not record draw at the compact level', async ($, on) => {
  setup(on)
  const outcomes = session(on)
  await level($, 'compact')
  await editingTurn($, outcomes)
  await level($, 'blackbox')
  const ui = await mountUse($, EDIT_ROW)
  expect(await ui.find({ key: 'open-card' })).toMatchObject({ text: 'Show ▸' })
  expect(await ui.find({ key: 'turn-fold' })).toBeUndefined()
  await ui.unmount()
  const text = await mountText($, 'text1', 'Step one reads the notes.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await text.unmount()
})

test('the other levels draw the same rows as they did before', async ($, on) => {
  setup(on)
  const outcomes = session(on)
  for (const density of ['full', 'balanced', 'compact']) {
    await level($, density)
    await editingTurn($, outcomes)
    const edit = await mountUse($, EDIT_ROW)
    expect(await edit.find({ key: 'turn-fold' })).toBeUndefined()
    expect(await edit.find({ text: /Edit/ })).toBeDefined()
    await edit.unmount()
    const text = await mountText($, 'text1', 'Step one reads the notes.')
    expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
    await text.unmount()
  }
})

test('another surface keeps its own rendering at blackbox', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  for (const component of ['ToolUse', 'AssistantMessage'] as const) {
    const ui = component === 'ToolUse'
      ? await $.ui.mount({ ...SITE, surface: 'desktop', component, requestId: 'c2', props: EDIT_ROW })
      : await $.ui.mount({ ...SITE, surface: 'desktop', component, requestId: 'text1', props: { text: 'Step one reads the notes.', isFirstOfReply: true } })
    expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
    await ui.unmount()
  }
})

test('the first call of a turn draws the block while its input still streams in', async ($, on) => {
  await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'first' })
  const group = await mountGroup($, 'collapsed-toolu_f1', [tool('f1', 'Read', { file_path: '/work/a.txt' }, undefined)], true)
  expect((await group.find({ key: 'turn-fold' }))?.text).toBe('▸ Reading a.txt')
  expect(await group.find({ type: 'Text', text: exactly('1 call · Read: a.txt') })).toBeDefined()
  await group.unmount()
})

test('a subagent’s rows and calls stay out of the turn', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'parent' })
  await use($, 'm1', 'Agent', { description: 'Look around' })
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'sub1', name: 'Bash', input: { command: 'ls' } }] },
    door: 'response', origin: { kind: 'model', model: 'test-model' }, uuid: 'sub-row', agentId: 'agent-1',
  })
  outcomes.set('sub1', { isError: true, result: 'boom', text: 'boom' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'sub1', command: 'ls', agentId: 'agent-1' } as never)
  const ui = await mountUse($, tool('m1', 'Agent', { description: 'Look around' }, undefined, { isRunning: true }))
  expect(await ui.find({ type: 'Text', text: exactly('1 call · Agent: Look around') })).toBeDefined()
  await ui.unmount()
})

test('a subagent’s text closes no block of the turn', async ($, on) => {
  await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'parent' })
  await use($, 'm1', 'Agent', { description: 'Look around' })
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'The subagent looked.' }] },
    door: 'response', origin: { kind: 'model', model: 'test-model' }, uuid: 'sub-text', agentId: 'agent-1',
  })
  await use($, 'm2', 'Read', { file_path: '/work/a.txt' })
  const ui = await mountUse($, tool('m1', 'Agent', { description: 'Look around' }, undefined, { isRunning: true }))
  expect(await ui.find({ type: 'Text', text: exactly('2 calls · Read: a.txt') })).toBeDefined()
  await ui.unmount()
  const later = await mountUse($, tool('m2', 'Read', { file_path: '/work/a.txt' }, undefined, { isRunning: true }))
  expect(await later.drawn()).toEqual(NOTHING)
  await later.unmount()
})

test('a failed command shows its first error line past the exit code', async ($, on) => {
  const outcomes = await blackbox($, on)
  const text = `Exit code 1\n${MISSING}`
  expect(resultsOf([{ type: 'tool_result', tool_use_id: 'e1', is_error: true, content: text }])[0]?.error).toBe(MISSING)
  expect(resultsOf([{ type: 'tool_result', tool_use_id: 'e2', is_error: true, content: 'Exit code 2' }])[0]?.error).toBe('Exit code 2')
  await $.turn.start({ text: 'go', turnId: 'exit' })
  await call($, outcomes, 'e1', 'Bash', { command: 'cat missing.txt' }, { isError: true, result: text, text })
  const ui = await mountUse($, tool('e1', 'Bash', { command: 'cat missing.txt' }, text, { isErrored: true }))
  expect(await ui.find({ type: 'Text', text: exactly(MISSING) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exactly('Exit code 1') })).toBeUndefined()
  await ui.unmount()
})

// Background jobs.

const TIMED_OUT = {
  stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: 'bomtka2wc', timedOutAfterMs: 120000,
}
const STARTED = { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg42' }
const BUILD = { command: 'npm run build' }
const SLEEP = { command: 'sleep 3 && echo done', run_in_background: true }

// Text, a command, a call moved to the background on its 120-second timeout, and the final reply.
async function backgroundTurn($: Engine, outcomes: Map<string, Outcome>) {
  await $.turn.start({ text: 'go', turnId: 'bg' })
  await say($, 'bg-text', 'Now the long build.')
  await call($, outcomes, 'b1', 'Bash', { command: 'echo first' }, { result: { stdout: 'first', stderr: '', interrupted: false }, text: 'first' })
  await call($, outcomes, 'b2', 'Bash', BUILD, { result: TIMED_OUT, text: 'Command running in background with ID: bomtka2wc.', ms: 120000 })
  await say($, 'bg-end', 'The build runs on.')
  await $.turn.complete({ answer: 'The build runs on.', durationMs: 121000, isAborted: false, turnId: 'bg', reason: 'answer' })
}

test('a call moved to the background on its timeout draws nothing of its own', async ($, on) => {
  const outcomes = await blackbox($, on)
  await backgroundTurn($, outcomes)
  const rows = [
    await mountUse($, tool('b2', 'Bash', BUILD, TIMED_OUT)),
    await mountResult($, 'b2', 'Bash', TIMED_OUT),
    await mountGroup($, 'collapsed-row-b2', [tool('b2', 'Bash', BUILD, TIMED_OUT)]),
  ]
  for (const row of rows) {
    expect(await row.drawn()).toEqual(NOTHING)
    await row.unmount()
  }
})

test('a call moved to the background counts as a call, not a failure, and opens as a muted row', async ($, on) => {
  const outcomes = await blackbox($, on)
  await backgroundTurn($, outcomes)
  const ui = await mountUse($, tool('b1', 'Bash', { command: 'echo first' }, { stdout: 'first', stderr: '', interrupted: false }))
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.border } })
  expect(await ui.find({ type: 'Text', text: exactly('2 calls · 2m 1s') })).toBeDefined()
  await ui.press({ key: 'turn-fold' })
  const row = await ui.find({ type: 'Text', text: exactly('Bash: npm run build · moved to background after 120s') })
  expect(row?.props.color).toBe(COLORS.muted)
  expect(await ui.find({ key: 'open-card-b2' })).toBeUndefined()
  await ui.unmount()
})

test('a run_in_background call stays inside the block, even as its first call', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'started' })
  await call($, outcomes, 'r1', 'Bash', SLEEP, { result: STARTED, text: 'Command running in background with ID: bg42.', ms: 300 })
  await say($, 'started-end', 'It runs.')
  await $.turn.complete({ answer: 'It runs.', durationMs: 300, isAborted: false, turnId: 'started', reason: 'answer' })
  const ui = await mountUse($, tool('r1', 'Bash', SLEEP, STARTED))
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: exactly('1 call · 0.3s') })).toBeDefined()
  await ui.press({ key: 'turn-fold' })
  expect(await ui.find({ type: 'Text', text: exactly('Bash: sleep 3 && echo done · running in background') })).toBeDefined()
  await ui.unmount()
  const result = await mountResult($, 'r1', 'Bash', STARTED)
  expect(await result.drawn()).toEqual(NOTHING)
  await result.unmount()
})

test('the text before a backgrounded call draws, and the open block lists only the calls', async ($, on) => {
  const outcomes = await blackbox($, on)
  await backgroundTurn($, outcomes)
  const text = await mountText($, 'bg-text', 'Now the long build.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await text.unmount()
  const ui = await mountUse($, tool('b1', 'Bash', { command: 'echo first' }, { stdout: 'first', stderr: '', interrupted: false }))
  await ui.press({ key: 'turn-fold' })
  const whole = (await ui.findAll({}))[0]!.text
  const at = ['Bash: echo first', 'Bash: npm run build · moved to background'].map(part => whole.indexOf(part))
  for (const index of at) expect(index).toBeGreaterThan(-1)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(whole.includes('Now the long build.')).toBe(false)
  await ui.unmount()
})

test('while a background call is the call in progress, the status line reads background', async ($, on) => {
  await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'pending-bg' })
  await use($, 'q1', 'Bash', SLEEP)
  const ui = await mountUse($, tool('q1', 'Bash', SLEEP, undefined, { isRunning: true }))
  expect(await ui.find({ type: 'Text', text: exactly('1 call · background') })).toBeDefined()
  await ui.unmount()
})

test('the other levels keep the native row for a background job', async ($, on) => {
  setup(on)
  const outcomes = session(on)
  for (const density of ['full', 'balanced', 'compact']) {
    await level($, density)
    await backgroundTurn($, outcomes)
    for (const output of [TIMED_OUT, STARTED]) {
      const row = await mountUse($, tool('b2', 'Bash', BUILD, output))
      expect(await row.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
      await row.unmount()
      const result = await mountResult($, 'b2', 'Bash', output)
      expect(await result.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
      await result.unmount()
    }
  }
})

// One terminal row per folded line.

const LONG_COMMAND = 'python3 scripts/regenerate-the-inventory-fixtures-for-every-warehouse-region.py --all && cat out.txt'
const LONG_TITLE = '▸ Running python3 regenerate-the-inventory-fixtures-for-every-warehouse-region.py'
const LONG_ERROR = 'fatal: ../omp-blocks-wide already exists and is not an empty directory, so the worktree cannot be added'

async function longTurn($: Engine, outcomes: Map<string, Outcome>) {
  await $.turn.start({ text: 'go', turnId: 'long' })
  await call($, outcomes, 'w1', 'Bash', { command: LONG_COMMAND }, {
    isError: true, result: `Exit code 128\n${LONG_ERROR}`, text: `Exit code 128\n${LONG_ERROR}`, ms: 1200,
  })
  await say($, 'long-end', 'It failed.')
  await $.turn.complete({ answer: 'It failed.', durationMs: 1200, isAborted: false, turnId: 'long', reason: 'answer' })
}

const mountAt = ($: Engine, columns: number) => $.ui.mount({
  ...SITE, viewport: { columns, rows: 40 }, component: 'ToolUse', requestId: 'w1',
  props: tool('w1', 'Bash', { command: LONG_COMMAND }, `Exit code 128\n${LONG_ERROR}`, { isErrored: true }),
})

// Each folded line, the room its row leaves inside the border and padding.
async function foldedLines(ui: Awaited<ReturnType<typeof mountAt>>) {
  const texts = await ui.findAll({ type: 'Text' })
  const pick = (pattern: RegExp) => texts.find(found => pattern.test(found.text))!
  return [
    { line: pick(/^▸ Running/), room: 4 },
    { line: pick(/^1 call/), room: 6 },
    { line: pick(/^✗ Bash:/), room: 6 },
    { line: pick(/^fatal:/), room: 8 },
  ]
}

test('at a narrow pane, each folded line is cut with … to fit one row', async ($, on) => {
  const outcomes = await blackbox($, on)
  await longTurn($, outcomes)
  const ui = await mountAt($, 40)
  for (const { line, room } of await foldedLines(ui)) {
    expect(line.props.wrap).toBe('truncate-end')
    expect(widthOf(line.text)).toBeLessThanOrEqual(40 - room)
  }
  const [title, , header, error] = await foldedLines(ui)
  for (const line of [title!.line, header!.line, error!.line]) expect(line.text.endsWith('…')).toBe(true)
  expect((await ui.find({ key: 'turn-fold' }))?.props.label).toBe(LONG_TITLE)
  await ui.unmount()
})

test('at a wide pane, each folded line shows whole', async ($, on) => {
  const outcomes = await blackbox($, on)
  await longTurn($, outcomes)
  const ui = await mountAt($, 200)
  const [title, status, header, error] = (await foldedLines(ui)).map(({ line }) => line.text)
  expect(title).toBe(LONG_TITLE)
  expect(status).toBe('1 call · 1 failed · 1.2s')
  expect(header).toBe(`✗ Bash: ${LONG_COMMAND}`)
  expect(error).toBe(LONG_ERROR)
  await ui.unmount()
})

test('fitLine cuts a line by terminal cells and keeps one that fits', () => {
  expect(fitLine('abcdef', 6)).toBe('abcdef')
  expect(fitLine('abcdefg', 6)).toBe('abcde…')
  expect(fitLine('日本語のテキスト', 7)).toBe('日本語…')
  expect(fitLine('abc', 0)).toBe('…')
})

// The folded error line of a failed shell command.

test('a shell failure shows its first stderr line, else its last stdout line', () => {
  expect(shellErrorLine('ok\nbuilt 3 files\n', 'error: one\nerror: two\n')).toBe('error: one')
  expect(shellErrorLine('ok\n/opt/homebrew/bin/npx\nnpm error could not determine executable to run\n\n', '')).toBe('npm error could not determine executable to run')
  expect(shellErrorLine('Exit code 1\nok\n', '  \nExit code 1\n')).toBe('ok')
  expect(shellErrorLine('partial\nExit code 2', '')).toBe('partial')
  expect(shellErrorLine('Exit code 2', '')).toBe('Failed')
  expect(shellErrorLine('', '')).toBe('Failed')
})

test('a failed command’s error text reads as its output, past status lines a wrapper prints first', () => {
  expect(failureLine('Bash', 'Exit code 1\nok\ncat: missing.txt: No such file or directory')).toBe('cat: missing.txt: No such file or directory')
  expect(failureLine('Bash', 'Exit code 127\n/opt/homebrew/bin/npx\nzsh: command not found: nope')).toBe('zsh: command not found: nope')
  expect(failureLine('Bash', 'Exit code 1')).toBe('Failed')
  expect(failureLine('Bash', '<tool_use_error>Blocked by a hook</tool_use_error>')).toBe('Blocked by a hook')
  expect(failureLine('Bash', 'ignored', { stdout: 'ok\n', stderr: 'boom\n' })).toBe('boom')
  expect(failureLine('Edit', '<tool_use_error>String to replace not found in file.\nString: old</tool_use_error>')).toBe('String to replace not found in file.')
})

test('a folded shell failure shows the error line, not the status a wrapper printed first', async ($, on) => {
  const outcomes = await blackbox($, on)
  const text = 'Exit code 1\nok\nboom: real error'
  await $.turn.start({ text: 'go', turnId: 'wrapped' })
  await call($, outcomes, 'x1', 'Bash', { command: 'rtk build' }, { isError: true, result: text, text })
  await $.turn.complete({ answer: '', durationMs: 500, isAborted: false, turnId: 'wrapped', reason: 'answer' })
  const ui = await mountUse($, tool('x1', 'Bash', { command: 'rtk build' }, text, { isErrored: true }))
  expect(await ui.find({ type: 'Text', text: exactly('boom: real error') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exactly('ok') })).toBeUndefined()
  await ui.unmount()
})
