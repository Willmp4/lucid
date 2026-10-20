import { read } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'
import type { Diagram, DiagramFiles } from '../types'
import { CORRECTIONS, isFlow, isStale, pictureSize, specRequest, unfenced, widthProblem } from './diagram'
import type { CellArt, DiagramFence } from './diagram'
import type { Picture } from './diagram-card'
import { diagramsIn } from './long-fence'

// The background job that draws a diagram fence, and what starts it. The job writes the
// fence's member of the `diagram` family, keyed by the fence's id, and the card that reads the
// member redraws as it changes.

const DIAGRAM = { plugin: 'lucid', key: 'diagram' } as const

// A job dies with the load that ran it, so a member still drawing under another load's mark
// is an orphan, drawn again.
const LOAD = Math.random().toString(36).slice(2)

// Where the renderer keeps diagrams and whether the terminal shows pixels, as render.mjs
// answers at session start, and the columns the last terminal reply drew in.
const place: { dir?: string; pixels: boolean; columns: number } = { pixels: false, columns: 100 }
// The diagrams whose job is waiting or running.
const scheduled = new Set<string>()
// The host's cap on an Svg's source, in characters.
const SVG_CAP = 131072

type Rendered = DiagramFiles | { error: string }

function rendererOf($: EngineInterface): string {
  return `${$.plugin.root}/renderer/render.mjs`
}
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The cache folder and whether pixels show. Without node, or with a renderer that answers
// nothing, there is no cache, and each job's render fails with its reason.
export async function locateDiagrams($: EngineInterface): Promise<void> {
  const run = await $.process.run(['node', rendererOf($), '--dir']).catch(() => undefined)
  try {
    const found = JSON.parse(run?.stdout ?? '') as { dir: string; pixels: boolean }
    place.dir = found.dir
    place.pixels = found.pixels === true
  } catch {
    place.dir = undefined
  }
}

// The terminal's columns at a reply's drawing, the budget of the next spec.
export function seeColumns(columns: number): void {
  place.columns = columns
}

async function cached($: EngineInterface, id: string): Promise<DiagramFiles | undefined> {
  if (place.dir === undefined) return undefined
  try {
    if (!(await $.fs.exists(`${place.dir}/${id}.json`))) return undefined
    return JSON.parse(await $.fs.read(`${place.dir}/${id}.json`)) as DiagramFiles
  } catch {
    return undefined
  }
}

async function specFrom($: EngineInterface, brief: string, failed?: { spec: string; problem: string }): Promise<string> {
  const reply = await $.model.complete(specRequest(brief, place, failed))
  if (!reply.isAnswered) throw new Error(`the background model call ended: ${reply.reason}`)
  return unfenced(reply.text)
}

async function rendered($: EngineInterface, id: string, spec: string): Promise<Rendered> {
  const run = await $.process.run(['node', rendererOf($), id], { stdin: spec, timeoutMs: 60000 })
  const line = run.stdout.trim().split('\n').pop() ?? ''
  try {
    return JSON.parse(line) as Rendered
  } catch {
    return { error: run.stderr.trim() || `render.mjs exited ${run.exitCode}` }
  }
}

// The job: claim the member at the version read, so one job draws it; take the cache's files,
// or write a spec and draw it, sending a refused spec, or one too wide for the terminal's
// cells, back to the model. A brief already in .flow goes to the renderer as written. A member
// drawn, or drawing under this load, is left alone; a retry draws a failed one again.
async function runJob($: EngineInterface, fence: DiagramFence, isRetry = false): Promise<void> {
  const ref = { ...DIAGRAM, id: fence.id }
  const set = (value: Diagram) => $.state.set(ref, value)
  try {
    const held = await $.state.get(ref)
    if (!isStale(held.value, LOAD) && !(isRetry && held.value?.status === 'failed')) return
    const claim = await $.state.set(ref, { status: 'drawing', step: 'writing the spec', load: LOAD }, { ifVersion: held.version })
    if (!claim.isSet) return
    const hit = await cached($, fence.id)
    if (hit !== undefined) {
      await set({ status: 'ready', ...hit })
      return
    }
    const isSpecKnown = isFlow(fence.brief)
    let spec = isSpecKnown ? fence.brief : await specFrom($, fence.brief)
    await set({ status: 'drawing', step: 'drawing', load: LOAD })
    let result = await rendered($, fence.id, spec)
    const problemOf = (drawn: Rendered) => ('error' in drawn ? drawn.error : widthProblem(drawn, place))
    for (let attempt = 1, problem = problemOf(result); problem !== undefined && !isSpecKnown && attempt <= CORRECTIONS; attempt++, problem = problemOf(result)) {
      await set({ status: 'drawing', step: `fixing the spec (${attempt} of ${CORRECTIONS})`, load: LOAD })
      spec = await specFrom($, fence.brief, { spec, problem })
      result = await rendered($, fence.id, spec)
    }
    if ('error' in result) throw new Error(result.error)
    await set({ status: 'ready', ...result })
    $.ui.toast(`Diagram ready: ${result.title || 'untitled'}`)
  } catch (error) {
    await set({ status: 'failed', reason: reasonOf(error) }).catch(() => undefined)
  }
}

// A diagram's job starts off the dispatch that found it, so the turn that wrote the fence
// never waits on it and nothing aborts it when that dispatch settles. One job a diagram runs
// at a time; a later one finds the member drawn, unless /clear or /resume reset $.state.
export function scheduleDiagram($: EngineInterface, fence: DiagramFence): void {
  if (scheduled.has(fence.id)) return
  scheduled.add(fence.id)
  $.clock.after(0, () => {
    void runJob($, fence).finally(() => scheduled.delete(fence.id))
  })
}

export function retryDiagram($: EngineInterface, fence: DiagramFence): void {
  $.clock.after(0, () => {
    void runJob($, fence, true)
  })
}

// A reply row reaches session.append before its text, as often as not, so its fences are
// read off the stored messages once the row is in, as well as off the row.
export function watchReply($: EngineInterface, text: string): void {
  for (const fence of diagramsIn(text)) scheduleDiagram($, fence)
  $.clock.after(0, () => {
    void $.session.messages().then(messages => {
      for (const message of messages.slice(-6)) {
        if (message.role === 'assistant') for (const fence of diagramsIn(message.text)) scheduleDiagram($, fence)
      }
    }).catch(() => undefined)
  })
}

// What a fence's card shows: its member, else what the cache holds. A diagram not drawn yet,
// or one a reload cut off, is scheduled; one in the cache comes back through its job too.
export async function diagramState($: EngineInterface, fence: DiagramFence): Promise<Diagram | undefined> {
  const diagram = await read($, { ...DIAGRAM, id: fence.id })
  if (isStale(diagram, LOAD)) scheduleDiagram($, fence)
  if (diagram !== undefined) return diagram
  const hit = await cached($, fence.id)
  return hit === undefined ? undefined : { status: 'ready', ...hit }
}

// How a drawn diagram shows on the surface: see Picture.
export async function pictureOf($: EngineInterface, surface: RenderSurface, files: DiagramFiles, columns: number): Promise<Picture> {
  if (surface === 'terminal') {
    if (place.pixels && files.png !== undefined) return { kind: 'png', file: files.png, title: files.title, ...pictureSize(files, columns) }
    try {
      return { kind: 'cells', art: JSON.parse(await $.fs.read(files.cells)) as CellArt }
    } catch {
      return { kind: 'path', file: files.svg }
    }
  }
  const source = await $.fs.read(files.svg).catch(() => '')
  return source !== '' && source.length <= SVG_CAP ? { kind: 'svg', source, title: files.title } : { kind: 'path', file: files.svg }
}
