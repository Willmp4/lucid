import { expect, test } from 'claude-code/testing'
import { speakCommand, speakOf } from './speak'

// What `/omp <args>` typed at the prompt raises.
const omp = (args: string) => ({
  command: 'omp', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

test('speakOf reads a stored on and falls back to off', () => {
  expect(speakOf('on')).toBe(true)
  expect(speakOf('off')).toBe(false)
  for (const value of [undefined, null, '', 'ON', true, 1, { speak: 'on' }]) expect(speakOf(value)).toBe(false)
})

test('speakCommand turns speech on or off, reports it, and refuses anything else', () => {
  expect(speakCommand('speak on', false)).toEqual({ speak: true, text: 'speech: on' })
  expect(speakCommand('  SPEAK   Off ', true)).toEqual({ speak: false, text: 'speech: off' })
  expect(speakCommand('speak', true)).toEqual({ text: 'speech: on' })
  expect(speakCommand('speak', false)).toEqual({ text: 'speech: off' })
  for (const args of ['speak loud', 'speak on now', 'speaks on', '']) expect(speakCommand(args, false)).toEqual({ text: 'usage: /omp speak on|off' })
})

test('/omp speak starts off, turns on and off, and stores each change', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  expect(await $.command.run(omp('speak'))).toMatchObject({ text: 'speech: off' })
  expect(store.has('speak')).toBe(false)
  expect(await $.command.run(omp('speak on'))).toMatchObject({ text: 'speech: on' })
  expect(store.get('speak')).toBe('on')
  expect(await $.command.run(omp('speak off'))).toMatchObject({ text: 'speech: off' })
  expect(store.get('speak')).toBe('off')

  store.set('speak', 'on')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await $.command.run(omp('speak'))).toMatchObject({ text: 'speech: on' })
  store.set('speak', 'loud')
  await $.classic.SessionStart({ source: 'clear' })
  expect(await $.command.run(omp('speak'))).toMatchObject({ text: 'speech: off' })
})
