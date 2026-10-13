import type { ElementTable, RenderElement } from 'claude-code'
import { COLORS } from './text-style'

// The TLDR block under a reply: the reply as usual, then the summary in a rounded card. While
// the summary is written, or after it failed, one muted line takes the card's place.

type Ui = ElementTable<'terminal'>

export function drawTldr(ui: Ui, summary: string, reply: RenderElement | null | undefined) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" width="100%">
      {reply}
      <Box flexDirection="column" width="100%" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
        <Text color={COLORS.name} bold>TLDR</Text>
        <Text color={COLORS.output} wrap="wrap">{summary}</Text>
      </Box>
    </Box>
  )
}

// The reply as usual, then `Summarizing…` or why the summary failed.
export function drawTldrNote(ui: Ui, note: string, reply: RenderElement | null | undefined) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" width="100%">
      {reply}
      <Text color={COLORS.muted} wrap="wrap">{note}</Text>
    </Box>
  )
}
