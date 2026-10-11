import type { ElementTable, RenderElement } from 'claude-code'

// The OMP dark Catppuccin palette, shared by all six tool renderers.
export const COLORS = {
  border: '#45475a',
  borderErr: '#f38ba8',
  name: '#fab387',
  path: '#89dceb',
  output: '#a6adc8',
  muted: '#7f849c',
  dim: '#6c7086',
  command: '#cba6f7',
  flag: '#89b4fa',
  quote: '#f9e2af',
  add: '#a6e3a1',
  addBg: '#394545',
  del: '#f38ba8',
  delBg: '#53394c',
  warn: '#f9e2af',
} as const

export type Tone = 'command' | 'flag' | 'quote' | 'path' | 'muted' | 'success' | 'warning' | 'failure'
export type Span = { start: number; end: number; tone: Tone }
export type InlineBudget = { remaining: number }

// Bound added Text nodes independently of the existing row and expansion limits.
export const INLINE_NODE_LIMIT = 128
const LINE_SPAN_LIMIT = 24
const EMPTY_SPANS: readonly Span[] = []
const TONE_COLOR = {
  command: COLORS.command,
  flag: COLORS.flag,
  quote: COLORS.quote,
  path: COLORS.path,
  muted: COLORS.muted,
  success: COLORS.add,
  warning: COLORS.warn,
  failure: COLORS.del,
} as const

const FILENAME = /^(?:[\w@%+.-]+\.(?:md|txt|log|json|jsonl|ya?ml|toml|ini|conf|config|csv|ts|tsx|js|jsx|mjs|cjs|py|rb|rs|go|java|c|h|cpp|hpp|sh|bash|zsh|html|css|scss|sql|xml|svg|png|jpe?g|gif|pdf|ipynb)|\.(?:env(?:\.[\w.-]+)?|gitignore|gitattributes|npmrc|editorconfig)|README|Makefile|Dockerfile|LICENSE)$/i
const PATH_WORD = /^(?:(?:~|\.{1,2})?\/|[\w@%+.-]+\/)[\w@%+~./-]*[\w@%+~/-]$/
const OUTPUT_TOKEN = /[A-Za-z][A-Za-z\d+.-]*:\/\/[^\s<>"']+|[^\s()\[\]{};,="'`<>]+/g
const OUTPUT_HINT = /[/.:\d]|\b(?:PASSED|PASS|SUCCEEDED|SUCCESS|OK|WARNING|WARN|FAILED|FAIL|ERROR|FATAL|Failed|Interrupted|README|Makefile|Dockerfile|LICENSE)\b/i
const SHELL_PROMPT = /^[ \t]*\$ /
const WHITESPACE = /\s/
const SEPARATOR = /[|;&()]/
const REDIRECT = /[<>]/
const WORD_END = /[\s|;&()<>"']/
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const FLAG = /^--?(?:[A-Za-z0-9][\w-]*(?:=.*)?|)$/
const SUCCESS = /^(?:PASSED|PASS|SUCCEEDED|SUCCESS|OK)$/
const WARNING = /^(?:WARNING|WARN|Interrupted)$/
const FAILURE = /^(?:FAILED|FAIL|ERROR|FATAL|Failed)$/
const TEMPORAL = /^(?:\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?|(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?|\d+(?:\.\d+)?(?:ms|s|m|h))$/

export function highlightSpans(text: string, mode: 'output' | 'command' = 'output', limit = LINE_SPAN_LIMIT): readonly Span[] {
  const cap = Math.min(LINE_SPAN_LIMIT, limit)
  if (cap <= 0 || text === '') return EMPTY_SPANS
  const prompt = mode === 'output' ? SHELL_PROMPT.exec(text) : null
  if (mode === 'command' || prompt !== null) return commandSpans(text, prompt?.[0].length ?? 0, cap)
  if (!OUTPUT_HINT.test(text)) return EMPTY_SPANS

  let spans: Span[] | undefined
  OUTPUT_TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OUTPUT_TOKEN.exec(text)) !== null) {
    const start = match.index
    let end = start + match[0].length
    // Keep punctuation outside a lexical token without changing the source text.
    while (end > start && (text[end - 1] === '.' || text[end - 1] === ':')) end--
    const token = text.slice(start, end)
    let tone: Tone
    if (PATH_WORD.test(token) || FILENAME.test(token)) tone = 'path'
    else if (token.includes(':')) {
      const colon = token.indexOf(':')
      const path = token.slice(0, colon)
      if (PATH_WORD.test(path) || FILENAME.test(path)) {
        ;(spans ??= []).push({ start, end: start + colon, tone: 'path' })
        if (spans.length >= cap) break
        continue
      }
      if (!TEMPORAL.test(token)) continue
      tone = 'muted'
    }
    else if (SUCCESS.test(token)) tone = 'success'
    else if (WARNING.test(token)) tone = 'warning'
    else if (FAILURE.test(token)) tone = 'failure'
    else if (TEMPORAL.test(token)) tone = 'muted'
    else continue
    ;(spans ??= []).push({ start, end, tone })
    if (spans.length >= cap) break
  }
  return spans ?? EMPTY_SPANS
}

function commandSpans(text: string, start: number, cap: number): readonly Span[] {
  let spans: Span[] | undefined
  let index = start
  let command = true
  let flags = true
  let redirect = false
  let assignmentQuote = false
  while (index < text.length && (spans?.length ?? 0) < cap) {
    const char = text[index]!
    if (WHITESPACE.test(char)) {
      if (char === '\n') {
        command = true
        flags = true
      }
      index++
      continue
    }
    if (SEPARATOR.test(char)) {
      command = true
      flags = true
      redirect = false
      index++
      continue
    }
    if (REDIRECT.test(char)) {
      redirect = true
      index++
      continue
    }
    if (char === '#' && (index === start || WHITESPACE.test(text[index - 1]!))) break
    const from = index
    if (char === '"' || char === "'") {
      index++
      while (index < text.length && text[index] !== char) {
        if (char === '"' && text[index] === '\\') index++
        index++
      }
      if (index >= text.length) break
      index++
      ;(spans ??= []).push({ start: from, end: index, tone: 'quote' })
      if (command && !redirect && !assignmentQuote) command = false
      assignmentQuote = false
      redirect = false
      continue
    }
    while (index < text.length && !WORD_END.test(text[index]!)) {
      if (text[index] === '\\' && index + 1 < text.length) index++
      index++
    }
    const word = text.slice(from, index)
    const assignment = command && ASSIGNMENT.test(word)
    assignmentQuote = assignment && (text[index] === '"' || text[index] === "'")
    let tone: Tone | undefined
    if (PATH_WORD.test(word) || FILENAME.test(word)) tone = 'path'
    else if (!assignment && !redirect && command) tone = 'command'
    else if (flags && FLAG.test(word)) tone = 'flag'
    if (tone !== undefined) (spans ??= []).push({ start: from, end: index, tone })
    if (!assignment && !redirect) command = false
    if (word === '--') flags = false
    redirect = false
  }
  return spans ?? EMPTY_SPANS
}

export function drawInline(ui: ElementTable<'terminal'>, text: string, mode: 'output' | 'command', budget: InlineBudget) {
  if (budget.remaining <= 0) return text
  const spans = highlightSpans(text, mode, budget.remaining)
  if (spans.length === 0) return text
  const { Text } = ui
  const children = []
  let end = 0
  for (const span of spans) {
    if (span.start > end) children.push(text.slice(end, span.start))
    children.push(<Text key={`span-${span.start}`} color={TONE_COLOR[span.tone]}>{text.slice(span.start, span.end)}</Text>)
    end = span.end
  }
  if (end < text.length) children.push(text.slice(end))
  budget.remaining -= spans.length
  return children
}

// Serialize only trees whose conservative size estimate approaches the host cap.
// An unsplit base tree preserves output when added styling has no headroom.
export function drawWithinLimit(render: (budget: InlineBudget) => RenderElement, textLength: number, rowCount: number): RenderElement {
  const treeLimit = 100000
  const spanAllowance = 256
  // Reserve worst-case JSON escapes, row layout, and fixed frame/header nodes.
  const estimatedBaseSize = textLength * 6 + rowCount * 640 + 2048
  if (estimatedBaseSize + INLINE_NODE_LIMIT * spanAllowance < treeLimit) {
    return render({ remaining: INLINE_NODE_LIMIT })
  }
  const plain = render({ remaining: 0 })
  const headroom = treeLimit - JSON.stringify(plain).length
  const remaining = Math.min(INLINE_NODE_LIMIT, Math.floor(headroom / spanAllowance))
  if (remaining <= 3) return plain
  const styled = render({ remaining })
  return JSON.stringify(styled).length <= treeLimit ? styled : plain
}
