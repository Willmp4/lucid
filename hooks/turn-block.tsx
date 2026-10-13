import type { ElementTable, RenderElement } from 'claude-code'
import type { CallRecord } from '../types'
import { linesOfText } from './card-model'
import type { CardContent } from './card-model'
import { COLORS } from './text-style'
import { callLabel, fitLine, fitParts, isBrokenCall, statusLine, titleOf } from './turn-model'

// A run of a turn's calls at the blackbox level: one bordered block, folded to its title and
// status lines, failures always listed; open, a compact card per call.

export type TurnView = {
  calls: { id: string; record: CallRecord }[]
  durationMs?: number
  // The label of the call in progress, while the turn runs.
  running?: string
  unfolded: boolean
  toggle: () => void
  // The terminal's width: each folded line keeps to one row of it.
  columns: number
  // Open: the call cards, in turn order.
  entries: RenderElement[]
}

const SUBJECT_COLOR: Readonly<Record<string, string>> = {
  Editing: COLORS.path, Reading: COLORS.path, Running: COLORS.command, Searching: COLORS.quote, Using: COLORS.name,
}
// The cells a line loses to the block's border and padding, and to each indent.
const FRAME = 4
const INDENT = 2

export function drawTurn(ui: ElementTable<'terminal'>, view: TurnView, cwd: string) {
  const { Box, Text, Button } = ui
  const records = view.calls.map(call => call.record)
  const title = titleOf(records, cwd)
  const arrow = view.unfolded ? '▾' : '▸'
  const label = [arrow, title.verb, title.subject, title.extra].filter(Boolean).join(' ')
  const broken = view.calls.filter(call => isBrokenCall(call.record))
  // A Button's children ignore their Text's wrap, so every folded line is cut to fit first.
  const room = Math.max(1, view.columns - FRAME)
  const [arrowPart, verbPart, subjectPart, extraPart] = fitParts([
    `${arrow} `, title.verb, title.subject === '' ? '' : ` ${title.subject}`, title.extra === undefined ? '' : ` ${title.extra}`,
  ], room)

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={broken.length > 0 ? COLORS.borderErr : COLORS.border} paddingX={1}>
      <Button key="turn-fold" label={label} onPress={view.toggle} plain>
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{arrowPart}</Text>
          {verbPart === '' ? null : <Text color={COLORS.name} bold>{verbPart}</Text>}
          {subjectPart === '' ? null : <Text color={SUBJECT_COLOR[title.verb]}>{subjectPart}</Text>}
          {extraPart === '' ? null : <Text color={COLORS.muted}>{extraPart}</Text>}
        </Text>
      </Button>
      <Box paddingLeft={INDENT}>
        <Text color={COLORS.muted} wrap="truncate-end">{fitLine(statusLine(records, view.durationMs, view.running), room - INDENT)}</Text>
      </Box>
      {view.unfolded ? view.entries : broken.map(call => (
        <Box key={`broken-${call.id}`} flexDirection="column" paddingLeft={INDENT}>
          <Text color={COLORS.del} wrap="truncate-end">{fitLine(`✗ ${callLabel(call.record, cwd)}`, room - INDENT)}</Text>
          <Box paddingLeft={INDENT}>
            <Text color={COLORS.del} wrap="truncate-end">{fitLine(call.record.error ?? 'Failed', room - 2 * INDENT)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// A call no card formats (an Agent, an MCP tool) shows the text the model read.
export function genericCard(record: CallRecord, text: string | undefined, cwd: string): CardContent {
  const failed = record.status === 'failed'
  return {
    title: callLabel(record, cwd),
    rows: linesOfText(text ?? '').map(line => ({ text: line, kind: failed ? 'error' : 'text' })),
    failed,
    ...(record.status === 'running' ? {} : { status: record.status === 'ok' ? 'ok' : record.status }),
  }
}

// A call no card draws in an open block, such as a background job or an image read: one muted
// row cut to fit.
export function mutedRow(ui: ElementTable<'terminal'>, label: string, columns: number) {
  const { Text } = ui
  return <Text color={COLORS.muted} wrap="truncate-end">{fitLine(label, Math.max(1, columns - FRAME))}</Text>
}
