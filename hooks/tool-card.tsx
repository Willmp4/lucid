import type { ElementTable } from 'claude-code'
import { COLORS, drawInline, drawWithinLimit } from './text-style'
import type { CallProps } from './block'
import type { CardContent } from './card-model'
import { formatBash } from './bash-card'
import { formatFileTool } from './file-cards'

export const CARD_TOOLS: Readonly<Record<string, true>> = { Bash: true, Read: true, Grep: true, Glob: true }
const PREVIEW_ROWS = 16

export function cardOf(props: CallProps, cwd: string): CardContent | null {
  return props.tool === 'Bash' ? formatBash(props, cwd) : formatFileTool(props, cwd)
}

export function drawCard(ui: ElementTable<'terminal'>, card: CardContent, expanded: boolean, toggle: () => void, durationMs: number) {
  const { Box, Text, Button } = ui
  const colon = card.title.indexOf(':')
  const labelEnd = colon === -1 ? card.title.length : colon
  const label = card.title.slice(0, labelEnd)
  const detailStart = labelEnd === card.title.length ? labelEnd : labelEnd + 2
  const visible = []
  let hidden = 0
  let gutter = 0
  let textLength = card.title.length + (card.summary?.length ?? 0)
  for (const [index, row] of card.rows.entries()) {
    const folds = !card.failed && index >= PREVIEW_ROWS && row.kind !== 'error'
    if (folds) hidden++
    if (!folds || expanded) {
      visible.push({ row, index })
      textLength += row.text.length
      if (row.number !== undefined) gutter = Math.max(gutter, String(row.number).length)
    }
  }
  const expansion = hidden > 0
    ? <Button key="expand-output" label={expanded ? 'Collapse' : `Show all (${hidden} more rows)`} onPress={toggle} plain />
    : null

  return drawWithinLimit(inlineBudget => {
    const semanticHeader = inlineBudget.remaining > 3
    if (semanticHeader) inlineBudget.remaining -= 3
    return (
      <Box flexDirection="column" width="100%" borderStyle="round" borderColor={card.failed ? COLORS.borderErr : COLORS.border} paddingX={1}>
        {semanticHeader ? (
          <Text color={COLORS.output} wrap="wrap">
            <Text color={COLORS.name} bold>{label}</Text>
            <Text color={COLORS.muted}>{card.title.slice(labelEnd, detailStart)}</Text>
            {card.titlePathStart === undefined
              ? label === 'Bash' ? drawInline(ui, card.title.slice(detailStart), 'command', inlineBudget) : card.title.slice(detailStart)
              : [
                card.title.slice(detailStart, card.titlePathStart),
                <Text key="title-path" color={COLORS.path}>{card.title.slice(card.titlePathStart)}</Text>,
              ]}
          </Text>
        ) : <Text color={COLORS.name} bold wrap="wrap">{card.title}</Text>}
        {card.summary || durationMs >= 0 ? (
          <Text color={card.failed ? COLORS.del : COLORS.muted} wrap="wrap">
            {card.failed ? card.summary ?? '' : drawInline(ui, card.summary ?? '', 'output', inlineBudget)}
            {durationMs >= 0 ? `${card.summary ? ' · ' : ''}${(durationMs / 1000).toFixed(1)}s` : ''}
          </Text>
        ) : null}
        {visible.map(({ row, index }) => {
          const failed = card.failed || row.kind === 'error'
          const pathRow = row.kind === 'path' || row.kind === 'heading'
          const pathRange = row.pathStart !== undefined || row.pathEnd !== undefined
          const shown = row.text === '' ? ' ' : row.text
          const color = failed ? COLORS.del : pathRow ? COLORS.path : row.kind === 'muted' || pathRange ? COLORS.muted : COLORS.output
          let content = failed || pathRow || pathRange ? shown : drawInline(ui, shown, 'output', inlineBudget)
          if (!failed && pathRange && inlineBudget.remaining > 0) {
            const start = row.pathStart ?? 0
            const end = row.pathEnd ?? row.text.length
            content = [
              row.text.slice(0, start),
              <Text key="row-path" color={COLORS.path}>{row.text.slice(start, end)}</Text>,
              row.text.slice(end),
            ]
            inlineBudget.remaining--
          }
          return (
            <Box key={`row-${index}`} flexDirection="row" width="100%">
              {row.number === undefined ? null : (
                <Box width={gutter + 2} flexShrink={0}><Text color={COLORS.dim}>{String(row.number).padStart(gutter)}</Text></Box>
              )}
              <Box flexGrow={1}>
                <Text color={color} bold={row.kind === 'heading'} wrap="wrap">{content}</Text>
              </Box>
            </Box>
          )
        })}
        {expansion}
      </Box>
    )
  }, textLength, visible.length)
}
