# omp-blocks

OMP-style tool cards for the Claude Code terminal. File edits, shell commands,
reads, and searches share rounded borders and compact output previews.

| Tool | Card contents |
|---|---|
| Edit and Write | Line-numbered diffs, added/removed counts, and shaded changes |
| Bash | Command, elapsed time, output preview, and visible errors |
| Read | File path, returned line range, and line-numbered content |
| Grep | Pattern, scope, grouped matches, and pagination totals |
| Glob | Pattern, scope, returned file count, and matching paths |

A card's body shows what the user acts on: the end of shell output, where
test totals and exit status print, and the diffs to review. A run of reads and
searches shares one card with a row per call. Click **Show all** to expand a
card or to split a merged run into its own cards, and **Collapse** to restore
it. Failed calls always open in full. `/omp density` sets how much each card
shows, or folds each turn's calls into one block.

Peach bold tool labels, cyan paths, and softer ordinary output share one
palette across all six tools. Shell commands distinguish commands, flags,
and quoted strings. Inline timestamps and durations stay muted; standalone
success, warning, and failure markers use green, amber, and red. Actual
failures, stderr, and changed diff rows keep their colour precedence.

Markdown tables in Claude's replies draw as box-drawn grids. When a table is
wider than the pane, its widest columns narrow and long cells wrap onto extra
lines, so no cell loses text. The rest of the reply keeps the skins drawing.

## Settings

The `/omp` command holds this mod's settings. Each setting persists across
sessions.

| Command | Effect |
|---|---|
| `/omp usage above` | The context and plan-limit meters stay in the skins band above the prompt, with its Compact button. The default |
| `/omp usage below` | The meters move to a line under the prompt, and the band above the prompt draws nothing |
| `/omp usage` | Shows the current placement |
| `/omp density balanced` | Card bodies show what the user acts on. The default |
| `/omp density compact` | Each card shows one header line and opens on **Show ▸** |
| `/omp density full` | Cards show their full previews, and every run of calls draws one card per call |
| `/omp density blackbox` | Each turn's tool calls fold into one block that opens on click; Claude's text draws below it |
| `/omp density` | Shows the current level |

The density level sets each card's body:

| Card | `full` | `balanced` | `compact` |
|---|---|---|---|
| A run of Read, Grep, and Glob calls | One card per call | One card with a row per call: its path or pattern and its summary. **Show all** splits the run into `full` cards | One header line that counts the calls; **Show ▸** opens the rows |
| Read, Grep, or Glob on its own | The first 16 rows | The header and summary; the rows open on **Show all (N rows)** | One header line; **Show ▸** opens the `balanced` body |
| Bash | The first 16 stdout rows; the duration on the summary line | The last 4 stdout rows; `✓` or `✗` and the duration on the header row | One header line with `✓` or `✗` and the duration; **Show ▸** opens the `balanced` body |
| Edit and Write | Up to 40 diff rows or 20 new-file rows | Up to 12 rows | One header line with the counts; **Show ▸** opens the 12 rows |
| A failed call | Every row and a red border | Every row and a red border | Every row and a red border |

At `blackbox`, one bordered block holds every tool call of a turn, from the
prompt to Claude's final reply. Only the calls and their results fold;
Claude's text never does. The block draws where the turn's first call would,
so text Claude writes before that call stays above it, and each later message
draws below the block in turn order, ending with the final reply. The block is
folded by default:

```text
╭──────────────────────────────────────────╮
│ ▸ Editing inventory.py +1 file           │
│   10 calls · 1 failed · 6.1s             │
│   ✗ Bash: cat missing.txt                │
│     cat: missing.txt: No such file       │
╰──────────────────────────────────────────╯
⏺ The notes name inventory.py, so the edit goes there.
⏺ All seven steps ran; cat failed as planned.
```

Each folded line takes one terminal row at any pane width, cut with `…`.

- **Title:** `Editing` and the file the turn edits or writes most, with
  `+N file` or `+N files` for the rest. Otherwise the title reads a shell
  command by what it does, not its raw text: `Running` and the first command
  it runs, named by its program and up to two words (`Running npm test`,
  `Running python3 inventory.py`); else `Reading` or `Searching` and the file
  the turn's reads and searches touch most, with `+N file` or `+N files` for
  the others (`Reading index.mjs +1 file`); else `Using` and the first tool.
  `cat`, `head`, `tail`, `wc`, `sed -n`, and `git show`, `log`, `diff`, and
  `status` read; `grep`, `rg`, `find`, `fd`, `ls`, and `tree` search;
  wrappers such as `rtk proxy` and `timeout 60`, and commands such as `cd`
  and `echo`, take no part. A file shows its name alone unless another
  touched file shares it
- **Status line:** the call count, the failed calls, and the turn's duration.
  While the turn runs, the line ends with the call in progress, such as
  `· Bash: python3 toy.py`, or `· background` for a background job, and the
  duration waits for the turn to end
- **Failures:** a failed or interrupted call turns the border red and lists
  its header and an error line, folded or open. For a shell command, the error
  line is the first stderr line, else the last output line, so a status line
  such as `ok` that a command wrapper prints first never stands in for the
  error. `Exit code N` lines are skipped, and `Failed` stands in when no line
  is left
- **Open:** click the title to list the turn's calls in order, each as its
  `compact` card, with no text; each card's **Show ▸** opens its `balanced`
  body. Subagent calls count as calls
- **Background jobs:** a shell command moved to the background, on its timeout
  or by `run_in_background`, stays in the block, counts as a call, and never
  counts as a failure. Open, it lists as one muted row:
  `Bash: <command> · moved to background after 120s`, or
  `Bash: <command> · running in background`

## Requirements

- Claude Code 2.1.296 or later with mods enabled; verification uses 2.1.296
- Git, for repository-based installation
- A terminal running Claude Code

The [skins mod](https://github.com/hellosverre/claude-skins) is a required
dependency. It styles the rest of Claude Code; omp-blocks takes precedence
for supported tool cards. The dependency declaration enforces that order.
Neither the OMP executable nor Herdr is required.

## Install

Run these commands in your shell:

```sh
claude plugin marketplace add hellosverre/claude-skins
claude plugin install skins@hellosverre-mods
claude plugin install omp-blocks --marketplace Willmp4/omp-blocks
```

In an existing Claude Code session, run:

```text
/reload-plugins
```

The `/plugin` screen lists `omp-blocks` and `skins` as active mods. Subsequent
sessions load them at startup.

### Install from a local checkout

Clone the repository into any directory, then register that directory:

```sh
git clone https://github.com/Willmp4/omp-blocks.git
claude plugin marketplace add hellosverre/claude-skins
claude plugin install skins@hellosverre-mods
claude plugin install omp-blocks --marketplace ./omp-blocks
```

Keep the checkout in place: Claude Code loads local marketplace plugins
directly from their source folders.

## Update

```sh
claude plugin update skins@hellosverre-mods
claude plugin marketplace update omp-blocks
claude plugin update omp-blocks@omp-blocks
```

Run `/reload-plugins` in open sessions. For a local checkout, pull its updates
and reload the plugins instead.

## Disable or remove

To disable the cards while keeping the installation:

```sh
claude plugin disable omp-blocks@omp-blocks
```

To remove the mod:

```sh
claude plugin uninstall omp-blocks@omp-blocks
claude plugin marketplace remove omp-blocks
```

Removing omp-blocks does not require removing skins. Manage skins separately
if you also want to remove its styling.

## Behavior and limits

- Terminal-only presentation: desktop and other surfaces retain their rendering
- Tool inputs, results, permissions, and the content Claude receives stay unchanged
- Images, PDFs, notebooks, background jobs, and unknown result formats keep native controls; at `blackbox`, a background job folds into the turn's block
- At `full`, successful shell/read/search previews show 16 rows; below it, shell previews show the last 4 stdout rows and read/search cards show their summary
- At `blackbox`, a turn folds only when the level was set as the turn started; earlier turns, and a resumed session's history, draw at `compact`
- At `blackbox`, a result the block cannot show, such as an image, keeps its own row; permission prompts and questions stay in full view
- Stderr, error rows, and the `Full output` and `Raw output` artifact rows never fold
- Below `full`, an interrupted call opens in full with a red border, as a failed call does
- A run that mixes in any other tool stays one card per call; its cards follow the density level
- A run whose calls carry no input or output, or whose output a card cannot summarise, stays one card per call
- Splitting a merged run marks the calls it holds; a call that joins a live run afterwards draws its `balanced` card
- Compact header lines cut long commands and paths with `…`; an open card shows them whole
- Search pagination reports the tool's supplied totals; expansion cannot recover output the tool omitted
- Tool-call expansion state is independent for each card and each merged run
- The palette matches OMP's dark Catppuccin-style cards; it does not follow light themes
- Semantic highlighting preserves text and whitespace; status words never determine tool success or failure
- Conservative lexical spans require no syntax-highlighter dependency; shell/read/search cards retain terminal-control sanitization
- Inline highlighting has a node budget; remaining text stays visible in its base colour
- Reply tables draw on the terminal only; a reply with a table loses the skins `copy reply` button
- Tables inside fenced code blocks stay code
- With the meters below the prompt, a survey still takes the band above it
- Claude Code's renderer retains its own size and terminal limitations

Mods run with Claude Code's access to your machine. Install only code you
trust. This mod observes Bash calls to measure their duration and changes
render events; it does not approve permissions or replace tool execution.

## Troubleshooting

If cards do not appear:

1. Check `claude --version` against the requirements.
2. Open `/plugin` and confirm that both `omp-blocks` and `skins` are enabled.
3. Run `/reload-plugins`.
4. Check whether your organization's policy disables installed mods.

Do not remove the skins dependency from `plugin.json`: loading skins first
can intercept the tool row before omp-blocks renders it.

## Development

Claude Code loads the TypeScript directly. No Node.js dependency installation
or compilation step is required.

From the repository root:

```sh
claude plugin validate . --strict
claude plugin test .
```

To hot-reload a local implementation for one session, install skins first,
then run:

```sh
claude --plugin-dir .
```

The tests cover rendering, the four density levels, turn blocks, merged runs, expansion
transitions, native fallbacks, errors, line offsets, blank matches, search
pagination, lossless semantic spans, token boundaries, and colour precedence. [SPEC.md](SPEC.md) describes the
renderer and live smoke checks.

## License

[MIT](LICENSE). Skins is a separate MIT-licensed dependency.

This is an independent community mod, not an official Anthropic product.
