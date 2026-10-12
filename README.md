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
shows.

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
| `/omp density` | Shows the current level |

The density level sets each card's body:

| Card | `full` | `balanced` | `compact` |
|---|---|---|---|
| A run of Read, Grep, and Glob calls | One card per call | One card with a row per call: its path or pattern and its summary. **Show all** splits the run into `full` cards | One header line that counts the calls; **Show ▸** opens the rows |
| Read, Grep, or Glob on its own | The first 16 rows | The header and summary; the rows open on **Show all (N rows)** | One header line; **Show ▸** opens the `balanced` body |
| Bash | The first 16 stdout rows; the duration on the summary line | The last 4 stdout rows; `✓` or `✗` and the duration on the header row | One header line with `✓` or `✗` and the duration; **Show ▸** opens the `balanced` body |
| Edit and Write | Up to 40 diff rows or 20 new-file rows | Up to 12 rows | One header line with the counts; **Show ▸** opens the 12 rows |
| A failed call | Every row and a red border | Every row and a red border | Every row and a red border |

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
- Images, PDFs, notebooks, background jobs, and unknown result formats keep native controls
- At `full`, successful shell/read/search previews show 16 rows; below it, shell previews show the last 4 stdout rows and read/search cards show their summary
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

The tests cover rendering, the three density levels, merged runs, expansion
transitions, native fallbacks, errors, line offsets, blank matches, search
pagination, lossless semantic spans, token boundaries, and colour precedence. [SPEC.md](SPEC.md) describes the
renderer and live smoke checks.

## License

[MIT](LICENSE). Skins is a separate MIT-licensed dependency.

This is an independent community mod, not an official Anthropic product.
