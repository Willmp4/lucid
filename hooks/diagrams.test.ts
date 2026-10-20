import type { ModelCompleteResult, On, PromptComposeSection, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import { DIAGRAM_HINT, idOf } from './diagram'

const BRIEF = 'Two boxes: client and server, an arrow from client to server labelled request.'
const REPLY = ['Here is the design.', '', '```excalidraw', BRIEF, '```', '', 'That is the whole flow.'].join('\n')
const FLOW = 'title: Client and server\nnode client: client\nnode server: server\npanel A\n  client\n  server\n  client -> server: request'
const SPEC = 'title: Client and server\npanel A\n  client\n  server'
const READY = {
  png: '/cache/d.png', svg: '/cache/d.svg', cells: '/cache/d.cells.json', columns: 12, excalidraw: '/cache/d.excalidraw', width: 1600, height: 800,
  title: 'Client and server',
}
const CELLS = { columns: 12, lines: [[['╭────╮', null]], [['│ ', null], ['hi', '#e03131'], [' │', null]], [['╰────╯', null]]] }
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })
const ran = (out: object) => ({ exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

// What `/lucid <args>` typed at the prompt raises.
const lucid = (args: string) => ({
  command: 'lucid', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

type Options = {
  // Whether the renderer says the terminal shows pixels.
  pixels?: boolean
  // What the renderer prints for its nth drawing, from 1.
  rendered?: (n: number) => object
  // The files the cache holds, by path.
  files?: Record<string, string>
}

// The engine beneath the mod: the renderer, the model, the cache's files, the store, and the
// toasts, each recorded. The engine's own drawing of a reply's text names the text it drew.
async function setup($: Engine, on: On, options: Options = {}) {
  const clock: MockClock = mock.clock(on)
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
  on('ui.render', (_$, e): RenderElement => ({ type: 'Text', props: {}, children: [`engine: ${String((e.props as { text?: unknown }).text ?? '').trim()}`] }))
  const files = new Map(Object.entries(options.files ?? { [READY.cells]: JSON.stringify(CELLS), [READY.svg]: '<svg xmlns="http://www.w3.org/2000/svg"/>' }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: `ENOENT: ${e.path}` }))
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    return { value: answered(SPEC) }
  })
  const specs: string[] = []
  on('process.run', (_$, e) => {
    if (e.argv.includes('--dir')) return { value: ran({ dir: '/cache', pixels: options.pixels ?? false }) }
    specs.push(String(e.init?.stdin))
    return { value: ran(options.rendered?.(specs.length) ?? READY) }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return { clock, store, files, prompts, specs, toasts }
}

const mountReply = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', text = REPLY, columns = 100) =>
  $.ui.mount({ plugin: 'lucid', surface, component: 'AssistantMessage', requestId: 'reply1', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 40 } })

// The card in place.

test('a terminal fence draws in place: the text around it as Markdown, a card between', async ($, on) => {
  await setup($, on)
  const ui = await mountReply($)
  const drawn = await ui.findAll({ type: 'Markdown' })
  expect(drawn.map(element => element.text.trim())).toEqual(['Here is the design.', 'That is the whole flow.'])
  expect((await ui.find({ type: 'Text', text: /^excalidraw/ }))?.text).toBe('excalidraw')
  expect((await ui.find({ type: 'Text', text: /drawing in the background/ }))?.text).toBe('drawing in the background · queued')
  expect((await ui.find({ type: 'Box', text: /^Here/ }))?.text).toMatch(/^Here is the design\.[\s\S]*excalidraw[\s\S]*That is the whole flow\.$/)
  await ui.unmount()
})

test('elsewhere the text around a fence draws beneath, in parts, with the card between', async ($, on) => {
  await setup($, on)
  const ui = await mountReply($, 'desktop')
  expect((await ui.find({ type: 'Text', text: /engine: Here/ }))?.text).toBe('engine: Here is the design.')
  expect((await ui.find({ type: 'Text', text: /drawing in the background/ }))?.text).toContain('queued')
  expect((await ui.find({ type: 'Text', text: /engine: That/ }))?.text).toBe('engine: That is the whole flow.')
  await ui.unmount()
})

// The job.

test('the background job turns the brief into a picture where the terminal shows pixels', async ($, on) => {
  const { clock, prompts, toasts } = await setup($, on, { pixels: true })
  const ui = await mountReply($)
  await clock.advance(0)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toBe(`Brief:\n${BRIEF}`)
  expect((await ui.find({ type: 'Text', text: /Client and server/ }))?.text).toBe('excalidraw · Client and server')
  expect((await ui.find({ type: 'Image' }))?.props).toEqual({
    source: { file: '/cache/d.png', format: 'png' }, columns: 94, rows: 23, alt: 'Diagram: Client and server',
  })
  expect((await ui.find({ type: 'Text', text: '/cache/d.excalidraw' }))).toBeDefined()
  expect(toasts).toEqual(['Diagram ready: Client and server'])
  await ui.unmount()
})

test('the same diagram draws in cells where the terminal shows no pixels', async ($, on) => {
  const { clock, prompts } = await setup($, on)
  const ui = await mountReply($)
  await clock.advance(0)
  expect(prompts[0]).toContain('boxes side by side')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))?.text).toBe('│ hi │')
  expect(JSON.stringify(await ui.drawn())).toContain('{"type":"Text","props":{"color":"#e03131"},"children":["hi"]}')
  await ui.unmount()
})

test('a renderer that drew no PNG draws in cells even where pixels show', async ($, on) => {
  const { png: _, ...noPng } = READY
  const { clock } = await setup($, on, { pixels: true, rendered: () => noPng })
  const ui = await mountReply($)
  await clock.advance(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))).toBeDefined()
  await ui.unmount()
})

test('a desktop reply draws the diagram as its SVG', async ($, on) => {
  const { clock } = await setup($, on)
  const ui = await mountReply($, 'desktop')
  await clock.advance(0)
  expect((await ui.find({ type: 'Svg' }))?.props).toEqual({ source: '<svg xmlns="http://www.w3.org/2000/svg"/>', alt: 'Diagram: Client and server' })
  await ui.unmount()
})

test('a spec too wide for the terminal goes back to the model with its width', async ($, on) => {
  const widths = [300, 90]
  const { clock, prompts } = await setup($, on, { rendered: () => ({ ...READY, columns: widths.shift() }) })
  const ui = await mountReply($)
  await clock.advance(0)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain('The diagram is 300 columns wide and the terminal has 94.')
  expect(prompts[1]).toContain(`Your spec:\n${SPEC}`)
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))?.text).toBe('│ hi │')
  await ui.unmount()
})

test('a refused spec goes back twice, then the card says why and draws again on Retry', async ($, on) => {
  let refusals = 3
  const { clock, prompts, specs } = await setup($, on, { rendered: () => (refusals-- > 0 ? { error: 'panel 0 ("A") has no nodes' } : READY) })
  const ui = await mountReply($)
  await clock.advance(0)
  expect(prompts).toHaveLength(3)
  expect(prompts[2]).toContain('The generator refused it:\npanel 0 ("A") has no nodes')
  expect((await ui.find({ type: 'Text', text: /^Could not draw it/ }))?.text).toBe('Could not draw it: panel 0 ("A") has no nodes')
  await ui.press({ key: `retry-${idOf(BRIEF)}` })
  await clock.advance(0)
  expect(specs).toHaveLength(4)
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))).toBeDefined()
  await ui.unmount()
})

test('a brief written as .flow draws as written, with no model call', async ($, on) => {
  const { clock, prompts, specs } = await setup($, on)
  const ui = await mountReply($, 'terminal', `The flow:\n\n\`\`\`excalidraw\n${FLOW}\n\`\`\``)
  await clock.advance(0)
  expect(prompts).toEqual([])
  expect(specs).toEqual([FLOW])
  await ui.unmount()
})

test('a diagram the cache holds draws from it, with no model call or drawing', async ($, on) => {
  const files = { [`/cache/${idOf(BRIEF)}.json`]: JSON.stringify(READY), [READY.cells]: JSON.stringify(CELLS) }
  const { clock, prompts, specs } = await setup($, on, { files })
  const ui = await mountReply($)
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))).toBeDefined()
  await clock.advance(0)
  expect(prompts).toEqual([])
  expect(specs).toEqual([])
  expect((await ui.find({ type: 'Text', text: /Client and server/ }))?.text).toBe('excalidraw · Client and server')
  await ui.unmount()
})

test('a member a reload left drawing is an orphan, and its card draws it again', async ($, on) => {
  // Until a job writes the member, it reads as drawing under a load that is gone.
  on('state.get', async (_$, e, next) => {
    const held = await next(e)
    if (e.key !== 'diagram' || !('value' in held) || held.value?.version !== 0) return held
    return { value: { value: { status: 'drawing', step: 'drawing', load: 'a load gone' }, version: 0 } }
  })
  const { clock, prompts } = await setup($, on)
  const ui = await mountReply($)
  expect((await ui.find({ type: 'Text', text: /drawing in the background/ }))?.text).toBe('drawing in the background · drawing')
  await clock.advance(0)
  expect(prompts).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))).toBeDefined()
  await ui.unmount()
})

test('a reply row starts the job before its card draws, from the stored messages', async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: REPLY, toolUses: [] }] }))
  const { clock, prompts } = await setup($, on)
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [] }, door: 'response', origin: { kind: 'model', model: 'test-model' }, uuid: 'row1',
  })
  await clock.advance(0)
  await clock.advance(0)
  expect(prompts).toEqual([`Brief:\n${BRIEF}\n\nThe terminal draws the diagram in 94 columns. A box at width 200 takes about 25 columns and each panel adds about 6, so keep at most 3 boxes side by side across all panels together; stack rows instead of widening them.`])
  const ui = await mountReply($)
  expect((await ui.find({ type: 'Text', text: /^│ hi │$/ }))).toBeDefined()
  await ui.unmount()
})

// The hint and the setting.

const BASE: PromptComposeSection = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' }
const composed = ($: Engine, surfaces: ('terminal' | 'desktop')[] = ['terminal'], traits: ('print' | 'bare')[] = []) =>
  $.prompt.compose({ surfaces, traits, model: 'test-model', promptModel: 'test-model', tools: [], outputStyle: null })

test('a terminal session\'s system prompt asks for diagrams, last; print, bare, and other surfaces do not', async ($, on) => {
  on('prompt.compose', () => ({ sections: [BASE] }))
  await setup($, on)
  expect((await composed($)).sections).toEqual([BASE, { id: 'lucid:diagrams', text: DIAGRAM_HINT, scope: 'session' }])
  expect((await composed($, ['desktop'])).sections).toEqual([BASE])
  expect((await composed($, ['terminal'], ['print'])).sections).toEqual([BASE])
  expect((await composed($, ['terminal'], ['bare'])).sections).toEqual([BASE])
})

test('/lucid diagrams off drops the hint and draws a fence as ordinary code, and on brings both back', async ($, on) => {
  on('prompt.compose', () => ({ sections: [BASE] }))
  const { store } = await setup($, on)
  expect(await $.command.run(lucid('diagrams'))).toMatchObject({ text: 'diagrams: on' })
  expect(await $.command.run(lucid('diagrams off'))).toMatchObject({ text: 'diagrams: off' })
  expect(store.get('diagrams')).toBe('off')
  expect((await composed($)).sections).toEqual([BASE])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountReply($, surface)
    expect((await ui.find({ type: 'Text', text: /^engine:/ }))?.text).toBe(`engine: ${REPLY}`)
    expect(await ui.find({ type: 'Text', text: /^excalidraw/ })).toBeUndefined()
    await ui.unmount()
  }
  expect(await $.command.run(lucid('diagrams on'))).toMatchObject({ text: 'diagrams: on' })
  expect(store.get('diagrams')).toBe('on')
  expect((await composed($)).sections).toHaveLength(2)
})

test('the setting loads at session start and again after /clear', async ($, on) => {
  const { store } = await setup($, on)
  store.set('diagrams', 'off')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await $.command.run(lucid('diagrams'))).toMatchObject({ text: 'diagrams: off' })
  store.set('diagrams', 'on')
  await $.classic.SessionStart({ source: 'clear' })
  expect(await $.command.run(lucid('diagrams'))).toMatchObject({ text: 'diagrams: on' })
})
