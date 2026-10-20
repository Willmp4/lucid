import { expect, test } from 'claude-code/testing'

import { classify, runName, shellActions, splitCommand, targetsOf, unwrap } from './shell-command'

const words = (command: string) => splitCommand(command).map(segment => segment.words)

// The splitter.

test('a command splits into segments on &&, ||, ;, and |', () => {
  expect(words('cd /tmp/x && npm test')).toEqual([['cd', '/tmp/x'], ['npm', 'test']])
  expect(words('make || echo failed; ls src | wc -l')).toEqual([['make'], ['echo', 'failed'], ['ls', 'src'], ['wc', '-l']])
  expect(splitCommand('ls src | wc -l').map(segment => segment.piped)).toEqual([false, true])
})

test('quoted text keeps its separators and loses its quotes', () => {
  expect(words('grep -nE "name:|registerTool|tool\\(|description" /work/index.mjs | head -40; wc -l /work/index.mjs')).toEqual([
    ['grep', '-nE', 'name:|registerTool|tool\\(|description', '/work/index.mjs'],
    ['head', '-40'],
    ['wc', '-l', '/work/index.mjs'],
  ])
  expect(words("echo 'a && b; c' && find . -name '*.ts'")).toEqual([['echo', 'a && b; c'], ['find', '.', '-name', '*.ts']])
})

test('newlines end a segment and a heredoc body is no command', () => {
  expect(words('cat > out.txt <<\'EOF\'\nrm -rf build; npm publish\nEOF\nls src')).toEqual([['cat'], ['ls', 'src']])
  expect(words('npm test\ngit status')).toEqual([['npm', 'test'], ['git', 'status']])
})

test('redirections and command substitutions stay out of the words', () => {
  expect(words('npm test 2>&1 > log.txt')).toEqual([['npm', 'test']])
  expect(words('echo "$(git rev-parse HEAD)" && make')).toEqual([['echo', '$(git rev-parse HEAD)'], ['make']])
})

// Wrappers.

test('wrappers fall away to leave the program and its arguments', () => {
  expect(unwrap(['FOO=1', 'BAR=two', 'npm', 'test'])).toEqual(['npm', 'test'])
  expect(unwrap(['rtk', 'proxy', 'find', '.', '-name', '*.ts'])).toEqual(['find', '.', '-name', '*.ts'])
  expect(unwrap(['rtk', 'git', 'status'])).toEqual(['git', 'status'])
  expect(unwrap(['command', 'grep', 'x'])).toEqual(['grep', 'x'])
  expect(unwrap(['time', 'npm', 'test'])).toEqual(['npm', 'test'])
  expect(unwrap(['timeout', '30', 'npm', 'test'])).toEqual(['npm', 'test'])
  expect(unwrap(['nice', '-n', '10', 'make'])).toEqual(['make'])
  expect(unwrap(['nice', 'rtk', 'proxy', 'ls'])).toEqual(['ls'])
})

// The classifier.

test('searches, reads, and runs are told apart by program', () => {
  for (const command of ['grep x', 'rg x', 'ag x', 'find .', 'fd x', 'ls', 'tree', 'git grep x', 'git ls-files', 'git -C ../repo grep x']) {
    expect(classify(command.split(' '))).toBe('search')
  }
  for (const command of ['cat a', 'head a', 'tail a', 'less a', 'bat a', 'wc a', 'sed -n 1p a', 'git show', 'git log', 'git diff', 'git status']) {
    expect(classify(command.split(' '))).toBe('read')
  }
  for (const command of ['sed -i s/a/b/ a', 'git commit', 'git init', 'npm test', 'python3 toy.py', '/opt/homebrew/bin/npx tsc']) {
    expect(classify(command.split(' '))).toBe('run')
  }
})

test('trivial programs classify as nothing', () => {
  for (const program of ['cd', 'echo', 'printf', 'true', 'export', 'sleep', 'pwd']) expect(classify([program, 'x'])).toBeNull()
})

// Naming.

test('a run is named by its program and up to two plain words, a path ending it', () => {
  expect(runName(['python3', 'inventory.py'])).toBe('python3 inventory.py')
  expect(runName(['npm', 'test'])).toBe('npm test')
  expect(runName(['npm', 'run', 'lint'])).toBe('npm run lint')
  expect(runName(['claude', 'plugin', 'validate', '.', '--strict'])).toBe('claude plugin validate')
  expect(runName(['git', 'init'])).toBe('git init')
  expect(runName(['python3', 'scripts/gen.py', '--all'])).toBe('python3 gen.py')
  expect(runName(['npx', 'tsc', '--noEmit', '-p', '.'])).toBe('npx tsc')
  expect(runName(['git', '-C', '~/projects/lucid-blocks', 'worktree', 'add', '../wt', 'main'])).toBe('git worktree add')
  expect(runName(['./observe', '--marlin', '-d'])).toBe('observe')
})

// Targets.

const target = (kind: 'path' | 'pattern', text: string) => ({ kind, text })

test('a search targets its paths, else its pattern', () => {
  expect(targetsOf(['grep', '-n', 'foo', 'src/a.ts', 'src/b.ts'])).toEqual([target('path', 'src/a.ts'), target('path', 'src/b.ts')])
  expect(targetsOf(['grep', '-rn', 'TODO'])).toEqual([target('pattern', 'TODO')])
  expect(targetsOf(['grep', '-A', '3', '-e', 'foo', 'lib'])).toEqual([target('path', 'lib')])
  expect(targetsOf(['find', '.', '-name', '*.ts'])).toEqual([target('pattern', '*.ts')])
  expect(targetsOf(['find', 'src', '-name', '*.ts'])).toEqual([target('path', 'src')])
  expect(targetsOf(['ls', '-la', 'src'])).toEqual([target('path', 'src')])
  expect(targetsOf(['ls', '-la'])).toEqual([])
  expect(targetsOf(['git', 'ls-files', 'hooks'])).toEqual([target('path', 'hooks')])
})

test('a read targets the files it names', () => {
  expect(targetsOf(['head', '-n', '40', '/work/notes.txt'])).toEqual([target('path', '/work/notes.txt')])
  expect(targetsOf(['sed', '-n', '1,40p', 'toy.py'])).toEqual([target('path', 'toy.py')])
  expect(targetsOf(['cat', 'Makefile', 'README.md'])).toEqual([target('path', 'Makefile'), target('path', 'README.md')])
  expect(targetsOf(['git', 'diff', 'main', '--', 'src/a.ts'])).toEqual([target('path', 'src/a.ts')])
  expect(targetsOf(['git', 'status'])).toEqual([])
})

test('a command yields one action per segment that does something, a pipe’s reader left out', () => {
  expect(shellActions('cd /tmp/x && rtk proxy npm test 2>&1 | tail -20')).toEqual([{ kind: 'run', name: 'npm test', targets: [] }])
  expect(shellActions('grep -nE "name:|tool" /work/index.mjs | head -40; wc -l /work/index.mjs')).toEqual([
    { kind: 'search', name: 'grep', targets: [target('path', '/work/index.mjs')] },
    { kind: 'read', name: 'wc', targets: [target('path', '/work/index.mjs')] },
  ])
  expect(shellActions('sleep 3 && echo done')).toEqual([])
})
