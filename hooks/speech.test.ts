import { expect, test } from 'claude-code/testing'
import { SPEECH_CAP, speechSentences } from './speech'

test('code blocks, tables, and HTML drop out', () => {
  const reply = [
    'Before the code.',
    '',
    '```ts',
    'const secret = 1',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '<details><summary>More</summary>',
    '<!-- a note -->',
    'After the table.',
  ].join('\n')
  expect(speechSentences(reply)).toEqual(['Before the code.', 'More', 'After the table.'])
})

test('an unclosed fence drops to the end of the reply', () => {
  expect(speechSentences('Read this.\n\n~~~\nnever spoken')).toEqual(['Read this.'])
})

test('headings, list markers, emphasis, and quote markers lose their markers', () => {
  const reply = '## Summary\n- **Fixed** the _flaky_ test\n2. Added a ~~note~~ check\n> Quoted *words* here.\n---\nDone.'
  expect(speechSentences(reply)).toEqual(['Summary', 'Fixed the flaky test', 'Added a note check', 'Quoted words here.', 'Done.'])
})

test('a link reads as its text, inline code as its text, and a bare URL as link', () => {
  expect(speechSentences('See [the docs](https://example.com/a) and `npm test` at https://example.com/b, or <https://example.com/c>.'))
    .toEqual(['See the docs and npm test at link, or link.'])
  expect(speechSentences('Keep snake_case_names and `a*b*c` as written.')).toEqual(['Keep snake_case_names and a*b*c as written.'])
})

test('sentences split after a full stop, question mark, or exclamation mark and at blank lines', () => {
  expect(speechSentences('It passed. Did it?\nYes! Version 3.5 ships\n\nNext part')).toEqual(['It passed.', 'Did it?', 'Yes!', 'Version 3.5 ships', 'Next part'])
})

test('a sentence over the cap splits at the last whitespace under it', () => {
  const words = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ')
  const sentences = speechSentences(words)
  expect(sentences.length).toBeGreaterThan(1)
  for (const sentence of sentences) expect(sentence.length).toBeLessThanOrEqual(SPEECH_CAP)
  expect(sentences.join(' ')).toBe(words)
  const solid = 'x'.repeat(SPEECH_CAP + 10)
  expect(speechSentences(solid)).toEqual(['x'.repeat(SPEECH_CAP), 'x'.repeat(10)])
})

test('a reply with nothing left after stripping has no sentences', () => {
  expect(speechSentences('```sh\nls\n```')).toEqual([])
  expect(speechSentences('')).toEqual([])
})
