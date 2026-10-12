import type { ElementTable, RenderElement } from 'claude-code'
import { COLORS } from './text-style'
import { tableLines } from './reply-table'
import type { Run, Segment, Style } from './reply-table'

type Ui = ElementTable<'terminal'>

// The columns a reply's block loses to the transcript's own margin.
const REPLY_INSET = 2
// Past this many styled spans a table draws one plain span per line, well under the
// host's serialized-tree limit.
const SPAN_BUDGET = 1500

const SPAN_PROPS: Record<Style, { color?: string; bold?: boolean }> = {
  plain: {},
  header: { bold: true },
  code: { color: COLORS.path },
  bold: { bold: true },
  border: { color: COLORS.border },
}

export const hasTable = (segments: readonly Segment[]) => segments.some(segment => segment.kind === 'table')

function drawTable(ui: Ui, lines: readonly Run[][], key: string) {
  const { Box, Text } = ui
  const styled = lines.reduce((sum, line) => sum + line.length, 0) <= SPAN_BUDGET
  return (
    <Box key={key} flexDirection="column" marginY={1}>
      {lines.map((line, at) => (
        <Text key={`${key}-${at}`} wrap="truncate-end">
          {styled
            ? line.map((run, i) => <Text key={`${i}`} {...SPAN_PROPS[run.style]}>{run.text}</Text>)
            : line.map(run => run.text).join('')}
        </Text>
      ))}
    </Box>
  )
}

export const replyColumns = (viewportColumns: number) => Math.max(20, viewportColumns - REPLY_INSET)

// `drawn` holds skins' drawing of each text segment, where skins drew one; the rest of
// the text keeps Claude Code's own markdown.
export function drawReply(ui: Ui, segments: readonly Segment[], columns: number, drawn: readonly (RenderElement | undefined)[]) {
  const { Box, Markdown } = ui
  return (
    <Box flexDirection="column">
      {segments.map((segment, i) => segment.kind === 'table'
        ? drawTable(ui, tableLines(segment, columns), `table-${i}`)
        : <Box key={`text-${i}`} flexDirection="column">{drawn[i] ?? <Markdown text={segment.text} />}</Box>)}
    </Box>
  )
}
