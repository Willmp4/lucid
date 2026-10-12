export type UsagePlacement = 'above' | 'below'
export type UsageMeter = { label: string; percent: number; bar: string }
export type Density = 'full' | 'balanced' | 'compact'

declare module 'claude-code' {
  interface PluginState {
    'omp-blocks': {
      expanded: StateFamily<boolean>
      opened: StateFamily<boolean>
      ungrouped: StateFamily<boolean>
      duration: StateFamily<number>
      usage: UsagePlacement
      density: Density
      meters: UsageMeter[]
    }
  }
}
