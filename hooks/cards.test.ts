import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COLORS } from './text-style'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
const SITE = { plugin: 'omp-blocks', surface: 'terminal', component: 'ToolUse', viewport: { columns: 100, rows: 40 } } as const
const props = (tool: string, input: unknown, output: unknown, extra: object = {}) => ({
  tool_use_id: 'card1', tool, input, output, isRunning: false, isErrored: false, isInterrupted: false, ...extra,
})
// These cards describe the full level: today's previews and forced-open groups.
async function setup($: Engine, on: On) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.render', () => STOCK)
  await $.command.run({ command: 'omp', args: 'density full', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

test('Bash shows its command and keeps stderr visible beyond a long stdout preview', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'bash1', props: props('Bash', { command: 'run-check' }, {
    stdout: Array.from({ length: 30 }, (_, i) => `log ${i}`).join('\n'), stderr: 'compiler failed', interrupted: false,
  }) })
  expect(await ui.find({ type: 'Text', text: /run-check/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compiler failed/ })).toBeDefined()
  await ui.unmount()
})

test('Read retains the returned starting line and file content', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'read1', props: props('Read', { file_path: '/work/src/a.ts', offset: 42 }, {
    type: 'text', file: { filePath: '/work/src/a.ts', content: 'const answer = 42;\nreturn answer;', startLine: 42, numLines: 2, totalLines: 80 },
  }) })
  expect(await ui.find({ type: 'Text', text: /src\/a\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'const answer = 42;' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^42\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^43\s*$/ })).toBeDefined()
  await ui.unmount()
})

test('Grep groups numbered matches without repeating the path on each line', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'grep1', props: props('Grep', { pattern: 'needle', path: '/work/src', output_mode: 'content' }, {
    mode: 'content', numFiles: 1, filenames: [], content: '/work/src/a.ts:4:needle one\n/work/src/a.ts:9:needle two', numLines: 2,
  }) })
  expect(await ui.find({ type: 'Text', text: /needle.*src/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'needle two' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^9\s*$/ })).toBeDefined()
  await ui.unmount()
})

test('Glob shows paths and the count of matching files', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'glob1', props: props('Glob', { pattern: '**/*.ts', path: '/work' }, {
    durationMs: 7, numFiles: 2, filenames: ['/work/src/a.ts', '/work/src/b.ts'], truncated: false,
  }) })
  expect(await ui.find({ type: 'Text', text: /2 files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/b.ts' })).toBeDefined()
  await ui.unmount()
})

test('long output expands and collapses independently for each call', async ($, on) => {
  await setup($, on)
  const output = { durationMs: 1, numFiles: 40, filenames: Array.from({ length: 40 }, (_, i) => `/work/file-${i}.ts`), truncated: false }
  const first = await $.ui.mount({ ...SITE, requestId: 'glob-long1', props: props('Glob', { pattern: '*.ts' }, output) })
  const second = await $.ui.mount({ ...SITE, requestId: 'glob-long2', props: props('Glob', { pattern: '*.ts' }, output) })
  expect(await first.find({ type: 'Text', text: 'file-39.ts' })).toBeUndefined()
  await first.press({ key: 'expand-output' })
  expect(await first.find({ type: 'Text', text: 'file-39.ts' })).toBeDefined()
  expect(await second.find({ type: 'Text', text: 'file-39.ts' })).toBeUndefined()
  await first.press({ key: 'expand-output' })
  expect(await first.find({ type: 'Text', text: 'file-39.ts' })).toBeUndefined()
  await first.unmount()
  await second.unmount()
})

test('a failed Bash call keeps every error line visible', async ($, on) => {
  await setup($, on)
  const output = Array.from({ length: 35 }, (_, i) => `failure detail ${i}`).join('\n')
  const ui = await $.ui.mount({ ...SITE, requestId: 'bash-error', props: props('Bash', { command: 'failing-check' }, output, { isErrored: true, isRunning: true }) })
  expect(await ui.find({ type: 'Text', text: 'failure detail 34' })).toBeDefined()
  await ui.unmount()
})

test('nontext Read results retain native rendering at both sites', async ($, on) => {
  await setup($, on)
  const output = { type: 'image', file: { base64: 'image-data', type: 'image/png', originalSize: 10 } }
  const call = props('Read', { file_path: '/work/image.png' }, output)
  const use = await $.ui.mount({ ...SITE, requestId: 'image1', props: call })
  const result = await $.ui.mount({ ...SITE, component: 'ToolResult', requestId: 'image1', props: {
    tool_use_id: 'card1', tool: 'Read', output, isErrored: false,
  } })
  expect(await use.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  expect(await result.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await use.unmount()
  await result.unmount()
})

test('background Bash keeps its native task controls', async ($, on) => {
  await setup($, on)
  const output = { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'job1' }
  const use = await $.ui.mount({ ...SITE, requestId: 'background1', props: props('Bash', { command: 'long-job' }, output) })
  const result = await $.ui.mount({ ...SITE, component: 'ToolResult', requestId: 'background1', props: {
    tool_use_id: 'card1', tool: 'Bash', output, isErrored: false,
  } })
  expect(await use.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  expect(await result.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await use.unmount()
  await result.unmount()
})

test('semantic card spans preserve every displayed character and soften ordinary output', async ($, on) => {
  await setup($, on)
  const command = 'printf -- "%s" handoff/ready.md'
  const text = '  12:34:56\tPASS  handoff/ready.md in 1.2s  '
  const ui = await $.ui.mount({ ...SITE, requestId: 'semantic-bash', props: props('Bash', { command }, {
    stdout: `${text}\nordinary output\nFAIL is stdout text\n`, stderr: '', interrupted: false,
  }) })
  expect(await ui.find({ type: 'Text', text: `Bash: ${command}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Bash$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^printf$/ }))?.props.color).toBe(COLORS.command)
  expect((await ui.find({ type: 'Text', text: /^--$/ }))?.props.color).toBe(COLORS.flag)
  expect((await ui.find({ type: 'Text', text: /^"%s"$/ }))?.props.color).toBe(COLORS.quote)
  expect((await ui.find({ type: 'Text', text: /^PASS$/ }))?.props.color).toBe(COLORS.add)
  expect((await ui.find({ type: 'Text', text: /^12:34:56$/ }))?.props.color).toBe(COLORS.muted)
  expect((await ui.find({ type: 'Text', text: 'ordinary output' }))?.props.color).toBe(COLORS.output)
  expect((await ui.find({ type: 'Text', text: /^FAIL$/ }))?.props.color).toBe(COLORS.del)
  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe(COLORS.border)
  await ui.unmount()
})

test('explicit failed calls and stderr retain red precedence over markers and paths', async ($, on) => {
  await setup($, on)
  const text = 'PASS handoff/ready.md WARN 1.2s'
  for (const failed of [false, true]) {
    const ui = await $.ui.mount({ ...SITE, requestId: `semantic-error-${failed}`, props: props('Bash', { command: 'check' }, {
      stdout: failed ? text : '', stderr: failed ? '' : text, interrupted: false,
    }, { isErrored: failed }) })
    expect((await ui.find({ type: 'Text', text }))?.props.color).toBe(COLORS.del)
    for (const span of await ui.findAll({ type: 'Text', text: /PASS|handoff\/ready\.md|WARN|1\.2s/ })) {
      if (span.props.color !== undefined) expect(span.props.color).toBe(COLORS.del)
    }
    await ui.unmount()
  }
})

test('authoritative file paths take precedence over status names and ambiguous scope separators', async ($, on) => {
  await setup($, on)
  const glob = await $.ui.mount({ ...SITE, requestId: 'semantic-glob', props: props('Glob', {
    pattern: 'PASS · **/*', path: '/work/a · b',
  }, { numFiles: 2, filenames: ['/work/PASS', '/work/a file'], truncated: false }) })
  expect(await glob.find({ type: 'Text', text: 'Glob: PASS · **/* · a · b' })).toBeDefined()
  expect((await glob.find({ type: 'Text', text: /^a · b$/ }))?.props.color).toBe(COLORS.path)
  expect((await glob.find({ type: 'Text', text: /^PASS$/ }))?.props.color).toBe(COLORS.path)
  expect((await glob.find({ type: 'Text', text: /^a file$/ }))?.props.color).toBe(COLORS.path)
  await glob.unmount()
  const read = await $.ui.mount({ ...SITE, requestId: 'semantic-read', props: props('Read', { file_path: '/work/PASS' }, {
    type: 'text', file: { filePath: '/work/PASS', content: '\nPASS handoff/ready.md', startLine: 42, numLines: 2, totalLines: 43 },
  }) })
  expect((await read.find({ type: 'Text', text: /^PASS$/ }))?.props.color).toBe(COLORS.path)
  expect(await read.find({ type: 'Text', text: /^42\s*$/ })).toBeDefined()
  expect(await read.find({ type: 'Text', text: /^43\s*$/ })).toBeDefined()
  expect(await read.find({ type: 'Text', text: ' ' })).toBeDefined()
  await read.unmount()
})

test('artifact and counted filename ranges preserve their labels and numeric suffixes', async ($, on) => {
  await setup($, on)
  const bash = await $.ui.mount({ ...SITE, requestId: 'semantic-artifact', props: props('Bash', { command: 'check' }, {
    stdout: '', stderr: '', persistedOutputPath: '/work/PASS with spaces', interrupted: false,
  }) })
  expect(await bash.find({ type: 'Text', text: 'Full output: PASS with spaces' })).toBeDefined()
  expect((await bash.find({ type: 'Text', text: /^PASS with spaces$/ }))?.props.color).toBe(COLORS.path)
  await bash.unmount()
  const grep = await $.ui.mount({ ...SITE, requestId: 'semantic-count', props: props('Grep', { pattern: 'value', output_mode: 'count' }, {
    mode: 'count', numFiles: 1, filenames: [], content: 'PASS:3',
  }) })
  expect((await grep.find({ type: 'Text', text: 'PASS:3' }))?.props.color).toBe(COLORS.muted)
  expect((await grep.find({ type: 'Text', text: /^PASS$/ }))?.props.color).toBe(COLORS.path)
  await grep.unmount()
})

test('long semantic lines keep their unstyled tail after the span limit', async ($, on) => {
  await setup($, on)
  const text = `${'PASS handoff/ready.md '.repeat(40)}untouched tail  `
  const ui = await $.ui.mount({ ...SITE, requestId: 'semantic-budget', props: props('Bash', { command: 'check' }, {
    stdout: text, stderr: '', interrupted: false,
  }) })
  expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await ui.unmount()
})

test('semantic spans retain output that fits near the serialized tree limit', async ($, on) => {
  await setup($, on)
  const text = `${'PASS '.repeat(24)}${'x'.repeat(98500)}`
  const bash = await $.ui.mount({ ...SITE, requestId: 'semantic-tree-bash', props: props('Bash', { command: 'check' }, {
    stdout: text, stderr: '', interrupted: false,
  }) })
  expect(await bash.find({ type: 'Text', text })).toBeDefined()
  await bash.unmount()
  const edit = await $.ui.mount({ ...SITE, requestId: 'semantic-tree-edit', props: props('Edit', {}, {
    filePath: '/work/a.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [` ${text}`] }],
  }) })
  expect(await edit.find({ type: 'Text', text })).toBeDefined()
  await edit.unmount()
})
