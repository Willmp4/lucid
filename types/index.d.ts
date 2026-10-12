export type UsagePlacement = 'above' | 'below'
export type UsageMeter = { label: string; percent: number; bar: string }
export type Density = 'full' | 'balanced' | 'compact' | 'blackbox'

// One entry of a turn, in the order the model wrote them: a text row by its row id, or a
// call by its tool_use_id.
export type TurnItem = { kind: 'text'; id: string; text: string } | { kind: 'call'; id: string }
export type TurnRecord = { items: TurnItem[]; durationMs?: number }
export type CallStatus = 'running' | 'ok' | 'failed' | 'interrupted'
// What a folded turn block reads of a call: long input strings are cut.
export type CallRecord = { tool: string; input: Record<string, unknown>; status: CallStatus; error?: string }
// What an open call card reads: the whole input, the stored result, and the text the model read.
export type CallBody = { input: unknown; output?: unknown; text?: string }

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
      liveTurn: string
      turn: StateFamily<TurnRecord>
      owner: StateFamily<string>
      call: StateFamily<CallRecord>
      body: StateFamily<CallBody>
      unfolded: StateFamily<boolean>
    }
  }
}
