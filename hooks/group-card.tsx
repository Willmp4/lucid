import type { ElementTable } from 'claude-code'
import type { CallProps } from './block'
import type { CardContent, CardView } from './card-model'
import { COLORS } from './text-style'
import { cardOf, isBroken } from './tool-card'

// Below the full level a run of reads and searches draws one card, a row per call.

// What the merged header counts each tool's calls as.
const GROUP_NOUNS: Readonly<Record<string, string>> = { Read: 'file', Grep: 'pattern', Glob: 'pattern' }
// A long path wraps inside this many columns rather than push the summaries off the card.
const LABEL_COLUMNS = 48

export type GroupCall = CallProps & { tool_use_id?: string }

export type Group = {
  ids: string[]
  counts: { tool: string; count: number }[]
  cards: CardContent[]
}

// Null where a call is another tool, carries no input or output, or has no summary: that
// group stays forced open.
export function groupOf(calls: readonly GroupCall[], cwd: string): Group | null {
  if (calls.length === 0) return null
  const group: Group = { ids: [], counts: [], cards: [] }
  for (const call of calls) {
    if (typeof GROUP_NOUNS[call.tool] !== 'string' || call.tool_use_id === undefined) return null
    if (call.input === null || typeof call.input !== 'object') return null
    if (call.output === undefined && !call.isRunning && !call.isErrored && !call.isInterrupted) return null
    const card = cardOf(call, cwd)
    if (card === null) return null
    group.ids.push(call.tool_use_id)
    group.cards.push(card)
    const counted = group.counts.find(entry => entry.tool === call.tool)
    if (counted) counted.count++
    else group.counts.push({ tool: call.tool, count: 1 })
  }
  return group
}

export function drawGroup(ui: ElementTable<'terminal'>, group: Group, view: CardView, showAll: () => void) {
  const { Box, Text, Button } = ui
  const broken = group.cards.some(isBroken)
  const closed = view.density === 'compact' && !view.opened && !broken
  const labels = group.cards.map(card => card.title.slice(card.title.indexOf(': ') + 2))
  const column = Math.min(LABEL_COLUMNS, Math.max(...labels.map(label => label.length))) + 2

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={broken ? COLORS.borderErr : COLORS.border} paddingX={1}>
      <Box flexDirection="row" width="100%">
        <Box flexGrow={1} flexShrink={1}>
          <Text color={COLORS.output} wrap={closed ? 'truncate-end' : 'wrap'}>
            {group.counts.map(({ tool, count }, index) => [
              index === 0 ? null : <Text key={`gap-${index}`} color={COLORS.muted}> · </Text>,
              <Text key={`tool-${index}`} color={COLORS.name} bold>{tool}</Text>,
              ` ${count} ${GROUP_NOUNS[tool]}${count === 1 ? '' : 's'}`,
            ])}
          </Text>
        </Box>
        {view.density === 'compact' && !broken ? (
          <Box flexShrink={0} marginLeft={1}>
            <Button key="open-group" label={closed ? 'Show ▸' : 'Collapse'} onPress={view.toggleOpen} plain />
          </Box>
        ) : null}
      </Box>
      {closed ? null : group.cards.map((card, index) => {
        // A failure's own lines follow its row; a lone line that repeats the summary does not.
        const below = !isBroken(card) || (card.rows.length === 1 && card.rows[0]!.text === card.summary) ? [] : card.rows
        return (
          <Box key={`call-${index}`} flexDirection="column" width="100%">
            <Box flexDirection="row" width="100%">
              <Box width={column} flexShrink={1}>
                <Text color={COLORS.path} wrap="wrap">{labels[index]}</Text>
              </Box>
              {card.summary === undefined ? null : (
                <Box flexGrow={1}>
                  <Text color={card.failed ? COLORS.del : COLORS.muted} wrap="wrap">{card.summary}</Text>
                </Box>
              )}
            </Box>
            {below.map((row, at) => (
              <Text key={`row-${at}`} color={card.failed || row.kind === 'error' ? COLORS.del : COLORS.muted} wrap="wrap">
                {row.text === '' ? ' ' : row.text}
              </Text>
            ))}
          </Box>
        )
      })}
      {closed ? null : <Button key="show-group" label="Show all" onPress={showAll} plain />}
    </Box>
  )
}
