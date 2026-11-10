import { expect, test } from 'claude-code/testing'
import { canShowPixels } from '../renderer/pixels.mjs'

test('kitty and Ghostty show pixels on their own', () => {
  expect(canShowPixels({ TERM: 'xterm-kitty' })).toBe(true)
  expect(canShowPixels({ TERM: 'xterm-ghostty' })).toBe(true)
  expect(canShowPixels({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })).toBe(true)
})

test('other terminals show no pixels', () => {
  expect(canShowPixels({ TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app' })).toBe(false)
  expect(canShowPixels({})).toBe(false)
})

test('a multiplexer between Ghostty and the screen shows no pixels', () => {
  for (const name of ['HERDR_ENV', 'TMUX', 'ZELLIJ', 'STY']) {
    expect(canShowPixels({ TERM_PROGRAM: 'ghostty', [name]: '1' })).toBe(false)
  }
})

test('the Herdr desktop app, whose terminals herdr-core runs, shows no pixels', () => {
  expect(canShowPixels({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty', HC_TERMINAL_ID: 't1dr' })).toBe(false)
})
