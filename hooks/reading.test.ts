import type { ModelCompleteInput, ModelCompleteResult, On, PromptDecoration, PromptEditInput, PromptEditResult, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import { SUMMARY_SYSTEM } from './tldr'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['native rendering'] }
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })
const REPLY = 'The cache now expires after an hour. The tests pass. Should the old keys be deleted?'
const SUMMARY = 'The cache expires after an hour and the tests pass.\nShould the old keys be deleted?'

// What `/lucid <args>` typed at the prompt raises.
const lucid = (args: string) => ({
  command: 'lucid', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 },
})

// What the model and the synthesizer answer: a value, or a refusal, which rejects the call.
type Answer<T> = T | { deny: string }
type Options = {
  // false leaves `/lucid speak` at its default, off; otherwise each test starts with speech on.
  speech?: boolean
  // The decorations the prompt box holds before the mod adds its own.
  decorations?: PromptDecoration[]
  model?: (e: ModelCompleteInput) => Answer<ModelCompleteResult> | Promise<Answer<ModelCompleteResult>>
  speak?: (text: string, index: number, voice?: string) => void | { deny: string } | Promise<void>
}

// The engine beneath the mod: the store, the prompt box, the prompt, the model, the synthesizer
// and the voice it was asked for, and the transcript's log and toasts, each recorded.
async function setup($: Engine, on: On, options: Options = {}) {
  const clock: MockClock = mock.clock(on, { now: 1000 })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length,
    ...(options.decorations === undefined ? {} : { decorations: options.decorations }),
  }))
  const received: string[] = []
  on('prompt.submit', (_$, e) => {
    received.push(e.text)
    return { text: e.text }
  })
  const requests: ModelCompleteInput[] = []
  on('model.complete', async (_$, e) => {
    requests.push(e)
    const result = await (options.model ?? (() => answered(SUMMARY)))(e)
    return 'deny' in result ? result : { value: result }
  })
  const spoken: string[] = []
  const voices: (string | undefined)[] = []
  on('audio.speak', async (_$, e) => {
    spoken.push(e.text)
    voices.push(e.voice)
    const refused = await options.speak?.(e.text, spoken.length - 1, e.voice)
    return refused ?? { value: { via: 'system' as const } }
  })
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    if (e.to === 'transcript') logs.push(e.text)
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => STOCK)
  if (options.speech !== false) await $.command.run(lucid('speak on'))
  return { clock, store, received, requests, spoken, voices, logs, toasts }
}

const typed = (text: string, turnId?: string) => ({ text, wait: false, origin: { kind: 'composer' as const }, ...(turnId === undefined ? {} : { turnId }) })
const say = ($: Engine, uuid: string, text: string, agentId?: string) => $.session.append({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response', origin: { kind: 'model', model: 'test-model' }, uuid, ...(agentId === undefined ? {} : { agentId }),
})
const complete = ($: Engine, turnId: string, answer: string, reason: 'answer' | 'aborted' = 'answer') =>
  $.turn.complete({ answer, durationMs: 1000, isAborted: reason === 'aborted', turnId, reason })

// One prompt and its turn: the prompt as typed, the reply's row, and the turn's end.
async function turn($: Engine, turnId: string, prompt: string, reply = REPLY) {
  const entered = await $.prompt.submit(typed(prompt))
  await $.turn.start({ text: entered.text ?? '', turnId })
  await say($, `${turnId}-reply`, reply)
  await complete($, turnId, reply)
  return entered
}

const mountReply = ($: Engine, uuid: string, text = REPLY, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'lucid', surface, component: 'AssistantMessage', requestId: uuid, props: { text, isFirstOfReply: true }, viewport: { columns: 80, rows: 40 } })

// A promise and the call that settles it, to hold a call open while the test looks.
function held<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>(resolve => {
    settle = resolve
  })
  return { promise, settle }
}

// The kit raises `prompt.edit` as the composer does, though its typings list no call for it.
const edit = ($: Engine, e: Omit<PromptEditInput, 'origin'>) =>
  ($.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }).edit({ origin: { kind: 'composer' }, ...e })

// The highlight.

test('the highlight paints each letter of a counting keyword beside the decorations already there', async ($, on) => {
  const theirs = { start: 0, end: 3, color: 'warning' }
  await setup($, on, { decorations: [theirs] })
  const box = await edit($, { text: 'fix it. tl', cursor: 10, start: 10, end: 10, inputText: 'dr' })
  expect(box.text).toBe('fix it. tldr')
  expect(box.decorations).toEqual([
    theirs,
    { start: 8, end: 9, color: 'rainbow_red' },
    { start: 9, end: 10, color: 'rainbow_orange' },
    { start: 10, end: 11, color: 'rainbow_yellow' },
    { start: 11, end: 12, color: 'rainbow_green' },
  ])
})

test('a trailing speak loses its colour once more text follows it', async ($, on) => {
  await setup($, on)
  const lit = await edit($, { text: 'ask them to spea', cursor: 16, start: 16, end: 16, inputText: 'k' })
  expect(lit.decorations?.length).toBe(5)
  const plain = await edit($, { text: 'ask them to speak', cursor: 17, start: 17, end: 17, inputText: ' first' })
  expect(plain.decorations).toBeUndefined()
})

// The prompt and its marks.

test('a prompt with keywords and text reaches Claude without them, and its reply takes a summary beneath', async ($, on) => {
  const { clock, received, requests } = await setup($, on)
  const entered = await turn($, 't1', 'fix nothing, reply with three paragraphs. tldr')
  expect(entered.text).toBe('fix nothing, reply with three paragraphs.')
  expect(received).toEqual(['fix nothing, reply with three paragraphs.'])
  await clock.settle()
  expect(requests).toHaveLength(1)
  const ui = await mountReply($, 't1-reply')
  expect(await ui.find({ type: 'Text', text: 'TLDR' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SUMMARY })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await ui.unmount()
})

test('the summary request carries the reply and the fixed fields, and keeps six nonblank lines', async ($, on) => {
  const long = ['one', '', '  two  ', 'three', 'four', '', 'five', 'six', 'seven', 'eight'].join('\n')
  const { clock, requests } = await setup($, on, { model: () => answered(long) })
  await turn($, 't1', 'tldr: explain the cache')
  await clock.settle()
  expect(requests[0]).toMatchObject({ model: 'haiku', system: SUMMARY_SYSTEM, prompt: `<reply>\n${REPLY}\n</reply>`, maxTokens: 300, effort: 'low', timeoutMs: 30000 })
  const ui = await mountReply($, 't1-reply')
  expect(await ui.find({ type: 'Text', text: /^one\ntwo\nthree\nfour\nfive\nsix$/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt submitted while a turn runs marks that turn', async ($, on) => {
  const { clock, received, spoken } = await setup($, on)
  await $.prompt.submit(typed('explain the cache'))
  await $.turn.start({ text: 'explain the cache', turnId: 't1' })
  await say($, 'early', 'Looking at the cache first.')
  const entered = await $.prompt.submit(typed('speak, also check the docs', 't1'))
  expect(entered.text).toBe('also check the docs')
  expect(received).toEqual(['explain the cache', 'also check the docs'])
  await say($, 't1-reply', REPLY)
  await complete($, 't1', REPLY)
  await clock.settle()
  expect(spoken).toEqual(['The cache now expires after an hour.', 'The tests pass.', 'Should the old keys be deleted?'])
})

test('prompts from other origins pass unchanged and mark nothing', async ($, on) => {
  const { clock, received, requests } = await setup($, on)
  for (const kind of ['sdk', 'task-notification'] as const) {
    await $.prompt.submit({ text: 'fix it. tldr', wait: false, origin: { kind } })
  }
  await $.turn.start({ text: 'fix it. tldr', turnId: 't1' })
  await say($, 't1-reply', REPLY)
  await complete($, 't1', REPLY)
  await clock.settle()
  expect(received).toEqual(['fix it. tldr', 'fix it. tldr'])
  expect(requests).toHaveLength(0)
})

// The TLDR block.

test('the reply draws in full, with Summarizing… and then the TLDR block beneath it', async ($, on) => {
  const answer = held<ModelCompleteResult>()
  const { clock } = await setup($, on, { model: () => answer.promise })
  await turn($, 't1', 'explain the cache. tldr')
  const ui = await mountReply($, 't1-reply')
  expect(await ui.find({ type: 'Text', text: 'Summarizing…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  answer.settle(answered(SUMMARY))
  await clock.settle()
  await ui.redraw()
  expect(await ui.drawn()).toMatchObject({
    type: 'Box',
    children: [STOCK, { type: 'Box', props: { borderStyle: 'round' } }],
  })
  expect(await ui.find({ type: 'Text', text: 'TLDR' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SUMMARY })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Summarizing…' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

for (const [label, result, reason] of [
  ['an API error', { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, 'API error overloaded (529)'],
  ['a timeout', { isAnswered: false, reason: 'aborted', usage: USAGE }, 'timed out'],
  ['an answer with no text', answered(' \n '), 'no text'],
] as const) {
  test(`a summary that fails on ${label} leaves the reply and says why`, async ($, on) => {
    const { clock } = await setup($, on, { model: () => result as ModelCompleteResult })
    await turn($, 't1', 'explain the cache. tldr')
    await clock.settle()
    const ui = await mountReply($, 't1-reply')
    expect(await ui.find({ type: 'Text', text: `TLDR failed: ${reason}` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
    await ui.unmount()
  })
}

test('a summary the engine refuses to send fails with its message', async ($, on) => {
  const { clock } = await setup($, on, { model: () => ({ deny: 'model blocked' }) })
  await turn($, 't1', 'explain the cache. tldr')
  await clock.settle()
  const ui = await mountReply($, 't1-reply')
  expect(await ui.find({ type: 'Text', text: /^TLDR failed: .*model blocked/ })).toBeDefined()
  await ui.unmount()
})

test('an aborted turn drops its marks, and the next turn has none', async ($, on) => {
  const { clock, requests, spoken } = await setup($, on)
  await $.prompt.submit(typed('explain the cache. tldr speak'))
  await $.turn.start({ text: 'explain the cache.', turnId: 't1' })
  await say($, 't1-reply', REPLY)
  await complete($, 't1', REPLY, 'aborted')
  await turn($, 't2', 'and the docs?')
  await clock.settle()
  expect(requests).toHaveLength(0)
  expect(spoken).toHaveLength(0)
})

test('a desktop reply keeps the drawing beneath, summary or not', async ($, on) => {
  const { clock } = await setup($, on)
  await turn($, 't1', 'explain the cache. tldr')
  await clock.settle()
  const ui = await mountReply($, 't1-reply', REPLY, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'TLDR' })).toBeUndefined()
  await ui.unmount()
})

// Keywords alone act on the previous reply.

test('keywords alone drop the prompt with a reason that names what runs', async ($, on) => {
  const { clock, received } = await setup($, on)
  await turn($, 't1', 'explain the cache')
  for (const [prompt, reason] of [
    ['tldr', 'Summarizing the previous reply'],
    ['Speak.', 'Reading the previous reply aloud'],
    ['tldr speak', 'Summarizing and reading the previous reply'],
  ] as const) {
    expect(await $.prompt.submit(typed(prompt))).toEqual({ drop: reason })
  }
  await clock.settle()
  expect(received).toEqual(['explain the cache'])
})

test('keywords alone with no previous reply drop the prompt and run nothing', async ($, on) => {
  const { clock, requests, spoken, logs } = await setup($, on)
  expect(await $.prompt.submit(typed('tldr speak'))).toEqual({ drop: 'No reply yet' })
  await clock.settle()
  expect(requests).toHaveLength(0)
  expect(spoken).toHaveLength(0)
  expect(logs).toHaveLength(0)
})

test('a tldr alone writes the previous reply\'s summary as a log row and leaves the reply as it was', async ($, on) => {
  const { clock, requests, logs } = await setup($, on)
  await turn($, 't1', 'explain the cache')
  await $.prompt.submit(typed('TL;DR'))
  await clock.settle()
  expect(requests[0]?.prompt).toBe(`<reply>\n${REPLY}\n</reply>`)
  expect(logs).toEqual(['TLDR · previous reply', SUMMARY.replace('\n', ' ')])
  const ui = await mountReply($, 't1-reply')
  expect(await ui.find({ type: 'Text', text: 'native rendering' })).toBeDefined()
  await ui.unmount()
})

test('a tldr alone whose summary fails logs the reason', async ($, on) => {
  const { clock, logs } = await setup($, on, { model: () => ({ isAnswered: false, reason: 'aborted', usage: USAGE }) })
  await turn($, 't1', 'explain the cache')
  await $.prompt.submit(typed('tldr'))
  await clock.settle()
  expect(logs).toEqual(['TLDR failed: timed out'])
})

// Speech.

test('a speak reads the reply aloud, a sentence at a time, in order', async ($, on) => {
  const { clock, spoken } = await setup($, on)
  await turn($, 't1', 'speak, explain the cache', '## Result\n\nThe cache works. **All** tests pass!\n\n```sh\nnpm test\n```\n\nDone?')
  await clock.settle()
  expect(spoken).toEqual(['Result', 'The cache works.', 'All tests pass!', 'Done?'])
})

test('a speak alone reads the previous reply at once', async ($, on) => {
  const { clock, spoken } = await setup($, on)
  await turn($, 't1', 'explain the cache')
  await $.prompt.submit(typed('speak'))
  await clock.settle()
  expect(spoken).toHaveLength(3)
})

test('a prompt stops a reading after the sentence it is speaking', async ($, on) => {
  const first = held<void>()
  const { clock, spoken } = await setup($, on, { speak: (_text, index) => (index === 0 ? first.promise : undefined) })
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toEqual(['The cache now expires after an hour.'])
  await $.prompt.submit(typed('next task'))
  first.settle()
  await clock.settle()
  expect(spoken).toEqual(['The cache now expires after an hour.'])
})

test('a new reading stops the one before it', async ($, on) => {
  const first = held<void>()
  const { clock, spoken } = await setup($, on, { speak: (_text, index) => (index === 0 ? first.promise : undefined) })
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  await say($, 'other', 'Another reply. It has two sentences.')
  await $.prompt.submit(typed('speak'))
  first.settle()
  await clock.settle()
  expect(spoken).toEqual(['The cache now expires after an hour.', 'Another reply.', 'It has two sentences.'])
})

test('tldr speak reads the summary once it is ready', async ($, on) => {
  const { clock, spoken } = await setup($, on)
  await turn($, 't1', 'explain the cache. tldr speak')
  await clock.settle()
  expect(spoken).toEqual(['The cache expires after an hour and the tests pass.', 'Should the old keys be deleted?'])
})

test('tldr speak reads the reply when the summary fails', async ($, on) => {
  const { clock, spoken } = await setup($, on, { model: () => ({ isAnswered: false, reason: 'empty-reply', usage: USAGE }) })
  await turn($, 't1', 'explain the cache. tldr speak')
  await clock.settle()
  expect(spoken).toEqual(['The cache now expires after an hour.', 'The tests pass.', 'Should the old keys be deleted?'])
})

test('tldr speak alone reads the previous reply\'s summary', async ($, on) => {
  const { clock, spoken, logs } = await setup($, on)
  await turn($, 't1', 'explain the cache')
  await $.prompt.submit(typed('tldr speak'))
  await clock.settle()
  expect(logs).toHaveLength(2)
  expect(spoken).toEqual(['The cache expires after an hour and the tests pass.', 'Should the old keys be deleted?'])
})

test('a rejected speak call stops the reading and shows a toast', async ($, on) => {
  const { clock, spoken, toasts } = await setup($, on, { speak: () => ({ deny: 'no synthesizer' }) })
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toHaveLength(1)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Speech failed: .*no synthesizer/)
})

// Speech off.

test('with speech off, a speak neither glows nor leaves the prompt, and nothing reads aloud', async ($, on) => {
  const { clock, received, requests, spoken } = await setup($, on, { speech: false })
  const box = await edit($, { text: 'fix it. spea', cursor: 12, start: 12, end: 12, inputText: 'k' })
  expect(box.decorations).toBeUndefined()
  const entered = await turn($, 't1', 'explain the cache. speak')
  expect(entered.text).toBe('explain the cache. speak')
  expect(await $.prompt.submit(typed('speak'))).toEqual({ text: 'speak' })
  await clock.settle()
  expect(received).toEqual(['explain the cache. speak', 'speak'])
  expect(requests).toHaveLength(0)
  expect(spoken).toHaveLength(0)
})

test('with speech off, tldr still counts and a speak beside it stays text', async ($, on) => {
  const { clock, received, requests, spoken } = await setup($, on, { speech: false })
  await turn($, 't1', 'explain the cache. speak tldr')
  await clock.settle()
  expect(received).toEqual(['explain the cache. speak'])
  expect(requests).toHaveLength(1)
  expect(spoken).toHaveLength(0)
})

test('/lucid speak off stops later readings, and /lucid speak on starts them again', async ($, on) => {
  const { clock, spoken } = await setup($, on)
  expect(await $.command.run(lucid('speak off'))).toMatchObject({ text: 'speech: off' })
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toHaveLength(0)
  expect(await $.command.run(lucid('speak on'))).toMatchObject({ text: 'speech: on' })
  await turn($, 't2', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toHaveLength(3)
})

// The voice.

test('each sentence goes to the synthesizer with Samantha, the default voice', async ($, on) => {
  const { clock, spoken, voices } = await setup($, on)
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toHaveLength(3)
  expect(voices).toEqual(['Samantha', 'Samantha', 'Samantha'])
  await $.prompt.submit(typed('speak'))
  await clock.settle()
  expect(voices).toEqual(Array(6).fill('Samantha'))
})

test('/lucid voice sets the voice of every later reading, the summary\'s too', async ($, on) => {
  const { clock, store, voices } = await setup($, on)
  expect(await $.command.run(lucid('voice Eddy (English (US))'))).toMatchObject({ text: 'speech voice: Eddy (English (US))' })
  expect(store.get('voice')).toBe('Eddy (English (US))')
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  await $.prompt.submit(typed('tldr speak'))
  await clock.settle()
  expect(voices).toEqual(Array(5).fill('Eddy (English (US))'))
})

test('a /clear reloads the stored voice for the next reading', async ($, on) => {
  const { clock, store, voices } = await setup($, on)
  store.set('voice', 'Daniel')
  await $.classic.SessionStart({ source: 'clear' })
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(voices).toEqual(['Daniel', 'Daniel', 'Daniel'])
})

test('a voice that is not installed stops the reading and shows a toast', async ($, on) => {
  const { clock, spoken, toasts } = await setup($, on, {
    speak: (_text, _index, voice) => (voice === 'Samantha' ? undefined : { deny: `voice not installed: ${voice}` }),
  })
  await $.command.run(lucid('voice Nobody'))
  await turn($, 't1', 'explain the cache. speak')
  await clock.settle()
  expect(spoken).toHaveLength(1)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Speech failed: .*voice not installed: Nobody/)
})

// Subagents.

test('a subagent\'s rows and turns take no part', async ($, on) => {
  const { clock, requests } = await setup($, on)
  await say($, 'sub-row', 'A subagent reply.', 'agent-1')
  expect(await $.prompt.submit(typed('tldr'))).toEqual({ drop: 'No reply yet' })
  await $.prompt.submit(typed('explain the cache. tldr'))
  await $.turn.start({ text: 'explain the cache.', turnId: 't1' })
  await say($, 'sub-final', 'The subagent is done.', 'agent-1')
  await $.turn.complete({ answer: 'The subagent is done.', durationMs: 10, isAborted: false, turnId: 'sub-turn', reason: 'answer', agentId: 'agent-1' })
  await clock.settle()
  expect(requests).toHaveLength(0)
  await say($, 't1-reply', REPLY)
  await complete($, 't1', REPLY)
  await clock.settle()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.prompt).toBe(`<reply>\n${REPLY}\n</reply>`)
})
