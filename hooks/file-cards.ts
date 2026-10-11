import { shortenPath } from './block'
import type { CallProps } from './block'
import { cleanText, linesOfText, recordOf, textOf } from './card-model'
import type { CardContent, CardRow } from './card-model'

const FILE_TOOLS: Record<string, true> = { Read: true, Glob: true, Grep: true }
const GREP_MODES: Record<string, true> = { content: true, files_with_matches: true, count: true }

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const countLabel = (count: number, unit: 'line' | 'file' | 'match'): string =>
  `${count} ${unit}${count === 1 ? '' : unit === 'match' ? 'es' : 's'}`

type MatchLine = { path: string; number: number; text: string; context: boolean }

function grepContentRows(lines: readonly string[], knownPaths: readonly string[], cwd: string, showNumbers: boolean): CardRow[] {
  const rows: CardRow[] = []
  let activePath: string | undefined

  for (const line of lines) {
    let parsed: MatchLine | undefined
    let ambiguous = false

    if (showNumbers) {
      for (const path of knownPaths) {
        if (path === '' || !line.startsWith(path)) continue
        const suffix = /^([:-])([1-9]\d*)\1(.*)$/.exec(line.slice(path.length))
        if (!suffix) continue
        const number = Number(suffix[2])
        if (!nonnegativeInteger(number)) continue
        const candidate = { path, number, text: suffix[3]!, context: suffix[1] === '-' }
        if (parsed && parsed.path !== path) {
          ambiguous = true
          break
        }
        parsed = candidate
      }

      if (!parsed && !ambiguous && !/^[1-9]\d*[:-]/.test(line)) {
        // Multiple numeric delimiters cannot distinguish a colon-bearing filename
        // from numeric content without an authoritative filename in the result.
        let separators = 0
        for (const delimiter of line.matchAll(/(?=([:-])([1-9]\d*)\1)/g)) {
          separators += 1
          if (separators > 1) {
            parsed = undefined
            break
          }
          const path = line.slice(0, delimiter.index)
          const number = Number(delimiter[2])
          if (path.includes(':') || (!path.includes('/') && !path.includes('.')) || !nonnegativeInteger(number)) continue
          parsed = {
            path,
            number,
            text: line.slice(delimiter.index + delimiter[2]!.length + 2),
            context: delimiter[1] === '-',
          }
        }
      }
    }

    if (parsed && !ambiguous) {
      if (activePath !== parsed.path) rows.push({ text: shortenPath(parsed.path, cwd), kind: 'heading' })
      rows.push(parsed.context
        ? { text: parsed.text, number: parsed.number, kind: 'muted' }
        : { text: parsed.text, number: parsed.number })
      activePath = parsed.path
    } else {
      rows.push({ text: line })
      activePath = undefined
    }
  }

  return rows
}

export function formatFileTool(props: CallProps, cwd: string): CardContent | null {
  if (FILE_TOOLS[props.tool] !== true) return null

  const input = recordOf(props.input)
  const output = recordOf(props.output)
  const file = recordOf(output.file)
  const requestedPath = textOf(input.file_path)
  const resultPath = output.type === 'text' ? textOf(file.filePath) : ''
  const scope = textOf(input.path) || cwd || '.'
  const shownScope = cleanText(scope === cwd ? '.' : shortenPath(scope, cwd))
  const title = props.tool === 'Read'
    ? `Read: ${cleanText(shortenPath(resultPath || requestedPath, cwd))}`
    : `${props.tool}: ${cleanText(textOf(input.pattern))} · ${shownScope}`
  const header = { title, titlePathStart: props.tool === 'Read' ? 6 : title.length - shownScope.length }

  if (props.output === undefined) {
    if (props.isErrored) return { ...header, summary: 'Failed', failed: true, rows: [{ text: 'Failed', kind: 'error' }] }
    if (props.isInterrupted) return { ...header, summary: 'Interrupted', rows: [{ text: 'Interrupted', kind: 'muted' }] }
    let summary: string | undefined
    if (props.tool === 'Read' && (input.offset !== undefined || input.limit !== undefined)) {
      const start = nonnegativeInteger(input.offset) && input.offset > 0 ? input.offset : 1
      const limit = nonnegativeInteger(input.limit) && input.limit > 0 ? input.limit : undefined
      summary = limit === undefined ? `lines ${start}–end` : `lines ${start}–${start + limit - 1}`
    }
    return { ...header, summary, rows: [] }
  }

  // Error strings carry the complete diagnostic, even before isRunning clears.
  if (props.isErrored && typeof props.output === 'string') {
    const lines = linesOfText(props.output.replace(/<\/?tool_use_error>/g, ''))
    return {
      ...header,
      summary: 'Failed',
      failed: true,
      rows: (lines.length > 0 ? lines : ['Failed']).map(text => ({ text, kind: 'error' })),
    }
  }

  if (props.tool === 'Read') {
    if (output.type !== 'text' || typeof file.filePath !== 'string' || typeof file.content !== 'string'
      || !nonnegativeInteger(file.startLine) || file.startLine < 1
      || !nonnegativeInteger(file.numLines) || !nonnegativeInteger(file.totalLines)
      || (file.truncatedByTokenCap !== undefined && typeof file.truncatedByTokenCap !== 'boolean')) return null

    const startLine = file.startLine
    const content = cleanText(file.content)
    const lines = content === '' ? (file.numLines > 0 ? [''] : []) : content.split('\n')
    if (lines.at(-1) === '' && lines.length > file.numLines) lines.pop()
    const range = file.numLines === 0
      ? '0 lines'
      : file.numLines === 1 ? `line ${file.startLine}` : `lines ${file.startLine}–${file.startLine + file.numLines - 1}`
    return {
      ...header,
      summary: `${range} · ${file.totalLines} total lines${file.truncatedByTokenCap ? ' · truncated by token cap' : ''}`,
      rows: lines.map((text, index) => ({ text, number: startLine + index })),
      failed: props.isErrored,
    }
  }

  if (!nonnegativeInteger(output.numFiles)
    || (output.truncated !== undefined && typeof output.truncated !== 'boolean')) return null

  if (props.tool === 'Glob') {
    if (!stringArray(output.filenames)) return null
    return {
      ...header,
      summary: `${countLabel(output.numFiles, 'file')}${output.truncated ? ' · tool output truncated' : ''}`,
      rows: output.filenames.map(path => ({ text: cleanText(shortenPath(path, cwd)), kind: 'path' })),
      failed: props.isErrored,
    }
  }

  if ((output.filenames !== undefined && !stringArray(output.filenames))
    || (output.content !== undefined && typeof output.content !== 'string')
    || (output.numLines !== undefined && !nonnegativeInteger(output.numLines))
    || (output.mode !== undefined && typeof output.mode !== 'string')
    || (output.output_mode !== undefined && typeof output.output_mode !== 'string')
    || (output.mode !== undefined && output.output_mode !== undefined && output.mode !== output.output_mode)) return null

  const filenames = stringArray(output.filenames) ? output.filenames : []
  const mode = textOf(output.mode) || textOf(output.output_mode) || textOf(input.output_mode) || 'files_with_matches'
  if (GREP_MODES[mode] !== true || (output.filenames === undefined && output.content === undefined)) return null
  const content = textOf(output.content)
  const lines = mode === 'content' && nonnegativeInteger(output.numLines)
    ? cleanText(content).split('\n')
    : linesOfText(content)
  if (mode === 'content' && nonnegativeInteger(output.numLines) && lines.at(-1) === '' && lines.length > output.numLines) {
    lines.pop()
  }
  const truncated = output.truncated ? ' · tool output truncated' : ''
  let rows: CardRow[]
  let summary: string

  if (mode === 'files_with_matches') {
    rows = filenames.map(path => ({ text: cleanText(shortenPath(path, cwd)), kind: 'path' }))
    if (lines.length > 0) {
      if (filenames.length === 0) rows = lines.map(path => ({ text: shortenPath(path, cwd), kind: 'path' }))
      else if (lines.length !== filenames.length || lines.some((line, index) => line !== cleanText(filenames[index]!))) {
        rows.push(...lines.map(text => ({ text })))
      }
    }
    summary = nonnegativeInteger(output.totalFiles) && output.totalFiles > output.numFiles
      ? `${output.numFiles} of ${countLabel(output.totalFiles, 'file')}`
      : countLabel(output.numFiles, 'file')
  } else if (mode === 'count') {
    if (typeof output.content !== 'string') return null
    let matches = 0
    let countedRows = 0
    let completeCounts = true
    rows = lines.map(text => {
      const pathCount = /^(.+):([0-9]+)$/.exec(text)
      const singleCount = /^([0-9]+)$/.exec(text)
      const count = Number(pathCount?.[2] ?? singleCount?.[1])
      if (!nonnegativeInteger(count) || !Number.isSafeInteger(matches + count)) {
        if (text !== '') completeCounts = false
        return { text }
      }
      matches += count
      countedRows += 1
      if (!pathCount) return { text }
      const path = shortenPath(pathCount[1]!, cwd)
      return { text: `${path}:${pathCount[2]}`, pathEnd: path.length }
    })
    const empty = lines.length === 0 && output.numFiles === 0 && !output.truncated
    const matchCount = nonnegativeInteger(output.numMatches) && output.numMatches > matches
      ? `${matches} of ${countLabel(output.numMatches, 'match')}`
      : countLabel(matches, 'match')
    const fileCount = countedRows < output.numFiles
      ? `${countedRows} of ${countLabel(output.numFiles, 'file')}`
      : countLabel(output.numFiles, 'file')
    summary = completeCounts && (countedRows > 0 || empty || (lines.length === 0 && nonnegativeInteger(output.numMatches)))
      ? `${matchCount}${output.numFiles > 0 ? ` · ${fileCount}` : ''}`
      : countLabel(output.numFiles, 'file')
    if (lines.length === 0 && filenames.length > 0) rows = filenames.map(path => ({ text: cleanText(shortenPath(path, cwd)), kind: 'path' }))
  } else {
    if (typeof output.content !== 'string') return null
    const knownPaths: string[] = []
    for (const path of [...filenames, textOf(input.path)]) {
      for (const candidate of [path, shortenPath(path, cwd)]) {
        const cleaned = cleanText(candidate)
        if (cleaned !== '' && !knownPaths.includes(cleaned)) knownPaths.push(cleaned)
      }
    }
    rows = grepContentRows(lines, knownPaths, cwd, input['-n'] !== false)
    if (lines.length === 0 && filenames.length > 0) rows = filenames.map(path => ({ text: cleanText(shortenPath(path, cwd)), kind: 'path' }))
    const lineCount = nonnegativeInteger(output.numLines) ? output.numLines : lines.length
    const totalLines = nonnegativeInteger(output.totalLines) ? output.totalLines : lineCount
    summary = totalLines > lineCount
      ? `${lineCount} of ${countLabel(totalLines, 'line')}`
      : lineCount === 0 && lines.length === 0 && output.numFiles === 0 && filenames.length === 0 && !output.truncated
        ? '0 matches'
        : countLabel(lineCount, 'line')
  }

  return { ...header, summary: summary + truncated, rows, failed: props.isErrored }
}
