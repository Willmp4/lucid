import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Density, UsageMeter, UsagePlacement } from '../types'
import { EDIT_TOOLS, blockOf, drawBlock } from './block'
import { densityCommand, densityOf } from './density'
import { drawGroup, groupOf } from './group-card'
import { drawReply, hasTable, replyColumns } from './reply'
import { splitReply } from './reply-table'
import { CARD_TOOLS, cardOf, drawCard } from './tool-card'
import { metersOf, placementOf, usageCommand } from './usage'
import { drawMeters } from './usage-line'

const OMP_HELP = 'usage: /omp usage above|below, or /omp density full|balanced|compact'

const expandedAtom = atom({ plugin: 'omp-blocks', key: 'expanded' } as const, false)
const durationAtom = atom({ plugin: 'omp-blocks', key: 'duration' } as const, -1)
const usageAtom = atom({ plugin: 'omp-blocks', key: 'usage' } as const, 'above' as UsagePlacement)
const densityAtom = atom({ plugin: 'omp-blocks', key: 'density' } as const, 'balanced' as Density)
const openedAtom = atom({ plugin: 'omp-blocks', key: 'opened' } as const, false)
const ungroupedAtom = atom({ plugin: 'omp-blocks', key: 'ungrouped' } as const, false)
const metersAtom = atom({ plugin: 'omp-blocks', key: 'meters' } as const, [] as UsageMeter[])

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

// Unsupported tools and nonterminal surfaces keep their native or skins rendering.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'omp',
      description: 'omp-blocks settings: /omp usage above|below, /omp density full|balanced|compact',
      argumentHint: 'usage above|below | density full|balanced|compact',
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
    const forced = { ...e, props: { ...e.props, isExpanded: true } }
    const density = await read($, densityAtom)
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
    const isEdit = EDIT_TOOLS.has(e.props.tool)
    if (!isEdit && CARD_TOOLS[e.props.tool] !== true) return next(e)
    const cwd = await $.session.cwd()
    const density = await read($, densityAtom)
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
