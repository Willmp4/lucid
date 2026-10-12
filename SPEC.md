# omp-blocks design

A Claude Code mod that draws Edit, Write, Bash, Read, Grep, and Glob calls
as bordered cards in the style of the oh-my-pi (OMP) harness. The skins mod
keeps drawing unsupported tools and payloads. Two prompt keywords fold a
reply to a short summary or read it aloud.

## Goal

Tool calls share rounded borders, shortened paths, and consistent status
colors. Edit and Write show line-numbered diffs. Shell commands, reads,
and searches show useful previews with controls to expand long output.
A card's body shows what the user acts on, at a density level the user
sets. The mod changes presentation only: tool inputs, results,
permissions, and the content Claude receives stay unchanged. The one
exception is a reading keyword, which the mod removes from the prompt
before Claude receives it.

## Scope

In scope:

- The `ToolUse` and `ToolResult` rows of Edit, Write, Bash, Read, Grep, and Glob
- `ToolGroup` rows that hold supported shell, read, and search calls: one
  merged card or the group forced open
- The card density, set by `/omp density`
- At the `blackbox` level, each run of a main-loop turn's calls, drawn as one
  block that Claude's text ends
- Terminal `AssistantMessage` rows that hold a markdown table, or a fenced
  code block over skins' 9,000-character cap
- The usage meters' placement: `AbovePrompt` and `PromptHint`, set by `/omp usage`
- The reading keywords `tldr` and `speak`: their highlight in the prompt box,
  their removal from the prompt, a reply's TLDR fold, and speech through the
  system synthesizer
- The `terminal` surface

Out of scope:

- Unsupported tools and unknown result formats, which pass through to skins
- The `desktop`, `vscode`, and `mobile` surfaces, which pass through
- Image, PDF, notebook, and background-command payloads, which keep native
  UI; at `blackbox`, a background command folds into its block
- Expanding an Edit/Write diff past its row cap, and full programming-language
  syntax highlighting
- Reading the skins palette; this mod's colours are fixed
- A reading mode that persists across turns; each keyword acts on one reply
- A choice of voice; speech uses the synthesizer's default voice
- Folding a reply that scrolled away before its keyword-only `tldr` arrived;
  that summary draws as a row of its own instead

## Location and files

The repository root is the plugin and marketplace root. Claude Code loads
local marketplace installations directly from their checkout; repository
installations use Claude Code's plugin cache.

| File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Manifest: name `omp-blocks`, version, and the skins dependency |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }` |
| `hooks/register.tsx` | Hook wiring: chooses which rows this mod draws |
| `hooks/block.tsx` | Pure functions: tool output to header and rows, rows to a tree |
| `hooks/block.test.ts` | Tests for `block.tsx` and the pass-through rules |
| `hooks/card-model.ts` | Shared card rows, the density view, and terminal text sanitization |
| `hooks/tool-card.tsx` | Card frame, previews by density level, and expansion controls |
| `hooks/group-card.tsx` | A run of reads and searches as one card: per-call rows and the merged header |
| `hooks/density.ts` | `/omp density` parsing and the stored level |
| `hooks/turn-model.ts` | Pure functions: a turn's rows to blocks of calls, results to outcomes, error lines, and block times, background jobs, a block's title and status line, and lines cut to a width |
| `hooks/turn-block.tsx` | A block of a turn's calls: the title and status lines, folded failures, and the open call cards |
| `hooks/shell-command.ts` | Pure functions: a shell command to segments, each segment's program past its wrappers, its class, its name, and the files it names |
| `hooks/shell-command.test.ts` | The splitter, wrapper stripping, the classifier, run names, and targets |
| `hooks/blackbox.test.ts` | The `blackbox` level: the setting, the turn model and its blocks, the blocks drawn through session events, background jobs, line widths, and error lines |
| `hooks/density.test.ts` | Level parsing, the command, persistence, and the reload after `/clear` |
| `hooks/levels.test.ts` | Each level's cards, merged groups and their fallbacks, compact expansion, failures, and caps |
| `hooks/text-style.tsx` | Shared palette, conservative lexical spans, and bounded inline rendering |
| `hooks/text-style.test.ts` | Token boundaries, shell quoting, lossless offsets, and span-budget boundaries |
| `hooks/bash-card.ts` | Shell output, failures, and artifact links |
| `hooks/file-cards.ts` | Read, Grep, and Glob result formatting |
| `hooks/cards.test.ts` | Rendered content, fallback, and expansion transitions |
| `hooks/bash-card.test.ts`, `hooks/file-cards.test.ts` | Tool-result boundary tests |
| `hooks/reply-table.ts` | Pure functions: reply to text and table segments, tables to wrapped box-drawn lines |
| `hooks/reply.tsx` | Draws a reply's tables and hands its other text to skins |
| `hooks/reply-table.test.ts` | Splitting, cell parsing, widths, wrapping, and the rendered reply |
| `hooks/long-fence.ts` | Pure functions: a fence over the cap to pieces under it |
| `hooks/long-fence.test.ts` | Splitting at line boundaries, long lines, language labels, and the rendered reply |
| `hooks/keywords.ts` | Pure functions: a prompt to its counting keywords, their letter ranges, and the text left for Claude |
| `hooks/keywords.test.ts` | Matching, removal, keyword-only prompts, and highlight ranges |
| `hooks/tldr.ts` | The summary request and its result, cut to the line limit |
| `hooks/tldr-block.tsx` | The TLDR block: folded, open, pending, and failed. Named apart from `tldr.ts`, since one import path cannot name both |
| `hooks/speech.ts` | Pure functions: reply markdown to sentences for speech |
| `hooks/speech.test.ts` | Markdown stripping, sentence splits, and the utterance length cap |
| `hooks/reading.test.ts` | The keywords through session events: marks, the fold, the previous reply, speech order and stopping, and failures |
| `hooks/usage.ts` | Meter figures and `/omp usage` parsing |
| `hooks/usage-line.tsx` | The meter line drawn under the prompt |
| `hooks/usage.test.ts` | Meter text, the command, placement persistence, and both slots |
| `types/index.d.ts` | Per-call expansion, opening, and splitting; elapsed time; usage placement; density; meter; turn-record; and reading state declarations |

The mod keeps expansion, compact opening, merged-group splitting, and Bash
duration in `$.state` families keyed by the render request ID: a tool
call's, or a merged group's for its compact opening. Each call expands
independently. At `blackbox` it also keeps each turn's record of its blocks,
keyed by the turn ID; each call's turn, keyed by its `tool_use_id`; and each
block's open state, keyed by its first call's `tool_use_id`. The reading
keywords keep their state as the Reading keywords section describes.

## Hook order

The skins mod draws `Edit` and `Write` rows without calling `next`.
`omp-blocks` declares `"dependencies": ["skins@hellosverre-mods"]` in its
manifest so its render hooks run before skins. Claude Code runs a mod before
its declared dependencies in the user hook chain.

Without that ordering, skins replaces `ToolUse` while `omp-blocks` hides
`ToolResult`, leaving neither an OMP block nor the native diff. Keep skins
installed and enabled. After changing the manifest, run `/reload-plugins`
in each open Claude Code session; subsequent sessions load the order at startup.

## Rows this mod draws

`ui.render` on `{ component: 'ToolUse' }`:

- Terminal Edit and Write calls draw their diff block
- Terminal Bash, Read, Grep, and Glob calls draw a card when the formatter
  recognizes the output
- Unsupported payloads and surfaces return `next(e)`

`ui.render` on `{ component: 'ToolResult' }`:

- Hide the separate result only when the card handles that payload
- Otherwise return `next(e)` so native content and controls remain visible

`ui.render` on `{ component: 'ToolGroup' }`, for a terminal group that holds
Bash, Read, Grep, or Glob:

- At `full`, pass `isExpanded: true` to `next`, so the group cannot hide the
  individual cards
- Below `full`, draw one merged card when every call is Read, Grep, or Glob
  and each call carries the data its card needs, as the following section
  describes; otherwise pass `isExpanded: true` to `next`

At `blackbox`, the rows of a recorded turn follow the turn block rules in
the Turn blocks section, ahead of the rules above.

An expanded group draws each result inside its `ToolUse` row, and a merged
card replaces those rows. A separate `ToolResult` belongs to a standalone
row only, and the rule above holds at every level: each card reaches its
whole payload through **Show all**, and through **Show ▸** first at
`compact`.

## Card density

`/omp density full|balanced|compact|blackbox` stores the level under the
store key `density` and holds it in the `density` atom. `session.start` and
`classic.SessionStart` with the sources `clear`, `resume`, and `fork` load
it, as they load the usage placement. A stored value other than the four
levels reads as `balanced`, the default. `/omp density` reports the level; a
typed value other than the four levels shows the usage line and changes
nothing. `/omp` with neither setting's name shows one usage line for both.

| Level | Purpose |
|---|---|
| `full` | The longest previews: forced-open groups, 16-row previews, 40-row diffs, and 20-row new-file previews |
| `balanced` | A card's body shows what the user acts on: shell results at the end of the output, diffs, and failures |
| `compact` | Each card is one header line inside its border; **Show ▸** opens the `balanced` body |
| `blackbox` | Each run of a turn's calls folds into one block, and Claude's text ends a block and draws between blocks; each call opens as its `compact` card |

A failed call opens in full at every level. Below `full`, an interrupted
call does too, and its border turns red.

### Merged read and search groups

Below `full`, a terminal `ToolGroup` whose calls are all Read, Grep, or Glob
draws one bordered card:

- **Header:** each tool with its call count, in order of first appearance:
  `Read 3 files · Grep 1 pattern`. Read counts files; Grep and Glob count
  patterns. Tool names use the label colour
- **Rows:** one per call: its path, or `pattern · scope`, in the path colour,
  in a column up to 48 cells wide, followed by the summary its own card
  shows. A failed or interrupted call's rows follow its row in full, and the
  border turns red
- **Show all:** marks each call in the `ungrouped` family and draws the group
  forced open, its calls as `full` cards, with **Collapse** beneath. A call
  that joins a live group after the split draws its `balanced` card
- **Compact:** the header alone with **Show ▸**, which opens the rows and the
  **Show all** button; **Collapse** closes them. A group with a failed or
  interrupted call opens without the button

A group stays forced open, with each card on the current level's rules, when
any call is another tool, has no `tool_use_id`, has no input, has no output
once settled, or produces no card (`cardOf` returns `null`).

### Turn blocks

At `blackbox`, one bordered block holds each run of a main-loop turn's tool
calls with no text of Claude's between them. Only calls and their results
fold: every `AssistantMessage` row draws as it does at the other levels. Text
Claude writes after a call closes that call's block, and the next call opens a
new block at its own row, so the turn reads text, block, text, block, and the
final reply, each message next to the calls it follows. Thinking, text that is
only whitespace, and a subagent's text close no block. Subagent (Agent) calls
count as calls; a subagent's own calls do not.

```text
❯ Fix the type error in bash-card.test.ts
⏺ Reading the failing test first.
╭────────────────────────────────────────╮
│ ▸ Reading bash-card.test.ts            │
│   3 calls · 2.4s                       │
╰────────────────────────────────────────╯
⏺ The types folder holds generated files the engine writes on load.
╭────────────────────────────────────────╮
│ ▸ Editing bash-card.test.ts +1 file    │
│   20 calls · 2 failed · 3m 51s         │
╰────────────────────────────────────────╯
⏺ The error is fixed.
```

**Recording.** Render props carry no turn, so session events build the record:

| Event | What it records |
|---|---|
| `turn.start` | The turn running (`liveTurn`), only while the level is `blackbox` |
| `session.append`, door `response`, no `agentId` | The row's text and `tool_use` blocks, in order: text closes the open block, and a call, keyed by `tool_use_id`, joins it or opens the next block, which starts at `$.clock.now()`; each call's turn in `owner` |
| `tool.call`, no `agentId` | The call's stored result, the text the model read, its status, its error line, and for a Bash call the engine moved to the background, `background` with any `timedOutAfterMs`; the result passes on unchanged |
| `session.append`, door `tool-result` | Each answered call's status and, for an error, its error line; each block that holds an answered call ends at `$.clock.now()` |
| `turn.complete`, no `agentId` | The open block closes, ending then if the turn was aborted or no result answered it; an aborted turn marks its running calls interrupted |

A `ToolGroup` call's `tool_use_id` names its call. A row whose call is still
streaming has no record yet; during the turn running, it joins that turn's
open block, or opens the next block when text closed the last one.

**Rows.** Each block draws at its anchor, its first call: in that call's
`ToolUse` row, or in the `ToolGroup` row that holds it. A group that holds
the anchors of two blocks draws both, in turn order. Every other
call row and its `ToolResult` draw an empty `Box`, which leaves no blank line.
A call whose result the block cannot show keeps its own row: a Read, Grep,
Glob, or Bash payload `cardOf` rejects, or another tool's result with no text.
A group holding such a call draws forced open, and each of its `ToolUse` rows
applies these rules. Rows of a turn the level did not record, such as a
resumed session's history, draw at `compact`.

**Background jobs.** A Bash result that carries `backgroundTaskId` stays in
the block: one the engine moved to the background when the call reached its
timeout, and one started with `run_in_background`. Its `ToolUse` and
`ToolResult` rows draw an empty `Box`. It counts as a call and never as a
failure. Below `blackbox`, and in turns the level did not record, such a
result keeps its native rendering.

**Folded**, the default. Each line is cut with `…` to one terminal row at any
`viewport.columns`: the mod measures each line in terminal cells against the
row's room, which is the viewport's width less the block's border, padding,
and indent, and sets `wrap="truncate-end"` as well. The title line needs the
measurement, because a `Button`'s children do not follow their `Text`'s
`wrap`. The title `Button` keeps the whole title as its `label`.

- **Title line:** `▸`, then the title, the first of these that applies:
  1. A block that edits or writes (Edit, Write, NotebookEdit): `Editing`, the
     file it touches most (the first on a tie), and `+N file` or `+N files`
     for the rest. A file shows its basename unless another touched file
     shares it, and its shortened path then
  2. A block with a run segment: `Running` and the first run segment's name,
     with no `+N`
  3. A block with a read: `Reading` and its main target
  4. A block with a search: `Searching` and its main target
  5. Else `Using` and the first call's tool

  The title describes a shell command by what it does rather than quoting it,
  since Claude reads and searches through Bash when no Grep or Glob tool is
  loaded:

  - **Segments:** a command splits on `&&`, `||`, `;`, `|`, a lone `&`, and
    newlines, outside quotes; a heredoc's body, redirections, and their
    targets are dropped. A segment that `|` feeds filters the one before it,
    as `head -40` does after a `grep`, and takes no part in the title
  - **Program:** the first word past the wrappers, which fall away:
    environment assignments (`FOO=bar`), `rtk proxy`, `rtk`, `command`,
    `time`, `timeout N`, and `nice`. A segment whose program is `cd`, `echo`,
    `printf`, `true`, `export`, `sleep`, or `pwd` takes no part
  - **Class:** a search is `grep`, `rg`, `ag`, `find`, `fd`, `ls`, `tree`,
    `git grep`, or `git ls-files`; a read is `cat`, `head`, `tail`, `less`,
    `bat`, `wc`, `sed -n`, `git show`, `git log`, `git diff`, or
    `git status`; anything else is a run
  - **Run name:** the program's basename and up to two more words that are
    neither flags nor paths, such as `npm run lint` or
    `claude plugin validate`. A path argument ends the name as its basename,
    as in `python3 inventory.py`; `.` and `..` end it with nothing added. The
    values of `-C` and `-c` are skipped, so `git -C <dir> worktree add` names
    `git worktree add`
  - **Targets:** a read or search segment's path arguments, past flag values,
    a grep's pattern, and a `sed` script; for a search with no path, its
    pattern (a `find` name, a grep pattern). `.` and `..` name no target. A
    Read call targets its `file_path`; a Grep or Glob call its `path`, else
    its pattern
  - **Main target:** each call counts each distinct target once, paths
    resolved against the working directory and `~` against the home directory
    the working directory sits under (`/Users/<name>`, `/home/<name>`, or
    `/root`), so two spellings of one file count once. The main target is the path
    touched most by the block's read and search calls together, the first on a
    tie; a pattern is the main target only when no path was touched. `+N file`
    or `+N files` counts every other distinct target, a pattern included. A
    read or search that names no target at all titles the block by its command,
    such as `Reading git status`
- **Status line:** `N calls · K failed · <elapsed>`, for the block's own
  calls. `K` counts failed and interrupted calls and is left out at 0. The
  elapsed time runs from the response row that holds the block's first call
  to the last result row that answers one of its calls, and is left out while
  the block is open. While the block is open in the turn running, the line
  ends with the newest running call's label, such as `· Bash: python3 toy.py`.
  A background job reads `· background` there: a call with
  `run_in_background`, or one whose result carries `backgroundTaskId`
- **Failures:** a failed or interrupted call turns the border red and adds
  two lines: `✗` with the call's label, and its error line. A shell failure's
  error line is its first non-empty stderr line, else its last non-empty
  stdout line, where an error prints after the status lines a command wrapper
  prints first. `Exit code N` lines never count, and `Failed` stands in when
  no line qualifies. A failed call's error text holds the command's merged
  output, so it reads as stdout. Another tool's error line is the first line
  of its error text

**Open:** a press on the title line toggles the block's member of
`unfolded`, keyed by its first call, and the arrow turns to `▾`; each block
opens on its own. The block lists its calls in turn order and no text. Each call draws its `compact` card, with its button keys suffixed by
`-<tool_use_id>`, and **Show ▸** opens the call's `balanced` body. A call no
card formats, such as Agent or an MCP tool, draws a card whose rows are the
text the model read. A background job draws one muted row, cut to one terminal
row: `Bash: <command> · moved to background after <N>s`, with `N` the seconds
of `timedOutAfterMs`, or `Bash: <command> · running in background` when the
result carries no timeout.

## Bash, Read, and search cards

| Tool | Header and body |
|---|---|
| Bash | Command, observed elapsed time, stdout, and stderr; failed calls show their complete error text |
| Read | Shortened path, returned line range and total, and content numbered from the returned offset |
| Grep | Pattern and scope; file headings and line numbers where parsing is unambiguous; raw text otherwise |
| Glob | Pattern and scope, returned file count, and shortened matching paths |

What a card's body previews depends on the density level:

| Level | Bash | Read, Grep, and Glob |
|---|---|---|
| `full` | The first 16 rows; the duration follows the summary | The first 16 rows |
| `balanced` | The last 4 stdout rows; artifact rows, stderr, and error rows stay | The header and summary; error rows stay |
| `compact` | The header line until **Show ▸**, then the `balanced` body | The header line until **Show ▸**, then the `balanced` body |

Stderr and error rows never fold. Click **Show all** to expand a card and
**Collapse** to restore its preview. At `full` the button counts the rows it
reveals, `Show all (n more rows)`; below it the button counts every row,
`Show all (n rows)`. Failed calls never fold their output.

Below `full`, a settled Bash call's status and duration stand at the right
of the header row: `✓ 4.2s` in the success colour, or `✗ 4.2s` in the
failure colour for a failed or interrupted call. The summary line stays only
for text beyond the status: the return-code interpretation, or
`Interrupted`. A call restored without timing data shows the marker alone.

At `compact`, the header row holds the title, the Bash marker, and
**Show ▸**; the title truncates with `…` to keep one line. **Show ▸** opens
the `balanced` body under the whole title, and **Collapse** at the right of
the header closes it. A failed or interrupted card opens without the
button.

Bash timing wraps the existing call and forwards its result unchanged.
Calls restored without timing data omit duration rather than estimate it.
Full-output artifact paths remain visible before a long output preview.

Grep preserves blank matches and supports content, filename, and count
modes. Pagination summaries distinguish displayed rows from totals when
the tool supplies those totals. Content-mode `numFiles` is not a reliable
file count and does not appear in its summary. Engine truncation is
separate from the card preview: expansion cannot recover output that the
tool never returned.

Native rendering remains responsible for nontext Read results, background
Bash tasks, and unsupported structured payloads. At `blackbox`, a recorded
turn's background Bash task folds into its block instead.

## Semantic colour hierarchy

All six tools use one fixed OMP dark Catppuccin palette:

| Content | Colour | Behavior |
|---|---|---|
| Tool label | Peach `#fab387` | Bold; the label, not the whole command, carries emphasis |
| Ordinary output | Softer `#a6adc8` | Default for shell, read, and search text |
| Path or filename | Cyan `#89dceb` | Known tool paths take precedence over words such as `PASS` in filenames |
| Shell command | Mauve `#cba6f7` | Command position in Bash headers and explicit `$ ` output prompts |
| Shell flag | Blue `#89b4fa` | Unquoted flags; `--` ends flag recognition |
| Quoted shell string | Amber `#f9e2af` | Closed single- or double-quoted strings, including their quotes |
| Date, timestamp, or duration | Muted `#7f849c` | ISO-style dates/timestamps, clock times, and `ms`, `s`, `m`, or `h` durations |
| Line number | Dim `#6c7086` | Existing read/search and diff-context gutters |
| Success marker | Green `#a6e3a1` | Standalone `PASS`, `PASSED`, `SUCCESS`, `SUCCEEDED`, or `OK` |
| Warning marker | Amber `#f9e2af` | Standalone `WARN`, `WARNING`, or `Interrupted` |
| Failure marker | Red `#f38ba8` | Standalone `FAIL`, `FAILED`, `ERROR`, `FATAL`, or `Failed` |

Recognition stays lexical, not a programming-language or shell interpreter.
Paths use explicit path shapes, common filename extensions, and known
filenames. Words embedded in identifiers, larger words, filenames, or URLs
do not become status markers. File-tool rows retain authoritative path
bounds, including paths with spaces or separator characters.

Status words colour text only; they never determine call success or failure.
Failed calls and stderr remain red across their entire rows. Diff additions
and removals retain their green/red text and shaded backgrounds. Only
context text receives inline semantic spans inside Edit/Write bodies.

Inline lexical highlighting adds at most 24 spans per line and uses a
128-child-node budget per card, including styled shell/read/search headers.
Filename-row colours and the existing Edit/Write headers add no lexical
spans. Near the host's 100,000-character serialized-tree limit, the renderer
reserves headroom from an unsplit base tree before adding spans. If styling
cannot fit, the base tree keeps the same text and controls. Short cards
avoid the extra serialization. Remaining text keeps its original characters
and base colour after a limit. Plain text adds no span arrays or styled nodes.
Whitespace, blank lines, offsets, wrapping, row caps, expansion state,
sanitization, native fallback, and tool inputs/results remain unchanged.
The renderer introduces no ANSI passthrough or external dependency.

## Edit and Write blocks

### Frame

- An outer `Box`: `borderStyle: "round"`, `flexDirection: "column"`,
  `width: "100%"`, `paddingX: 1`
- Border colour `#45475a`; `#f38ba8` when `isErrored` is true

### Header

One row: `✎ `, the tool name, `: `, the path, two spaces, and the counts.

- Tool name: `#fab387`, bold
- Path: `#89dceb`. A path inside the session's working directory shows
  relative to it. Any other path replaces a leading `/Users/<name>` or
  `/home/<name>` with `~`
- The path comes from `output.filePath` once the call resolves, and from
  `input.file_path` while it runs
- Counts for a diff: `(+a/-r)`, where `a` counts `+` lines and `r` counts `-`
  lines across all hunks. `+a` is `#a6e3a1`, `-r` is `#f38ba8`, and the
  brackets and slash are `#7f849c`
- Counts for a new file: `(+n)`, where `n` is the line count of
  `output.content`
- No counts before output arrives, after an error, or after an interruption

### Body by state

| State | Test | Body |
|---|---|---|
| Running | `isRunning` and `output === undefined` | None |
| Interrupted | `isInterrupted` | `Interrupted` in `#f9e2af` |
| Errored | `isErrored` | The first line of the output text in `#f38ba8` |
| New file | `Write` with `output.type === "create"` | The first lines of `output.content` as added rows, numbered from 1, up to the length cap |
| Diff | `output.structuredPatch` has hunks | Diff rows, described in the following section |
| No diff | `structuredPatch` is empty | `no changes shown` in `#7f849c` |

Claude Code can supply completed output while `isRunning` remains true.
The output takes precedence: render its counts and rows immediately rather
than waiting for another event to clear the flag.

### Diff rows

Each hunk walks its `lines` with two counters, `old` from `oldStart` and
`new` from `newStart`:

| Line prefix | Row number | Counters after |
|---|---|---|
| ` ` (context) | `new` | `old + 1`, `new + 1` |
| `-` (removed) | `-old` | `old + 1` |
| `+` (added) | `+new` | `new + 1` |
| `\` (no-newline marker) | Row skipped | Unchanged |

- A `…` row in `#7f849c` separates consecutive hunks
- Leading spaces and tabs on removed and added rows show as one `·` each, in
  `#6c7086`. Context rows keep their whitespace

### Row colours

| Row | Number | Text | Background |
|---|---|---|---|
| Removed | `#f38ba8` | `#f38ba8` | `#53394c` |
| Added | `#a6e3a1` | `#a6e3a1` | `#394545` |
| Context | `#6c7086` | `#7f849c` | None |

The background shading of these colours comes from the Catppuccin Mocha
`delta` theme.

### Row layout

- Each row is a `Box` with `flexDirection: "row"` and `width: "100%"`; changed
  rows carry the `backgroundColor`, so the shading reaches the right border
- The number column is a `Text` of fixed width: the widest row number in the
  block plus its sign, right-aligned, followed by two spaces. It does not
  shrink
- The line text is a `Text` with `wrap: "wrap"` and `flexGrow: 1`. A long line
  wraps under the text column, so the number column stays clear

### Length cap

- At `full`, a diff body shows at most 40 rows, counting `…` separators, and
  a new-file body at most 20 rows
- Below `full`, either body shows at most 12 rows
- Past the cap, one final row reads `… n more lines` in `#7f849c`, where `n`
  counts the rows left out

### Compact header

At `compact`, an Edit or Write block draws its header alone, cut with `…` to
one line, with its counts and **Show ▸** at the right. **Show ▸** opens the
capped rows and **Collapse** closes them; the state is the call's member of
`expanded`. A failed or interrupted block opens with a red border and no
button.

## Reply tables

skins draws each table row on one line and cuts a cell that outgrows its
column with `…`. omp-blocks draws a terminal `AssistantMessage` whose text
holds a table, so the tables wrap. A reply that holds neither a table nor a
fence over the cap in the Long code blocks section returns `next(e)`.

- **Detection:** a line with a pipe, followed by a delimiter row whose cells
  match `:?-+:?` and whose cell count equals the header's. Body rows continue
  while lines are nonblank and hold a pipe. Lines inside a fenced code block
  (three or more backticks or tildes) are never searched. A line indented four
  spaces is never a header
- **Cells:** outer pipes are dropped and `\|` stays a literal pipe. A row with
  fewer cells than the header is padded with empty cells; extra cells are
  dropped. Code spans draw without backticks in `#89dceb`, bold drops its
  markers, a link draws as its text, and backslash escapes resolve
- **Widths:** the budget is the viewport's columns less a two-column inset,
  less the borders and one padding cell each side of every cell. Natural widths
  that fit stay. Otherwise the widest column narrows one cell at a time down to
  its longest word (at most 20 cells), then down to three cells
- **Wrapping:** greedy word wrap; runs of spaces collapse; a word longer than
  its column breaks across lines. Column alignment from the delimiter row
  applies to every line of a cell
- **Frame:** `╭┬╮`, `├┼┤`, and `╰┴╯` rules in `#45475a`, bold header text, and a
  rule between body rows once any body row wraps. Each line is one `Text`
  with `truncate-end` as a guard. Past 1,500 styled spans a table draws one
  plain span per line
- **Other text:** each text segment draws through `$.skins.markdown`, so code
  blocks, charts, and math keep the skins look. Where skins draws nothing, or
  is absent, the segment draws as Claude Code's `Markdown`

## Long code blocks

skins draws a reply only when every text segment and every fence in it is at
most 9,000 characters (`MAX_MARKDOWN` in the skins mod's `hooks/reply.ts`).
One longer block hands the whole reply back to Claude Code's drawing, which
shows every line without colour. A long file printed in a reply, such as a
run's `INTENT.md`, crosses that cap.

- **Detection:** a fence, read as the table splitter reads fences (three or
  more backticks or tildes), whose raw text, markers included, exceeds 9,000
  characters
- **Split:** the fence's body splits at line boundaries into pieces. Each
  piece repeats the opening line, language label included, and the closing
  marker, and its raw text stays at most 9,000 characters. A single line
  longer than a piece can hold splits at that length. The pieces hold every
  line once, in order
- **Drawing:** the reply draws as its segments in order: text, tables, and
  fence pieces. Text and each piece draw through `$.skins.markdown`, and
  tables draw as the Reply tables section describes. Where skins draws
  nothing, or is absent, a segment draws as Claude Code's `Markdown`
- **Pass-through:** a reply keeps `next(e)` when a text segment outside every
  fence exceeds 9,000 characters, since Claude Code's `Markdown` takes at most
  10,000 characters a block. It also keeps `next(e)` when the reply's estimated
  tree passes 80 % of the host's tree limit: the host refuses a tree of more
  than 20,000 nodes, strings included, and draws its own; it sets no limit on
  a tree's serialized size. The estimate scales the reply's length by 0.3 nodes
  a character, the densest ratio measured from skins' drawing of a
  9,000-character fence (0.06 to 0.27 across TypeScript, Python, Markdown, and
  JSON), so a reply past about 53,000 characters keeps `next(e)`
- **Folds and copy:** `$.skins.markdown` draws no fold or copy controls, so
  each piece shows whole whatever `/skin fold` holds, and the reply has no
  **Copy** button. A reply that fits the cap keeps skins' drawing, where
  `/skin fold off` shows its blocks whole

`/skin fold off` changes only what skins draws itself: reply code blocks
and tables, the opened rows of tools this mod leaves to skins (Agent,
WebFetch, and MCP tools), and the shell output of the Bash calls this mod
hands back (background jobs and image output). The cards at every density
level read no skins setting.

## Reading keywords

Two words in a prompt act on Claude's reply instead of reaching Claude:
`tldr` folds a reply to a short summary, and `speak` reads a reply aloud. Each
keyword acts on one reply; nothing carries into the next turn.

### Matching

- A keyword is `tldr`, `tl;dr`, or `speak`, in any letter case, as a whole
  word: no letter, digit, `-`, or `_` touches it on either side
- `speak` is an ordinary word, so a keyword counts only inside a run at the
  start or the end of the prompt. A run is one or more keywords separated by
  whitespace or `,`
- A leading run can end in `:` or `,`. A trailing run can end in `.`
- `speak, fix the failing test`, `tldr: what changed?`, and
  `fix the failing test. tldr speak` each count. `ask them to speak first`
  does not
- The other text is the prompt with the run, its trailing `:`, `,`, or `.`,
  and the surrounding whitespace removed
- Keywords count only in the user's own prompts, whose `origin.kind` is
  `composer`. Prompts from a plugin, a peer, the SDK, or a bridge pass
  unchanged

### Highlight

`prompt.edit` calls `next(e)`, then adds one decoration for each letter of
each counting keyword in the answer's text. The letters cycle through the
theme keys Claude Code paints `ultrathink` with: `rainbow_red`,
`rainbow_orange`, `rainbow_yellow`, `rainbow_green`, `rainbow_blue`,
`rainbow_indigo`, and `rainbow_violet`. Decorations already on the answer
stay. A word that stops counting, such as a trailing `speak` that more text
follows, loses its colour on that edit.

The theme resolves each key: a live session drew them as Claude Code's dark
theme holds them, from `rgb(235,95,87)` to `rgb(200,130,180)`, so no hex
value stands in.

### Submit

`prompt.submit`, for a prompt whose keywords count:

| Prompt | Result |
|---|---|
| Keywords and other text | `next({ ...e, text })` with the other text. The turn the prompt starts carries the keywords as its marks |
| Keywords only | `{ drop: reason }`. The keywords act on the previous reply |
| No counting keyword | `next(e)` |

A prompt submitted while a turn runs (`e.turnId` set) marks that turn.
Otherwise the marks wait in `pendingMarks`, and the next main-loop
`turn.start` takes them.

The drop reason reads `Summarizing the previous reply`, `Reading the previous
reply aloud`, or `Summarizing and reading the previous reply`. With no
previous reply in this session, it reads `No reply yet`, and nothing else
runs.

Every `composer` prompt, keywords or not, stops speech in progress after the
sentence it is speaking.

### Replies

`session.append` on the main loop, at the `response` door, records each row
that holds text: `lastReply` takes its `uuid` and text, and during a marked
turn `turnReply` takes its `uuid` for that turn. The turn's last text row is
its final reply.

`turn.complete` on the main loop with `reason` `answer` runs the turn's
marks on `e.answer` and the final reply's row. Any other reason drops the
marks. A turn with no text row runs nothing.

An `AssistantMessage` render's `requestId` equals the `uuid` that
`session.append` recorded for the row, as a live session confirmed, so the
TLDR state is keyed by that `uuid`.

### TLDR

The summary is one `$.model.complete` call:

| Field | Value |
|---|---|
| `model` | `haiku` |
| `system` | `Summarize a coding assistant's reply for the person who asked for it. Write one to three short lines of plain text with no headings or lists. Lead with the outcome. Copy any question the reply asks the reader, and any failure it reports, word for word.` |
| `prompt` | The reply's text inside `<reply>` and `</reply>` |
| `maxTokens` | 300 |
| `effort` | `low` |
| `timeoutMs` | 30,000 |

The result keeps its first six nonblank lines, trimmed. A result with no
text, an API error, or a timeout fails with that reason.

The hook starts the call and returns without waiting for it. The `tldr`
family, keyed by the reply's row, holds `pending`, `ready` with the text, or
`failed` with the reason. A marked final reply draws:

| State | Drawing |
|---|---|
| `pending` | The reply's usual drawing, then a muted `Summarizing…` line |
| `ready`, folded (the default) | A rounded block in the card border colour: the label `TLDR`, the summary wrapped to the width, and **Show ▸**. The reply stays hidden |
| `ready`, open | The block with **Collapse** in place of **Show ▸**, then the reply's usual drawing |
| `failed` | The reply's usual drawing, then a muted `TLDR failed: <reason>` line |

The usual drawing is what this mod draws for the reply without a mark: its
tables and long fences, or `next(e)`.

A keyword-only `tldr` summarizes `lastReply` the same way and writes the
result with `$.ui.log`, whose rows hold one line each: a
`TLDR · previous reply` row, then the summary's lines joined into one row, or
one `TLDR failed: <reason>` row. The previous reply keeps its drawing, since it might
sit in scrollback, where a redraw does not reach.

### Speech

The text for speech comes from the reply's markdown:

- Fenced code blocks, tables, and HTML drop out
- Headings, list markers, emphasis, and quote markers lose their markers
- A link reads as its text, inline code as its text, and a bare URL as
  `link`
- The text splits into sentences after `.`, `!`, or `?` followed by
  whitespace, and at every blank line, heading, and list item. A sentence over 4,096 characters, the
  synthesizer's cap, splits at the last whitespace under it

Sentences play in order, one `$.audio.speak` call each, with the default
voice. A `speech` counter holds the current reading. A `composer` prompt and
another reading each advance it, and a reading stops before any sentence whose
counter value is out of date. One reading plays at a time.

| Marks | What plays |
|---|---|
| `speak` | The reply, when the turn ends |
| `tldr speak` | The summary once it is `ready`. A failed summary reads the reply instead |
| Keyword-only `speak` | `lastReply`, at once |
| Keyword-only `tldr speak` | The summary of `lastReply`, once it is ready |

A rejected `speak` call stops the reading and shows a toast: `Speech failed:
<cause>`. A reply with no text left after stripping plays nothing.

### State

| Atom or family | Key | Holds |
|---|---|---|
| `pendingMarks` | none | The keywords of a prompt whose turn has not started |
| `marks` | turn ID | The turn's keywords |
| `readingTurn` | none | The main-loop turn running, for the rows that follow its marks |
| `turnReply` | turn ID | The `uuid` of the turn's last text row |
| `lastReply` | none | The `uuid` and text of the last main-loop text row |
| `tldr` | reply row | `pending`, `ready`, or `failed` |
| `tldrOpen` | reply row | Whether the block is open |
| `speech` | none | The current reading's counter |

`/clear`, `/resume`, and `/branch` reset `$.state`. After them, a
keyword-only prompt finds no previous reply until Claude answers again.

## Usage meter placement

`/omp usage above|below` stores the placement under the store key `usage`
and holds it in the `usage` atom; any other value reads as `above`.
`/omp usage` reports it, and other arguments show the usage line.

| Placement | `AbovePrompt` | `PromptHint` |
|---|---|---|
| `above` (default) | `next(e)`: the skins band with its Compact button | `next(e)` |
| `below` | An empty `Box`, unless a survey holds the band | The meter line, then the engine's hint line |

The meter line reads `$.session.usage()`: context and each plan limit as an
eight-cell `▰▱` bar, its percent in bold, and its label muted. The bar is
mauve, amber from 80 %, and red from 95 %. A limit's kind reads as `5h` or
`7d`. The `meters` atom refreshes on `session.start`, `session.measure`, a
main-loop `turn.complete`, and a placement change; identical figures keep
the previous value, so the line does not redraw.

`/clear`, `/resume`, and `/branch` reset `$.state` and skip `session.start`,
so `classic.SessionStart` with those sources reloads the placement and the
figures.

## Testing

`hooks/block.test.ts` covers:

1. Row numbering across two hunks, including the `…` separator
2. Counts for a mixed diff, and `(+n)` for a new file
3. Leading-whitespace dots on changed rows, and none on context rows
4. The 40-row diff cap and the 20-row new-file cap with the `… n more lines`
   count
5. The running, interrupted, errored, and no-diff states
6. Path shortening: inside the working directory, under a home directory, and
   elsewhere
7. Pass-through: a `WebFetch` row and an `Edit` row on the desktop surface
   both reach `next`
8. Completed Write and Edit output remains visible when `isRunning` lags

The card suites cover returned line offsets, blank lines, trustworthy Grep
grouping, ambiguous search text, pagination, native fallback, failure
visibility, and independent expand/collapse transitions.

Semantic tests cover whole-token boundaries, escaped and incomplete shell
quotes, exact filename/scope bounds, UTF-16 offsets, unstyled text beyond
span and serialized-size budgets, and error/diff colour precedence.

`hooks/reply-table.test.ts` covers table detection between paragraphs,
tables inside fences, mismatched delimiter rows, escaped pipes, width
fitting, word wrap and word breaking, wide characters, a long cell drawn in
full at exactly the budget width, inline code and bold, row rules, and
pass-through for replies without tables and for the desktop surface.

`hooks/long-fence.test.ts` covers a fence at exactly 9,000 characters and
one past it, the pieces' language labels and line order, a line longer than
a piece, a reply that holds both a table and a long fence, a long prose
segment and an oversized reply that keep `next(e)`, and the desktop surface.

`hooks/keywords.test.ts` covers each keyword in each letter case, `tl;dr`,
leading and trailing runs with their punctuation, a keyword in the middle of
a prompt, a keyword inside a longer word, keyword-only prompts, the text left
for Claude, and the letter ranges of the highlight. `hooks/speech.test.ts`
covers code blocks, tables, and HTML dropped; markers stripped; links, inline
code, and bare URLs; sentence splits; and the 4,096-character cap.

`hooks/reading.test.ts` drives session events with a stubbed `$.model` and
`$.audio`. It covers the highlight's decorations beside existing ones, the
prompt rewrite and its marks, a prompt submitted mid-turn, keyword-only
drops and their reasons, no previous reply, each TLDR state and the
**Show ▸** and **Collapse** transitions, the summary request's fields and
the six-line cut, a summary that fails or times out, an aborted turn, the
previous reply's `$.ui.log` row, speech order, a prompt that stops a reading
after its sentence, `tldr speak` with a ready and a failed summary, a
rejected `speak` call, subagent turns, prompts from other origins, and the
desktop surface.

`hooks/usage.test.ts` covers the meter line, the command's replies, store
persistence, the band hidden and restored, a survey keeping the band, the
meter line above the hint line, and the reload after `/clear`.
Rendered-text queries use exact matches for individual styles; precedence
checks permit nested or inherited spans but reject conflicting colours.

`hooks/blackbox.test.ts` covers the `blackbox` setting, the turn model's
blocks, anchors, times, title rules, status line, and labels, and the blocks
drawn through session events: the folded lines and their truncation, failures
and interruptions while folded, hidden call rows that draw nothing, Claude's
text drawing before, between, and after the blocks, text ending a block and
the next call opening one, each block's own title, count, time, and open
state, thinking and a subagent's text closing no block, a group that spans
two blocks, an answer that one more call follows, the open call cards in turn
order with no text, each call's **Show ▸**, the call in progress, streaming calls, Agent calls, subagent rows,
results the block cannot show, unrecorded turns at `compact`, the other levels
with the same events, and the desktop surface. It also covers background jobs
moved there by a timeout or by `run_in_background`, and their native rows at
the other levels; one-row folded lines at 40 and 200 columns; the error
line's choice of stderr, stdout, and `Failed`; and titles drawn from shell
commands by what they run, read, or search. `hooks/shell-command.test.ts`
covers the splitter, wrapper stripping, the classifier, run names, and
targets.

`hooks/density.test.ts` covers level parsing, the command's replies and its
registration, store persistence, the fallback for a stored unknown level,
and the reload after `/clear`. `hooks/levels.test.ts` covers `full` against
today's previews, the `balanced` Bash tail and header marker, `balanced`
single-card summaries, merged groups with their split, fallbacks, and mixed
groups, compact header lines and their expansion, failures at every level,
the 12-row Edit and Write cap, and result hiding at every level. The card
suites in `hooks/cards.test.ts` run at `full`.

Verification before reporting completion:

1. `claude plugin validate <mod folder>/.claude-plugin/plugin.json --strict`
   reports no errors or warnings
2. `claude plugin test <mod folder>` passes
3. Live Write and Edit calls draw bordered blocks, counts, and line-numbered
   content without restarting the session
4. Live Bash, Read, Grep, and Glob calls draw their cards; mouse clicks expand
   and collapse long output while failures remain visible

The live smoke check runs Claude Code in Herdr with disposable files under `/tmp/`.
It verifies a two-line Write followed by an Edit that replaces one line:
the Write shows `(+2)`, and the Edit shows `(+1/-1)` with removed, added,
and context rows.

The extended smoke check exercises Bash success and intentional failure,
a Read starting at line three, all Grep modes with paginated results,
single-file blank matches, and Glob. A long Read reveals its final line
after **Show all** and hides it again after **Collapse**.

The reading smoke check runs in the same session:

1. `fix nothing, reply with three paragraphs. tldr` lights `tldr` as it is
   typed, and the reply folds to a TLDR block that **Show ▸** opens
2. A keyword-only `tldr` writes a `TLDR · previous reply` row and starts no
   turn
3. `speak` reads the previous reply aloud, and a following prompt stops it
   after the sentence in progress
4. A reply that prints a 10,000-character file draws it coloured, as
   consecutive cards, and draws it whole with `/skin fold off`
