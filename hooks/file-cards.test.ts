import { expect, test } from 'claude-code/testing'
import type { CallProps } from './block'
import { formatFileTool } from './file-cards'

const call = (tool: string, input: unknown, output?: unknown, state: Partial<CallProps> = {}): CallProps => ({
  tool, input, output, isRunning: false, isErrored: false, isInterrupted: false, ...state,
})

// Dropping empty content rows or using the requested offset changes these line numbers.
test('Read numbers every returned line from the result offset', () => {
  const card = formatFileTool(call('Read', { file_path: '/work/old.ts', offset: 1 }, {
    type: 'text', file: { filePath: '/work/src/a.ts', content: 'alpha\n\nbeta\n', startLine: 42, numLines: 3, totalLines: 80 },
  }, { isRunning: true }), '/work')
  expect(card?.title).toBe('Read: src/a.ts')
  expect(card?.summary).toMatch(/42–44.*80/)
  expect(card?.rows).toEqual([
    { text: 'alpha', number: 42 },
    { text: '', number: 43 },
    { text: 'beta', number: 44 },
  ])
})

test('Read preserves a returned empty line and reports token truncation', () => {
  const card = formatFileTool(call('Read', { file_path: '/work/a.ts' }, {
    type: 'text', file: { filePath: '/work/a.ts', content: '', startLine: 7, numLines: 1, totalLines: 100, truncatedByTokenCap: true },
  }), '/work')
  expect(card?.rows).toEqual([{ text: '', number: 7 }])
  expect(card?.summary).toMatch(/7.*100.*truncated/)
})

test('Read uses the returned line count to retain a final blank line', () => {
  const card = formatFileTool(call('Read', { file_path: '/work/a.ts' }, {
    type: 'text', file: { filePath: '/work/a.ts', content: 'alpha\n', startLine: 7, numLines: 2, totalLines: 8 },
  }), '/work')
  expect(card?.rows).toEqual([{ text: 'alpha', number: 7 }, { text: '', number: 8 }])
})

test('Read keeps a pending requested range without inventing returned lines', () => {
  const card = formatFileTool(call('Read', { file_path: '/work/a.ts', offset: 12, limit: 5 }, undefined, { isRunning: true }), '/work')
  expect(card?.title).toBe('Read: a.ts')
  expect(card?.summary).toMatch(/12–16/)
  expect(card?.rows).toEqual([])
})

test('an empty Read has no fabricated numbered line', () => {
  const card = formatFileTool(call('Read', { file_path: '/work/empty' }, {
    type: 'text', file: { filePath: '/work/empty', content: '', startLine: 1, numLines: 0, totalLines: 0 },
  }), '/work')
  expect(card?.rows).toEqual([])
  expect(card?.summary).toMatch(/0 lines/)
})

test('unsupported Read result formats remain native', () => {
  for (const type of ['image', 'pdf', 'notebook', 'parts', 'file_unchanged', 'other']) {
    expect(formatFileTool(call('Read', {}, { type, file: { content: 'must not replace native output' } }), '/work')).toBeNull()
  }
  expect(formatFileTool(call('Read', {}, 'unknown plain result'), '/work')).toBeNull()
  expect(formatFileTool(call('Read', {}, { type: 'text', file: { content: 'missing metadata' } }), '/work')).toBeNull()
})

test('file tool errors preserve every error line while the running flag lags', () => {
  for (const tool of ['Read', 'Glob', 'Grep']) {
    const card = formatFileTool(call(tool, {}, '<tool_use_error>first\n\nlast</tool_use_error>', { isErrored: true, isRunning: true }), '/work')
    expect(card?.failed).toBe(true)
    expect(card?.rows).toEqual([
      { text: 'first', kind: 'error' },
      { text: '', kind: 'error' },
      { text: 'last', kind: 'error' },
    ])
  }
})

test('Glob returns every filename and reports the engine count and truncation', () => {
  const filenames = Array.from({ length: 40 }, (_, i) => `/work/file-${i}.ts`)
  const card = formatFileTool(call('Glob', { pattern: '**/*.ts', path: '/work/src' }, {
    filenames, numFiles: 90, truncated: true, durationMs: 1,
  }, { isRunning: true }), '/work')
  expect(card?.title).toBe('Glob: **/*.ts · src')
  expect(card?.summary).toMatch(/90 files.*truncated/)
  expect(card?.rows).toHaveLength(40)
  expect(card?.rows[39]).toEqual({ text: 'file-39.ts', kind: 'path' })
})

test('Glob reports zero files without fabricating matches', () => {
  const card = formatFileTool(call('Glob', { pattern: '*.ts' }, { filenames: [], numFiles: 0, truncated: false, durationMs: 1 }), '/work')
  expect(card?.summary).toBe('0 files')
  expect(card?.rows).toEqual([])
})

test('malformed search records remain native instead of dropping filenames', () => {
  expect(formatFileTool(call('Glob', {}, { filenames: ['/work/a.ts', 7], numFiles: 2 }), '/work')).toBeNull()
  expect(formatFileTool(call('Grep', {}, { filenames: ['/work/a.ts', 7], numFiles: 2, mode: 'files_with_matches' }), '/work')).toBeNull()
  expect(formatFileTool(call('Grep', {}, { content: 'a.ts:2:text', filenames: [], numFiles: 1, mode: 'other' }), '/work')).toBeNull()
})

test('Grep groups match and context lines while retaining blank and raw rows', () => {
  const card = formatFileTool(call('Grep', { pattern: 'needle', path: '/work/src', output_mode: 'content' }, {
    mode: 'content', filenames: [], numFiles: 2, numLines: 6,
    content: '/work/src/a.ts:4:needle\n/work/src/a.ts-5-context\n\n--\n/work/src/b.ts:9:\nraw data\n',
  }, { isRunning: true }), '/work')
  expect(card?.title).toBe('Grep: needle · src')
  expect(card?.rows).toEqual([
    { text: 'src/a.ts', kind: 'heading' },
    { text: 'needle', number: 4 },
    { text: 'context', number: 5, kind: 'muted' },
    { text: '' },
    { text: '--' },
    { text: 'src/b.ts', kind: 'heading' },
    { text: '', number: 9 },
    { text: 'raw data' },
  ])
})

test('Grep uses known filenames to preserve colons and numbers in content', () => {
  const card = formatFileTool(call('Grep', { pattern: 'value', output_mode: 'content' }, {
    output_mode: 'content', filenames: ['/work/a:part.ts'], numFiles: 1, numLines: 2,
    content: '/work/a:part.ts:8:value:12:tail\n/work/a:part.ts-9-context-23-tail',
  }), '/work')
  expect(card?.rows).toEqual([
    { text: 'a:part.ts', kind: 'heading' },
    { text: 'value:12:tail', number: 8 },
    { text: 'context-23-tail', number: 9, kind: 'muted' },
  ])
})

test('Grep keeps ambiguous colon and hyphen records intact', () => {
  const content = '/work/a:part.ts:8:value\n/work/a:2:part.ts:8:value\n/work/a.ts:8:value:12:tail\n/work/a-2-part.ts-8-context'
  const card = formatFileTool(call('Grep', { pattern: 'value', output_mode: 'content' }, {
    mode: 'content', filenames: [], numFiles: 1, numLines: 4, content,
  }), '/work')
  expect(card?.rows).toEqual([
    { text: '/work/a:part.ts:8:value' },
    { text: '/work/a:2:part.ts:8:value' },
    { text: '/work/a.ts:8:value:12:tail' },
    { text: '/work/a-2-part.ts-8-context' },
  ])
})

test('Grep preserves single-file and line-numbers-off output without guessing', () => {
  const output = { mode: 'content', filenames: [], numFiles: 1, numLines: 2, content: '8:value\n9-other' }
  expect(formatFileTool(call('Grep', { pattern: 'value', path: '/work/a.ts', output_mode: 'content' }, output), '/work')?.rows).toEqual([
    { text: '8:value' }, { text: '9-other' },
  ])
  expect(formatFileTool(call('Grep', { pattern: 'value', path: '/work/a.ts', output_mode: 'content' }, {
    ...output, content: '8:/work/other.ts:23:value\n9-/work/other.ts-23-context',
  }), '/work')?.rows).toEqual([
    { text: '8:/work/other.ts:23:value' }, { text: '9-/work/other.ts-23-context' },
  ])
  expect(formatFileTool(call('Grep', { pattern: 'value', output_mode: 'content', '-n': false }, {
    ...output, content: '/work/a.ts:8:value\n/work/a.ts-9-other',
  }), '/work')?.rows).toEqual([
    { text: '/work/a.ts:8:value' }, { text: '/work/a.ts-9-other' },
  ])
})

test('Grep files mode uses the completed mode and retains every returned filename', () => {
  const card = formatFileTool(call('Grep', { pattern: 'value', output_mode: 'content' }, {
    mode: 'files_with_matches', filenames: ['/work/a.ts', '/work/b.ts'], numFiles: 2, numLines: 0, content: '',
  }), '/work')
  expect(card?.summary).toBe('2 files')
  expect(card?.rows).toEqual([{ text: 'a.ts', kind: 'path' }, { text: 'b.ts', kind: 'path' }])
})

test('Grep count mode keeps colon filenames and sums only known counts', () => {
  const card = formatFileTool(call('Grep', { pattern: 'value', output_mode: 'count' }, {
    mode: 'count', filenames: [], numFiles: 2, numLines: 2, content: '/work/a:part.ts:3\n/work/b.ts:2',
  }), '/work')
  expect(card?.summary).toBe('5 matches · 2 files')
  expect(card?.rows).toEqual([{ text: 'a:part.ts:3', pathEnd: 9 }, { text: 'b.ts:2', pathEnd: 4 }])
  const raw = formatFileTool(call('Grep', { pattern: 'value', output_mode: 'count' }, {
    mode: 'count', filenames: [], numFiles: 1, numLines: 1, content: 'unknown count data',
  }), '/work')
  expect(raw?.rows).toEqual([{ text: 'unknown count data' }])
  expect(raw?.summary).toBe('1 file')
})

test('Grep reports zero matches only for an empty nontruncated content result', () => {
  const output = { mode: 'content', filenames: [], numFiles: 0, numLines: 0, content: '' }
  expect(formatFileTool(call('Grep', { pattern: 'value' }, output), '/work')?.summary).toBe('0 matches')
  expect(formatFileTool(call('Grep', { pattern: 'value' }, { ...output, truncated: true }), '/work')?.summary).not.toContain('0 matches')
})

test('unrecognized tools and search outputs remain native', () => {
  expect(formatFileTool(call('Other', {}, {}), '/work')).toBeNull()
  expect(formatFileTool(call('Glob', {}, { content: 'not a filename result' }), '/work')).toBeNull()
  expect(formatFileTool(call('Grep', {}, 'unknown plain result'), '/work')).toBeNull()
})

test('Grep content does not report a zero file count when native content mode omits it', () => {
  const card = formatFileTool(call('Grep', { pattern: 'needle' }, {
    mode: 'content', numFiles: 0, filenames: [],
    content: '/work/a.ts:1:needle\n/work/b.ts:2:needle',
    numLines: 2, totalLines: 2,
  }), '/work')
  expect(card?.summary).not.toContain('0 files')
  expect(card?.rows.filter(row => row.kind === 'heading').map(row => row.text)).toEqual(['a.ts', 'b.ts'])
})

test('Grep distinguishes displayed pages from engine totals in each mode', () => {
  const content = formatFileTool(call('Grep', { pattern: 'needle', head_limit: 1 }, {
    mode: 'content', numFiles: 0, filenames: [], content: '/work/a.ts:1:needle',
    numLines: 1, totalLines: 3, appliedLimit: 1,
  }), '/work')
  const files = formatFileTool(call('Grep', { pattern: 'needle', head_limit: 1 }, {
    mode: 'files_with_matches', filenames: ['/work/b.ts'], numFiles: 1, totalFiles: 2, appliedLimit: 1,
  }), '/work')
  const counts = formatFileTool(call('Grep', { pattern: 'needle', head_limit: 1 }, {
    mode: 'count', filenames: [], numFiles: 2, content: '/work/b.ts:1', numMatches: 3, appliedLimit: 1,
  }), '/work')
  expect(content?.summary).toContain('1 of 3')
  expect(files?.summary).toContain('1 of 2')
  expect(counts?.summary).toContain('1 of 3')
  expect(counts?.summary).toContain('1 of 2')
})

test('Grep retains blank matches when single-file output omits line prefixes', () => {
  const input = { pattern: '^$', path: '/work/blank.txt', output_mode: 'content', '-n': false }
  const empty = formatFileTool(call('Grep', input, {
    mode: 'content', numFiles: 0, filenames: [], content: '', numLines: 1, totalLines: 1,
  }), '/work')
  const trailing = formatFileTool(call('Grep', input, {
    mode: 'content', numFiles: 0, filenames: [], content: 'value\n', numLines: 2, totalLines: 2,
  }), '/work')
  expect(empty?.rows).toEqual([{ text: '' }])
  expect(trailing?.rows).toEqual([{ text: 'value' }, { text: '' }])
})

test('an empty Grep count page retains the nonzero query totals', () => {
  const card = formatFileTool(call('Grep', { pattern: 'needle', head_limit: 1, offset: 99 }, {
    mode: 'count', numFiles: 2, filenames: [], content: '', numMatches: 3, appliedLimit: 1, appliedOffset: 99,
  }), '/work')
  expect(card?.summary).toContain('0 of 3')
  expect(card?.summary).toContain('0 of 2')
  expect(card?.rows).toEqual([])
})
