import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { CallBody, CallRecord, CallStatus, Density, Mark, ReplyRow, Summary, TurnRecord, UsageMeter, UsagePlacement } from '../types'
import { EDIT_TOOLS, blockOf, drawBlock } from './block'
import type { CallProps } from './block'
import { densityCommand, densityOf } from './density'
import { DIAGRAM_HINT, diagramsCommand, diagramsOf } from './diagram'
import type { DiagramFence } from './diagram'
import { drawDiagramCard } from './diagram-card'
import { diagramState, locateDiagrams, pictureOf, retryDiagram, seeColumns, watchReply } from './diagram-job'
import { drawGroup, groupOf } from './group-card'
import { MARKS, dropReason, keywordDecorations, readKeywords } from './keywords'
import { diagramParts, replyLayout } from './long-fence'
import { drawReply, replyColumns } from './reply'
import { speakCommand, speakOf } from './speak'
import { speechSentences } from './speech'
import { summaryOf, summaryRequest } from './tldr'
import type { Settled } from './tldr'
import { drawTldr, drawTldrNote } from './tldr-block'
import { CARD_TOOLS, cardOf, drawCard } from './tool-card'
import { drawTurn, genericCard, mutedRow } from './turn-block'
import {
  addItems, anchorOf, answerCalls, backgroundLabel, backgroundOf, callLabel, elapsedOf, endTurn, failureLine, imageLabel, isBackgroundCall,
  isBrokenCall, isImageRead, isQuestion, openBlock, recordInput, responseItems, resultsOf,
} from './turn-model'
import { metersOf, placementOf, usageCommand } from './usage'
import { drawMeters } from './usage-line'
import { DEFAULT_VOICE, voiceCommand, voiceOf } from './voice'

const LUCID_HELP = 'usage: /lucid usage above|below, /lucid density full|balanced|compact|blackbox, /lucid speak on|off, /lucid voice <name>, or /lucid diagrams on|off'

const expandedAtom = atom({ plugin: 'lucid', key: 'expanded' } as const, false)
const durationAtom = atom({ plugin: 'lucid', key: 'duration' } as const, -1)
const usageAtom = atom({ plugin: 'lucid', key: 'usage' } as const, 'above' as UsagePlacement)
const densityAtom = atom({ plugin: 'lucid', key: 'density' } as const, 'balanced' as Density)
const speakAtom = atom({ plugin: 'lucid', key: 'speak' } as const, false)
const voiceAtom = atom({ plugin: 'lucid', key: 'voice' } as const, DEFAULT_VOICE)
const openedAtom = atom({ plugin: 'lucid', key: 'opened' } as const, false)
const ungroupedAtom = atom({ plugin: 'lucid', key: 'ungrouped' } as const, false)
const metersAtom = atom({ plugin: 'lucid', key: 'meters' } as const, [] as UsageMeter[])
// The blackbox level's record of each turn: the turn running, each turn's blocks, which turn a
// call belongs to, each call's outcome, and which blocks are open, by their first call.
const liveTurnAtom = atom({ plugin: 'lucid', key: 'liveTurn' } as const, '')
// Keyed apart from the one-block record of earlier versions, which a reload can leave in state.
const turnAtom = atom({ plugin: 'lucid', key: 'turnBlocks' } as const, { blocks: [] } as TurnRecord)
const ownerAtom = atom({ plugin: 'lucid', key: 'owner' } as const, '')
const callAtom = atom({ plugin: 'lucid', key: 'call' } as const, { tool: '', input: {}, status: 'running' } as CallRecord)
const bodyAtom = atom({ plugin: 'lucid', key: 'body' } as const, { input: {} } as CallBody)
const unfoldedAtom = atom({ plugin: 'lucid', key: 'unfolded' } as const, false)
// The reading keywords: marks waiting for their turn, each turn's marks and final reply, the
// main loop's last reply, each reply's summary, and the reading in progress.
const pendingMarksAtom = atom({ plugin: 'lucid', key: 'pendingMarks' } as const, [] as Mark[])
const marksAtom = atom({ plugin: 'lucid', key: 'marks' } as const, [] as Mark[])
const readingTurnAtom = atom({ plugin: 'lucid', key: 'readingTurn' } as const, '')
const turnReplyAtom = atom({ plugin: 'lucid', key: 'turnReply' } as const, '')
const lastReplyAtom = atom({ plugin: 'lucid', key: 'lastReply' } as const, { uuid: '', text: '' } as ReplyRow)
const tldrAtom = atom({ plugin: 'lucid', key: 'tldr' } as const, { state: 'none' } as Summary)
const speechAtom = atom({ plugin: 'lucid', key: 'speech' } as const, 0)
// Whether replies draw their diagram fences, and Claude is asked to write them.
const diagramsAtom = atom({ plugin: 'lucid', key: 'diagrams' } as const, true)

const member = (requestId: string) => ({ requestId })
// A later outcome never softens an earlier one: an interruption outranks a failure.
const RANK: Readonly<Record<CallStatus, number>> = { running: 0, ok: 1, failed: 2, interrupted: 3 }

// The same figures keep the same value, so the line under the prompt is not redrawn.
async function refreshMeters($: EngineInterface): Promise<void> {
  const meters = metersOf(await $.session.usage())
  await update($, metersAtom, previous => (JSON.stringify(previous) === JSON.stringify(meters) ? previous : meters))
}

// The stored settings and the current figures, at the start and after a reset.
async function loadSettings($: EngineInterface): Promise<void> {
  const stored = placementOf(await $.store.get('usage'))
  const density = densityOf(await $.store.get('density'))
  const speak = speakOf(await $.store.get('speak'))
  const voice = voiceOf(await $.store.get('voice'))
  const diagrams = diagramsOf(await $.store.get('diagrams'))
  await update($, usageAtom, () => stored)
  await update($, densityAtom, () => density)
  await update($, speakAtom, () => speak)
  await update($, voiceAtom, () => voice)
  await update($, diagramsAtom, () => diagrams)
  await refreshMeters($)
}

// Text between a reply's tables as skins draws it; undefined where skins is absent or
// draws nothing of its own.
async function skinsMarkdown($: EngineInterface, text: string, columns: number): Promise<RenderElement | undefined> {
  try {
    return await $.skins.markdown({ surface: 'terminal', text, columns })
  } catch {
    return undefined
  }
}

// A call's outcome, from its run or its result row, whichever lands first.
async function settle($: EngineInterface, id: string, status: CallStatus, text: string, error?: string, output?: unknown, background?: CallRecord['background']): Promise<void> {
  await update($, memberOf(callAtom, member(id)), call => RANK[status] < RANK[call.status] ? call : {
    ...call, status, ...(error === undefined ? {} : { error }), ...(background === undefined ? {} : { background }),
  })
  await update($, memberOf(bodyAtom, member(id)), body => ({
    ...body,
    ...(output !== undefined ? { output } : body.output === undefined && status !== 'ok' ? { output: text } : {}),
    ...(text !== '' || body.text === undefined ? { text } : {}),
  }))
}

type Content = { type: string; [field: string]: unknown }[]

// A main-loop row of the turn running: the turn's blocks first, then whose calls they are.
async function recordRow($: EngineInterface, turnId: string, door: string, content: Content): Promise<void> {
  const turn = memberOf(turnAtom, member(turnId))
  if (door === 'tool-result') {
    const answered: string[] = []
    for (const result of resultsOf(content)) {
      if ((await read($, memberOf(ownerAtom, member(result.id)))) !== turnId) continue
      const { tool } = await read($, memberOf(callAtom, member(result.id)))
      await settle($, result.id, result.status, result.text, result.status === 'failed' ? failureLine(tool, result.text) : result.error)
      answered.push(result.id)
    }
    if (answered.length > 0) {
      const now = await $.clock.now()
      await update($, turn, record => answerCalls(record, answered, now))
    }
    return
  }
  const { items, calls } = responseItems(content)
  if (items.length === 0) return
  for (const call of calls) {
    await update($, memberOf(callAtom, member(call.id)), () => call.record)
    await update($, memberOf(bodyAtom, member(call.id)), () => call.body)
  }
  const now = await $.clock.now()
  await update($, turn, record => addItems(record, items, now))
  for (const call of calls) await update($, memberOf(ownerAtom, member(call.id)), () => turnId)
}

const isPending = (props: CallProps) => props.output === undefined && !props.isErrored && !props.isInterrupted

// Whether the block can show a call's result in place of its own row: a card formats it, it
// is a background job or an image read, or it is text.
async function canShow($: EngineInterface, id: string, props: CallProps, cwd: string): Promise<boolean> {
  if (EDIT_TOOLS.has(props.tool)) return true
  if (props.tool === 'Bash' && backgroundOf(props.output) !== undefined) return true
  if (isImageRead(props.tool, props.output)) return true
  if (CARD_TOOLS[props.tool] === true) return cardOf(props, cwd) !== null
  if (isPending(props)) return true
  const body = await read($, memberOf(bodyAtom, member(id)))
  return typeof body.text === 'string' && body.text.trim() !== ''
}

const propsOf = (record: CallRecord, body: CallBody): CallProps => ({
  tool: record.tool,
  input: body.input,
  output: body.output,
  isRunning: record.status === 'running',
  isErrored: record.status === 'failed',
  isInterrupted: record.status === 'interrupted',
})

// One call of an open block: its compact card, keyed apart from the others; a background job
// or an image read draws one muted row.
async function drawCall($: EngineInterface, e: RenderInput<'ToolUse' | 'ToolGroup', 'terminal'>, id: string, cwd: string) {
  const ui = $.ui.resolve(e)
  const columns = e.viewport?.columns ?? 100
  const record = await read($, memberOf(callAtom, member(id)))
  if (isBackgroundCall(record) && !isBrokenCall(record)) return mutedRow(ui, backgroundLabel(record, cwd), columns)
  const body = await read($, memberOf(bodyAtom, member(id)))
  if (isImageRead(record.tool, body.output)) return mutedRow(ui, imageLabel(record, cwd), columns)
  const props = propsOf(record, body)
  const opening = memberOf(openedAtom, member(id))
  const view = { density: 'compact' as const, opened: await read($, opening), keySuffix: `-${id}`, toggleOpen: () => {
    void update($, opening, previous => !previous)
  } }
  if (EDIT_TOOLS.has(record.tool)) return drawBlock(ui, blockOf(props, cwd, 'compact'), view)
  const expansion = memberOf(expandedAtom, member(id))
  const toggle = () => {
    void update($, expansion, previous => !previous)
  }
  const duration = record.tool === 'Bash' ? await read($, memberOf(durationAtom, member(id))) : -1
  const card = (CARD_TOOLS[record.tool] === true ? cardOf(props, cwd) : null) ?? genericCard(record, body.text, cwd)
  return drawCard(ui, card, await read($, expansion), toggle, duration, view)
}

// The block a turn draws at `anchor`, its first call. `provisional` holds calls a live turn has
// not recorded yet, while their input streams in.
async function drawTurnBlock(
  $: EngineInterface, e: RenderInput<'ToolUse' | 'ToolGroup', 'terminal'>, turnId: string, anchor: string, provisional: readonly CallProps[] = [],
) {
  const ui = $.ui.resolve(e)
  const cwd = await $.session.cwd()
  const block = (await read($, memberOf(turnAtom, member(turnId)))).blocks.find(found => found.ids[0] === anchor)
  const ids = block?.ids ?? []
  const calls = await Promise.all(ids.map(async id => ({ id, record: await read($, memberOf(callAtom, member(id))) })))
  provisional.forEach((props, index) => calls.push({
    id: `pending-${index}`, record: { tool: props.tool, input: recordInput(props.input), status: 'running' },
  }))
  const live = (await read($, liveTurnAtom)) === turnId && block?.closed !== true
  const running = live ? calls.filter(call => call.record.status === 'running').at(-1) : undefined
  const unfolding = memberOf(unfoldedAtom, member(anchor))
  const unfolded = await read($, unfolding)
  const entries: RenderElement[] = []
  if (unfolded) {
    const { Box } = ui
    for (const id of ids) entries.push(<Box key={`call-${id}`} flexDirection="column" width="100%">{await drawCall($, e, id, cwd)}</Box>)
  }
  return drawTurn(ui, {
    calls,
    durationMs: block === undefined ? undefined : elapsedOf(block),
    running: running === undefined ? undefined : isBackgroundCall(running.record) ? 'background' : callLabel(running.record, cwd),
    unfolded,
    columns: e.viewport?.columns ?? 100,
    toggle: () => {
      void update($, unfolding, previous => !previous)
    },
    entries,
  }, cwd)
}

// A diagram fence's card. A terminal's columns are the budget of the next spec.
async function drawDiagram($: EngineInterface, e: RenderInput<'AssistantMessage'>, fence: DiagramFence): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const columns = e.viewport?.columns ?? 100
  if (e.surface === 'terminal') seeColumns(columns)
  const diagram = await diagramState($, fence)
  const picture = diagram?.status === 'ready' ? await pictureOf($, e.surface, diagram, columns) : undefined
  return drawDiagramCard(ui, fence.id, diagram, picture, () => retryDiagram($, fence))
}

// A terminal reply as this mod draws it before any summary: its tables wrap, its long
// fences split into pieces skins draws, and its diagram fences draw as cards; any other
// reply keeps the drawing beneath.
async function drawUsual($: EngineInterface, e: RenderInput<'AssistantMessage', 'terminal'>, beneath: () => Promise<RenderElement>): Promise<RenderElement> {
  const segments = replyLayout(e.props.text, await read($, diagramsAtom))
  if (segments === null) return beneath()
  const columns = replyColumns(e.viewport?.columns ?? 100)
  const drawn: (RenderElement | undefined)[] = []
  for (const segment of segments) {
    drawn.push(segment.kind === 'text'
      ? await skinsMarkdown($, segment.text, columns)
      : segment.kind === 'diagram' ? await drawDiagram($, e, segment) : undefined)
  }
  return drawReply($.ui.resolve(e), segments, columns, drawn)
}

// Another surface's reply keeps its own drawing, but for its diagram fences: the text around
// each draws beneath, in parts, and the fence draws as a card between them.
async function drawElsewhere($: EngineInterface, e: RenderInput<'AssistantMessage'>, next: (e: RenderInput<'AssistantMessage'>) => Promise<RenderElement>): Promise<RenderElement> {
  const parts = (await read($, diagramsAtom)) ? diagramParts(e.props.text) : null
  if (parts === null) return next(e)
  const { Box } = $.ui.resolve(e)
  const drawn: RenderElement[] = []
  for (const [i, part] of parts.entries()) {
    drawn.push(part.kind === 'diagram'
      ? await drawDiagram($, e, part)
      : await next({ ...e, props: { ...e.props, text: part.text, isFirstOfReply: e.props.isFirstOfReply && i === 0 } }))
  }
  return (
    <Box flexDirection="column" width="100%">
      {drawn.map((part, i) => <Box key={`part-${i}`} flexDirection="column" width="100%">{part}</Box>)}
    </Box>
  )
}

const joined = (a: readonly Mark[], b: readonly Mark[]) => MARKS.filter(mark => a.includes(mark) || b.includes(mark))

const textOf = (content: Content) =>
  content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n\n')

// A new reading's counter value. A prompt or another reading takes a newer one. A reset
// $.state starts the counter again, so the clock keeps a new value apart from an old one.
async function claimReading($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  let claimed = 0
  await update($, speechAtom, previous => (claimed = Math.max(previous + 1, now)))
  return claimed
}

// One sentence at a time in the stored voice while the reading holds the counter, so a
// prompt stops it after the sentence it is speaking.
async function readAloud($: EngineInterface, reading: number, text: string): Promise<void> {
  const voice = await read($, voiceAtom)
  for (const sentence of speechSentences(text)) {
    if ((await read($, speechAtom)) !== reading) return
    try {
      await $.audio.speak(sentence, { voice })
    } catch (error) {
      $.ui.toast(`Speech failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
}

// One summary call; a call the engine refuses to send fails with its message.
async function summarize($: EngineInterface, reply: string): Promise<Settled> {
  try {
    return summaryOf(await $.model.complete(summaryRequest(reply)))
  } catch (error) {
    return { state: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

// The summary of a reply that may sit in scrollback: log rows, since a redraw does not
// reach it. A log row is one line, so the summary's lines share one.
function logSummary($: EngineInterface, summary: Settled): void {
  if (summary.state === 'failed') {
    $.ui.log(`TLDR failed: ${summary.reason}`)
    return
  }
  $.ui.log('TLDR · previous reply')
  $.ui.log(summary.text.split('\n').join(' '))
}

// The keywords' work on a reply, which no hook waits for: the summary, then the reading,
// which speaks the summary once it is ready and the reply otherwise. A reply's row takes
// its summary as a fold; without a row the summary goes to the transcript as log rows.
async function readReply($: EngineInterface, marks: readonly Mark[], text: string, reading: number | undefined, row?: string): Promise<void> {
  let spoken = text
  if (marks.includes('tldr')) {
    const summary = await summarize($, text)
    if (row !== undefined) await update($, memberOf(tldrAtom, member(row)), () => summary)
    else logSummary($, summary)
    if (summary.state === 'ready') spoken = summary.text
  }
  if (reading !== undefined) await readAloud($, reading, spoken)
}

// The keywords a prompt can hold: `speak` counts only while speech is on.
const counting = async ($: EngineInterface): Promise<readonly Mark[]> =>
  (await read($, speakAtom)) ? MARKS : ['tldr']

const detach = ($: EngineInterface, work: Promise<void>) => {
  void work.catch(error => $.ui.log(`lucid reading: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' }))
}

// A main-loop turn takes the marks of the prompt that started it.
async function startReading($: EngineInterface, turnId: string): Promise<void> {
  await update($, readingTurnAtom, () => turnId)
  const pending = await read($, pendingMarksAtom)
  if (pending.length === 0) return
  await update($, memberOf(marksAtom, member(turnId)), previous => joined(previous, pending))
  await update($, pendingMarksAtom, () => [])
}

// Each main-loop row that holds text is the last reply; in a marked turn it is also the
// turn's final reply until another follows.
async function recordReply($: EngineInterface, uuid: string, content: Content): Promise<void> {
  const text = textOf(content)
  if (text.trim() === '') return
  await update($, lastReplyAtom, () => ({ uuid, text }))
  const turnId = await read($, readingTurnAtom)
  if (turnId !== '' && (await read($, memberOf(marksAtom, member(turnId)))).length > 0) {
    await update($, memberOf(turnReplyAtom, member(turnId)), () => uuid)
  }
}

// A main-loop turn's end runs its marks on its final reply, when the turn answered.
async function finishTurn($: EngineInterface, turnId: string, reason: string, answer: string): Promise<void> {
  if ((await read($, readingTurnAtom)) === turnId) await update($, readingTurnAtom, () => '')
  const marking = memberOf(marksAtom, member(turnId))
  const marks = await read($, marking)
  if (marks.length === 0) return
  await update($, marking, () => [])
  const row = await read($, memberOf(turnReplyAtom, member(turnId)))
  if (reason !== 'answer' || row === '') return
  const last = await read($, lastReplyAtom)
  const text = answer.trim() !== '' ? answer : last.uuid === row ? last.text : ''
  if (text.trim() === '') return
  const reading = marks.includes('speak') ? await claimReading($) : undefined
  if (marks.includes('tldr')) await update($, memberOf(tldrAtom, member(row)), (): Summary => ({ state: 'pending' }))
  detach($, readReply($, marks, text, reading, row))
}

// Unsupported tools and nonterminal surfaces keep their native or skins rendering.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lucid',
      description: 'lucid settings: /lucid usage above|below, /lucid density full|balanced|compact|blackbox, /lucid speak on|off, /lucid voice <name>, /lucid diagrams on|off',
      argumentHint: 'usage above|below | density full|balanced|compact|blackbox | speak on|off | voice <name> | diagrams on|off',
    })
    await loadSettings($)
    await locateDiagrams($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state to its defaults and skip session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadSettings($)
    return next(e)
  })

  on('command.run', { command: 'lucid' }, async ($, e) => {
    const setting = e.args.trim().toLowerCase().split(/\s+/)[0]
    if (setting === 'density') {
      const result = densityCommand(e.args, await read($, densityAtom))
      if (result.density !== undefined) {
        const density = result.density
        await $.store.set('density', density)
        await update($, densityAtom, () => density)
      }
      return { text: result.text }
    }
    if (setting === 'speak') {
      const result = speakCommand(e.args, await read($, speakAtom))
      if (result.speak !== undefined) {
        const speak = result.speak
        await $.store.set('speak', speak ? 'on' : 'off')
        await update($, speakAtom, () => speak)
      }
      return { text: result.text }
    }
    if (setting === 'voice') {
      const result = voiceCommand(e.args, await read($, voiceAtom))
      if (result.voice !== undefined) {
        const voice = result.voice
        await $.store.set('voice', voice)
        await update($, voiceAtom, () => voice)
      }
      return { text: result.text }
    }
    if (setting === 'diagrams') {
      const result = diagramsCommand(e.args, await read($, diagramsAtom))
      if (result.diagrams !== undefined) {
        const diagrams = result.diagrams
        await $.store.set('diagrams', diagrams ? 'on' : 'off')
        await update($, diagramsAtom, () => diagrams)
      }
      return { text: result.text }
    }
    if (setting !== 'usage') return { text: LUCID_HELP }
    const result = usageCommand(e.args, await read($, usageAtom))
    if (result.placement !== undefined) {
      const placement = result.placement
      await $.store.set('usage', placement)
      await update($, usageAtom, () => placement)
      await refreshMeters($)
    }
    return { text: result.text }
  })

  // A turn's end and a plan limit's move are when the numbers change.
  on('session.measure', async ($, e, next) => {
    await refreshMeters($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refreshMeters($)
      await finishTurn($, e.turnId, e.reason, e.answer)
      if ((await read($, liveTurnAtom)) === e.turnId) {
        const turn = memberOf(turnAtom, member(e.turnId))
        if (e.isAborted) {
          for (const id of (await read($, turn)).blocks.flatMap(block => block.ids)) {
            await update($, memberOf(callAtom, member(id)), (call): CallRecord => call.status === 'running'
              ? { ...call, status: 'interrupted', error: 'Interrupted' }
              : call)
          }
        }
        const now = await $.clock.now()
        await update($, turn, record => endTurn(record, now, e.isAborted))
        await update($, liveTurnAtom, () => '')
      }
    }
    return next(e)
  })

  // At the blackbox level each main-loop turn is recorded: its calls in order, in blocks that
  // Claude's text ends. Every turn takes the reading keywords' marks.
  on('turn.start', async ($, e, next) => {
    const recording = (await read($, densityAtom)) === 'blackbox'
    await update($, liveTurnAtom, () => (recording ? e.turnId : ''))
    await startReading($, e.turnId)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && (e.door === 'response' || e.door === 'tool-result')) {
      const turnId = await read($, liveTurnAtom)
      if (turnId !== '') await recordRow($, turnId, e.door, e.message.content)
      if (e.door === 'response') {
        await recordReply($, e.uuid, e.message.content)
        if (await read($, diagramsAtom)) watchReply($, textOf(e.message.content))
      }
    }
    return stored
  })

  // While diagrams are on, a terminal session's system prompt asks Claude to draw them.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.surfaces.includes('terminal') || e.traits.includes('print') || e.traits.includes('bare') || !(await read($, diagramsAtom))) return composed
    return { sections: [...composed.sections, { id: 'lucid:diagrams', text: DIAGRAM_HINT, scope: 'session' as const }] }
  })

  // A recorded call's result, as its own row would draw it; the result itself passes unchanged.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || (await read($, memberOf(ownerAtom, member(e.tool_use_id)))) === '') return result
    if (result.deny !== undefined) await settle($, e.tool_use_id, 'failed', result.deny, failureLine(e.tool, result.deny), result.deny)
    else if (result.isError) {
      const text = result.text ?? (typeof result.result === 'string' ? result.result : '')
      await settle($, e.tool_use_id, 'failed', text, failureLine(e.tool, text, result.result), text)
    } else {
      const interrupted = e.tool === 'Bash' && (result.result as { interrupted?: unknown } | undefined)?.interrupted === true
      const background = e.tool === 'Bash' ? backgroundOf(result.result) : undefined
      await settle($, e.tool_use_id, interrupted ? 'interrupted' : 'ok', result.text ?? '', interrupted ? 'Interrupted' : undefined, result.result, background)
    }
    return result
  })

  // With the meters below the prompt, skins' band above it draws nothing; a survey keeps it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, usageAtom)) !== 'below') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // With the meters below the prompt, they take a line above the hint line, which stays.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const theirs = await next(e)
    const meters = await read($, metersAtom)
    if ((await read($, usageAtom)) !== 'below' || meters.length === 0) return theirs
    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {drawMeters(ui, meters)}
        {theirs}
      </Box>
    )
  })

  // A terminal reply: its tables wrap, its long fences draw in colour, its diagram fences
  // draw as diagrams, and a reply a `tldr` marked takes its summary beneath. Elsewhere only
  // the diagram fences change.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return drawElsewhere($, e, next)
    const summary = await read($, memberOf(tldrAtom, e))
    if (summary.state === 'none') return drawUsual($, e, () => next(e))
    const ui = $.ui.resolve(e)
    const reply = await drawUsual($, e, () => next(e))
    if (summary.state === 'pending') return drawTldrNote(ui, 'Summarizing…', reply)
    if (summary.state === 'failed') return drawTldrNote(ui, `TLDR failed: ${summary.reason}`, reply)
    return drawTldr(ui, summary.text, reply)
  })

  // A counting keyword lights up as it is typed, one rainbow colour a letter.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const { ranges } = readKeywords(box.text, await counting($))
    return ranges.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...keywordDecorations(ranges)] }
  })

  // The reading keywords leave the user's prompt before Claude reads it, and mark the turn
  // it starts. A prompt of keywords alone acts on the previous reply and starts no turn.
  // Every prompt the user sends stops a reading after the sentence it is speaking.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    await claimReading($)
    const { marks, rest } = readKeywords(e.text, await counting($))
    if (marks.length === 0) return next(e)
    if (rest === '') {
      const last = await read($, lastReplyAtom)
      if (last.uuid === '') return { drop: 'No reply yet' }
      const reading = marks.includes('speak') ? await claimReading($) : undefined
      detach($, readReply($, marks, last.text, reading))
      return { drop: dropReason(marks) }
    }
    if (e.turnId !== undefined) {
      await update($, memberOf(marksAtom, member(e.turnId)), previous => joined(previous, marks))
      return next({ ...e, text: rest })
    }
    // The turn this prompt starts begins before `next` resolves, so its marks wait first.
    await update($, pendingMarksAtom, () => marks)
    const entered = await next({ ...e, text: rest })
    if (entered.drop !== undefined) await update($, pendingMarksAtom, () => [])
    return entered
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const start = await $.clock.now()
    try {
      return await next(e)
    } finally {
      const elapsed = (await $.clock.now()) - start
      await update($, memberOf(durationAtom, { requestId: e.tool_use_id }), () => elapsed)
    }
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const forced = { ...e, props: { ...e.props, isExpanded: true } }
    const level = await read($, densityAtom)
    // A recorded turn's group draws its blocks whatever its tools: one of only MCP or Agent
    // calls can hold a block's first call.
    if (level === 'blackbox') {
      // A question keeps its own row: the group draws forced open, and each row decides.
      if (e.props.calls.some(call => isQuestion(call.tool))) return next(forced)
      const ids = e.props.calls.map(call => call.tool_use_id ?? '')
      if (!ids.includes('')) {
        const owners = await Promise.all(ids.map(id => read($, memberOf(ownerAtom, member(id)))))
        const owner = owners.find(found => found !== '') ?? ''
        const turnId = owner === '' && e.props.isActive ? await read($, liveTurnAtom) : owner
        if (turnId !== '') {
          const turn = await read($, memberOf(turnAtom, member(turnId)))
          // Each call's block, by its first call. A call still streaming in joins the open block,
          // or the group's first such call opens the next one.
          const fresh = openBlock(turn)?.ids[0] ?? ids.find((_, index) => owners[index] === '')
          const anchors = ids.map((id, index) => (owners[index] === '' ? fresh : anchorOf(turn, id)))
          if (anchors.every(anchor => anchor !== undefined)) {
            const cwd = await $.session.cwd()
            const shown = await Promise.all(e.props.calls.map((call, index) => canShow($, ids[index]!, call, cwd)))
            // A result the block cannot show keeps its row: each row of the open group decides.
            if (shown.includes(false)) return next(forced)
            // The group draws each block whose first call it holds, in turn order.
            const drawn = [...new Set(anchors)].filter(anchor => ids.includes(anchor))
            const { Box } = $.ui.resolve(e)
            if (drawn.length === 0) return <Box />
            const blocks = await Promise.all(drawn.map(anchor => drawTurnBlock($, e, turnId, anchor,
              e.props.calls.filter((_, index) => owners[index] === '' && anchors[index] === anchor))))
            if (blocks.length === 1) return blocks[0]!
            return (
              <Box flexDirection="column" width="100%">
                {blocks.map((block, index) => <Box key={`turn-block-${drawn[index]}`} flexDirection="column" width="100%">{block}</Box>)}
              </Box>
            )
          }
        }
      }
    }
    if (!e.props.calls.some(call => CARD_TOOLS[call.tool] === true)) return next(e)
    // Calls of a turn the level did not record draw as compact draws them.
    const density = level === 'blackbox' ? 'compact' : level
    if (density === 'full') return next(forced)
    const group = groupOf(e.props.calls, await $.session.cwd())
    if (group === null) return next(forced)

    // Show all marks each call, so its own row draws the full level's card.
    const mark = (value: boolean) => () => {
      void Promise.all(group.ids.map(requestId => update($, memberOf(ungroupedAtom, { requestId }), () => value)))
    }
    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    if ((await Promise.all(group.ids.map(requestId => read($, memberOf(ungroupedAtom, { requestId }))))).some(Boolean)) {
      return (
        <Box flexDirection="column" width="100%">
          {await next(forced)}
          <Button key="merge-group" label="Collapse" onPress={mark(false)} plain />
        </Box>
      )
    }
    const opening = memberOf(openedAtom, e)
    const opened = density === 'compact' && await read($, opening)
    return drawGroup(ui, group, { density, opened, toggleOpen: () => {
      void update($, opening, previous => !previous)
    } }, mark(true))
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const level = await read($, densityAtom)
    // A question keeps its own row, asked or answered, and joins no block.
    if (level === 'blackbox' && !isQuestion(e.props.tool)) {
      const id = e.props.tool_use_id
      const pending = isPending(e.props)
      const owner = await read($, memberOf(ownerAtom, member(id)))
      const turnId = owner === '' && pending ? await read($, liveTurnAtom) : owner
      if (turnId !== '') {
        const turn = await read($, memberOf(turnAtom, member(turnId)))
        // A call still streaming in joins the open block, or opens the next one.
        const anchor = owner === '' ? openBlock(turn)?.ids[0] ?? id : anchorOf(turn, id)
        if (anchor !== undefined) {
          const shown = await canShow($, id, e.props, await $.session.cwd())
          if (anchor !== id) {
            if (!shown) return next(e)
            const { Box } = $.ui.resolve(e)
            return <Box />
          }
          const block = await drawTurnBlock($, e, turnId, anchor, owner === '' ? [e.props] : [])
          if (shown) return block
          const { Box } = $.ui.resolve(e)
          return (
            <Box flexDirection="column" width="100%">
              {block}
              {await next(e)}
            </Box>
          )
        }
      }
    }
    const isEdit = EDIT_TOOLS.has(e.props.tool)
    if (!isEdit && CARD_TOOLS[e.props.tool] !== true) return next(e)
    const cwd = await $.session.cwd()
    // Calls of a turn the level did not record draw as compact draws them.
    const density = level === 'blackbox' ? 'compact' : level
    if (isEdit) {
      const block = blockOf(e.props, cwd, density)
      if (density === 'full') return drawBlock($.ui.resolve(e), block)
      const opening = memberOf(expandedAtom, e)
      const opened = density === 'compact' && await read($, opening)
      return drawBlock($.ui.resolve(e), block, { density, opened, toggleOpen: () => {
        void update($, opening, previous => !previous)
      } })
    }

    const card = cardOf(e.props, cwd)
    if (card === null) return next(e)
    const expansion = memberOf(expandedAtom, e)
    const expanded = await read($, expansion)
    const duration = e.props.tool === 'Bash' ? await read($, memberOf(durationAtom, e)) : -1
    const toggle = () => {
      void update($, expansion, previous => !previous)
    }
    // A call of a merged group the user split apart draws as the full level draws it.
    if (density === 'full' || await read($, memberOf(ungroupedAtom, e))) return drawCard($.ui.resolve(e), card, expanded, toggle, duration)
    const opening = memberOf(openedAtom, e)
    const opened = density === 'compact' && await read($, opening)
    return drawCard($.ui.resolve(e), card, expanded, toggle, duration, { density, opened, toggleOpen: () => {
      void update($, opening, previous => !previous)
    } })
  })

  // Hide a separate result only when the tool card can display its full payload.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if ((await read($, densityAtom)) === 'blackbox' && (await read($, memberOf(ownerAtom, member(e.props.tool_use_id)))) !== '') {
      const props = { ...e.props, input: {}, isRunning: false, isInterrupted: false }
      if (!(await canShow($, e.props.tool_use_id, props, await $.session.cwd()))) return next(e)
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    if (!EDIT_TOOLS.has(e.props.tool)) {
      if (CARD_TOOLS[e.props.tool] !== true) return next(e)
      const card = cardOf({
        ...e.props, input: {}, isRunning: false, isInterrupted: false,
      }, await $.session.cwd())
      if (card === null) return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}
