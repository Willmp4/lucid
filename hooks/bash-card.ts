import { shortenPath } from './block'
import type { CallProps } from './block'
import { cleanText, linesOfText, recordOf, textOf } from './card-model'
import type { CardContent, CardRow } from './card-model'

export function formatBash(props: CallProps, cwd: string): CardContent | null {
  const input = recordOf(props.input)
  const output = recordOf(props.output)
  const command = cleanText(textOf(input.command)).trim()
  const title = command === '' ? 'Bash' : `Bash: ${command}`

  if (output.backgroundTaskId !== undefined || output.isImage === true ||
      (output.structuredContent !== undefined && output.structuredContent !== null)) {
    return null
  }

  if (props.output === undefined || props.output === null) {
    return {
      title,
      summary: props.isInterrupted ? 'Interrupted' : props.isErrored ? 'Failed' : props.isRunning ? 'Running' : 'Pending',
      rows: [],
      failed: props.isErrored,
    }
  }

  let failed = props.isErrored
  let stdout: string
  let stderr: string

  if (typeof props.output === 'string') {
    failed ||= /<tool_use_error>/.test(props.output)
    const text = props.output.replace(/<\/?tool_use_error>/g, '')
    stdout = failed ? '' : text
    stderr = failed ? text : ''
  } else if (typeof output.stdout === 'string' && typeof output.stderr === 'string') {
    stdout = output.stdout
    stderr = output.stderr
  } else {
    return null
  }

  const interrupted = props.isInterrupted || output.interrupted === true
  const interpretation = cleanText(textOf(output.returnCodeInterpretation)).trim()
  const status = interrupted ? 'Interrupted' : failed ? 'Failed' : ''
  const summary = [status, interpretation].filter(Boolean).join(' · ') || undefined
  const persistedPath = textOf(output.persistedOutputPath)
  const rawPath = textOf(output.rawOutputPath)
  const rows: CardRow[] = []

  // Artifact paths precede stream rows so the collapsed preview retains them.
  if (persistedPath !== '') {
    rows.push({ text: `Full output: ${cleanText(shortenPath(persistedPath, cwd))}`, kind: 'muted', pathStart: 13 })
  }
  if (rawPath !== '' && rawPath !== persistedPath) {
    rows.push({ text: `Raw output: ${cleanText(shortenPath(rawPath, cwd))}`, kind: 'muted', pathStart: 12 })
  }

  const stdoutLines = linesOfText(stdout)
  const stderrLines = linesOfText(stderr)
  for (const text of stdoutLines) rows.push({ text, kind: 'text' })
  for (const text of stderrLines) rows.push({ text, kind: 'error' })

  if (stdoutLines.length === 0 && stderrLines.length === 0) {
    rows.push({ text: persistedPath !== '' || rawPath !== '' ? 'No inline output' : 'No output', kind: 'muted' })
  }

  return { title, summary, rows, failed }
}
