import type { UsageMeter, UsagePlacement } from '../types'

// Where the context and plan-limit meters sit: in skins' band above the prompt, or on
// a line of this mod's under it.

type Usage = {
  context: { percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number }[]
}

const USAGE_HELP = 'usage: /lucid usage above|below'

// `five_hour` reads as `5h`, `seven_day` as `7d`, matching the skins band.
function limitLabel(kind: string): string {
  const name = kind.toLowerCase()
  if (name.includes('five') || name.includes('5h') || name.includes('5_h')) return '5h'
  if (name.includes('seven') || name.includes('7d') || name.includes('week')) return '7d'
  return name.replace(/_/g, ' ')
}

// Context and each plan limit as an eight-cell block meter, as the skins band draws them.
export function metersOf(usage: Usage): UsageMeter[] {
  return [
    ...(usage.context.percent === undefined ? [] : [{ label: 'context', percent: usage.context.percent }]),
    ...usage.rateLimits.map(limit => ({ label: limitLabel(limit.kind), percent: limit.percentUsed })),
  ].map(meter => {
    const percent = Math.max(0, Math.min(100, Math.round(meter.percent)))
    const filled = Math.round(percent / 12.5)
    return { label: meter.label, percent, bar: `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)}` }
  })
}

export const meterLine = (meters: readonly UsageMeter[]) =>
  meters.map(meter => `${meter.bar} ${meter.percent}% ${meter.label}`).join('   ')

export const placementOf = (value: unknown): UsagePlacement => (value === 'below' ? 'below' : 'above')

const describe = (placement: UsagePlacement) => `usage meters: ${placement} the prompt`

// `/lucid usage [above|below]`: a placement to store, or only text to show.
export function usageCommand(args: string, current: UsagePlacement): { placement?: UsagePlacement; text: string } {
  const [setting, value, extra] = args.trim().toLowerCase().split(/\s+/)
  if (setting !== 'usage' || extra !== undefined) return { text: USAGE_HELP }
  if (value === undefined) return { text: describe(current) }
  if (value !== 'above' && value !== 'below') return { text: USAGE_HELP }
  return { placement: value, text: describe(value) }
}
