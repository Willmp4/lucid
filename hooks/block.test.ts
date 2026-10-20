import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { blockOf, countsOf, diffRows, hunksOf, shortenPath } from './block'
import { COLORS } from './text-style'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['stock row'] }

const SITE = { plugin: 'lucid', viewport: { columns: 100, rows: 30 } } as const

const call = (tool: string, input: unknown, state: object = {}) => ({
  tool_use_id: 'tu1',
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...state,
})

const PATCH = [
  { oldStart: 10, oldLines: 3, newStart: 10, newLines: 3, lines: [' keep', '-  old', '+  new'] },
  { oldStart: 40, oldLines: 2, newStart: 40, newLines: 3, lines: [' ctx', '+added', '\\ No newline at end of file'] },
]

const EDIT_OUTPUT = { filePath: '/work/docs/spec.md', structuredPatch: PATCH }

function stub(on: On) {
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.render', () => STOCK)
}

test('rows number each hunk from its own start, with a gap between hunks', () => {
  const rows = diffRows(hunksOf(EDIT_OUTPUT))

  expect(rows).toEqual([
    { kind: 'ctx', number: '10', text: 'keep' },
    { kind: 'del', number: '-11', text: '  old' },
    { kind: 'add', number: '+11', text: '  new' },
    { kind: 'gap' },
    { kind: 'ctx', number: '40', text: 'ctx' },
    { kind: 'add', number: '+41', text: 'added' },
  ])
})

test('counts add up both kinds across hunks', () => {
  expect(countsOf(hunksOf(EDIT_OUTPUT))).toEqual({ added: 2, removed: 1 })
})

test('a new file counts its lines and shows the first 20', () => {
  const content = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const block = blockOf(call('Write', {}, { output: { type: 'create', filePath: '/work/a.ts', content } }), '/work')

  expect(block.counts).toEqual({ added: 25 })
  expect(block.rows).toHaveLength(21)
  expect(block.rows[0]).toEqual({ kind: 'add', number: '+1', text: 'line 1' })
  expect(block.rows[20]).toEqual({ kind: 'more', count: 5 })
})

test('a long diff stops at 40 rows and counts the rest', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `+l${i}`)
  const output = { filePath: '/work/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 50, lines }] }
  const block = blockOf(call('Edit', {}, { output }), '/work')

  expect(block.rows).toHaveLength(41)
  expect(block.rows[40]).toEqual({ kind: 'more', count: 10 })
})

test('completed Write and Edit output stays visible while the running flag lags', () => {
  const written = blockOf(call('Write', {}, {
    isRunning: true,
    output: { type: 'create', filePath: '/work/a.ts', content: 'alpha = 1\nbeta = 2\n' },
  }), '/work')
  const edited = blockOf(call('Edit', {}, {
    isRunning: true,
    output: {
      filePath: '/work/a.ts',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: ['-alpha = 1', '+alpha = 3', ' beta = 2'] }],
    },
  }), '/work')

  expect(written.counts).toEqual({ added: 2 })
  expect(written.rows).toEqual([
    { kind: 'add', number: '+1', text: 'alpha = 1' },
    { kind: 'add', number: '+2', text: 'beta = 2' },
  ])
  expect(edited.counts).toEqual({ added: 1, removed: 1 })
  expect(edited.rows).toEqual([
    { kind: 'del', number: '-1', text: 'alpha = 1' },
    { kind: 'add', number: '+1', text: 'alpha = 3' },
    { kind: 'ctx', number: '2', text: 'beta = 2' },
  ])
})

test('running, interrupted, failed, and empty calls each say so', () => {
  const input = { file_path: '/work/a.ts' }

  expect(blockOf(call('Edit', input, { isRunning: true }), '/work')).toMatchObject({ path: 'a.ts', counts: null, rows: [] })
  expect(blockOf(call('Edit', input, { isInterrupted: true }), '/work').rows).toEqual([
    { kind: 'note', text: 'Interrupted', color: COLORS.warn },
  ])
  expect(
    blockOf(call('Edit', input, { isErrored: true, output: '<tool_use_error>File has not been read yet.</tool_use_error>' }), '/work'),
  ).toMatchObject({ isErrored: true, rows: [{ kind: 'note', text: 'File has not been read yet.' }] })
  expect(blockOf(call('Edit', input, { output: { filePath: '/work/a.ts', structuredPatch: [] } }), '/work').rows).toEqual([
    { kind: 'note', text: 'no changes shown', color: COLORS.muted },
  ])
})

test('paths shorten inside the working directory and under a home directory', () => {
  expect(shortenPath('/work/docs/a.md', '/work')).toBe('docs/a.md')
  expect(shortenPath('/Users/someone/notes/a.md', '/work')).toBe('~/notes/a.md')
  expect(shortenPath('/home/someone/a.md', '/work')).toBe('~/a.md')
  expect(shortenPath('/etc/hosts', '/work')).toBe('/etc/hosts')
})

test('an Edit row in the terminal draws the bordered block with shaded rows', async ($, on) => {
  stub(on)

  const row = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolUse', requestId: 'tu1', props: call('Edit', {}, { output: EDIT_OUTPUT }) })

  expect(await row.find({ type: 'Text', text: 'stock row' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: /Edit: docs\/spec\.md/ })).toBeDefined()
  expect((await row.find({ type: 'Box', key: 'r1' }))?.props.backgroundColor).toBe(COLORS.delBg)
  expect((await row.find({ type: 'Box', key: 'r2' }))?.props.backgroundColor).toBe(COLORS.addBg)
  expect(await row.find({ type: 'Text', text: '··' })).toBeDefined()
  await row.unmount()

  const result = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolResult', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Edit', output: EDIT_OUTPUT, isErrored: false } })
  expect(await result.find({ type: 'Text', text: 'stock row' })).toBeUndefined()
  await result.unmount()
})

test('other tools and other surfaces keep the row beneath', async ($, on) => {
  stub(on)

  const web = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolUse', requestId: 'tu2', props: call('WebFetch', { url: 'https://example.com' }) })
  expect(await web.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  await web.unmount()

  const desktop = await $.ui.mount({ ...SITE, surface: 'desktop', component: 'ToolUse', requestId: 'tu3', props: call('Edit', {}, { output: EDIT_OUTPUT }) })
  expect(await desktop.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  await desktop.unmount()
})

test('diff changes and error notes keep precedence over inline markers and filenames', async ($, on) => {
  stub(on)
  const text = 'PASS handoff/ready.md WARN 1.2s'
  const row = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolUse', requestId: 'semantic-edit', props: call('Edit', {}, {
    output: { filePath: '/work/FAIL', structuredPatch: [
      { oldStart: 1, newStart: 1, lines: [`-${text} removed`, `+${text} added`, ' context handoff/ready.md'] },
    ] },
  }) })
  expect((await row.find({ type: 'Text', text: /^FAIL$/ }))?.props.color).toBe(COLORS.path)
  expect((await row.find({ type: 'Box', key: 'r0' }))?.props.backgroundColor).toBe(COLORS.delBg)
  expect((await row.find({ type: 'Box', key: 'r1' }))?.props.backgroundColor).toBe(COLORS.addBg)
  expect((await row.find({ type: 'Text', text: `${text} removed` }))?.props.color).toBe(COLORS.del)
  expect((await row.find({ type: 'Text', text: `${text} added` }))?.props.color).toBe(COLORS.add)
  expect(await row.find({ type: 'Text', text: 'context handoff/ready.md' })).toBeDefined()
  expect((await row.find({ type: 'Text', text: /^handoff\/ready\.md$/ }))?.props.color).toBe(COLORS.path)
  await row.unmount()
  const failed = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolUse', requestId: 'semantic-edit-failed', props: call('Edit', {}, {
    isErrored: true, output: `<tool_use_error>${text}</tool_use_error>`,
  }) })
  expect((await failed.find({ type: 'Text', text }))?.props.color).toBe(COLORS.del)
  for (const span of await failed.findAll({ type: 'Text', text: /PASS|handoff\/ready\.md|WARN|1\.2s/ })) {
    if (span.props.color !== undefined) expect(span.props.color).toBe(COLORS.del)
  }
  await failed.unmount()
})

test('changed diff text cannot receive an inline colour override', async ($, on) => {
  stub(on)
  const text = 'PASS handoff/ready.md WARN 1.2s'
  for (const [prefix, color] of [['-', COLORS.del], ['+', COLORS.add]]) {
    const row = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'ToolUse', requestId: `semantic-change-${prefix}`, props: call('Edit', {}, {
      output: { filePath: '/work/a.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`${prefix}${text}`] }] },
    }) })
    expect((await row.find({ type: 'Text', text }))?.props.color).toBe(color)
    for (const span of await row.findAll({ type: 'Text', text: /PASS|handoff\/ready\.md|WARN|1\.2s/ })) {
      if (span.props.color !== undefined) expect(span.props.color).toBe(color)
    }
    await row.unmount()
  }
})
