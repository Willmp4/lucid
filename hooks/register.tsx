import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { UsageMeter, UsagePlacement } from '../types'
import { EDIT_TOOLS, blockOf, drawBlock } from './block'
import { drawReply, hasTable, replyColumns } from './reply'
import { splitReply } from './reply-table'
import { CARD_TOOLS, cardOf, drawCard } from './tool-card'
import { metersOf, placementOf, usageCommand } from './usage'
import { drawMeters } from './usage-line'

const expandedAtom = atom({ plugin: 'omp-blocks', key: 'expanded' } as const, false)
const durationAtom = atom({ plugin: 'omp-blocks', key: 'duration' } as const, -1)
const usageAtom = atom({ plugin: 'omp-blocks', key: 'usage' } as const, 'above' as UsagePlacement)
const metersAtom = atom({ plugin: 'omp-blocks', key: 'meters' } as const, [] as UsageMeter[])

// The same figures keep the same value, so the line under the prompt is not redrawn.
async function refreshMeters($: EngineInterface): Promise<void> {
  const meters = metersOf(await $.session.usage())
  await update($, metersAtom, previous => (JSON.stringify(previous) === JSON.stringify(meters) ? previous : meters))
}

// The stored placement and the current figures, at the start and after a reset.
async function loadUsage($: EngineInterface): Promise<void> {
  const stored = placementOf(await $.store.get('usage'))
  await update($, usageAtom, () => stored)
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

// Unsupported tools and nonterminal surfaces keep their native or skins rendering.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'omp', description: 'omp-blocks settings: /omp usage above|below', argumentHint: 'usage above|below' })
    await loadUsage($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state to its defaults and skip session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadUsage($)
    return next(e)
  })

  on('command.run', { command: 'omp' }, async ($, e) => {
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
    if (e.agentId === undefined) await refreshMeters($)
    return next(e)
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
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const isEdit = EDIT_TOOLS.has(e.props.tool)
    if (!isEdit && CARD_TOOLS[e.props.tool] !== true) return next(e)
    const cwd = await $.session.cwd()
    if (isEdit) return drawBlock($.ui.resolve(e), blockOf(e.props, cwd))

    const card = cardOf(e.props, cwd)
    if (card === null) return next(e)
    const expansion = memberOf(expandedAtom, e)
    const expanded = await read($, expansion)
    const duration = e.props.tool === 'Bash' ? await read($, memberOf(durationAtom, e)) : -1
    return drawCard($.ui.resolve(e), card, expanded, () => {
      void update($, expansion, previous => !previous)
    }, duration)
  })

  // Hide a separate result only when the tool card can display its full payload.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
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
