export type CardRow = {
  text: string
  number?: number
  kind?: 'text' | 'muted' | 'error' | 'heading'
}

export type CardContent = {
  title: string
  summary?: string
  rows: CardRow[]
  failed?: boolean
}

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
