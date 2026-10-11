import type { ElementTable } from 'claude-code'
import { COLORS } from './block'
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
  const visible = []
  let hidden = 0
  let gutter = 0
  for (const [index, row] of card.rows.entries()) {
    const folds = !card.failed && index >= PREVIEW_ROWS && row.kind !== 'error'
    if (folds) hidden++
    if (!folds || expanded) {
      visible.push({ row, index })
      if (row.number !== undefined) gutter = Math.max(gutter, String(row.number).length)
    }
  }

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={card.failed ? COLORS.borderErr : COLORS.border} paddingX={1}>
      <Text color={COLORS.name} bold wrap="wrap">{card.title}</Text>
      {card.summary || durationMs >= 0 ? (
        <Text color={COLORS.muted} wrap="wrap">
          {card.summary ?? ''}{durationMs >= 0 ? `${card.summary ? ' · ' : ''}${(durationMs / 1000).toFixed(1)}s` : ''}
        </Text>
      ) : null}
      {visible.map(({ row, index }) => (
        <Box key={`row-${index}`} flexDirection="row" width="100%">
          {row.number === undefined ? null : (
            <Box width={gutter + 2} flexShrink={0}><Text color={COLORS.dim}>{String(row.number).padStart(gutter)}</Text></Box>
          )}
          <Box flexGrow={1}>
            <Text color={row.kind === 'error' ? COLORS.del : row.kind === 'muted' ? COLORS.muted : COLORS.path} bold={row.kind === 'heading'} wrap="wrap">{row.text === '' ? ' ' : row.text}</Text>
          </Box>
        </Box>
      ))}
      {hidden > 0 ? (
        <Button key="expand-output" label={expanded ? 'Collapse' : `Show all (${hidden} more rows)`} onPress={toggle} plain />
      ) : null}
    </Box>
  )
}
