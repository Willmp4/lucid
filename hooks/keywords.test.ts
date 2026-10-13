import { expect, test } from 'claude-code/testing'
import { RAINBOW, dropReason, keywordDecorations, readKeywords } from './keywords'

test('each keyword counts in any letter case', () => {
  for (const word of ['tldr', 'TLDR', 'TlDr', 'tl;dr', 'TL;DR', 'Tl;Dr']) expect(readKeywords(word)).toEqual({ marks: ['tldr'], ranges: [{ start: 0, end: word.length }], rest: '' })
  for (const word of ['speak', 'SPEAK', 'Speak']) expect(readKeywords(word)).toEqual({ marks: ['speak'], ranges: [{ start: 0, end: 5 }], rest: '' })
})

test('a leading run ends in a colon, a comma, or whitespace', () => {
  expect(readKeywords('tldr: what changed?')).toMatchObject({ marks: ['tldr'], rest: 'what changed?' })
  expect(readKeywords('speak, fix the failing test')).toMatchObject({ marks: ['speak'], rest: 'fix the failing test' })
  expect(readKeywords('speak fix the failing test')).toMatchObject({ marks: ['speak'], rest: 'fix the failing test' })
  expect(readKeywords('  tldr, speak: go on')).toMatchObject({ marks: ['tldr', 'speak'], rest: 'go on' })
})

test('a trailing run can end in a period', () => {
  expect(readKeywords('fix the failing test. tldr speak')).toMatchObject({ marks: ['tldr', 'speak'], rest: 'fix the failing test.' })
  expect(readKeywords('fix the failing test, tldr.')).toMatchObject({ marks: ['tldr'], rest: 'fix the failing test,' })
  expect(readKeywords('fix the failing test\n\nTL;DR')).toMatchObject({ marks: ['tldr'], rest: 'fix the failing test' })
})

test('a leading and a trailing run both count', () => {
  expect(readKeywords('tldr fix the failing test speak')).toMatchObject({ marks: ['tldr', 'speak'], rest: 'fix the failing test' })
})

test('a keyword in the middle of a prompt does not count', () => {
  const prompt = 'ask them to speak first'
  expect(readKeywords(prompt)).toEqual({ marks: [], ranges: [], rest: prompt })
  expect(readKeywords('a tldr: here')).toMatchObject({ marks: [], rest: 'a tldr: here' })
})

test('a keyword inside a longer word does not count', () => {
  for (const prompt of ['speaker notes', 'tldr-ish summary', 'tldr_bot runs', 'mytldr', 'speak2 now', 'speak.js is broken', 'open notes.speak', 'run the -speak flag', 'tldr? what']) {
    expect(readKeywords(prompt)).toEqual({ marks: [], ranges: [], rest: prompt })
  }
})

test('a prompt of keywords alone leaves no text for Claude', () => {
  expect(readKeywords('tldr speak')).toMatchObject({ marks: ['tldr', 'speak'], rest: '' })
  expect(readKeywords('speak, tldr.')).toMatchObject({ marks: ['tldr', 'speak'], rest: '' })
  expect(readKeywords('tldr: speak')).toMatchObject({ marks: ['tldr', 'speak'], rest: '' })
  expect(readKeywords('tldr tldr')).toMatchObject({ marks: ['tldr'], rest: '' })
  expect(readKeywords('   ')).toEqual({ marks: [], ranges: [], rest: '   ' })
})

test('the ranges cover each counting keyword', () => {
  expect(readKeywords('fix it. TL;DR speak').ranges).toEqual([{ start: 8, end: 13 }, { start: 14, end: 19 }])
  expect(readKeywords('speak, fix it tldr').ranges).toEqual([{ start: 0, end: 5 }, { start: 14, end: 18 }])
})

test('each letter of a keyword takes the next rainbow colour, from red for each word', () => {
  expect(RAINBOW).toEqual(['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'])
  expect(keywordDecorations([{ start: 3, end: 8 }, { start: 9, end: 13 }])).toEqual([
    { start: 3, end: 4, color: 'rainbow_red' },
    { start: 4, end: 5, color: 'rainbow_orange' },
    { start: 5, end: 6, color: 'rainbow_yellow' },
    { start: 6, end: 7, color: 'rainbow_green' },
    { start: 7, end: 8, color: 'rainbow_blue' },
    { start: 9, end: 10, color: 'rainbow_red' },
    { start: 10, end: 11, color: 'rainbow_orange' },
    { start: 11, end: 12, color: 'rainbow_yellow' },
    { start: 12, end: 13, color: 'rainbow_green' },
  ])
})

test('the drop reason names what runs on the previous reply', () => {
  expect(dropReason(['tldr'])).toBe('Summarizing the previous reply')
  expect(dropReason(['speak'])).toBe('Reading the previous reply aloud')
  expect(dropReason(['tldr', 'speak'])).toBe('Summarizing and reading the previous reply')
})

test('with only tldr counting, speak is an ordinary word', () => {
  expect(readKeywords('explain the cache. speak', ['tldr'])).toEqual({ marks: [], ranges: [], rest: 'explain the cache. speak' })
  expect(readKeywords('speak, fix it', ['tldr'])).toEqual({ marks: [], ranges: [], rest: 'speak, fix it' })
  expect(readKeywords('speak', ['tldr'])).toEqual({ marks: [], ranges: [], rest: 'speak' })
  expect(readKeywords('fix it. tldr speak', ['tldr'])).toEqual({ marks: [], ranges: [], rest: 'fix it. tldr speak' })
  expect(readKeywords('fix it. speak tldr', ['tldr'])).toMatchObject({ marks: ['tldr'], ranges: [{ start: 14, end: 18 }], rest: 'fix it. speak' })
  expect(readKeywords('tldr speak', ['tldr'])).toMatchObject({ marks: ['tldr'], ranges: [{ start: 0, end: 4 }], rest: 'speak' })
  expect(readKeywords('TL;DR: fix it', ['tldr'])).toMatchObject({ marks: ['tldr'], rest: 'fix it' })
})
