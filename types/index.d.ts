declare module 'claude-code' {
  interface PluginState {
    'omp-blocks': {
      expanded: StateFamily<boolean>
      duration: StateFamily<number>
    }
  }
}
