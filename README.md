# lucid

A Claude Code mod that draws tool calls as compact, colour-coded cards in the
OMP style.

![A turn at the balanced density: two shell command cards with their output and duration, a Read card with its line summary, and an Edit card with its diff, then Claude's reply](docs/balanced.svg)

- **Tool cards:** edits, shell commands, reads, and searches share one look.
  Failures show in red
- **Densities:** choose how much each card shows
- **Reply tables:** Markdown tables draw as grids that fit the pane
- **Diagrams:** Claude draws a design or a flow as a diagram in its reply
- **`tldr`:** adds a short summary under a reply

## Densities

Set the level with `/lucid density <level>`. The default is `balanced`.

**`compact`:** one line per call.

![The same turn at the compact density: four one-line cards, each with a Show button, and the shell commands with their status and duration](docs/compact.svg)

**`full`:** every card shows its full preview.

![The same turn at the full density: a shell command card with three matching lines, a Read card with numbered file lines, and an Edit card with its diff](docs/full.svg)

**`blackbox`:** each run of calls folds into one block. Click a block to open
it. Claude's questions to you stay outside the blocks, with your answers.

![A turn at the blackbox density: a folded Reading block, a line of Claude's text, and a folded Editing block with a red border that lists its failed call and error line](docs/blackbox-folded.svg)

![The Editing block opened: its four calls listed in order as compact cards, the failed call in full with a red border](docs/blackbox-open.svg)

## Replies

Wide tables wrap instead of losing text.

![A reply table with four columns drawn as a box-drawn grid in a 100-column pane, its long cells wrapped onto extra lines](docs/reply-table.svg)

Long code blocks keep their colours.

![The end of a long code block in a reply: the bottom edge of the first card, then a second card of syntax-coloured TypeScript lines](docs/long-code.svg)

## Diagrams

When a reply explains a design, a flow, or a before-and-after change, Claude
writes a short brief in an `excalidraw` code block. Claude Sonnet turns the
brief into a hand-drawn Excalidraw diagram in the background, and the diagram
draws in place of the block. Each card names its `.excalidraw` file, which
opens in Excalidraw.

Most terminals, and a terminal inside a multiplexer such as tmux, draw the
diagram in text.

![A one-line reply over its diagram card: the header excalidraw · How a diagram reaches a reply, two dashed panels of boxes and arrows drawn in text, and the path of the .excalidraw file](docs/diagram.svg)

Kitty and Ghostty show the hand-drawn picture.

![The same diagram drawn by hand: in the reply, Claude's brief leads to a waiting card, and in the background, the brief leads to Sonnet's spec, the renderer, and the redrawn card](docs/diagram.png)

`/lucid diagrams off` turns them off: Claude stops writing them, and the
blocks draw as code.

## `tldr`

Start or end a prompt with `tldr` to get a short summary under Claude's reply.
Send `tldr` on its own to summarize the previous reply.

![A two-paragraph reply drawn in full, with a TLDR block holding a short summary beneath it](docs/tldr.svg)

`speak` reads a reply aloud the same way. It's experimental and off by
default: turn it on with `/lucid speak on`.

## Settings

| Command | Effect |
|---|---|
| `/lucid density <level>` | `balanced`, `compact`, `full`, or `blackbox` |
| `/lucid usage below` | Moves the context and plan meters under the prompt. `above` moves them back |
| `/lucid speak on` | Turns on the `speak` keyword. `off`, the default, turns it off |
| `/lucid voice <name>` | Sets the voice for `speak`. The default is `Samantha` |
| `/lucid diagrams off` | Turns diagrams off. `on`, the default, turns them back on |

![The context and plan-limit meters on a line under the prompt, with nothing above the prompt](docs/usage-below.svg)

## Install

Requires Claude Code 2.1.296 or later. The [skins
mod](https://github.com/hellosverre/claude-skins) installs alongside it.

```sh
claude plugin marketplace add hellosverre/claude-skins
claude plugin install skins@hellosverre-mods
claude plugin install lucid --marketplace Willmp4/lucid
```

Then run `/reload-plugins` in any open session.

To update:

```sh
claude plugin marketplace update lucid
claude plugin update lucid@lucid
```

To remove:

```sh
claude plugin uninstall lucid@lucid
```

Moving from omp-blocks, the mod's earlier name? Remove it and its
marketplace, then install lucid as above. Its settings start from their
defaults.

```sh
claude plugin uninstall omp-blocks@omp-blocks
claude plugin marketplace remove omp-blocks
```

Cards missing? Confirm in `/plugin` that both `lucid` and `skins` are
enabled, then run `/reload-plugins`.

The cards draw in the terminal only, with a dark palette. `tldr` sends the
reply to Claude Haiku. Diagrams send their brief to Claude Sonnet and draw
with `node`, which must be on your `PATH`; nothing else needs installing.
Mods run with Claude Code's access to your machine, so install only code you
trust.

## Development

```sh
claude plugin validate . --strict
claude plugin test .
claude --plugin-dir .
bun scripts/screenshot-svg.ts --all   # redraw the README pictures
```

[SPEC.md](SPEC.md) covers how the renderer works.

## Credits

[Andrew Forsyth](https://github.com/capoveur) wrote the diagram layout generator,
[`renderer/mkflow.mjs`](renderer/mkflow.mjs), and designed the `.flow` spec
format and the authoring rules the diagram model follows. He gave permission
to publish them here.

## License

[MIT](LICENSE). An independent community mod, not an official Anthropic
product.
