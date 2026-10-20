// Whether `speak` reads a reply aloud. Off until `/lucid speak on`: while it is off, `speak` is
// an ordinary word in a prompt.

const SPEAK_HELP = 'usage: /lucid speak on|off'

export const speakOf = (value: unknown): boolean => value === 'on'

const describe = (speak: boolean) => `speech: ${speak ? 'on' : 'off'}`

// `/lucid speak [on|off]`: a setting to store, or only text to show.
export function speakCommand(args: string, current: boolean): { speak?: boolean; text: string } {
  const [setting, value, extra] = args.trim().toLowerCase().split(/\s+/)
  if (setting !== 'speak' || extra !== undefined) return { text: SPEAK_HELP }
  if (value === undefined) return { text: describe(current) }
  if (value !== 'on' && value !== 'off') return { text: SPEAK_HELP }
  return { speak: value === 'on', text: describe(value === 'on') }
}
