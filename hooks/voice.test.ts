import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { voiceCommand, voiceOf } from './voice'

test('voiceOf reads a stored name and falls back to Samantha', () => {
  expect(voiceOf('Daniel')).toBe('Daniel')
  expect(voiceOf('  Eddy (English (US)) ')).toBe('Eddy (English (US))')
  for (const value of [undefined, null, '', '   ', 3, { voice: 'Daniel' }]) expect(voiceOf(value)).toBe('Samantha')
})

test('voiceCommand sets a name as typed, reports the voice, and refuses other settings', () => {
  expect(voiceCommand('voice Daniel', 'Samantha')).toEqual({ voice: 'Daniel', text: 'speech voice: Daniel' })
  expect(voiceCommand('  VOICE   Eddy (English (US))  ', 'Samantha')).toEqual({ voice: 'Eddy (English (US))', text: 'speech voice: Eddy (English (US))' })
  expect(voiceCommand('voice samantha', 'Daniel')).toEqual({ voice: 'samantha', text: 'speech voice: samantha' })
  expect(voiceCommand('voice', 'Daniel')).toEqual({ text: 'speech voice: Daniel' })
  expect(voiceCommand(' voice  ', 'Samantha')).toEqual({ text: 'speech voice: Samantha' })
  expect(voiceCommand('voices Daniel', 'Samantha')).toEqual({ text: 'usage: /lucid voice <name>' })
  expect(voiceCommand('', 'Samantha')).toEqual({ text: 'usage: /lucid voice <name>' })
})

// What `/lucid <args>` typed at the prompt raises.
const lucid = (args: string) => ({
  command: 'lucid', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

function setup(on: On) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('classic.SessionStart', () => ({}))
  return store
}

test('/lucid voice reports the voice, sets one as typed, and stores it', async ($, on) => {
  const store = setup(on)
  expect(await $.command.run(lucid('voice'))).toMatchObject({ text: 'speech voice: Samantha' })
  expect(store.has('voice')).toBe(false)
  expect(await $.command.run(lucid('Voice Eddy (English (US))'))).toMatchObject({ text: 'speech voice: Eddy (English (US))' })
  expect(store.get('voice')).toBe('Eddy (English (US))')
  expect(await $.command.run(lucid('voice'))).toMatchObject({ text: 'speech voice: Eddy (English (US))' })
})

test('a stored voice loads at session start, and a bad one reads as Samantha', async ($, on) => {
  const store = setup(on)
  store.set('voice', 'Daniel')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await $.command.run(lucid('voice'))).toMatchObject({ text: 'speech voice: Daniel' })

  store.set('voice', 7)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await $.command.run(lucid('voice'))).toMatchObject({ text: 'speech voice: Samantha' })
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`a ${source} reloads the stored voice`, async ($, on) => {
    const store = setup(on)
    store.set('voice', 'Daniel')
    await $.classic.SessionStart({ source })
    expect(await $.command.run(lucid('voice'))).toMatchObject({ text: 'speech voice: Daniel' })
  })
}
