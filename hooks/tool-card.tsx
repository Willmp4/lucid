import type { ElementTable } from 'claude-code'
import { COLORS, drawInline, drawWithinLimit } from './text-style'
import type { CallProps } from './block'
import type { CardContent, CardRow, CardView } from './card-model'
import { formatBash } from './bash-card'
import { formatFileTool } from './file-cards'

export const CARD_TOOLS: Readonly<Record<string, true>> = { Bash: true, Read: true, Grep: true, Glob: true }
const PREVIEW_ROWS = 16
// Below the full level a shell card keeps the end of its output, where totals and exit status print.
const TAIL_ROWS = 4

export function cardOf(props: CallProps, cwd: string): CardContent | null {
  return props.tool === 'Bash' ? formatBash(props, cwd) : formatFileTool(props, cwd)
}

// Below the full level a failed or interrupted call never folds and draws a red border.
export const isBroken = (card: CardContent) => card.failed === true || card.status === 'interrupted'

const seconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)}s`

// Without a view the card draws at the full level.
export function drawCard(ui: ElementTable<'terminal'>, card: CardContent, expanded: boolean, toggle: () => void, durationMs: number, view?: CardView) {
  const { Box, Text, Button } = ui
  const colon = card.title.indexOf(':')
  const labelEnd = colon === -1 ? card.title.length : colon
  const label = card.title.slice(0, labelEnd)
  const detailStart = labelEnd === card.title.length ? labelEnd : labelEnd + 2
  const shell = label === 'Bash'
  const broken = view === undefined ? card.failed === true : isBroken(card)
  const closed = view?.density === 'compact' && !view.opened && !broken
  // Below the full level a settled shell call's status and duration stand on its header row.
  const marked = view !== undefined && shell && card.status !== undefined
  const summary = marked ? card.detail : card.summary
  const textRows = card.rows.filter(row => row.kind === 'text').length
  const visible: { row: CardRow; index: number }[] = []
  let hidden = 0
  let gutter = 0
  let textSeen = 0
  let textLength = card.title.length + (summary?.length ?? 0)
  for (const [index, row] of card.rows.entries()) {
    let folds: boolean
    if (view === undefined) folds = !card.failed && index >= PREVIEW_ROWS && row.kind !== 'error'
    else if (broken || row.kind === 'error') folds = false
    else if (shell) folds = row.kind === 'text' && textSeen++ < textRows - TAIL_ROWS
    else folds = true
    if (folds) hidden++
    if (!closed && (!folds || expanded)) {
      visible.push({ row, index })
      textLength += row.text.length
      if (row.number !== undefined) gutter = Math.max(gutter, String(row.number).length)
    }
  }
  const expansion = hidden > 0 && !closed
    ? <Button key={`expand-output${view?.keySuffix ?? ''}`} label={expanded ? 'Collapse' : view === undefined ? `Show all (${hidden} more rows)` : `Show all (${card.rows.length} rows)`} onPress={toggle} plain />
    : null
  const control = view?.density === 'compact' && !broken && (summary || card.rows.length > 0) ? (
    <Box flexShrink={0} marginLeft={1}>
      <Button key={`open-card${view.keySuffix ?? ''}`} label={closed ? 'Show ▸' : 'Collapse'} onPress={view.toggleOpen} plain />
    </Box>
  ) : null
  const marker = marked ? (
    <Box flexShrink={0} marginLeft={1}>
      <Text color={card.status === 'ok' ? COLORS.add : COLORS.del}>
        {`${card.status === 'ok' ? '✓' : '✗'}${durationMs >= 0 ? ` ${seconds(durationMs)}` : ''}`}
      </Text>
    </Box>
  ) : null

  return drawWithinLimit(inlineBudget => {
    const semanticHeader = inlineBudget.remaining > 3
    if (semanticHeader) inlineBudget.remaining -= 3
    const wrap = closed ? 'truncate-end' : 'wrap'
    const title = semanticHeader ? (
      <Text color={COLORS.output} wrap={wrap}>
        <Text color={COLORS.name} bold>{label}</Text>
        <Text color={COLORS.muted}>{card.title.slice(labelEnd, detailStart)}</Text>
        {card.titlePathStart === undefined
          ? label === 'Bash' ? drawInline(ui, card.title.slice(detailStart), 'command', inlineBudget) : card.title.slice(detailStart)
          : [
            card.title.slice(detailStart, card.titlePathStart),
            <Text key="title-path" color={COLORS.path}>{card.title.slice(card.titlePathStart)}</Text>,
          ]}
      </Text>
    ) : <Text color={COLORS.name} bold wrap={wrap}>{card.title}</Text>
    let summaryLine = null
    if (view === undefined) {
      if (card.summary || durationMs >= 0) summaryLine = (
        <Text color={card.failed ? COLORS.del : COLORS.muted} wrap="wrap">
          {card.failed ? card.summary ?? '' : drawInline(ui, card.summary ?? '', 'output', inlineBudget)}
          {durationMs >= 0 ? `${card.summary ? ' · ' : ''}${seconds(durationMs)}` : ''}
        </Text>
      )
    } else if (summary && !closed) summaryLine = (
      <Text color={card.failed ? COLORS.del : COLORS.muted} wrap="wrap">
        {card.failed ? summary : drawInline(ui, summary, 'output', inlineBudget)}
      </Text>
    )
    return (
      <Box flexDirection="column" width="100%" borderStyle="round" borderColor={broken ? COLORS.borderErr : COLORS.border} paddingX={1}>
        {view === undefined ? title : (
          <Box flexDirection="row" width="100%">
            <Box flexGrow={1} flexShrink={1}>{title}</Box>
            {marker}
            {control}
          </Box>
        )}
        {summaryLine}
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
