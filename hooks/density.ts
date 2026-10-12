import type { Density } from '../types'

// How much a tool card's body shows: today's previews, what the user acts on, one header
// line, or each turn's calls folded into one block.

const LEVELS: readonly Density[] = ['full', 'balanced', 'compact', 'blackbox']
const DENSITY_HELP = `usage: /omp density ${LEVELS.join('|')}`

const isLevel = (value: unknown): value is Density => LEVELS.includes(value as Density)

export const densityOf = (value: unknown): Density => isLevel(value) ? value : 'balanced'

const describe = (density: Density) => `card density: ${density}`

// `/omp density [full|balanced|compact|blackbox]`: a level to store, or only text to show.
export function densityCommand(args: string, current: Density): { density?: Density; text: string } {
  const [setting, value, extra] = args.trim().toLowerCase().split(/\s+/)
  if (setting !== 'density' || extra !== undefined) return { text: DENSITY_HELP }
  if (value === undefined) return { text: describe(current) }
  if (!isLevel(value)) return { text: DENSITY_HELP }
  return { density: value, text: describe(value) }
}
