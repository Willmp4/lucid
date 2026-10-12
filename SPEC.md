# omp-blocks design

A Claude Code mod that draws Edit, Write, Bash, Read, Grep, and Glob calls
as bordered cards in the style of the oh-my-pi (OMP) harness. The skins mod
keeps drawing unsupported tools and payloads.

## Goal

Tool calls share rounded borders, shortened paths, and consistent status
colors. Edit and Write show line-numbered diffs. Shell commands, reads,
and searches show useful previews with controls to expand long output.
A card's body shows what the user acts on, at a density level the user
sets. The mod changes presentation only: tool inputs, results,
permissions, and the content Claude receives stay unchanged.

## Scope

In scope:

- The `ToolUse` and `ToolResult` rows of Edit, Write, Bash, Read, Grep, and Glob
- `ToolGroup` rows that hold supported shell, read, and search calls: one
  merged card or the group forced open
- The card density, set by `/omp density`
- At the `blackbox` level, each main-loop turn's calls, drawn as one block
- Terminal `AssistantMessage` rows that hold a markdown table
- The usage meters' placement: `AbovePrompt` and `PromptHint`, set by `/omp usage`
- The `terminal` surface

Out of scope:

- Unsupported tools and unknown result formats, which pass through to skins
- The `desktop`, `vscode`, and `mobile` surfaces, which pass through
- Image, PDF, notebook, and background-command payloads, which keep native
  UI; at `blackbox`, a background command folds into the turn's block
- Expanding an Edit/Write diff past its row cap, and full programming-language
  syntax highlighting
- Reading the skins palette; this mod's colours are fixed
- Voice output, parked for a later design

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
| `hooks/turn-model.ts` | Pure functions: a turn's rows to calls, results to outcomes and error lines, background jobs, the block's title and status line, and lines cut to a width |
| `hooks/turn-block.tsx` | A turn's block: the title and status lines, folded failures, and the open call cards |
| `hooks/shell-command.ts` | Pure functions: a shell command to segments, each segment's program past its wrappers, its class, its name, and the files it names |
| `hooks/shell-command.test.ts` | The splitter, wrapper stripping, the classifier, run names, and targets |
| `hooks/blackbox.test.ts` | The `blackbox` level: the setting, the turn model, the block drawn through session events, background jobs, line widths, and error lines |
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
| `hooks/usage.ts` | Meter figures and `/omp usage` parsing |
| `hooks/usage-line.tsx` | The meter line drawn under the prompt |
| `hooks/usage.test.ts` | Meter text, the command, placement persistence, and both slots |
| `types/index.d.ts` | Per-call expansion, opening, and splitting; elapsed time; usage placement; density; meter; and turn-record state declarations |

The mod keeps expansion, compact opening, merged-group splitting, and Bash
duration in `$.state` families keyed by the render request ID: a tool
call's, or a merged group's for its compact opening. Each call expands
independently. At `blackbox` it also keeps each turn's record, keyed by the
turn ID, and each call's turn, keyed by its `tool_use_id`.

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
| `blackbox` | Each turn's calls fold into one block, and Claude's text draws outside it; each call opens as its `compact` card |

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

At `blackbox`, one bordered block holds every tool call of a main-loop turn,
from the prompt to Claude's final reply. Only calls and their results fold:
every `AssistantMessage` row draws as it does at the other levels, wherever it
falls in the turn. The block draws at the turn's first call, so text written
before that call stays above the block, and each later message draws below it
in turn order, ending with the final reply. Subagent (Agent) calls count as
calls; a subagent's own calls do not.

```text
❯ Fix the type error in bash-card.test.ts
╭────────────────────────────────────────╮
│ ▸ Editing bash-card.test.ts +1 file    │
│   23 calls · 2 failed · 3m 54s         │
╰────────────────────────────────────────╯
⏺ The types folder holds generated files the engine writes on load.
⏺ Building an equivalent tsconfig outside the worktree.
⏺ The error is fixed.
```

**Recording.** Render props carry no turn, so session events build the record:

| Event | What it records |
|---|---|
| `turn.start` | The turn running (`liveTurn`), only while the level is `blackbox` |
| `session.append`, door `response`, no `agentId` | The row's `tool_use` blocks, keyed by `tool_use_id`, appended to the turn's items; each call's turn in `owner` |
| `tool.call`, no `agentId` | The call's stored result, the text the model read, its status, its error line, and for a Bash call the engine moved to the background, `background` with any `timedOutAfterMs`; the result passes on unchanged |
| `session.append`, door `tool-result` | Each answered call's status and, for an error, its error line |
| `turn.complete`, no `agentId` | The turn's `durationMs`; an aborted turn marks its running calls interrupted |

A `ToolGroup` call's `tool_use_id` names its call. A row whose call is still
streaming has no record yet; during the turn running, it joins that turn.

**Rows.** The block draws at the turn's anchor, its first call: in that
call's `ToolUse` row, or in the `ToolGroup` row that holds it. Every other
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
  1. A turn that edits or writes (Edit, Write, NotebookEdit): `Editing`, the
     file it touches most (the first on a tie), and `+N file` or `+N files`
     for the rest. A file shows its basename unless another touched file
     shares it, and its shortened path then
  2. A turn with a run segment: `Running` and the first run segment's name,
     with no `+N`
  3. A turn with a read: `Reading` and its main target
  4. A turn with a search: `Searching` and its main target
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
    touched most by the turn's read and search calls together, the first on a
    tie; a pattern is the main target only when no path was touched. `+N file`
    or `+N files` counts every other distinct target, a pattern included. A
    read or search that names no target at all titles the turn by its command,
    such as `Reading git status`
- **Status line:** `N calls · K failed · <elapsed>`. `K` counts failed and
  interrupted calls and is left out at 0. The elapsed time is the turn's
  `durationMs`, left out until the turn ends. While the turn runs, the line
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

**Open:** a press on the title line toggles the turn's member of `unfolded`
and the arrow turns to `▾`. The block lists the turn's calls in turn order and
no text. Each call draws its `compact` card, with its button keys suffixed by
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
turn's background Bash task folds into the turn's block instead.

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
holds a table, so the tables wrap; a reply without a table returns `next(e)`.

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

`hooks/usage.test.ts` covers the meter line, the command's replies, store
persistence, the band hidden and restored, a survey keeping the band, the
meter line above the hint line, and the reload after `/clear`.
Rendered-text queries use exact matches for individual styles; precedence
checks permit nested or inherited spans but reject conflicting colours.

`hooks/blackbox.test.ts` covers the `blackbox` setting, the turn model's
anchor, title rules, status line, and labels, and the block drawn through
session events: the folded lines and their truncation, failures and
interruptions while folded, hidden call rows that draw nothing, Claude's text
drawing before, between, and after the calls, an answer that one more call
follows, the open call cards in turn order with no text, each call's
**Show ▸**, the call in progress, streaming calls, Agent calls, subagent rows,
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
