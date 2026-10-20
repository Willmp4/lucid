import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { densityCommand, densityOf } from './density'

test('densityOf reads the three levels and falls back to balanced', () => {
  expect(densityOf('full')).toBe('full')
  expect(densityOf('balanced')).toBe('balanced')
  expect(densityOf('compact')).toBe('compact')
  for (const value of [undefined, null, '', 'loud', 'FULL', 3, { density: 'full' }]) expect(densityOf(value)).toBe('balanced')
})

test('densityCommand sets, reports, and refuses levels', () => {
  expect(densityCommand('density compact', 'balanced')).toEqual({ density: 'compact', text: 'card density: compact' })
  expect(densityCommand('  density   FULL ', 'compact')).toEqual({ density: 'full', text: 'card density: full' })
  expect(densityCommand('density', 'compact')).toEqual({ text: 'card density: compact' })
  expect(densityCommand('density loud', 'balanced')).toEqual({ text: 'usage: /lucid density full|balanced|compact|blackbox' })
  expect(densityCommand('density full extra', 'balanced')).toEqual({ text: 'usage: /lucid density full|balanced|compact|blackbox' })
})

const lucid = (args: string) => ({
  command: 'lucid', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
function setup(on: On) {
  const store = new Map<string, unknown>()
  const commands: unknown[] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_$, e) => {
    commands.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.render', () => STOCK)
  return { store, commands }
}

const READ = {
  tool_use_id: 'read1', tool: 'Read', input: { file_path: '/work/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false,
  output: { type: 'text', file: { filePath: '/work/a.ts', content: 'first line\nsecond line', startLine: 1, numLines: 2, totalLines: 2 } },
}
const SITE = { plugin: 'lucid', surface: 'terminal', component: 'ToolUse', viewport: { columns: 100, rows: 40 } } as const

test('/lucid density reports the level, sets one, and refuses an unknown one', async ($, on) => {
  const { store } = setup(on)
  expect(await $.command.run(lucid('density'))).toMatchObject({ text: 'card density: balanced' })
  expect(await $.command.run(lucid('density compact'))).toMatchObject({ text: 'card density: compact' })
  expect(store.get('density')).toBe('compact')
  expect(await $.command.run(lucid('density'))).toMatchObject({ text: 'card density: compact' })
  expect(await $.command.run(lucid('density loud'))).toMatchObject({ text: 'usage: /lucid density full|balanced|compact|blackbox' })
  expect(store.get('density')).toBe('compact')
})

test('/lucid with no known setting lists every setting', async ($, on) => {
  setup(on)
  for (const args of ['', 'colour red']) {
    expect(await $.command.run(lucid(args))).toMatchObject({ text: 'usage: /lucid usage above|below, /lucid density full|balanced|compact|blackbox, /lucid speak on|off, /lucid voice <name>, or /lucid diagrams on|off' })
  }
  expect(await $.command.run(lucid('usage'))).toMatchObject({ text: 'usage meters: above the prompt' })
})

test('the command names every setting when it registers', async ($, on) => {
  const { commands } = setup(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(commands).toEqual([expect.objectContaining({
    name: 'lucid',
    description: 'lucid settings: /lucid usage above|below, /lucid density full|balanced|compact|blackbox, /lucid speak on|off, /lucid voice <name>, /lucid diagrams on|off',
    argumentHint: 'usage above|below | density full|balanced|compact|blackbox | speak on|off | voice <name> | diagrams on|off',
  })])
})

test('a stored level loads at session start, and a bad one reads as balanced', async ($, on) => {
  const { store } = setup(on)
  store.set('density', 'full')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ ...SITE, requestId: 'read1', props: READ })
  expect(await ui.find({ type: 'Text', text: 'second line' })).toBeDefined()
  await ui.unmount()

  store.set('density', 'loud')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await $.command.run(lucid('density'))).toMatchObject({ text: 'card density: balanced' })
  ui = await $.ui.mount({ ...SITE, requestId: 'read1', props: READ })
  expect(await ui.find({ type: 'Text', text: 'second line' })).toBeUndefined()
  await ui.unmount()
})

test('a /clear reloads the stored level', async ($, on) => {
  const { store } = setup(on)
  on('classic.SessionStart', () => ({}))
  store.set('density', 'compact')
  await $.classic.SessionStart({ source: 'clear' })
  expect(await $.command.run(lucid('density'))).toMatchObject({ text: 'card density: compact' })
})
