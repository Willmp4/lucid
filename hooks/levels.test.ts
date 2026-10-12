import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Density } from '../types'
import { blockOf } from './block'
import { COLORS } from './text-style'

const SITE = { plugin: 'omp-blocks', surface: 'terminal', viewport: { columns: 100, rows: 40 } } as const
const call = (id: string | undefined, tool: string, input: unknown, output: unknown, extra: object = {}) => ({
  tool_use_id: id, tool, input, output, isRunning: false, isErrored: false, isInterrupted: false, ...extra,
})
const lines = (count: number, word = 'row') => Array.from({ length: count }, (_, i) => `${word} ${i + 1}`).join('\n')
const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

const readOf = (id: string | undefined, path: string, count = 3) => call(id, 'Read', { file_path: path }, {
  type: 'text', file: { filePath: path, content: lines(count), startLine: 1, numLines: count, totalLines: count },
})
const grepOf = (id: string, pattern: string, path: string) => call(id, 'Grep', { pattern, path, output_mode: 'count' }, {
  mode: 'count', numFiles: 1, filenames: [], content: `${path}/a.ts:4`, numMatches: 4,
})
const globOf = (id: string, pattern: string) => call(id, 'Glob', { pattern, path: '/work' }, {
  numFiles: 2, filenames: ['/work/src/a.ts', '/work/src/b.ts'], truncated: false,
})
const bashOf = (id: string, output: unknown, extra: object = {}) => call(id, 'Bash', { command: 'npm test' }, output, extra)
const editOf = (id: string, count: number, extra: object = {}) => call(id, 'Edit', { file_path: '/work/src/a.ts' }, {
  filePath: '/work/src/a.ts',
  structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: count, lines: ['-old line', ...Array.from({ length: count }, (_, i) => `+new ${i + 1}`)] }],
}, extra)

async function setup($: Engine, on: On, density?: Density) {
  const store = new Map<string, unknown>()
  let now = 0
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('clock.now', () => ({ value: (now += 4200) }))
  on('tool.call', () => ({ result: { stdout: 'done', stderr: '', interrupted: false } }))
  on('ui.render', (_$, e) => ({
    type: 'Text', props: {}, children: [e.component === 'ToolGroup' && e.props.isExpanded ? 'expanded group' : 'native rendering'],
  }))
  if (density !== undefined) {
    await $.command.run({ command: 'omp', args: `density ${density}`, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  }
}

const mountUse = ($: Engine, props: ReturnType<typeof call>) =>
  $.ui.mount({ ...SITE, component: 'ToolUse', requestId: props.tool_use_id ?? 'none', props: { ...props, tool_use_id: props.tool_use_id ?? 'none' } })
const mountGroup = ($: Engine, requestId: string, calls: ReturnType<typeof call>[]) =>
  $.ui.mount({ ...SITE, component: 'ToolGroup', requestId, props: { calls, isActive: false, isExpanded: false } })

// Full: today's behaviour.

test('full keeps every group forced open, a run of reads included', async ($, on) => {
  await setup($, on, 'full')
  const group = await mountGroup($, 'full-group', [readOf('r1', '/work/a.ts'), readOf('r2', '/work/b.ts')])
  expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeDefined()
  await group.unmount()
})

test('full previews the first 16 rows of a read and counts the rest', async ($, on) => {
  await setup($, on, 'full')
  const ui = await mountUse($, readOf('full-read', '/work/a.ts', 20))
  expect(await ui.find({ type: 'Text', text: exact('row 16') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact('row 17') })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: 'Show all (4 more rows)' })).toBeDefined()
  await ui.unmount()
})

test('full keeps the shell duration on the summary line', async ($, on) => {
  await setup($, on, 'full')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'full-bash', command: 'npm test' })
  const ui = await mountUse($, bashOf('full-bash', { stdout: lines(20), stderr: '', interrupted: false }))
  expect(await ui.find({ type: 'Text', text: exact('4.2s') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact('row 17') })).toBeUndefined()
  await ui.unmount()
})

test('full caps diffs at 40 rows and new files at 20', async ($, on) => {
  await setup($, on, 'full')
  const edit = await mountUse($, editOf('full-edit', 50))
  expect(await edit.find({ type: 'Text', text: '… 11 more lines' })).toBeDefined()
  await edit.unmount()
  const write = await mountUse($, call('full-write', 'Write', { file_path: '/work/new.ts' }, {
    type: 'create', filePath: '/work/new.ts', content: `${lines(25)}\n`,
  }))
  expect(await write.find({ type: 'Text', text: '… 5 more lines' })).toBeDefined()
  await write.unmount()
})

// Balanced: the default.

test('balanced is the default level', async ($, on) => {
  await setup($, on)
  const ui = await mountUse($, readOf('default-read', '/work/a.ts'))
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeUndefined()
  await ui.unmount()
})

test('balanced shell cards keep the last 4 stdout rows, artifacts, and stderr', async ($, on) => {
  await setup($, on, 'balanced')
  const ui = await mountUse($, bashOf('tail-bash', {
    stdout: lines(30), stderr: 'deprecated flag', interrupted: false, persistedOutputPath: '/work/out/full.txt',
  }))
  expect(await ui.find({ type: 'Text', text: 'Full output: out/full.txt' })).toBeDefined()
  for (const shown of ['row 27', 'row 28', 'row 29', 'row 30', 'deprecated flag']) {
    expect(await ui.find({ type: 'Text', text: exact(shown) })).toBeDefined()
  }
  for (const hidden of ['row 1', 'row 26']) expect(await ui.find({ type: 'Text', text: exact(hidden) })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: 'Show all (32 rows)' })).toBeDefined()
  await ui.press({ key: 'expand-output' })
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Collapse' })).toBeDefined()
  await ui.press({ key: 'expand-output' })
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeUndefined()
  await ui.unmount()
})

test('balanced shell output short enough to show needs no button', async ($, on) => {
  await setup($, on, 'balanced')
  const ui = await mountUse($, bashOf('short-bash', { stdout: lines(4), stderr: '', interrupted: false }))
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('balanced shell cards show the status and duration on the header row', async ($, on) => {
  await setup($, on, 'balanced')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'status-bash', command: 'npm test' })
  const ui = await mountUse($, bashOf('status-bash', { stdout: lines(2), stderr: '', interrupted: false }))
  const marker = await ui.find({ type: 'Text', text: '✓ 4.2s' })
  expect(marker?.props.color).toBe(COLORS.add)
  expect(await ui.findAll({ type: 'Text', text: /4\.2s/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'Bash: npm test' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', tool_use_id: 'status-grep', command: 'npm test' })
  const noted = await mountUse($, bashOf('status-grep', { stdout: '', stderr: '', interrupted: false, returnCodeInterpretation: 'No matches found' }))
  expect(await noted.find({ type: 'Text', text: '✓ 4.2s' })).toBeDefined()
  expect(await noted.find({ type: 'Text', text: exact('No matches found') })).toBeDefined()
  await noted.unmount()

  const restored = await mountUse($, bashOf('status-restored', { stdout: lines(2), stderr: '', interrupted: false }))
  expect(await restored.find({ type: 'Text', text: exact('✓') })).toBeDefined()
  await restored.unmount()
})

test('balanced shell failures show a red cross on the header and every row', async ($, on) => {
  await setup($, on, 'balanced')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'failed-bash', command: 'npm test' })
  const ui = await mountUse($, bashOf('failed-bash', { stdout: lines(30), stderr: 'Exit code 1', interrupted: false }, { isErrored: true }))
  expect((await ui.find({ type: 'Text', text: '✗ 4.2s' }))?.props.color).toBe(COLORS.del)
  expect(await ui.find({ type: 'Text', text: exact('Failed') })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: exact('row 1') })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
  await ui.unmount()
})

test('balanced single reads and searches show their header and summary, the body behind Show all', async ($, on) => {
  await setup($, on, 'balanced')
  const read = await mountUse($, readOf('single-read', '/work/src/a.ts', 20))
  expect(await read.find({ type: 'Text', text: 'Read: src/a.ts' })).toBeDefined()
  expect(await read.find({ type: 'Text', text: exact('lines 1–20 · 20 total lines') })).toBeDefined()
  expect(await read.find({ type: 'Text', text: exact('row 1') })).toBeUndefined()
  expect(await read.find({ type: 'Button', text: 'Show all (20 rows)' })).toBeDefined()
  await read.press({ key: 'expand-output' })
  expect(await read.find({ type: 'Text', text: exact('row 20') })).toBeDefined()
  await read.unmount()

  const grep = await mountUse($, grepOf('single-grep', 'retryCount', '/work/src'))
  expect(await grep.find({ type: 'Text', text: exact('4 matches · 1 file') })).toBeDefined()
  expect(await grep.find({ type: 'Text', text: 'src/a.ts:4' })).toBeUndefined()
  await grep.unmount()

  const glob = await mountUse($, globOf('single-glob', '**/*.ts'))
  expect(await glob.find({ type: 'Text', text: exact('2 files') })).toBeDefined()
  expect(await glob.find({ type: 'Text', text: exact('src/a.ts') })).toBeUndefined()
  await glob.unmount()
})

test('balanced single reads keep their errors visible', async ($, on) => {
  await setup($, on, 'balanced')
  const ui = await mountUse($, call('missing-read', 'Read', { file_path: '/work/gone.ts' }, '<tool_use_error>File does not exist.</tool_use_error>', { isErrored: true }))
  expect(await ui.find({ type: 'Text', text: exact('File does not exist.') })).toBeDefined()
  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
  await ui.unmount()
})

// Merged read and search groups.

test('balanced merges a run of reads and searches into one card', async ($, on) => {
  await setup($, on, 'balanced')
  const group = await mountGroup($, 'merged', [
    readOf('m1', '/work/src/api/client.ts', 212), readOf('m2', '/work/src/api/types.ts', 48),
    readOf('m3', '/work/src/api/retry.ts', 90), grepOf('m4', 'retryCount', '/work/src'),
  ])
  expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeUndefined()
  expect(await group.find({ type: 'Text', text: 'Read 3 files · Grep 1 pattern' })).toBeDefined()
  expect((await group.find({ type: 'Text', text: exact('src/api/client.ts') }))?.props.color).toBe(COLORS.path)
  expect(await group.find({ type: 'Text', text: exact('lines 1–212 · 212 total lines') })).toBeDefined()
  expect((await group.find({ type: 'Text', text: exact('retryCount · src') }))?.props.color).toBe(COLORS.path)
  expect(await group.find({ type: 'Text', text: exact('4 matches · 1 file') })).toBeDefined()
  expect(await group.find({ type: 'Text', text: exact('row 1') })).toBeUndefined()
  expect((await group.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.border)
  await group.unmount()
})

test('the merged header counts each tool in the singular or plural', async ($, on) => {
  await setup($, on, 'balanced')
  const group = await mountGroup($, 'counted', [globOf('c1', '*.md'), readOf('c2', '/work/a.ts'), globOf('c3', '*.ts')])
  expect(await group.find({ type: 'Text', text: 'Glob 2 patterns · Read 1 file' })).toBeDefined()
  await group.unmount()
})

test('Show all switches a merged group to full cards, and Collapse merges it again', async ($, on) => {
  await setup($, on, 'balanced')
  const calls = [readOf('s1', '/work/a.ts', 20), readOf('s2', '/work/b.ts', 20)]
  const group = await mountGroup($, 'switch', calls)
  await group.press({ key: 'show-group' })
  expect(await group.drawn()).toMatchObject({ type: 'Box' })
  expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeDefined()
  expect(await group.find({ type: 'Button', text: 'Collapse' })).toBeDefined()

  const member = await mountUse($, calls[0]!)
  expect(await member.find({ type: 'Text', text: exact('row 16') })).toBeDefined()
  expect(await member.find({ type: 'Button', text: 'Show all (4 more rows)' })).toBeDefined()
  await member.unmount()
  const outsider = await mountUse($, readOf('s3', '/work/c.ts', 20))
  expect(await outsider.find({ type: 'Text', text: exact('row 16') })).toBeUndefined()
  await outsider.unmount()

  await group.press({ key: 'merge-group' })
  expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeUndefined()
  expect(await group.find({ type: 'Text', text: 'Read 2 files' })).toBeDefined()
  await group.unmount()
})

test('a failed call in a merged group shows its error lines and turns the border red', async ($, on) => {
  await setup($, on, 'balanced')
  const group = await mountGroup($, 'failing', [
    readOf('f1', '/work/a.ts'),
    call('f2', 'Read', { file_path: '/work/gone.ts' }, '<tool_use_error>File does not exist.\nCheck the path.</tool_use_error>', { isErrored: true }),
    call('f3', 'Grep', { pattern: 'x', path: '/work' }, undefined, { isInterrupted: true }),
  ])
  expect(await group.find({ type: 'Text', text: exact('File does not exist.') })).toBeDefined()
  expect(await group.find({ type: 'Text', text: exact('Check the path.') })).toBeDefined()
  expect(await group.find({ type: 'Text', text: exact('Interrupted') })).toBeDefined()
  expect((await group.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
  await group.unmount()
})

test('a group falls back to forced open when a call cannot be summarised or carries no data', async ($, on) => {
  await setup($, on, 'balanced')
  const image = call('i1', 'Read', { file_path: '/work/a.png' }, { type: 'image', file: { base64: 'x', type: 'image/png', originalSize: 1 } })
  for (const odd of [image, call('i2', 'Read', { file_path: '/work/a.ts' }, undefined), readOf(undefined, '/work/a.ts'), call('i3', 'Read', undefined, undefined, { isRunning: true })]) {
    const group = await mountGroup($, `fallback-${odd.tool_use_id}`, [readOf('ok', '/work/b.ts'), odd])
    expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeDefined()
    await group.unmount()
  }
})

test('a group that mixes in another tool stays forced open, its cards on balanced rules', async ($, on) => {
  await setup($, on, 'balanced')
  const read = readOf('x1', '/work/a.ts', 20)
  const group = await mountGroup($, 'mixed', [read, bashOf('x2', { stdout: 'ok', stderr: '', interrupted: false })])
  expect(await group.find({ type: 'Text', text: 'expanded group' })).toBeDefined()
  await group.unmount()
  const card = await mountUse($, read)
  expect(await card.find({ type: 'Text', text: exact('row 1') })).toBeUndefined()
  expect(await card.find({ type: 'Button', text: 'Show all (20 rows)' })).toBeDefined()
  await card.unmount()
})

// Compact.

test('compact draws a shell card as one header line that opens to the balanced body', async ($, on) => {
  await setup($, on, 'compact')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'compact-bash', command: 'npm test' })
  const ui = await mountUse($, bashOf('compact-bash', { stdout: lines(30), stderr: '', interrupted: false }))
  expect((await ui.find({ type: 'Text', text: 'Bash: npm test' }))?.props.wrap).toBe('truncate-end')
  expect(await ui.find({ type: 'Text', text: '✓ 4.2s' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Show ▸' })).toBeDefined()
  expect(await ui.drawn()).toMatchObject({ type: 'Box' })
  expect(await ui.find({ type: 'Text', text: exact('row 30') })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'expand-output' })).toBeUndefined()

  await ui.press({ key: 'open-card' })
  expect(await ui.find({ type: 'Text', text: exact('row 30') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact('row 26') })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: 'Show all (30 rows)' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'open-card' }))?.text).toBe('Collapse')

  await ui.press({ key: 'open-card' })
  expect(await ui.find({ type: 'Text', text: exact('row 30') })).toBeUndefined()
  await ui.unmount()
})

test('compact read cards open to their summary', async ($, on) => {
  await setup($, on, 'compact')
  const ui = await mountUse($, readOf('compact-read', '/work/src/a.ts', 20))
  expect(await ui.find({ type: 'Text', text: exact('lines 1–20 · 20 total lines') })).toBeUndefined()
  await ui.press({ key: 'open-card' })
  expect(await ui.find({ type: 'Text', text: exact('lines 1–20 · 20 total lines') })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Show all (20 rows)' })).toBeDefined()
  await ui.unmount()
})

test('compact edit cards keep their counts and open to the capped diff', async ($, on) => {
  await setup($, on, 'compact')
  const ui = await mountUse($, editOf('compact-edit', 30))
  const header = await ui.find({ type: 'Text', text: /Edit: src\/a\.ts/ })
  expect(header?.text).toBe('✎ Edit: src/a.ts  (+30/-1)')
  expect(header?.props.wrap).toBe('truncate-end')
  expect(await ui.drawn()).toMatchObject({ type: 'Box' })
  expect(await ui.find({ type: 'Text', text: exact('new 1') })).toBeUndefined()
  await ui.press({ key: 'open-card' })
  expect(await ui.find({ type: 'Text', text: exact('new 1') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '… 19 more lines' })).toBeDefined()
  await ui.press({ key: 'open-card' })
  expect(await ui.find({ type: 'Text', text: exact('new 1') })).toBeUndefined()
  await ui.unmount()
})

test('compact merged groups open to their per-call rows', async ($, on) => {
  await setup($, on, 'compact')
  const group = await mountGroup($, 'compact-group', [readOf('g1', '/work/a.ts'), grepOf('g2', 'needle', '/work/src')])
  const header = await group.find({ type: 'Text', text: 'Read 1 file · Grep 1 pattern' })
  expect(header?.props.wrap).toBe('truncate-end')
  expect(await group.find({ type: 'Text', text: exact('a.ts') })).toBeUndefined()
  expect(await group.find({ type: 'Button', key: 'show-group' })).toBeUndefined()
  await group.press({ key: 'open-group' })
  expect(await group.drawn()).toMatchObject({ type: 'Box' })
  expect(await group.find({ type: 'Text', text: exact('a.ts') })).toBeDefined()
  expect(await group.find({ type: 'Button', key: 'show-group' })).toBeDefined()
  await group.press({ key: 'open-group' })
  expect(await group.find({ type: 'Text', text: exact('a.ts') })).toBeUndefined()
  await group.unmount()
})

// Failures at every level.

test('failed and interrupted cards open in full with a red border at every level', async ($, on) => {
  await setup($, on)
  for (const density of ['full', 'balanced', 'compact'] as const) {
    await $.command.run({ command: 'omp', args: `density ${density}`, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    const failed = await mountUse($, bashOf(`fail-${density}`, lines(35, 'failure'), { isErrored: true }))
    expect(await failed.find({ type: 'Text', text: exact('failure 35') })).toBeDefined()
    expect(await failed.find({ type: 'Button' })).toBeUndefined()
    expect((await failed.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
    await failed.unmount()

    const edit = await mountUse($, call(`edit-fail-${density}`, 'Edit', { file_path: '/work/a.ts' }, '<tool_use_error>File has not been read yet.</tool_use_error>', { isErrored: true }))
    expect(await edit.find({ type: 'Text', text: exact('File has not been read yet.') })).toBeDefined()
    expect(await edit.find({ type: 'Button' })).toBeUndefined()
    expect((await edit.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
    await edit.unmount()

    const read = await mountUse($, call(`read-fail-${density}`, 'Read', { file_path: '/work/gone.ts' }, '<tool_use_error>File does not exist.</tool_use_error>', { isErrored: true }))
    expect(await read.find({ type: 'Text', text: exact('File does not exist.') })).toBeDefined()
    await read.unmount()

    if (density === 'full') continue
    const interrupted = await mountUse($, bashOf(`stop-${density}`, { stdout: lines(30), stderr: '', interrupted: true }))
    expect(await interrupted.find({ type: 'Text', text: exact('row 1') })).toBeDefined()
    expect(await interrupted.find({ type: 'Text', text: exact('Interrupted') })).toBeDefined()
    expect((await interrupted.find({ type: 'Text', text: exact('✗') }))?.props.color).toBe(COLORS.del)
    expect((await interrupted.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
    await interrupted.unmount()

    const group = await mountGroup($, `group-fail-${density}`, [
      readOf(`ok-${density}`, '/work/a.ts'),
      call(`bad-${density}`, 'Read', { file_path: '/work/gone.ts' }, '<tool_use_error>File does not exist.</tool_use_error>', { isErrored: true }),
    ])
    expect(await group.find({ type: 'Text', text: exact('File does not exist.') })).toBeDefined()
    expect((await group.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.borderErr)
    await group.unmount()
  }
})

// Edit and Write caps.

test('balanced and compact cap Edit and Write previews at 12 rows', async ($, on) => {
  const write = call('w', 'Write', {}, { type: 'create', filePath: '/work/a.ts', content: `${lines(25)}\n` })
  for (const density of ['balanced', 'compact'] as const) {
    const edit = blockOf(editOf('e', 50), '/work', density)
    expect(edit.rows).toHaveLength(13)
    expect(edit.rows[12]).toEqual({ kind: 'more', count: 39 })
    const created = blockOf(write, '/work', density)
    expect(created.rows).toHaveLength(13)
    expect(created.rows[12]).toEqual({ kind: 'more', count: 13 })
  }
  expect(blockOf(editOf('e', 50), '/work', 'full').rows).toHaveLength(41)

  await setup($, on, 'balanced')
  const ui = await mountUse($, editOf('balanced-edit', 50))
  expect(await ui.find({ type: 'Text', text: exact('new 11') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact('new 12') })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '… 39 more lines' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

// Results stay hidden only where the card can show them.

test('a separate result hides only where the card can show it, at every level', async ($, on) => {
  await setup($, on)
  for (const density of ['full', 'balanced', 'compact'] as const) {
    await $.command.run({ command: 'omp', args: `density ${density}`, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    const text = readOf(`result-${density}`, '/work/a.ts')
    const shown = await $.ui.mount({ ...SITE, component: 'ToolResult', requestId: `result-${density}`, props: {
      tool_use_id: `result-${density}`, tool: 'Read', output: text.output, isErrored: false,
    } })
    expect(await shown.find({ type: 'Text', text: 'native rendering' })).toBeUndefined()
    await shown.unmount()
    const image = await $.ui.mount({ ...SITE, component: 'ToolResult', requestId: `image-${density}`, props: {
      tool_use_id: `image-${density}`, tool: 'Read', output: { type: 'image', file: { base64: 'x', type: 'image/png', originalSize: 1 } }, isErrored: false,
    } })
    expect(await image.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
    await image.unmount()
  }
})
