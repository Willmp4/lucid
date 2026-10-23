import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['? for shortcuts'] }
const HINT = { plugin: 'lucid', surface: 'terminal', component: 'PromptHint', viewport: { columns: 100, rows: 40 } } as const
const hintProps = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

// `pbcopy` takes what the clipboard receives unless `pbcopy` says otherwise; `copies` holds
// what the engine's own copy receives.
function setup(on: On, pbcopy: 'ok' | 'fails' | 'missing' = 'ok') {
  const piped: string[] = []
  const copies: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('ui.render', () => STOCK)
  on('tool.call', () => ({ result: { stdout: 'done', stderr: '', interrupted: false }, text: 'done' }))
  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'pbcopy') return { deny: `unexpected ${e.argv[0]}` }
    if (pbcopy === 'missing') return { deny: 'ENOENT: pbcopy' }
    if (pbcopy === 'ok') piped.push(String(e.init?.stdin))
    return { value: { exitCode: pbcopy === 'ok' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  return { piped, copies }
}

const run = ($: Engine, id: string, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', tool_use_id: id, command, ...(agentId === undefined ? {} : { agentId }) } as never)
const mountHint = ($: Engine, requestId: string) => $.ui.mount({ ...HINT, requestId, props: hintProps })

test('the hint line draws no copy control before a Bash command runs', async ($, on) => {
  setup(on)
  const ui = await mountHint($, 'hint1')
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect(await ui.find({ key: 'lucid-copy' })).toBeUndefined()
  await ui.unmount()
})

test('the copy control borrows the permission debug action, so a bound key presses it', async ($, on) => {
  setup(on)
  await run($, 'b1', 'git status')
  const ui = await mountHint($, 'hint2')
  const control = await ui.find({ key: 'lucid-copy' })
  expect(control?.props.label).toBe('copy')
  expect(control?.props.action).toBe('permission:toggleDebug')
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  await ui.unmount()
})

test('a press pipes the latest command to pbcopy exactly, and the control reads copied', async ($, on) => {
  const { piped, copies } = setup(on)
  await run($, 'b1', 'git status')
  await run($, 'b2', 'claude plugin test . 2>&1 | tail -15')
  const ui = await mountHint($, 'hint3')
  await ui.press({ key: 'lucid-copy' })
  expect(piped).toEqual(['claude plugin test . 2>&1 | tail -15'])
  expect(copies).toEqual([])
  expect((await ui.find({ key: 'lucid-copy' }))?.props.label).toBe('copied')
  await ui.unmount()
})

test('a subagent command leaves the copy control on the main conversation’s command', async ($, on) => {
  const { piped } = setup(on)
  await run($, 'b1', 'npm test')
  await run($, 'sub1', 'ls', 'agent-1')
  const ui = await mountHint($, 'hint4')
  await ui.press({ key: 'lucid-copy' })
  expect(piped).toEqual(['npm test'])
  await ui.unmount()
})

test('the next command after a copy sets the control back to copy', async ($, on) => {
  const { piped } = setup(on)
  await run($, 'b1', 'npm test')
  const ui = await mountHint($, 'hint5')
  await ui.press({ key: 'lucid-copy' })
  await run($, 'b2', 'npm run build')
  expect((await ui.find({ key: 'lucid-copy' }))?.props.label).toBe('copy')
  await ui.press({ key: 'lucid-copy' })
  expect(piped).toEqual(['npm test', 'npm run build'])
  await ui.unmount()
})

for (const pbcopy of ['fails', 'missing'] as const) {
  test(`when pbcopy ${pbcopy === 'fails' ? 'fails' : 'is missing'}, the engine’s own copy takes the command`, async ($, on) => {
    const { copies } = setup(on, pbcopy)
    await run($, 'b1', 'echo "it\'s here"')
    const ui = await mountHint($, 'hint6')
    await ui.press({ key: 'lucid-copy' })
    expect(copies).toEqual(['echo "it\'s here"'])
    expect((await ui.find({ key: 'lucid-copy' }))?.props.label).toBe('copied')
    await ui.unmount()
  })
}
