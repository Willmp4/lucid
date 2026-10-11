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

Click **Show all** to expand long Bash, Read, Grep, or Glob output, and
**Collapse** to restore its preview. Errors remain visible. Edit and Write
retain their fixed diff previews.

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
- Successful shell/read/search previews show 16 rows; stderr remains visible past the preview limit
- Search pagination reports the tool's supplied totals; expansion cannot recover output the tool omitted
- Tool-call expansion state is independent for each card
- The palette matches OMP's dark Catppuccin-style cards; it does not follow light themes
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

The tests cover rendering, expansion transitions, native fallbacks, errors,
line offsets, blank matches, and search pagination. [SPEC.md](SPEC.md)
describes the renderer and live smoke checks.

## License

[MIT](LICENSE). Skins is a separate MIT-licensed dependency.

This is an independent community mod, not an official Anthropic product.
