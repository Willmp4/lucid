import type { ElementTable } from 'claude-code'
import type { UsageMeter } from '../types'
import { COLORS } from './text-style'

// The accent while there is room; amber from 80 %, red from 95 %, as the skins band.
const meterColor = (percent: number) => (percent >= 95 ? COLORS.del : percent >= 80 ? COLORS.warn : COLORS.command)

// The meters as one line under the prompt, three cells between meters.
export function drawMeters(ui: Pick<ElementTable<'terminal'>, 'Text'>, meters: readonly UsageMeter[]) {
  const { Text } = ui
  return (
    <Text key="lucid-usage" wrap="truncate-end">
      {meters.map((meter, i) => [
        i > 0 ? <Text key={`gap-${i}`}>{'   '}</Text> : null,
        <Text key={`bar-${i}`} color={meterColor(meter.percent)}>{meter.bar}</Text>,
        <Text key={`percent-${i}`} bold>{` ${meter.percent}%`}</Text>,
        <Text key={`label-${i}`} color={COLORS.muted}>{` ${meter.label}`}</Text>,
      ])}
    </Text>
  )
}
