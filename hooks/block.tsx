import type { ElementTable } from 'claude-code'
import { COLORS, drawInline, drawWithinLimit } from './text-style'

// One bordered Edit or Write block with a shared OMP dark Catppuccin palette.
// Changed rows keep Catppuccin Mocha's delta shading and colour precedence.

export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])

export const DIFF_CAP = 40
export const NEW_FILE_CAP = 20

export type LineRow = { kind: 'add' | 'del' | 'ctx'; number: string; text: string }

export type Row =
  | LineRow
  | { kind: 'gap' }
  | { kind: 'more'; count: number }
  | { kind: 'note'; text: string; color: string }

export type Counts = { added: number; removed?: number }

export type Block = {
  tool: string
  path: string
  counts: Counts | null
  rows: Row[]
  isErrored: boolean
}

export type CallProps = {
  tool: string
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

type Hunk = { oldStart: number; newStart: number; lines: readonly string[] }

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

// Relative inside the working directory, `~` under a home directory, else as given.
export function shortenPath(path: string, cwd: string): string {
  const root = cwd.replace(/\/+$/, '')

  if (root !== '' && path.startsWith(`${root}/`)) {
    return path.slice(root.length + 1)
  }

  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

export function hunksOf(output: unknown): Hunk[] {
  const patch = record(output).structuredPatch

  if (!Array.isArray(patch)) {
    return []
  }

  return patch.filter(
    (hunk): hunk is Hunk =>
      typeof hunk?.oldStart === 'number' && typeof hunk?.newStart === 'number' && Array.isArray(hunk?.lines),
  )
}

export function countsOf(hunks: readonly Hunk[]): Counts {
  let added = 0
  let removed = 0

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        added += 1
      } else if (line.startsWith('-')) {
        removed += 1
      }
    }
  }

  return { added, removed }
}

export function diffRows(hunks: readonly Hunk[]): Row[] {
  const rows: Row[] = []

  hunks.forEach((hunk, index) => {
    if (index > 0) {
      rows.push({ kind: 'gap' })
    }

    let old = hunk.oldStart
    let now = hunk.newStart

    for (const line of hunk.lines) {
      const text = line.slice(1)

      if (line.startsWith('+')) {
        rows.push({ kind: 'add', number: `+${now}`, text })
        now += 1
      } else if (line.startsWith('-')) {
        rows.push({ kind: 'del', number: `-${old}`, text })
        old += 1
      } else if (line.startsWith('\\')) {
        continue
      } else {
        rows.push({ kind: 'ctx', number: `${now}`, text })
        old += 1
        now += 1
      }
    }
  })

  return rows
}

export function linesOf(content: string): string[] {
  const lines = content.split('\n')

  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

export function newFileRows(lines: readonly string[]): Row[] {
  return lines.map((text, index) => ({ kind: 'add', number: `+${index + 1}`, text }))
}

export function capped(rows: readonly Row[], limit: number): Row[] {
  return rows.length <= limit ? [...rows] : [...rows.slice(0, limit), { kind: 'more', count: rows.length - limit }]
}

// The first line of what the model read for a failed call, its error tags stripped.
export function errorLine(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output) ?? ''
  const line = text
    .replace(/<\/?tool_use_error>/g, '')
    .split('\n')
    .map(part => part.trim())
    .find(part => part !== '')

  return line ?? 'Failed'
}

export function blockOf(props: CallProps, cwd: string): Block {
  const output = record(props.output)
  const input = record(props.input)
  const raw = typeof output.filePath === 'string' ? output.filePath : typeof input.file_path === 'string' ? input.file_path : ''
  const base = { tool: props.tool, path: shortenPath(raw, cwd), isErrored: props.isErrored }

  // Completion output can arrive before the running flag clears.
  if (props.isRunning && props.output === undefined) {
    return { ...base, counts: null, rows: [] }
  }

  if (props.isInterrupted) {
    return { ...base, counts: null, rows: [{ kind: 'note', text: 'Interrupted', color: COLORS.warn }] }
  }

  if (props.isErrored) {
    return { ...base, counts: null, rows: [{ kind: 'note', text: errorLine(props.output), color: COLORS.del }] }
  }

  if (props.tool === 'Write' && output.type === 'create' && typeof output.content === 'string') {
    const lines = linesOf(output.content)

    return { ...base, counts: { added: lines.length }, rows: capped(newFileRows(lines), NEW_FILE_CAP) }
  }

  const hunks = hunksOf(props.output)

  if (hunks.length === 0) {
    return { ...base, counts: null, rows: [{ kind: 'note', text: 'no changes shown', color: COLORS.muted }] }
  }

  return { ...base, counts: countsOf(hunks), rows: capped(diffRows(hunks), DIFF_CAP) }
}

// Leading spaces and tabs on a changed line, drawn as one dot each.
export function splitIndent(text: string): [string, string] {
  const indent = /^[ \t]*/.exec(text)?.[0] ?? ''

  return ['·'.repeat(indent.length), text.slice(indent.length)]
}

const isLine = (row: Row): row is LineRow => row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx'

export function drawBlock(ui: ElementTable<'terminal'>, block: Block) {
  const { Box, Text } = ui
  const gutter = Math.max(0, ...block.rows.filter(isLine).map(row => row.number.length))
  const textLength = block.rows.reduce(
    (length, row) => length + ('text' in row ? row.text.length : 0),
    block.path.length + block.tool.length,
  )

  const header = (
    <Box key="head" flexDirection="row" width="100%">
      <Text wrap="wrap">
        <Text color={COLORS.name}>✎ </Text>
        <Text color={COLORS.name} bold>
          {block.tool}
        </Text>
        <Text color={COLORS.muted}>: </Text>
        <Text color={COLORS.path}>{block.path}</Text>
        {block.counts === null ? null : (
          <Text color={COLORS.muted}>
            {'  ('}
            <Text color={COLORS.add}>+{block.counts.added}</Text>
            {block.counts.removed === undefined ? null : (
              <Text color={COLORS.muted}>
                {'/'}
                <Text color={COLORS.del}>-{block.counts.removed}</Text>
              </Text>
            )}
            {')'}
          </Text>
        )}
      </Text>
    </Box>
  )

  return drawWithinLimit(inlineBudget => {
    const rows = block.rows.map((row, index) => {
      const key = `r${index}`

      if (row.kind === 'gap') {
        return (
          <Box key={key} width="100%">
            <Text color={COLORS.muted}>…</Text>
          </Box>
        )
      }

      if (row.kind === 'more') {
        return (
          <Box key={key} width="100%">
            <Text color={COLORS.muted}>
              … {row.count} more {row.count === 1 ? 'line' : 'lines'}
            </Text>
          </Box>
        )
      }

      if (row.kind === 'note') {
        return (
          <Box key={key} width="100%">
            <Text color={row.color} wrap="wrap">
              {row.text}
            </Text>
          </Box>
        )
      }

      const isChange = row.kind !== 'ctx'
      const color = row.kind === 'add' ? COLORS.add : row.kind === 'del' ? COLORS.del : COLORS.muted
      const background = row.kind === 'add' ? COLORS.addBg : row.kind === 'del' ? COLORS.delBg : undefined
      const [dots, rest] = isChange ? splitIndent(row.text) : ['', row.text]
      const shown = dots === '' && rest === '' ? ' ' : rest

      return (
        <Box key={key} flexDirection="row" width="100%" backgroundColor={background}>
          <Box width={gutter + 2} flexShrink={0}>
            <Text color={isChange ? color : COLORS.dim} backgroundColor={background}>
              {row.number.padStart(gutter)}
            </Text>
          </Box>
          <Box flexGrow={1}>
            <Text color={color} backgroundColor={background} wrap="wrap">
              {dots === '' ? null : (
                <Text color={COLORS.dim} backgroundColor={background}>
                  {dots}
                </Text>
              )}
              {isChange ? shown : drawInline(ui, shown, 'output', inlineBudget)}
            </Text>
          </Box>
        </Box>
      )
    })

    return (
      <Box
        flexDirection="column"
        width="100%"
        borderStyle="round"
        borderColor={block.isErrored ? COLORS.borderErr : COLORS.border}
        paddingX={1}
      >
        {header}
        {rows}
      </Box>
    )
  }, textLength, block.rows.length)
}
