import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { meterLine, metersOf, usageCommand } from './usage'

const USAGE = {
  context: { window: 200000, percent: 12.4 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 15 }, { kind: 'seven_day', percentUsed: 5 }],
}

test('meterLine draws context and plan limits as block meters', () => {
  expect(meterLine(metersOf(USAGE))).toBe('▰▱▱▱▱▱▱▱ 12% context   ▰▱▱▱▱▱▱▱ 15% 5h   ▱▱▱▱▱▱▱▱ 5% 7d')
})

test('metersOf is empty with no figures', () => {
  expect(metersOf({ context: {}, rateLimits: [] })).toEqual([])
})

test('usageCommand sets, reports, and refuses placements', () => {
  expect(usageCommand('usage below', 'above')).toEqual({ placement: 'below', text: 'usage meters: below the prompt' })
  expect(usageCommand('usage ABOVE', 'below')).toEqual({ placement: 'above', text: 'usage meters: above the prompt' })
  expect(usageCommand('usage', 'below')).toEqual({ text: 'usage meters: below the prompt' })
  expect(usageCommand('usage sideways', 'above')).toEqual({ text: 'usage: /omp usage above|below' })
  expect(usageCommand('', 'above')).toEqual({ text: 'usage: /omp usage above|below' })
})

// What `/omp <args>` typed at the prompt raises.
const omp = (args: string) => ({
  command: 'omp', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['skins band'] }
const BAND = { plugin: 'omp-blocks', surface: 'terminal', component: 'AbovePrompt', viewport: { columns: 100, rows: 40 } } as const
const bandProps = (hasSurvey: boolean) => ({
  hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 }, view: {},
})
function setup(on: On) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, ...USAGE } }))
  on('ui.render', () => STOCK)
  return store
}

test('the band above the prompt stays by default and hides once the meters move below', async ($, on) => {
  setup(on)
  let ui = await $.ui.mount({ ...BAND, requestId: 'band1', props: bandProps(false) })
  expect(await ui.find({ type: 'Text', text: 'skins band' })).toBeDefined()
  await ui.unmount()

  await $.command.run(omp('usage below'))
  ui = await $.ui.mount({ ...BAND, requestId: 'band2', props: bandProps(false) })
  expect(await ui.find({ type: 'Text', text: 'skins band' })).toBeUndefined()
  await ui.unmount()

  ui = await $.ui.mount({ ...BAND, requestId: 'band3', props: bandProps(true) })
  expect(await ui.find({ type: 'Text', text: 'skins band' })).toBeDefined()
  await ui.unmount()

  await $.command.run(omp('usage above'))
  ui = await $.ui.mount({ ...BAND, requestId: 'band4', props: bandProps(false) })
  expect(await ui.find({ type: 'Text', text: 'skins band' })).toBeDefined()
  await ui.unmount()
})

test('the placement persists in the store', async ($, on) => {
  const store = setup(on)
  await $.command.run(omp('usage below'))
  expect(store.get('usage')).toBe('below')
})

const HINT = { plugin: 'omp-blocks', surface: 'terminal', component: 'PromptHint', viewport: { columns: 100, rows: 40 } } as const
const hintProps = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

test('below the prompt, the meters draw above the hint line, which stays', async ($, on) => {
  setup(on)
  await $.command.run(omp('usage below'))
  const ui = await $.ui.mount({ ...HINT, requestId: 'hint1', props: hintProps })
  expect(await ui.find({ type: 'Text', text: /12% context.*15% 5h.*5% 7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'skins band' })).toBeDefined()
  await ui.unmount()
})

test('above the prompt, the hint line draws alone', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...HINT, requestId: 'hint2', props: hintProps })
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeUndefined()
  await ui.unmount()
})

test('a /clear reloads the stored placement and the figures', async ($, on) => {
  const store = setup(on)
  on('classic.SessionStart', () => ({}))
  store.set('usage', 'below')
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...HINT, requestId: 'hint3', props: hintProps })
  expect(await ui.find({ type: 'Text', text: /12% context/ })).toBeDefined()
  await ui.unmount()
})
