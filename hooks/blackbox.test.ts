import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CallRecord, TurnRecord } from '../types'
import { densityCommand, densityOf } from './density'
import { COLORS } from './text-style'
import { anchorOf, callLabel, isInBetween, responseItems, resultsOf, statusLine, titleOf } from './turn-model'

const omp = (args: string) => ({
  command: 'omp', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})
const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }

function setup(on: On) {
  const store = new Map<string, unknown>()
  let now = 0
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: (now += 100) }))
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

test('the turn anchors at its first call and folds text that a later call follows', () => {
  const turn: TurnRecord = { items: [
    { kind: 'text', id: 't1', text: 'First.' },
    { kind: 'call', id: 'c1' },
    { kind: 'text', id: 't2', text: 'Second.' },
    { kind: 'call', id: 'c2' },
    { kind: 'text', id: 't3', text: 'Done.' },
  ] }
  expect(anchorOf(turn)).toBe('c1')
  expect(isInBetween(turn, 't1')).toBe(true)
  expect(isInBetween(turn, 't2')).toBe(true)
  expect(isInBetween(turn, 't3')).toBe(false)
  expect(isInBetween(turn, 'c1')).toBe(false)
  expect(isInBetween(turn, 'unknown')).toBe(false)
  expect(anchorOf({ items: [{ kind: 'text', id: 't1', text: 'Only text.' }] })).toBeUndefined()
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

test('without edits the title names the first command, then the read, the search, or the tool', () => {
  expect(titleText([
    rec('Read', { file_path: '/work/a.py' }),
    rec('Bash', { command: 'python3 toy.py\necho done' }),
    rec('Bash', { command: 'ls' }),
  ])).toBe('Running python3 toy.py')
  expect(titleText([rec('Grep', { pattern: 'TODO' }), rec('Read', { file_path: '/work/src/a.py' })])).toBe('Reading a.py')
  expect(titleText([rec('Glob', { pattern: '**/*.ts' }), rec('Grep', { pattern: 'TODO' })])).toBe('Searching **/*.ts')
  expect(titleText([rec('Agent', { description: 'Find the bug' }), rec('TodoWrite', { todos: [] })])).toBe('Using Agent')
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

test('a response row yields its text and its calls, with long inputs cut for the record', () => {
  const content = 'x'.repeat(1000)
  const { items, calls } = responseItems('row1', [
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Writing it.' },
    { type: 'tool_use', id: 'c1', name: 'Write', input: { file_path: '/work/a.txt', content } },
  ])
  expect(items).toEqual([{ kind: 'text', id: 'row1', text: 'Writing it.' }, { kind: 'call', id: 'c1' }])
  expect(calls).toHaveLength(1)
  expect(calls[0]!.id).toBe('c1')
  expect(calls[0]!.record.tool).toBe('Write')
  expect(calls[0]!.record.status).toBe('running')
  expect(calls[0]!.record.input.file_path).toBe('/work/a.txt')
  expect(String(calls[0]!.record.input.content).length).toBeLessThan(400)
  expect(calls[0]!.body.input).toEqual({ file_path: '/work/a.txt', content })
  expect(responseItems('row2', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '  ' }])).toEqual({ items: [], calls: [] })
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
type Outcome = { result: unknown; text?: string; isError?: true }

function session(on: On) {
  const outcomes = new Map<string, Outcome>()
  on('tool.call', (_$, e) => outcomes.get(e.tool_use_id) ?? { result: { stdout: 'done', stderr: '', interrupted: false }, text: 'done' })
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

// Text, a read, text, an edit, a failing command, and the final reply.
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

test('folded, the block at the first call shows the title and the status line only', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Editing inventory.py')
  expect(await ui.find({ type: 'Text', text: '3 calls · 1 failed · 6.1s' })).toBeDefined()
  for (const hidden of ['Step one reads the notes.', 'Read: notes.txt', 'Edit: inventory.py', 'alpha']) {
    expect(await ui.find({ text: hidden })).toBeUndefined()
  }
  expect(await ui.find({ type: 'Button', text: 'Show ▸' })).toBeUndefined()
  await ui.unmount()
})

test('the title and status lines keep to one line each', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  expect((await ui.find({ type: 'Text', text: exactly('3 calls · 1 failed · 6.1s') }))?.props.wrap).toBe('truncate-end')
  expect((await ui.find({ type: 'Text', text: exactly('▸ Editing inventory.py') }))?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('a failed call turns the border red and shows its header and first error line while folded', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.borderErr } })
  expect(await ui.find({ type: 'Text', text: '✗ Bash: cat missing.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: MISSING })).toBeDefined()
  await ui.unmount()
})

test('a turn without failures keeps the plain border and lists no calls', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'calm' })
  await call($, outcomes, 'k1', 'Bash', { command: 'python3 toy.py' }, { result: { stdout: '5', stderr: '', interrupted: false }, text: '5' })
  await call($, outcomes, 'k2', 'Bash', { command: 'ls' }, { result: { stdout: 'toy.py', stderr: '', interrupted: false }, text: 'toy.py' })
  await say($, 'calm-end', 'Both ran.')
  await $.turn.complete({ answer: 'Both ran.', durationMs: 900, isAborted: false, turnId: 'calm', reason: 'answer' })
  const ui = await mountUse($, tool('k1', 'Bash', { command: 'python3 toy.py' }, { stdout: '5', stderr: '', interrupted: false }))
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.border } })
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Running python3 toy.py')
  expect(await ui.find({ type: 'Text', text: '2 calls · 0.9s' })).toBeDefined()
  expect(await ui.find({ text: /✗/ })).toBeUndefined()
  await ui.unmount()
})

test('every later row of the turn draws nothing: calls, groups, results, and in-between text', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const rows = [
    await mountUse($, EDIT_ROW),
    await mountUse($, BASH_ROW),
    await mountResult($, 'c2', 'Edit', EDIT_INVENTORY),
    await mountGroup($, 'collapsed-row-c3', [BASH_ROW]),
    await mountText($, 'text1', 'Step one reads the notes.'),
    await mountText($, 'text2', 'Step two edits the inventory.'),
  ]
  for (const row of rows) {
    expect(await row.drawn()).toEqual(NOTHING)
    await row.unmount()
  }
})

test('a group that holds the first call draws the block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountGroup($, 'collapsed-row-c1', [READ_ROW])
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Editing inventory.py')
  await ui.unmount()
})

test('the final reply stays outside the block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountText($, 'text3', 'All steps ran; cat failed as planned.')
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await ui.unmount()
})

test('expanded, the block lists the in-between text and a compact card per call in turn order', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  await ui.press({ key: 'turn-fold' })
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▾ Editing inventory.py')
  const whole = (await ui.findAll({}))[0]!.text
  const order = ['Step one reads the notes.', 'Read: notes.txt', 'Step two edits the inventory.', 'Edit: inventory.py', 'Bash: cat missing.txt']
  const at = order.map(text => whole.indexOf(text))
  for (const index of at) expect(index).toBeGreaterThan(-1)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(whole.includes('All steps ran')).toBe(false)
  expect(await ui.find({ key: 'open-card-c1' })).toBeDefined()
  expect(await ui.find({ key: 'open-card-c2' })).toBeDefined()
  await ui.press({ key: 'turn-fold' })
  expect(await ui.find({ text: 'Step one reads the notes.' })).toBeUndefined()
  await ui.unmount()
})

test('each call in the expanded block opens its balanced body on its own Show ▸', async ($, on) => {
  const outcomes = await blackbox($, on)
  await editingTurn($, outcomes)
  const ui = await mountUse($, READ_ROW)
  await ui.press({ key: 'turn-fold' })
  expect(await ui.find({ type: 'Button', text: 'Show all (2 rows)' })).toBeUndefined()
  await ui.press({ key: 'open-card-c1' })
  expect(await ui.find({ type: 'Button', text: 'Show all (2 rows)' })).toBeDefined()
  expect(await ui.find({ key: 'open-card-c2' })).toMatchObject({ text: 'Show ▸' })
  await ui.press({ key: 'open-card-c2' })
  expect(await ui.find({ type: 'Text', text: 'new' })).toBeDefined()
  await ui.unmount()
})

test('while the turn runs, the status line names the call in progress and omits the time', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'live' })
  await say($, 'live1', 'Running the script.')
  await use($, 'l1', 'Bash', { command: 'python3 toy.py' })
  const ui = await mountUse($, tool('l1', 'Bash', { command: 'python3 toy.py' }, undefined, { isRunning: true }))
  expect(await ui.find({ type: 'Text', text: '1 call · Bash: python3 toy.py' })).toBeDefined()
  outcomes.set('l1', { result: { stdout: '5', stderr: '', interrupted: false }, text: '5' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'l1', command: 'python3 toy.py' })
  await answer($, 'l1', '5')
  expect(await ui.find({ type: 'Text', text: exactly('1 call') })).toBeDefined()
  await $.turn.complete({ answer: '', durationMs: 400, isAborted: false, turnId: 'live', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: '1 call · 0.4s' })).toBeDefined()
  await ui.unmount()
})

test('while the turn runs, the newest text shows until a later call pulls it in', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'pull' })
  await call($, outcomes, 'p1', 'Bash', { command: 'ls' }, { result: { stdout: 'a', stderr: '', interrupted: false }, text: 'a' })
  await say($, 'pull-text', 'Now the second command.')
  const text = await mountText($, 'pull-text', 'Now the second command.')
  expect(await text.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await use($, 'p2', 'Bash', { command: 'pwd' })
  expect(await text.drawn()).toEqual(NOTHING)
  await text.unmount()
})

test('a later call still streaming in draws nothing once the turn has a block', async ($, on) => {
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

test('an interrupted turn marks its running call and turns the border red', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'stop' })
  await use($, 'i1', 'Bash', { command: 'sleep 30' })
  await $.turn.complete({ answer: '', durationMs: 2000, isAborted: true, turnId: 'stop', reason: 'aborted' })
  void outcomes
  const ui = await mountUse($, tool('i1', 'Bash', { command: 'sleep 30' }, undefined, { isInterrupted: true }))
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderColor: COLORS.borderErr } })
  expect(await ui.find({ type: 'Text', text: '1 call · 1 failed · 2.0s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✗ Bash: sleep 30' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exactly('Interrupted') })).toBeDefined()
  await ui.unmount()
})

test('an Agent call counts as a call and its result opens in the expanded block', async ($, on) => {
  const outcomes = await blackbox($, on)
  await $.turn.start({ text: 'go', turnId: 'agent' })
  await call($, outcomes, 'a1', 'Agent', { description: 'Reply with done', prompt: 'Reply with the word done' }, {
    result: { status: 'completed', content: [{ type: 'text', text: 'done' }] }, text: 'done',
  })
  await say($, 'agent-end', 'The agent replied.')
  await $.turn.complete({ answer: 'The agent replied.', durationMs: 1500, isAborted: false, turnId: 'agent', reason: 'answer' })
  const ui = await mountUse($, tool('a1', 'Agent', { description: 'Reply with done' }, { status: 'completed' }))
  expect((await ui.find({ key: 'turn-fold' }))?.text).toBe('▸ Using Agent')
  expect(await ui.find({ type: 'Text', text: '1 call · 1.5s' })).toBeDefined()
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
