export type UsagePlacement = 'above' | 'below'
export type UsageMeter = { label: string; percent: number; bar: string }
export type Density = 'full' | 'balanced' | 'compact' | 'blackbox'

// What a response row adds to a turn, in the order the model wrote it: a call by its
// tool_use_id, or text or a question to the user, either of which ends the block before it.
export type TurnItem = { kind: 'call'; id: string } | { kind: 'text' } | { kind: 'question' }
// A run of a turn's calls with no text or question between them, drawn as one block. Its time
// runs from the row of its first call to its last result; text or a question after it, or the
// turn's end, closes it.
export type TurnBlock = { ids: string[]; startedAt: number; endedAt?: number; closed: boolean }
export type TurnRecord = { blocks: TurnBlock[] }
export type CallStatus = 'running' | 'ok' | 'failed' | 'interrupted'
// What a folded turn block reads of a call: long input strings are cut. `background` marks a
// Bash call the engine moved to the background, with the timeout that moved it.
export type CallRecord = {
  tool: string
  input: Record<string, unknown>
  status: CallStatus
  error?: string
  background?: { timedOutAfterMs?: number }
}
// What an open call card reads: the whole input, the stored result, and the text the model read.
export type CallBody = { input: unknown; output?: unknown; text?: string }

// A reading keyword: `tldr` adds a summary under a reply, `speak` reads it aloud.
export type Mark = 'tldr' | 'speak'
// A main-loop row that holds text: its transcript uuid, which its render reads as `requestId`.
export type ReplyRow = { uuid: string; text: string }
// A reply's summary: none asked for, being written, written, or failed with its reason.
export type Summary =
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'ready'; text: string }
  | { state: 'failed'; reason: string }

// A diagram's files as renderer/render.mjs writes them: the PNG where it could draw one, the
// SVG, the version in terminal cells and its width in columns, the .excalidraw scene, the
// PNG's size in pixels, and the diagram's title.
export type DiagramFiles = {
  png?: string
  svg: string
  cells: string
  columns: number
  excalidraw: string
  width: number
  height: number
  title: string
}
// A diagram fence's picture: being drawn by the load that `load` names, at `step`; drawn; or
// failed with its reason.
export type Diagram =
  | { status: 'drawing'; step: string; load: string }
  | ({ status: 'ready' } & DiagramFiles)
  | { status: 'failed'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    lucid: {
      expanded: StateFamily<boolean>
      opened: StateFamily<boolean>
      ungrouped: StateFamily<boolean>
      duration: StateFamily<number>
      usage: UsagePlacement
      density: Density
      meters: UsageMeter[]
      liveTurn: string
      turnBlocks: StateFamily<TurnRecord>
      owner: StateFamily<string>
      call: StateFamily<CallRecord>
      body: StateFamily<CallBody>
      unfolded: StateFamily<boolean>
      pendingMarks: Mark[]
      marks: StateFamily<Mark[]>
      readingTurn: string
      turnReply: StateFamily<string>
      lastReply: ReplyRow
      tldr: StateFamily<Summary>
      speech: number
      speak: boolean
      voice: string
      diagram: StateFamily<Diagram>
      diagrams: boolean
    }
  }
}
