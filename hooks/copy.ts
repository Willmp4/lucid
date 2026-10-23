import type { EngineInterface, RenderSurface } from 'claude-code'

// The engine action the copy control borrows, since a mod cannot add one of its own. Its
// handler runs only inside a permission prompt, where a mod's Button does not fire, so the
// key bound to it presses the control everywhere else.
export const COPY_ACTION = 'permission:toggleDebug'

// Puts `text` on the clipboard: `pbcopy` where it runs, as it reaches the macOS clipboard from
// inside a multiplexer; the engine's own copy otherwise. Says whether either took.
export async function copyText($: EngineInterface, text: string, surface?: RenderSurface): Promise<boolean> {
  const piped = await $.process.run(['pbcopy'], { stdin: text }).then(run => run.exitCode === 0, () => false)
  if (piped) return true
  return (await $.ui.copy({ text, ...(surface === undefined ? {} : { surface }) })).isCopied
}
