// The system voice that reads a reply aloud, by its exact name. Without one, macOS `say`
// takes the system's chosen voice, and with none chosen it plays silence.

export const DEFAULT_VOICE = 'Samantha'
const VOICE_HELP = 'usage: /lucid voice <name>'

export const voiceOf = (value: unknown): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_VOICE

const describe = (voice: string) => `speech voice: ${voice}`

// `/lucid voice [name]`: a name to store as typed, past its edges' whitespace, or only text to
// show. A name can hold spaces, as `Eddy (English (US))` does.
export function voiceCommand(args: string, current: string): { voice?: string; text: string } {
  const typed = args.trim()
  const setting = typed.split(/\s/, 1)[0]!
  if (setting.toLowerCase() !== 'voice') return { text: VOICE_HELP }
  const name = typed.slice(setting.length).trim()
  if (name === '') return { text: describe(current) }
  return { voice: name, text: describe(name) }
}
