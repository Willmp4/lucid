import type { Density } from '../types'

// How much a tool card's body shows: today's previews, what the user acts on, or one header line.

const DENSITY_HELP = 'usage: /omp density full|balanced|compact'

export const densityOf = (value: unknown): Density =>
  value === 'full' || value === 'compact' ? value : 'balanced'

const describe = (density: Density) => `card density: ${density}`

// `/omp density [full|balanced|compact]`: a level to store, or only text to show.
export function densityCommand(args: string, current: Density): { density?: Density; text: string } {
  const [setting, value, extra] = args.trim().toLowerCase().split(/\s+/)
  if (setting !== 'density' || extra !== undefined) return { text: DENSITY_HELP }
  if (value === undefined) return { text: describe(current) }
  if (value !== 'full' && value !== 'balanced' && value !== 'compact') return { text: DENSITY_HELP }
  return { density: value, text: describe(value) }
}
