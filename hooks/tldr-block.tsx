import type { ElementTable, RenderElement } from 'claude-code'
import { COLORS } from './text-style'

// The TLDR block over a reply: the summary in a rounded card, folded over the reply until
// **Show ▸** opens it. While the summary is written, or after it failed, the reply draws
// as usual with one muted line beneath.

type Ui = ElementTable<'terminal'>

export function drawTldr(ui: Ui, summary: string, open: boolean, toggle: () => void, reply?: RenderElement | null) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" width="100%" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
        <Box flexDirection="row" width="100%">
          <Box flexGrow={1}>
            <Text color={COLORS.name} bold>TLDR</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button key="tldr-toggle" label={open ? 'Collapse' : 'Show ▸'} onPress={toggle} plain />
          </Box>
        </Box>
        <Text color={COLORS.output} wrap="wrap">{summary}</Text>
      </Box>
      {open ? reply : null}
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
