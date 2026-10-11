import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
const SITE = { plugin: 'omp-blocks', surface: 'terminal', component: 'ToolUse', viewport: { columns: 100, rows: 40 } } as const
const props = (tool: string, input: unknown, output: unknown, extra: object = {}) => ({
  tool_use_id: 'card1', tool, input, output, isRunning: false, isErrored: false, isInterrupted: false, ...extra,
})
function setup(on: On) {
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.render', () => STOCK)
}

test('Bash shows its command and keeps stderr visible beyond a long stdout preview', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'bash1', props: props('Bash', { command: 'run-check' }, {
    stdout: Array.from({ length: 30 }, (_, i) => `log ${i}`).join('\n'), stderr: 'compiler failed', interrupted: false,
  }) })
  expect(await ui.find({ type: 'Text', text: /run-check/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compiler failed/ })).toBeDefined()
  await ui.unmount()
})

test('Read retains the returned starting line and file content', async ($, on) => {
  setup(on)
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
  setup(on)
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
  setup(on)
  const ui = await $.ui.mount({ ...SITE, requestId: 'glob1', props: props('Glob', { pattern: '**/*.ts', path: '/work' }, {
    durationMs: 7, numFiles: 2, filenames: ['/work/src/a.ts', '/work/src/b.ts'], truncated: false,
  }) })
  expect(await ui.find({ type: 'Text', text: /2 files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/b.ts' })).toBeDefined()
  await ui.unmount()
})

test('long output expands and collapses independently for each call', async ($, on) => {
  setup(on)
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
  setup(on)
  const output = Array.from({ length: 35 }, (_, i) => `failure detail ${i}`).join('\n')
  const ui = await $.ui.mount({ ...SITE, requestId: 'bash-error', props: props('Bash', { command: 'failing-check' }, output, { isErrored: true, isRunning: true }) })
  expect(await ui.find({ type: 'Text', text: 'failure detail 34' })).toBeDefined()
  await ui.unmount()
})

test('nontext Read results retain native rendering at both sites', async ($, on) => {
  setup(on)
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
  setup(on)
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
