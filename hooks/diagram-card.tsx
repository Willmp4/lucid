import type { ElementTable } from 'claude-code'
import type { Diagram } from '../types'
import type { CellArt } from './diagram'
import { COLORS } from './text-style'

// A diagram fence's card: a rounded border, the header `excalidraw · <title>`, then what the
// diagram has come to. While it draws, a muted progress line; once it failed, the reason and
// a Retry button; once drawn, the picture and the path of its .excalidraw scene.

type Ui = ElementTable

// How the picture of a drawn diagram shows: the PNG, where the terminal shows pixels; its
// version in cells, in any other terminal; its SVG, on a surface that draws one; else the
// path of its SVG file.
export type Picture =
  | { kind: 'png'; file: string; columns: number; rows: number; title: string }
  | { kind: 'cells'; art: CellArt }
  | { kind: 'svg'; source: string; title: string }
  | { kind: 'path'; file: string }

function drawPicture(ui: Ui, picture: Picture) {
  const { Box, Text } = ui
  if (picture.kind === 'png' && 'Image' in ui) {
    const { Image } = ui
    return <Image source={{ file: picture.file, format: 'png' }} columns={picture.columns} rows={picture.rows} alt={`Diagram: ${picture.title}`} />
  }
  if (picture.kind === 'svg' && 'Svg' in ui) {
    const { Svg } = ui
    return <Svg source={picture.source} alt={`Diagram: ${picture.title}`} />
  }
  if (picture.kind === 'cells') {
    return (
      <Box flexDirection="column">
        {picture.art.lines.map((runs, i) => (
          <Text key={`cells-${i}`} wrap="truncate-end">
            {runs.length === 0 ? ' ' : runs.map(([text, tone], j) => tone === null
              ? text
              : tone === 'dim'
                ? <Text key={`run-${j}`} dimColor>{text}</Text>
                : tone === 'bold'
                  ? <Text key={`run-${j}`} bold>{text}</Text>
                  : <Text key={`run-${j}`} color={tone}>{text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  }
  return <Text color={COLORS.muted} wrap="truncate-end">{picture.kind === 'path' ? picture.file : ''}</Text>
}

// `picture` is the drawn diagram's; `retry` draws a failed one again. `id` keys the button.
export function drawDiagramCard(ui: Ui, id: string, diagram: Diagram | undefined, picture: Picture | undefined, retry: () => void) {
  const { Box, Button, Text } = ui
  const title = diagram?.status === 'ready' && diagram.title !== '' ? ` · ${diagram.title}` : ''
  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
      <Text color={COLORS.name} bold wrap="truncate-end">excalidraw{title}</Text>
      {diagram === undefined || diagram.status === 'drawing'
        ? <Text color={COLORS.muted}>drawing in the background · {diagram?.step ?? 'queued'}</Text>
        : diagram.status === 'failed'
          ? (
            <Box flexDirection="column">
              <Text color={COLORS.del} wrap="wrap">Could not draw it: {diagram.reason}</Text>
              <Button key={`retry-${id}`} label="Retry" onPress={retry} plain />
            </Box>
          )
          : (
            <Box flexDirection="column">
              {picture === undefined ? null : drawPicture(ui, picture)}
              <Text color={COLORS.muted} wrap="truncate-end">{diagram.excalidraw}</Text>
            </Box>
          )}
    </Box>
  )
}
