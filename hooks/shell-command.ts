// Shell commands read by what they do, for the blackbox title: each segment's program past its
// wrappers, classed as a search, a read, or a run, with the files it names. Pure functions.

export type ShellKind = 'search' | 'read' | 'run'
export type ShellTarget = { kind: 'path' | 'pattern'; text: string }
export type ShellAction = { kind: ShellKind; name: string; targets: ShellTarget[] }
// A segment's words, quotes removed, and whether it reads the segment before it through `|`.
export type ShellSegment = { words: string[]; piped: boolean }

const SEARCH: ReadonlySet<string> = new Set(['grep', 'rg', 'ag', 'find', 'fd', 'ls', 'tree'])
const READ: ReadonlySet<string> = new Set(['cat', 'head', 'tail', 'less', 'bat', 'wc'])
const TRIVIAL: ReadonlySet<string> = new Set(['cd', 'echo', 'printf', 'true', 'export', 'sleep', 'pwd'])
const GIT_SEARCH: ReadonlySet<string> = new Set(['grep', 'ls-files'])
const GIT_READ: ReadonlySet<string> = new Set(['show', 'log', 'diff', 'status'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const HEREDOC = /(?<![<\d])<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g
const REDIRECT = /^(\d*|&)(>>?|<<?|>&|<&)/
const REDIRECT_ALONE = /^(\d*|&)(>>?|<<-?|<|>&|<&)$/
// A word a run's name keeps: no quoting, globbing, or expansion left in it.
const PLAIN = /^[A-Za-z0-9@][\w@.:+,=-]*$/
// The flags whose value is the next word, wherever a name or a target is read.
const NAME_VALUES: ReadonlySet<string> = new Set(['-C', '-c'])
const GREP_VALUES: ReadonlySet<string> = new Set([
  '-A', '-B', '-C', '-m', '-g', '-t', '-T', '--include', '--exclude', '--exclude-dir', '--glob', '--type', '--max-count',
])
const FD_VALUES: ReadonlySet<string> = new Set(['-e', '-t', '-E', '-d', '-x', '-X', '--extension', '--type', '--exclude', '--max-depth', '--exec'])
const FIND_PATTERNS: ReadonlySet<string> = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-regex', '-iregex'])
const HEAD_VALUES: ReadonlySet<string> = new Set(['-n', '-c', '--lines', '--bytes'])
const TREE_VALUES: ReadonlySet<string> = new Set(['-L', '-I', '-P'])
const SED_SCRIPTS: ReadonlySet<string> = new Set(['-e', '-f', '--expression', '--file'])
const NONE: ReadonlySet<string> = new Set()

export const baseName = (path: string) => path.replace(/(.)\/+$/, '$1').split('/').at(-1) ?? path
// `.` and `..` name the directory the command already stands in, no file.
const isHere = (word: string) => /^\.{1,2}\/*$/.test(word)
export const isPath = (word: string) => !word.startsWith('-') &&
  (word.includes('/') || word.startsWith('~') || word.startsWith('.') || /[^.\s]\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(word))

// A heredoc's body is input, not commands: its lines go, up to the delimiter.
function dropHeredocs(command: string): string {
  const kept: string[] = []
  let pending: string[] = []
  for (const line of command.split('\n')) {
    if (pending.length > 0) {
      if (line.trim() === pending[0]) pending = pending.slice(1)
      continue
    }
    kept.push(line)
    for (const match of line.matchAll(HEREDOC)) pending.push(match[2]!)
  }
  return kept.join('\n')
}

// The index of the `)` that closes the `(` at `open`.
function closing(text: string, open: number): number {
  let depth = 0
  for (let at = open; at < text.length; at++) {
    if (text[at] === '(') depth++
    else if (text[at] === ')' && --depth === 0) return at
  }
  return text.length - 1
}

// Redirections and their targets are not arguments.
function withoutRedirects(words: readonly string[]): string[] {
  const kept: string[] = []
  for (let at = 0; at < words.length; at++) {
    if (!REDIRECT.test(words[at]!)) kept.push(words[at]!)
    else if (REDIRECT_ALONE.test(words[at]!)) at++
  }
  return kept
}

// Segments split on `&&`, `||`, `;`, `|`, newlines, and grouping parentheses, outside quotes.
export function splitCommand(command: string): ShellSegment[] {
  const text = dropHeredocs(command)
  const segments: ShellSegment[] = []
  let words: string[] = []
  let word = ''
  let started = false
  let piped = false
  const endWord = () => {
    if (started) words.push(word)
    word = ''
    started = false
  }
  const endSegment = (nextPiped: boolean) => {
    endWord()
    const kept = withoutRedirects(words)
    if (kept.length > 0) segments.push({ words: kept, piped })
    words = []
    piped = nextPiped
  }
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!
    const next = text[at + 1]
    if (char === "'") {
      const end = text.indexOf("'", at + 1)
      const stop = end === -1 ? text.length : end
      word += text.slice(at + 1, stop)
      started = true
      at = stop
    } else if (char === '"') {
      started = true
      for (at++; at < text.length && text[at] !== '"'; at++) {
        if (text[at] === '\\' && '$`"\\\n'.includes(text[at + 1] ?? '')) {
          if (text[at + 1] !== '\n') word += text[at + 1]
          at++
        } else if (text[at] === '$' && text[at + 1] === '(') {
          const end = closing(text, at + 1)
          word += text.slice(at, end + 1)
          at = end
        } else {
          word += text[at]
        }
      }
    } else if (char === '\\') {
      if (next !== undefined && next !== '\n') {
        word += next
        started = true
      }
      at++
    } else if (char === '$' && next === '(') {
      const end = closing(text, at + 1)
      word += text.slice(at, end + 1)
      started = true
      at = end
    } else if (char === '`') {
      const end = text.indexOf('`', at + 1)
      const stop = end === -1 ? text.length : end
      word += text.slice(at, stop + 1)
      started = true
      at = stop
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else if (char === '\n' || char === ';' || char === '(' || char === ')') {
      endSegment(false)
    } else if (char === '|') {
      if (next === '|') endSegment(false)
      else endSegment(true)
      if (next === '|' || next === '&') at++
    } else if (char === '&' && next !== '&' && (word.endsWith('>') || word.endsWith('<') || next === '>')) {
      word += char
      started = true
    } else if (char === '&') {
      endSegment(false)
      if (next === '&') at++
    } else {
      word += char
      started = true
    }
  }
  endSegment(false)
  return segments
}

// A segment's words from its program on: environment assignments, `rtk proxy`, `rtk`,
// `command`, `time`, `timeout N`, and `nice` fall away.
export function unwrap(words: readonly string[]): string[] {
  let at = 0
  for (;;) {
    const word = words[at]
    if (word === undefined) break
    if (ASSIGNMENT.test(word)) at++
    else if (word === 'rtk') at += words[at + 1] === 'proxy' ? 2 : 1
    else if (word === 'command' || word === 'time') {
      at++
      while (words[at]?.startsWith('-')) at++
    } else if (word === 'timeout') {
      at++
      while (words[at]?.startsWith('-')) at++
      at++
    } else if (word === 'nice') {
      at++
      while (words[at]?.startsWith('-')) at += words[at] === '-n' ? 2 : 1
    } else break
  }
  return words.slice(at)
}

// The arguments that are not flags or flag values; everything after `--`.
function positionals(args: readonly string[], values: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (arg === '--') return [...found, ...args.slice(at + 1)]
    if (arg.startsWith('-') && arg.length > 1) {
      if (values.has(arg)) at++
    } else found.push(arg)
  }
  return found
}

function gitSubcommand(args: readonly string[]): { name: string; rest: string[] } | undefined {
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (NAME_VALUES.has(arg)) at++
    else if (!arg.startsWith('-')) return { name: arg, rest: args.slice(at + 1) }
  }
  return undefined
}

// A search, a read, or a run; null for a program that does nothing worth a title.
export function classify(words: readonly string[]): ShellKind | null {
  const [first, ...args] = unwrap(words)
  if (first === undefined) return null
  const program = baseName(first)
  if (TRIVIAL.has(program)) return null
  if (program === 'git') {
    const name = gitSubcommand(args)?.name ?? ''
    return GIT_SEARCH.has(name) ? 'search' : GIT_READ.has(name) ? 'read' : 'run'
  }
  if (program === 'sed') {
    const quiet = args.some(arg => arg === '--quiet' || /^-[a-z]*n[a-z]*$/.test(arg))
    return quiet && !args.some(arg => /^(-i|--in-place)/.test(arg)) ? 'read' : 'run'
  }
  return SEARCH.has(program) ? 'search' : READ.has(program) ? 'read' : 'run'
}

// `npm run lint`: the program and up to two plain words past the flags; a path ends the name
// as its basename.
export function runName(words: readonly string[]): string {
  const [first = '', ...args] = unwrap(words)
  const parts = [baseName(first)]
  for (let at = 0, added = 0; at < args.length && added < 2; at++) {
    const arg = args[at]!
    if (arg.startsWith('-')) {
      if (NAME_VALUES.has(arg)) at++
    } else if (isPath(arg)) {
      if (!isHere(arg)) parts.push(baseName(arg))
      break
    } else if (PLAIN.test(arg)) {
      parts.push(arg)
      added++
    } else break
  }
  return parts.join(' ')
}

const paths = (words: readonly string[]): ShellTarget[] =>
  words.filter(word => !isHere(word)).map(text => ({ kind: 'path', text }))
const orPattern = (found: ShellTarget[], pattern: string | undefined): ShellTarget[] =>
  found.length > 0 || pattern === undefined ? found : [{ kind: 'pattern', text: pattern }]

// grep and its kin: the first positional is the pattern unless `-e` gives one; the rest are paths.
function grepTargets(args: readonly string[]): ShellTarget[] {
  let pattern: string | undefined
  let given = false
  const rest: string[] = []
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (arg === '--') {
      rest.push(...args.slice(at + 1))
      break
    }
    if (arg === '-e' || arg === '--regexp' || arg === '-f' || arg === '--file') {
      if (arg === '-e' || arg === '--regexp') pattern ??= args[at + 1]
      given = true
      at++
    } else if (arg.startsWith('-') && arg.length > 1) {
      if (GREP_VALUES.has(arg)) at++
    } else rest.push(arg)
  }
  if (!given) pattern = rest.shift()
  return orPattern(paths(rest), pattern)
}

function findTargets(args: readonly string[]): ShellTarget[] {
  const roots: string[] = []
  let at = 0
  while (at < args.length && !/^[-(!]/.test(args[at]!)) roots.push(args[at++]!)
  let pattern: string | undefined
  for (; at < args.length; at++) {
    if (FIND_PATTERNS.has(args[at]!) && args[at + 1] !== undefined) pattern ??= args[++at]
  }
  return orPattern(paths(roots), pattern)
}

// The files a search or read segment names: its paths, else a search's pattern.
export function targetsOf(words: readonly string[]): ShellTarget[] {
  const [first, ...args] = unwrap(words)
  if (first === undefined) return []
  switch (baseName(first)) {
    case 'git': {
      const sub = gitSubcommand(args)
      if (sub === undefined) return []
      if (sub.name === 'grep') return grepTargets(sub.rest)
      if (sub.name === 'ls-files') return paths(positionals(sub.rest, NONE))
      const at = sub.rest.indexOf('--')
      const named = at === -1 ? positionals(sub.rest, NONE).filter(isPath) : sub.rest.slice(at + 1)
      return paths(named.map(word => word.replace(/^[^:/]+:(?!\/)/, '')))
    }
    case 'grep':
    case 'rg':
    case 'ag':
      return grepTargets(args)
    case 'fd': {
      const [pattern, ...rest] = positionals(args, FD_VALUES)
      return orPattern(paths(rest), pattern)
    }
    case 'find':
      return findTargets(args)
    case 'ls':
    case 'tree':
      return paths(positionals(args, TREE_VALUES))
    case 'head':
    case 'tail':
      return paths(positionals(args, HEAD_VALUES))
    case 'sed': {
      const found = positionals(args, SED_SCRIPTS)
      return paths(args.some(arg => SED_SCRIPTS.has(arg)) ? found : found.slice(1))
    }
    default:
      return paths(positionals(args, NONE))
  }
}

// One action per segment that does something; a segment fed by `|` filters the one before it.
export function shellActions(command: string): ShellAction[] {
  return splitCommand(command).flatMap((segment): ShellAction[] => {
    if (segment.piped) return []
    const kind = classify(segment.words)
    if (kind === null) return []
    const words = unwrap(segment.words)
    if (kind === 'run') return [{ kind, name: runName(words), targets: [] }]
    const program = baseName(words[0]!)
    const name = program === 'git' ? `git ${gitSubcommand(words.slice(1))?.name ?? ''}`.trim() : program
    return [{ kind, name, targets: targetsOf(words) }]
  })
}
