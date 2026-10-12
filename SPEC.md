# omp-blocks design

A Claude Code mod that draws Edit, Write, Bash, Read, Grep, and Glob calls
as bordered cards in the style of the oh-my-pi (OMP) harness. The skins mod
keeps drawing unsupported tools and payloads.

## Goal

Tool calls share rounded borders, shortened paths, and consistent status
colors. Edit and Write show line-numbered diffs. Shell commands, reads,
and searches show useful previews with controls to expand long output.
The mod changes presentation only: tool inputs, results, permissions, and
the content Claude receives stay unchanged.

## Scope

In scope:

- The `ToolUse` and `ToolResult` rows of Edit, Write, Bash, Read, Grep, and Glob
- Expanded `ToolGroup` rows for supported shell, read, and search calls
- Terminal `AssistantMessage` rows that hold a markdown table
- The usage meters' placement: `AbovePrompt` and `PromptHint`, set by `/omp usage`
- The `terminal` surface

Out of scope:

- Unsupported tools and unknown result formats, which pass through to skins
- The `desktop`, `vscode`, and `mobile` surfaces, which pass through
- Image, PDF, notebook, and background-command payloads, which keep native UI
- Expand/collapse controls for Edit/Write diffs and full programming-language
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
| `hooks/card-model.ts` | Shared card rows and terminal text sanitization |
| `hooks/tool-card.tsx` | Card frame, previews, and expansion controls |
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
| `types/index.d.ts` | Per-call expansion, elapsed time, usage placement, and meter state declarations |

The mod keeps expansion and Bash duration in `$.state` families keyed by
the tool call's render request ID. Each call expands independently.

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

A terminal `ToolGroup` containing Bash, Read, Grep, or Glob passes
`isExpanded: true` to `next`, so the group cannot hide the individual cards.

## Bash, Read, and search cards

| Tool | Header and body |
|---|---|
| Bash | Command, observed elapsed time, stdout, and stderr; failed calls show their complete error text |
| Read | Shortened path, returned line range and total, and content numbered from the returned offset |
| Grep | Pattern and scope; file headings and line numbers where parsing is unambiguous; raw text otherwise |
| Glob | Pattern and scope, returned file count, and shortened matching paths |

Successful output previews show the first 16 rows. Stderr remains visible
past that limit. Click **Show all** to expand a card and **Collapse** to
restore its preview. Failed calls never fold their output.

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
Bash tasks, and unsupported structured payloads.

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
| New file | `Write` with `output.type === "create"` | The first 20 lines of `output.content` as added rows, numbered from 1 |
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

- A diff body shows at most 40 rows, counting `…` separators
- A new-file body shows at most 20 rows
- Past the cap, one final row reads `… n more lines` in `#7f849c`, where `n`
  counts the rows left out

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
