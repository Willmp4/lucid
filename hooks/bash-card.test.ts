import { expect, test } from 'claude-code/testing'

import type { CallProps } from './block'
import { formatBash } from './bash-card'

const call = (output?: unknown, state: Partial<CallProps> = {}): CallProps => ({
  tool: 'Bash',
  input: { command: 'run-check' },
  output,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...state,
})

test('Bash retains every stdout line and marks stderr separately', () => {
  const stdout = Array.from({ length: 30 }, (_, index) => `log ${index}`).join('\n')
  const card = formatBash(call({ stdout, stderr: 'warning one\nwarning two\n', interrupted: false }), '/work')

  expect(card?.title).toContain('run-check')
  expect(card?.rows).toHaveLength(32)
  expect(card?.rows[29]).toEqual({ text: 'log 29', kind: 'text' })
  expect(card?.rows.slice(30)).toEqual([
    { text: 'warning one', kind: 'error' },
    { text: 'warning two', kind: 'error' },
  ])
  expect(card?.failed).toBe(false)
})

test('completed Bash output takes precedence over a stale running flag', () => {
  const card = formatBash(call({ stdout: 'finished\n', stderr: '', interrupted: false }, { isRunning: true }), '/work')

  expect(card?.rows).toEqual([{ text: 'finished', kind: 'text' }])
})

test('absent Bash output does not become an empty successful result', () => {
  for (const output of [undefined, null]) {
    for (const isRunning of [false, true]) {
      const pending = formatBash(call(output, { isRunning }), '/work')
      expect(pending).not.toBeNull()
      expect(pending?.rows).toHaveLength(0)
      expect(pending?.failed).toBe(false)
    }
  }

  const completed = formatBash(call({ stdout: '', stderr: '', interrupted: false }), '/work')
  expect(completed?.rows).toHaveLength(1)
  expect(completed?.rows[0].kind).toBe('muted')
  expect(completed?.failed).toBe(false)
})

test('tagged tool errors retain every line even without the error flag', () => {
  const text = Array.from({ length: 35 }, (_, index) => `failure detail ${index}`).join('\n')
  const card = formatBash(call(`<tool_use_error>${text}</tool_use_error>`, { isRunning: true }), '/work')

  expect(card?.failed).toBe(true)
  expect(card?.rows).toHaveLength(35)
  expect(card?.rows[0]).toEqual({ text: 'failure detail 0', kind: 'error' })
  expect(card?.rows[34]).toEqual({ text: 'failure detail 34', kind: 'error' })
})

test('failed native Bash results retain stdout as well as stderr', () => {
  const card = formatBash(call({ stdout: 'partial result\n', stderr: 'Exit code 2\ninvalid argument\n', interrupted: false }, { isErrored: true }), '/work')

  expect(card?.failed).toBe(true)
  expect(card?.rows).toEqual([
    { text: 'partial result', kind: 'text' },
    { text: 'Exit code 2', kind: 'error' },
    { text: 'invalid argument', kind: 'error' },
  ])
})

test('plain string Bash results preserve text and error classification', () => {
  const success = formatBash(call('plain output\n', { isRunning: true }), '/work')
  const failure = formatBash(call('failure one\nfailure two', { isErrored: true }), '/work')

  expect(success?.rows).toEqual([{ text: 'plain output', kind: 'text' }])
  expect(failure?.failed).toBe(true)
  expect(failure?.rows).toEqual([
    { text: 'failure one', kind: 'error' },
    { text: 'failure two', kind: 'error' },
  ])
})

test('interrupted Bash calls retain partial output and distinguish their status', () => {
  const native = formatBash(call({ stdout: 'partial\n', stderr: '', interrupted: true }), '/work')
  const pending = formatBash(call(undefined, { isInterrupted: true, isRunning: true }), '/work')

  expect(native?.rows).toEqual([{ text: 'partial', kind: 'text' }])
  expect(native?.summary).toMatch(/interrupted/i)
  expect(pending?.summary).toMatch(/interrupted/i)
  expect(pending?.rows).toHaveLength(0)
})

test('background requests stay pending until their output selects native rendering', () => {
  const pending = formatBash(call(undefined, { input: { command: 'watch-check', run_in_background: true } }), '/work')
  expect(pending).not.toBeNull()
  expect(pending?.rows).toHaveLength(0)

  const output = { stdout: 'started', stderr: '', interrupted: false, backgroundTaskId: 'task1' }
  expect(formatBash(call(output), '/work')).toBeNull()
  expect(formatBash(call(output, { input: {} }), '/work')).toBeNull()
})

test('image and structured Bash payloads retain native rendering', () => {
  for (const extra of [{ isImage: true }, { structuredContent: { type: 'image', data: 'image payload' } }]) {
    expect(formatBash(call({ stdout: 'text companion', stderr: '', interrupted: false, ...extra }), '/work')).toBeNull()
  }
  expect(formatBash(call([{ type: 'image', data: 'image payload' }]), '/work')).toBeNull()
})

test('unrecognized Bash output retains native rendering', () => {
  for (const output of [{ stdout: 'missing stderr' }, { stdout: [], stderr: '', interrupted: false }, { content: 'unknown result' }, 42]) {
    expect(formatBash(call(output), '/work')).toBeNull()
  }
})

test('full-output paths stay before a long preview and shorten against the working directory', () => {
  const stdout = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')
  const card = formatBash(call({
    stdout,
    stderr: '',
    interrupted: false,
    persistedOutputPath: '/work/artifacts/full.txt',
    persistedOutputSize: 100,
    rawOutputPath: '/Users/person/logs/raw.txt',
  }), '/work')

  expect(card?.rows.slice(0, 2).map(row => row.text)).toEqual([
    'Full output: artifacts/full.txt',
    'Raw output: ~/logs/raw.txt',
  ])
  expect(card?.rows.at(-1)).toEqual({ text: 'line 29', kind: 'text' })
})

test('Bash cleans display controls without changing the command or result', () => {
  const input = Object.freeze({ command: '\u001b[32mrun-check\u001b[0m' })
  const output = Object.freeze({ stdout: '\u001b[31mred\u001b[0m\r\n', stderr: 'warning\r\n', interrupted: false, returnCodeInterpretation: 'matches found' })
  const card = formatBash(call(output, { input }), '/work')

  expect(card?.title).toBe('Bash: run-check')
  expect(card?.rows).toEqual([{ text: 'red', kind: 'text' }, { text: 'warning', kind: 'error' }])
  expect(card?.summary).toContain('matches found')
  expect(input.command).toBe('\u001b[32mrun-check\u001b[0m')
  expect(output.stdout).toBe('\u001b[31mred\u001b[0m\r\n')
})
