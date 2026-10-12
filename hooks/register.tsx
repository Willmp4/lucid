import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { CallBody, CallRecord, CallStatus, Density, TurnRecord, UsageMeter, UsagePlacement } from '../types'
import { EDIT_TOOLS, blockOf, drawBlock } from './block'
import type { CallProps } from './block'
import { densityCommand, densityOf } from './density'
import { drawGroup, groupOf } from './group-card'
import { drawReply, hasTable, replyColumns } from './reply'
import { splitReply } from './reply-table'
import { CARD_TOOLS, cardOf, drawCard } from './tool-card'
import { drawTurn, genericCard } from './turn-block'
import { anchorOf, callLabel, firstErrorLine, isInBetween, recordInput, responseItems, resultsOf } from './turn-model'
import { metersOf, placementOf, usageCommand } from './usage'
import { drawMeters } from './usage-line'

const OMP_HELP = 'usage: /omp usage above|below, or /omp density full|balanced|compact|blackbox'

const expandedAtom = atom({ plugin: 'omp-blocks', key: 'expanded' } as const, false)
const durationAtom = atom({ plugin: 'omp-blocks', key: 'duration' } as const, -1)
const usageAtom = atom({ plugin: 'omp-blocks', key: 'usage' } as const, 'above' as UsagePlacement)
const densityAtom = atom({ plugin: 'omp-blocks', key: 'density' } as const, 'balanced' as Density)
const openedAtom = atom({ plugin: 'omp-blocks', key: 'opened' } as const, false)
const ungroupedAtom = atom({ plugin: 'omp-blocks', key: 'ungrouped' } as const, false)
const metersAtom = atom({ plugin: 'omp-blocks', key: 'meters' } as const, [] as UsageMeter[])
// The blackbox level's record of each turn: the turn running, each turn's text and calls,
// which turn a row belongs to, each call's outcome, and which blocks are open.
const liveTurnAtom = atom({ plugin: 'omp-blocks', key: 'liveTurn' } as const, '')
const turnAtom = atom({ plugin: 'omp-blocks', key: 'turn' } as const, { items: [] } as TurnRecord)
const ownerAtom = atom({ plugin: 'omp-blocks', key: 'owner' } as const, '')
const callAtom = atom({ plugin: 'omp-blocks', key: 'call' } as const, { tool: '', input: {}, status: 'running' } as CallRecord)
const bodyAtom = atom({ plugin: 'omp-blocks', key: 'body' } as const, { input: {} } as CallBody)
const unfoldedAtom = atom({ plugin: 'omp-blocks', key: 'unfolded' } as const, false)

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
  await update($, usageAtom, () => stored)
  await update($, densityAtom, () => density)
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
async function settle($: EngineInterface, id: string, status: CallStatus, text: string, error?: string, output?: unknown): Promise<void> {
  await update($, memberOf(callAtom, member(id)), call => RANK[status] < RANK[call.status] ? call : {
    ...call, status, ...(error === undefined ? {} : { error }),
  })
  await update($, memberOf(bodyAtom, member(id)), body => ({
    ...body,
    ...(output !== undefined ? { output } : body.output === undefined && status !== 'ok' ? { output: text } : {}),
    ...(text !== '' || body.text === undefined ? { text } : {}),
  }))
}

type Content = { type: string; [field: string]: unknown }[]

// A main-loop row of the turn running: the turn's items first, then whose rows they are.
async function recordRow($: EngineInterface, turnId: string, door: string, uuid: string, content: Content): Promise<void> {
  if (door === 'tool-result') {
    for (const result of resultsOf(content)) {
      if ((await read($, memberOf(ownerAtom, member(result.id)))) === turnId) await settle($, result.id, result.status, result.text, result.error)
    }
    return
  }
  const { items, calls } = responseItems(uuid, content)
  if (items.length === 0) return
  for (const call of calls) {
    await update($, memberOf(callAtom, member(call.id)), () => call.record)
    await update($, memberOf(bodyAtom, member(call.id)), () => call.body)
  }
  await update($, memberOf(turnAtom, member(turnId)), turn => ({
    ...turn, items: [...turn.items, ...items.filter(item => !turn.items.some(seen => seen.id === item.id))],
  }))
  for (const item of items) await update($, memberOf(ownerAtom, member(item.id)), () => turnId)
}

const isPending = (props: CallProps) => props.output === undefined && !props.isErrored && !props.isInterrupted

// Whether the block can show a call's result in place of its own row: a card formats it, or
// it is text.
async function canShow($: EngineInterface, id: string, props: CallProps, cwd: string): Promise<boolean> {
  if (EDIT_TOOLS.has(props.tool)) return true
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

// One call of an open block: its compact card, keyed apart from the others.
async function drawCall($: EngineInterface, e: RenderInput<'ToolUse' | 'ToolGroup', 'terminal'>, id: string, cwd: string) {
  const ui = $.ui.resolve(e)
  const record = await read($, memberOf(callAtom, member(id)))
  const body = await read($, memberOf(bodyAtom, member(id)))
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

// The block a turn draws at its first call. `provisional` holds calls a live turn has not
// recorded yet, while their input streams in.
async function drawTurnBlock($: EngineInterface, e: RenderInput<'ToolUse' | 'ToolGroup', 'terminal'>, turnId: string, provisional: readonly CallProps[] = []) {
  const ui = $.ui.resolve(e)
  const cwd = await $.session.cwd()
  const turn = await read($, memberOf(turnAtom, member(turnId)))
  const ids = turn.items.flatMap(item => (item.kind === 'call' ? [item.id] : []))
  const calls = await Promise.all(ids.map(async id => ({ id, record: await read($, memberOf(callAtom, member(id))) })))
  provisional.forEach((props, index) => calls.push({
    id: `pending-${index}`, record: { tool: props.tool, input: recordInput(props.input), status: 'running' },
  }))
  const live = (await read($, liveTurnAtom)) === turnId
  const running = live ? calls.filter(call => call.record.status === 'running').at(-1) : undefined
  const unfolding = memberOf(unfoldedAtom, member(turnId))
  const unfolded = await read($, unfolding)
  const entries: RenderElement[] = []
  if (unfolded) {
    const { Box, Markdown } = ui
    const columns = Math.max(20, replyColumns(e.viewport?.columns ?? 100) - 4)
    for (const item of turn.items) {
      if (item.kind === 'call') {
        entries.push(<Box key={`call-${item.id}`} flexDirection="column" width="100%">{await drawCall($, e, item.id, cwd)}</Box>)
      } else if (isInBetween(turn, item.id)) {
        const drawn = await skinsMarkdown($, item.text, columns)
        entries.push(<Box key={`text-${item.id}`} flexDirection="column" width="100%">{drawn ?? <Markdown text={item.text} />}</Box>)
      }
    }
  }
  return drawTurn(ui, {
    calls,
    durationMs: turn.durationMs,
    running: running === undefined ? undefined : callLabel(running.record, cwd),
    unfolded,
    toggle: () => {
      void update($, unfolding, previous => !previous)
    },
    entries,
  }, cwd)
}

// Unsupported tools and nonterminal surfaces keep their native or skins rendering.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'omp',
      description: 'omp-blocks settings: /omp usage above|below, /omp density full|balanced|compact|blackbox',
      argumentHint: 'usage above|below | density full|balanced|compact|blackbox',
    })
    await loadSettings($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state to its defaults and skip session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadSettings($)
    return next(e)
  })

  on('command.run', { command: 'omp' }, async ($, e) => {
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
    if (setting !== 'usage') return { text: OMP_HELP }
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
      if ((await read($, liveTurnAtom)) === e.turnId) {
        const turn = memberOf(turnAtom, member(e.turnId))
        if (e.isAborted) {
          for (const item of (await read($, turn)).items) {
            if (item.kind !== 'call') continue
            await update($, memberOf(callAtom, member(item.id)), (call): CallRecord => call.status === 'running'
              ? { ...call, status: 'interrupted', error: 'Interrupted' }
              : call)
          }
        }
        await update($, turn, record => ({ ...record, durationMs: e.durationMs }))
        await update($, liveTurnAtom, () => '')
      }
    }
    return next(e)
  })

  // At the blackbox level each main-loop turn is recorded: its text rows and calls in order.
  on('turn.start', async ($, e, next) => {
    const recording = (await read($, densityAtom)) === 'blackbox'
    await update($, liveTurnAtom, () => (recording ? e.turnId : ''))
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && (e.door === 'response' || e.door === 'tool-result')) {
      const turnId = await read($, liveTurnAtom)
      if (turnId !== '') await recordRow($, turnId, e.door, e.uuid, e.message.content)
    }
    return stored
  })

  // A recorded call's result, as its own row would draw it; the result itself passes unchanged.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || (await read($, memberOf(ownerAtom, member(e.tool_use_id)))) === '') return result
    if (result.deny !== undefined) await settle($, e.tool_use_id, 'failed', result.deny, firstErrorLine(result.deny), result.deny)
    else if (result.isError) {
      const text = result.text ?? (typeof result.result === 'string' ? result.result : '')
      await settle($, e.tool_use_id, 'failed', text, firstErrorLine(text), text)
    } else {
      const interrupted = e.tool === 'Bash' && (result.result as { interrupted?: unknown } | undefined)?.interrupted === true
      await settle($, e.tool_use_id, interrupted ? 'interrupted' : 'ok', result.text ?? '', interrupted ? 'Interrupted' : undefined, result.result)
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

  // A terminal reply holding a table: its tables wrap, its other text stays skins'.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // At blackbox, text that a later call of its turn follows draws inside the block.
    if ((await read($, densityAtom)) === 'blackbox') {
      const turnId = await read($, memberOf(ownerAtom, e))
      if (turnId !== '' && isInBetween(await read($, memberOf(turnAtom, member(turnId))), e.requestId)) {
        const { Box } = $.ui.resolve(e)
        return <Box />
      }
    }
    const segments = splitReply(e.props.text)
    if (!hasTable(segments)) return next(e)
    const columns = replyColumns(e.viewport?.columns ?? 100)
    const drawn: (RenderElement | undefined)[] = []
    for (const segment of segments) drawn.push(segment.kind === 'text' ? await skinsMarkdown($, segment.text, columns) : undefined)
    return drawReply($.ui.resolve(e), segments, columns, drawn)
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
    if (e.surface !== 'terminal' || !e.props.calls.some(call => CARD_TOOLS[call.tool] === true)) return next(e)
    const forced = { ...e, props: { ...e.props, isExpanded: true } }
    const level = await read($, densityAtom)
    if (level === 'blackbox') {
      const ids = e.props.calls.map(call => call.tool_use_id ?? '')
      if (!ids.includes('')) {
        const owners = await Promise.all(ids.map(id => read($, memberOf(ownerAtom, member(id)))))
        const owner = owners.find(found => found !== '') ?? ''
        const turnId = owner === '' && e.props.isActive ? await read($, liveTurnAtom) : owner
        if (turnId !== '') {
          const anchor = anchorOf(await read($, memberOf(turnAtom, member(turnId)))) ?? (e.props.isActive ? ids[0] : undefined)
          if (anchor !== undefined) {
            const cwd = await $.session.cwd()
            const shown = await Promise.all(e.props.calls.map((call, index) => canShow($, ids[index]!, call, cwd)))
            // A result the block cannot show keeps its row: each row of the open group decides.
            if (shown.includes(false)) return next(forced)
            if (!ids.includes(anchor)) {
              const { Box } = $.ui.resolve(e)
              return <Box />
            }
            return drawTurnBlock($, e, turnId, e.props.calls.filter((_, index) => owners[index] === ''))
          }
        }
      }
    }
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
    if (level === 'blackbox') {
      const id = e.props.tool_use_id
      const pending = isPending(e.props)
      const owner = await read($, memberOf(ownerAtom, member(id)))
      const turnId = owner === '' && pending ? await read($, liveTurnAtom) : owner
      if (turnId !== '') {
        const anchor = anchorOf(await read($, memberOf(turnAtom, member(turnId)))) ?? (pending ? id : undefined)
        if (anchor !== undefined) {
          const shown = await canShow($, id, e.props, await $.session.cwd())
          if (anchor !== id) {
            if (!shown) return next(e)
            const { Box } = $.ui.resolve(e)
            return <Box />
          }
          const block = await drawTurnBlock($, e, turnId, owner === '' ? [e.props] : [])
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
