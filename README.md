# omp-blocks

A Claude Code mod that draws tool calls as compact, colour-coded cards in the
OMP style.

![A turn at the balanced density: two shell command cards with their output and duration, a Read card with its line summary, and an Edit card with its diff, then Claude's reply](docs/balanced.svg)

- **Tool cards:** edits, shell commands, reads, and searches share one look.
  Failures show in red
- **Densities:** choose how much each card shows
- **Reply tables:** Markdown tables draw as grids that fit the pane
- **`tldr`:** adds a short summary under a reply

## Densities

Set the level with `/omp density <level>`. The default is `balanced`.

**`compact`:** one line per call.

![The same turn at the compact density: four one-line cards, each with a Show button, and the shell commands with their status and duration](docs/compact.svg)

**`full`:** every card shows its full preview.

![The same turn at the full density: a shell command card with three matching lines, a Read card with numbered file lines, and an Edit card with its diff](docs/full.svg)

**`blackbox`:** each run of calls folds into one block. Click a block to open
it.

![A turn at the blackbox density: a folded Reading block, a line of Claude's text, and a folded Editing block with a red border that lists its failed call and error line](docs/blackbox-folded.svg)

![The Editing block opened: its four calls listed in order as compact cards, the failed call in full with a red border](docs/blackbox-open.svg)

## Replies

Wide tables wrap instead of losing text.

![A reply table with four columns drawn as a box-drawn grid in a 100-column pane, its long cells wrapped onto extra lines](docs/reply-table.svg)

Long code blocks keep their colours.

![The end of a long code block in a reply: the bottom edge of the first card, then a second card of syntax-coloured TypeScript lines](docs/long-code.svg)

## `tldr`

Start or end a prompt with `tldr` to get a short summary under Claude's reply.
Send `tldr` on its own to summarize the previous reply.

![A two-paragraph reply drawn in full, with a TLDR block holding a short summary beneath it](docs/tldr.svg)

`speak` reads a reply aloud the same way. It's experimental and off by
default: turn it on with `/omp speak on`.

## Settings

| Command | Effect |
|---|---|
| `/omp density <level>` | `balanced`, `compact`, `full`, or `blackbox` |
| `/omp usage below` | Moves the context and plan meters under the prompt. `above` moves them back |
| `/omp speak on` | Turns on the `speak` keyword. `off`, the default, turns it off |
| `/omp voice <name>` | Sets the voice for `speak`. The default is `Samantha` |

![The context and plan-limit meters on a line under the prompt, with nothing above the prompt](docs/usage-below.svg)

## Install

Requires Claude Code 2.1.296 or later. The [skins
mod](https://github.com/hellosverre/claude-skins) installs alongside it.

```sh
claude plugin marketplace add hellosverre/claude-skins
claude plugin install skins@hellosverre-mods
claude plugin install omp-blocks --marketplace Willmp4/omp-blocks
```

Then run `/reload-plugins` in any open session.

To update:

```sh
claude plugin marketplace update omp-blocks
claude plugin update omp-blocks@omp-blocks
```

To remove:

```sh
claude plugin uninstall omp-blocks@omp-blocks
```

Cards missing? Confirm in `/plugin` that both `omp-blocks` and `skins` are
enabled, then run `/reload-plugins`.

The cards draw in the terminal only, with a dark palette. `tldr` sends the
reply to Claude Haiku. Mods run with Claude Code's access to your machine, so
install only code you trust.

## Development

```sh
claude plugin validate . --strict
claude plugin test .
claude --plugin-dir .
bun scripts/screenshot-svg.ts --all   # redraw the README pictures
```

[SPEC.md](SPEC.md) covers how the renderer works.

## License

[MIT](LICENSE). An independent community mod, not an official Anthropic
product.
