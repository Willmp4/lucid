import type { ElementTable, RenderElement } from 'claude-code'
import type { CallRecord } from '../types'
import { linesOfText } from './card-model'
import type { CardContent } from './card-model'
import { COLORS } from './text-style'
import { callLabel, isBrokenCall, statusLine, titleOf } from './turn-model'

// A turn's calls at the blackbox level: one bordered block, folded to its title and status
// lines, failures always listed; open, the turn's text and a compact card per call.

export type TurnView = {
  calls: { id: string; record: CallRecord }[]
  durationMs?: number
  // The label of the call in progress, while the turn runs.
  running?: string
  unfolded: boolean
  toggle: () => void
  // Open: the in-between text and the call cards, in turn order.
  entries: RenderElement[]
}

const SUBJECT_COLOR: Readonly<Record<string, string>> = {
  Editing: COLORS.path, Reading: COLORS.path, Running: COLORS.command, Searching: COLORS.quote, Using: COLORS.name,
}

export function drawTurn(ui: ElementTable<'terminal'>, view: TurnView, cwd: string) {
  const { Box, Text, Button } = ui
  const records = view.calls.map(call => call.record)
  const title = titleOf(records, cwd)
  const arrow = view.unfolded ? '▾' : '▸'
  const label = [arrow, title.verb, title.subject, title.extra].filter(Boolean).join(' ')
  const broken = view.calls.filter(call => isBrokenCall(call.record))

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={broken.length > 0 ? COLORS.borderErr : COLORS.border} paddingX={1}>
      <Button key="turn-fold" label={label} onPress={view.toggle} plain>
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{`${arrow} `}</Text>
          <Text color={COLORS.name} bold>{title.verb}</Text>
          {title.subject === '' ? null : <Text color={SUBJECT_COLOR[title.verb]}>{` ${title.subject}`}</Text>}
          {title.extra === undefined ? null : <Text color={COLORS.muted}>{` ${title.extra}`}</Text>}
        </Text>
      </Button>
      <Box paddingLeft={2}>
        <Text color={COLORS.muted} wrap="truncate-end">{statusLine(records, view.durationMs, view.running)}</Text>
      </Box>
      {view.unfolded ? view.entries : broken.map(call => (
        <Box key={`broken-${call.id}`} flexDirection="column" paddingLeft={2}>
          <Text color={COLORS.del} wrap="truncate-end">{`✗ ${callLabel(call.record, cwd)}`}</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.del} wrap="truncate-end">{call.record.error ?? 'Failed'}</Text>
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
