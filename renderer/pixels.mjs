// Pixels reach the screen only from kitty or Ghostty with no multiplexer in between; the
// engine draws an Image's alt anywhere else. The Herdr desktop app sets TERM_PROGRAM to
// ghostty, but herdr-core runs its terminals, so it counts as a multiplexer by
// HC_TERMINAL_ID, which it sets in place of HERDR_ENV.
const MULTIPLEXERS = ['HERDR_ENV', 'HC_TERMINAL_ID', 'TMUX', 'ZELLIJ', 'STY']

export function canShowPixels(env) {
  const isMultiplexed = MULTIPLEXERS.some(name => env[name])
  return !isMultiplexed && (env.TERM === 'xterm-kitty' || env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'ghostty')
}
