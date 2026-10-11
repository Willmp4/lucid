import { expect, test } from 'claude-code/testing'
import { highlightSpans } from './text-style'

const tokens = (text: string, mode: 'output' | 'command' = 'output') =>
  highlightSpans(text, mode).map(span => [text.slice(span.start, span.end), span.tone])

test('output highlights bounded timestamps, paths, durations, and status markers', () => {
  expect(tokens('2026-10-11T12:34:56Z  PASS handoff/ready.md in 1.2s; WARN README.md; FAIL')).toEqual([
    ['2026-10-11T12:34:56Z', 'muted'],
    ['PASS', 'success'],
    ['handoff/ready.md', 'path'],
    ['1.2s', 'muted'],
    ['WARN', 'warning'],
    ['README.md', 'path'],
    ['FAIL', 'failure'],
  ])
})

test('markers inside filenames, identifiers, URLs, and ordinary words stay nonstatus text', () => {
  expect(tokens('PASS.md handoff/FAIL.txt COMPASS BYPASS PASS_count failover https://example.com/PASS.md https://example.com/?status=PASS&file=FAIL.md v1.2.3 12msuffix')).toEqual([
    ['PASS.md', 'path'],
    ['handoff/FAIL.txt', 'path'],
  ])
  expect(tokens('plain output with no semantic tokens')).toEqual([])
  expect(tokens('makefile readme dockerfile license')).toEqual([
    ['makefile', 'path'], ['readme', 'path'], ['dockerfile', 'path'], ['license', 'path'],
  ])
  expect(tokens('makefile')).toEqual([['makefile', 'path']])
})

test('shell commands retain quoting, escaping, assignments, and separator boundaries', () => {
  expect(tokens('MODE=test git --message="two words" ./src/a.ts | printf \'%s\\n\' "a\\\"b" && cat README.md', 'command')).toEqual([
    ['git', 'command'],
    ['--message=', 'flag'],
    ['"two words"', 'quote'],
    ['./src/a.ts', 'path'],
    ['printf', 'command'],
    ["'%s\\n'", 'quote'],
    ['"a\\\"b"', 'quote'],
    ['cat', 'command'],
    ['README.md', 'path'],
  ])
  expect(tokens('echo "unfinished', 'command')).toEqual([['echo', 'command']])
  expect(tokens('printf \\--literal -- -literal', 'command')).toEqual([
    ['printf', 'command'],
    ['--', 'flag'],
  ])
  expect(tokens('MODE="test value" > "out file" git -C src', 'command')).toEqual([
    ['"test value"', 'quote'], ['"out file"', 'quote'], ['git', 'command'], ['-C', 'flag'],
  ])
})

test('only explicit shell prompts opt output into command recognition', () => {
  expect(tokens('  $ git --short "two words"')).toEqual([
    ['git', 'command'], ['--short', 'flag'], ['"two words"', 'quote'],
  ])
  expect(tokens('git --short ordinary prose')).toEqual([])
})

test('semantic spans preserve UTF-16 offsets and stop at the requested node budget', () => {
  const text = '🙂\tPASS  src/a.ts\tWARN\nFAIL'
  const spans = highlightSpans(text)
  expect(spans.map(span => [span.start, span.end, text.slice(span.start, span.end)])).toEqual([
    [3, 7, 'PASS'], [9, 17, 'src/a.ts'], [18, 22, 'WARN'], [23, 27, 'FAIL'],
  ])
  expect(highlightSpans(text, 'output', 2)).toEqual(spans.slice(0, 2))
  expect(highlightSpans(text, 'output', 0)).toEqual([])
})
