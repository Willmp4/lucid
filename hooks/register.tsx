import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { EDIT_TOOLS, blockOf, drawBlock } from './block'
import { CARD_TOOLS, cardOf, drawCard } from './tool-card'

const expandedAtom = atom({ plugin: 'omp-blocks', key: 'expanded' } as const, false)
const durationAtom = atom({ plugin: 'omp-blocks', key: 'duration' } as const, -1)

// Unsupported tools and nonterminal surfaces keep their native or skins rendering.
export const register: Register = on => {
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
