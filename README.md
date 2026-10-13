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
shows, or folds each run of calls into a block that Claude's text ends.

![A turn at the balanced density: two shell command cards with their output and duration, a Read card with its line summary, and an Edit card with its diff, then Claude's reply](docs/balanced.svg)

Peach bold tool labels, cyan paths, and softer ordinary output share one
palette across all six tools. Shell commands distinguish commands, flags,
and quoted strings. Inline timestamps and durations stay muted; standalone
success, warning, and failure markers use green, amber, and red. Actual
failures, stderr, and changed diff rows keep their colour precedence.

Markdown tables in Claude's replies draw as box-drawn grids. When a table is
wider than the pane, its widest columns narrow and long cells wrap onto extra
lines, so no cell loses text. The rest of the reply keeps the skins drawing.

![A reply table with four columns drawn as a box-drawn grid in a 100-column pane, its long cells wrapped onto extra lines](docs/reply-table.svg)

A code block in a reply that is longer than skins' 9,000-character limit,
such as a long file Claude prints, draws in the skins colours too. The block
splits at line boundaries into consecutive cards, each under the limit, and
each card shows every line it holds.

When Claude prints a 10,000-character file, the first card ends at the top of
this picture, and the second card holds the file's last lines.

![The end of a long code block in a reply: the bottom edge of the first card, then a second card of syntax-coloured TypeScript lines](docs/long-code.svg)

Two keywords in a prompt act on Claude's reply: `tldr` folds it to a short
summary, and `speak` reads it aloud. See [Reading keywords](#reading-keywords).

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
| `/omp density blackbox` | Each run of tool calls folds into one block that opens on click; Claude's text between runs ends a block |
| `/omp density` | Shows the current level |
| `/omp voice <name>` | Speech uses the system voice of that exact name, such as `Daniel` or `Eddy (English (US))`. The default is `Samantha` |
| `/omp voice` | Shows the current voice |

With `/omp usage below`, the meters sit on a line under the prompt:

![The context and plan-limit meters on a line under the prompt, with nothing above the prompt](docs/usage-below.svg)

The density level sets each card's body:

| Card | `full` | `balanced` | `compact` |
|---|---|---|---|
| A run of Read, Grep, and Glob calls | One card per call | One card with a row per call: its path or pattern and its summary. **Show all** splits the run into `full` cards | One header line that counts the calls; **Show ▸** opens the rows |
| Read, Grep, or Glob on its own | The first 16 rows | The header and summary; the rows open on **Show all (N rows)** | One header line; **Show ▸** opens the `balanced` body |
| Bash | The first 16 stdout rows; the duration on the summary line | The last 4 stdout rows; `✓` or `✗` and the duration on the header row | One header line with `✓` or `✗` and the duration; **Show ▸** opens the `balanced` body |
| Edit and Write | Up to 40 diff rows or 20 new-file rows | Up to 12 rows | One header line with the counts; **Show ▸** opens the 12 rows |
| A failed call | Every row and a red border | Every row and a red border | Every row and a red border |

At `compact`, each card is one header line that opens on **Show ▸**:

![The same turn at the compact density: four one-line cards, each with a Show button, and the shell commands with their status and duration](docs/compact.svg)

At `full`, each card shows its full preview:

![The same turn at the full density: a shell command card with three matching lines, a Read card with numbered file lines, and an Edit card with its diff](docs/full.svg)

At `blackbox`, one bordered block holds each run of tool calls that Claude
makes without writing text between them. Only the calls and their results
fold; Claude's text never does. Text Claude writes after a call ends that
call's block, and the next call opens a new block where it would draw, so each
message sits between the calls it follows and the calls it leads to, and the
final reply comes last. Each block is folded by default:

```text
⏺ Reading the notes first.
╭──────────────────────────────────────────╮
│ ▸ Reading notes.txt                      │
│   2 calls · 1.4s                         │
╰──────────────────────────────────────────╯
⏺ The notes name inventory.py, so the edit goes there.
╭──────────────────────────────────────────╮
│ ▸ Editing inventory.py +1 file           │
│   8 calls · 1 failed · 4.7s              │
│   ✗ Bash: cat missing.txt                │
│     cat: missing.txt: No such file       │
╰──────────────────────────────────────────╯
⏺ All seven steps ran; cat failed as planned.
```

Each folded line takes one terminal row at any pane width, cut with `…`.

![A turn at the blackbox density: a folded Reading block, a line of Claude's text, and a folded Editing block with a red border that lists its failed call and error line](docs/blackbox-folded.svg)

- **Title:** `Editing` and the file the block edits or writes most, with
  `+N file` or `+N files` for the rest. Otherwise the title reads a shell
  command by what it does, not its raw text: `Running` and the first command
  it runs, named by its program and up to two words (`Running npm test`,
  `Running python3 inventory.py`); else `Reading` or `Searching` and the file
  the block's reads and searches touch most, with `+N file` or `+N files` for
  the others (`Reading index.mjs +1 file`); else `Using` and the first tool.
  `cat`, `head`, `tail`, `wc`, `sed -n`, and `git show`, `log`, `diff`, and
  `status` read; `grep`, `rg`, `find`, `fd`, `ls`, and `tree` search;
  wrappers such as `rtk proxy` and `timeout 60`, and commands such as `cd`
  and `echo`, take no part. A file shows its name alone unless another
  touched file shares it
- **Status line:** the block's call count, its failed calls, and its time,
  from its first call to its last result. While the block is open, the line
  ends with the call in progress, such as `· Bash: python3 toy.py`, or
  `· background` for a background job, and the time waits for text or the
  turn's end to close the block
- **Failures:** a failed or interrupted call turns the border red and lists
  its header and an error line, folded or open. For a shell command, the error
  line is the first stderr line, else the last output line, so a status line
  such as `ok` that a command wrapper prints first never stands in for the
  error. `Exit code N` lines are skipped, and `Failed` stands in when no line
  is left
- **Open:** click a block's title to list its calls in order, each as its
  `compact` card, with no text; each card's **Show ▸** opens its `balanced`
  body. Subagent calls count as calls
- **Background jobs:** a shell command moved to the background, on its timeout
  or by `run_in_background`, stays in the block, counts as a call, and never
  counts as a failure. Open, it lists as one muted row:
  `Bash: <command> · moved to background after 120s`, or
  `Bash: <command> · running in background`

Click the Editing block's title to open it:

![The Editing block opened: its four calls listed in order as compact cards, the failed call in full with a red border](docs/blackbox-open.svg)

## Reading keywords

Two keywords in a prompt act on Claude's reply instead of reaching Claude:

| Keyword | Effect |
|---|---|
| `tldr` or `tl;dr` | Folds the reply to a summary of one to three lines that Claude Haiku writes. **Show ▸** opens the reply under the summary, and **Collapse** folds it again |
| `speak` | Reads the reply aloud with the system synthesizer, one sentence at a time, in the voice `/omp voice` sets |

![A three-paragraph reply folded by tldr to a TLDR block with a short summary and a Show button](docs/tldr.svg)

A keyword counts in any letter case, as a whole word, and only at the start
or the end of the prompt, so `speak` inside a sentence stays an ordinary word.
Several keywords can share the start or the end, separated by spaces or
commas. Keywords at the start can end with `:` or `,`, and keywords at the
end with `.`. As you type, the prompt box paints each counting keyword in
rainbow colours.

| Prompt | Result |
|---|---|
| `tldr: what changed?` | Claude receives `what changed?`, and the reply folds to its summary |
| `speak, fix the failing test` | Claude receives `fix the failing test`, and the reply is read aloud when the turn ends |
| `fix the failing test. tldr speak` | Claude receives `fix the failing test.`, and the summary is read aloud once it is ready |
| `ask them to speak first` | Claude receives the whole prompt: `speak` is neither at the start nor at the end |
| `tldr` | No turn starts. The previous reply's summary appears as a `TLDR · previous reply` row |
| `speak` | No turn starts. The previous reply is read aloud |

- While Haiku writes the summary, the reply shows `Summarizing…` beneath it.
  A summary that fails, or takes longer than 30 seconds, leaves the reply as it
  was, with `TLDR failed:` and the reason beneath it
- Speech skips code blocks, tables, and HTML, and reads a link as its text and
  a bare URL as "link". `tldr speak` reads the summary, or the reply when the
  summary fails
- The next prompt you send stops a reading after the sentence it is speaking
- Speech uses the system synthesizer (`say` on macOS) with the voice that
  `/omp voice` sets, `Samantha` by default. To list the installed voices, run
  `say -v '?'` in your shell. When the synthesizer fails, for example because
  the voice is not installed, a `Speech failed:` toast shows the cause
- Only prompts you type count; prompts from other mods, peers, and the SDK
  pass unchanged
- Each keyword acts on one reply. After `/clear`, a keyword alone finds no
  previous reply until Claude answers again

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
- Tool inputs, results, and permissions stay unchanged; the content Claude receives changes only by the reading keywords this mod removes from a prompt you type
- Images, PDFs, notebooks, background jobs, and unknown result formats keep native controls; at `blackbox`, a background job folds into its block
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
- The cards of a code block past 9,000 characters have no fold or **Copy** controls, so they show every line whatever `/skin fold` holds; the reply loses the skins `copy reply` button
- A reply keeps Claude Code's own drawing when its prose outside code blocks runs past 9,000 characters in one stretch, or when the reply passes about 53,000 characters, near the host's limit on the size of a drawing
- Each `tldr` makes one Claude Haiku call of at most 300 output tokens
- The TLDR fold draws on the terminal only; a `tldr` alone leaves the previous reply as drawn, since it might sit in scrollback
- Claude Code keeps the text of a prompt a mod drops, so a keyword alone stays in the prompt box after it runs
- With the meters below the prompt, a survey still takes the band above it
- Claude Code's renderer retains its own size and terminal limitations

Mods run with Claude Code's access to your machine. Install only code you
trust. This mod observes Bash calls to measure their duration and changes
render events; it does not approve permissions or replace tool execution. It
removes reading keywords from the prompts you type, sends a reply to Claude
Haiku when you ask for its summary, and speaks through the system
synthesizer when you ask for speech.

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
pagination, lossless semantic spans, token boundaries, and colour precedence.
They also cover long code blocks, the reading keywords, the TLDR block, and
speech, with the model and the synthesizer stubbed. [SPEC.md](SPEC.md) describes the
renderer and live smoke checks.

The pictures in this README are SVG drawings of terminal screens saved in
`docs/screens/`. To redraw them after you change the converter, run
`bun scripts/screenshot-svg.ts --all`.

## License

[MIT](LICENSE). Skins is a separate MIT-licensed dependency.

This is an independent community mod, not an official Anthropic product.
