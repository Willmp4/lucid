export type UsagePlacement = 'above' | 'below'
export type UsageMeter = { label: string; percent: number; bar: string }

declare module 'claude-code' {
  interface PluginState {
    'omp-blocks': {
      expanded: StateFamily<boolean>
      duration: StateFamily<number>
      usage: UsagePlacement
      meters: UsageMeter[]
    }
  }
}
