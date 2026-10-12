export type CardRow = {
  text: string
  number?: number
  kind?: 'text' | 'muted' | 'error' | 'heading' | 'path'
  // Authoritative path bounds use string offsets; omitted bounds reach the edge.
  pathStart?: number
  pathEnd?: number
}

export type CardContent = {
  title: string
  // Keep scope boundaries exact even when patterns and paths contain separators.
  titlePathStart?: number
  summary?: string
  rows: CardRow[]
  failed?: boolean
  // A settled call's outcome, where its tool marks one; absent while it runs.
  status?: 'ok' | 'failed' | 'interrupted'
  // The summary less its status word, for a header that marks the status itself.
  detail?: string
}

// Below the full level: the level, whether a compact card is open, and the press that opens or closes it.
export type CardView = { density: 'balanced' | 'compact'; opened: boolean; toggleOpen: () => void }

export const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

export const textOf = (value: unknown): string => typeof value === 'string' ? value : ''

// Strip terminal controls without changing the tool result the model receives.
export const cleanText = (value: string): string => value
  .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

export function linesOfText(value: string): string[] {
  const text = cleanText(value)
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}
