import type { ModelCompleteRequest } from 'claude-code'
import type { Diagram, DiagramFiles } from '../types'

// A ```excalidraw fence in a reply holds a brief. A background model call turns the brief into
// a .flow spec, renderer/render.mjs lays the spec out and draws it, and the card the fence
// became redraws with the picture. Pure functions: the job lives in diagram-job.ts and the
// card in diagram-card.tsx.

// The system prompt's section that has Claude draw diagrams, while diagrams are on.
export const DIAGRAM_HINT = 'Excalidraw diagrams: in this terminal a ```excalidraw fenced block draws as an Excalidraw diagram in place, inside your reply, while another model draws it in the background. Draw one by default, without being asked, whenever a reply explains a design, an architecture, how components or services connect, a process of several steps, or a before-and-after change. One diagram per reply, in the final answer: text written between tool calls is folded away. Skip it for short answers, code edits, and status updates. The fence holds a short plain-language brief, not JSON: a title, the boxes, the arrows between them with their labels, and any side-by-side panels such as Before and After. Prefer ```excalidraw over a mermaid flowchart, sequence, state, or architecture diagram; keep mermaid for data charts such as xy, pie, gantt, timeline, sankey, and treemap.'

// The background model's system prompt: a brief in, a .flow spec out.
export const SPEC_GUIDE = `You turn a diagram brief into a .flow spec for a layout generator. Reply with the spec alone: no code fence, no commentary.

.flow lines (// starts a comment):
  title: <text>                    title above the panels
  width: <px>                      box width, 120-600, default 200
  flow <id>: <label> [#rrggbb]     a coloured path; colour auto-assigned if omitted
  node <id>: <text> [| <detail>]   declare once at the top; inside a panel, overrides it there
  panel <label>                    starts a panel; panels run left to right
  a, b, _, c                       a row: each line is the next row, each cell the next column, _ leaves a cell empty
  a -> b [mods] [: label]          an edge; the label may contain colons
  mods, on cells and edges: added | removed | problem | @<flow> (one per element)

Rows and edges sit indented under their panel. Positions are never given in pixels. A node's detail is a smaller grey second line, best for a code symbol under a plain-language concept.

Rules:
- Every panel needs at least one row of nodes.
- An edge joins two nodes that both sit in the rows of its own panel. No arrow crosses from one panel to another: to show a hand-off, place the receiving node in the sending panel's rows too, or reuse the node id in the next panel.
- Keep the diagram narrow: at most three panels, at most three cells in any row, and width 200 or less. The terminal draws it at about 22 columns per box.
- Keep box text under 30 characters and edge labels under 24; one long box lengthens the whole diagram.
- Rows run top to bottom. End a repeating path in an outcome box ("retried next pass") instead of an arrow back up, which routes around the panel and crosses everything.
- Reuse one node id across panels for the same participant, so Before and After panels read as a diff.
- added, removed and problem colour a cell or edge green, red or orange and add a legend; use them for before-and-after designs.
- flow colours independent paths through shared boxes; put it on edges and leave shared nodes neutral.
- Do not write an out: line.

Example:
title: Write access - a read-only account made every command a silent no-op
width: 240

node pub: command published | jobs/run
node drop: broker drops it silently | per-account ACL
node probe: startup write probe | probeWrite()
node pick: write-capable account chosen

panel Before
  pub
  drop problem
  pub -> drop problem

panel After
  probe added
  pick added
  probe -> pick added: 0x87 means denied`

// The spec comes from Sonnet; a spec the generator refuses, or one too wide for the terminal,
// goes back to it this many times.
export const SPEC_MODEL = 'sonnet'
export const CORRECTIONS = 2

// A reply's diagram fence: its brief, and the id its picture is kept under.
export type DiagramFence = { kind: 'diagram'; id: string; brief: string }
// A diagram in terminal cells, as render.mjs writes it: lines of [text, tone] runs, the tone
// null for the terminal's own colour, `dim`, `bold`, or a hex colour.
export type CellArt = { columns: number; lines: [string, string | null][][] }

const DIAGRAM_OPENING = /^ {0,3}(?:`{3,}|~{3,})\s*excalidraw(?:\s.*)?$/

// cyrb53: a 53-bit string hash, so a brief keys the same diagram in every session.
export function idOf(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// A closed fence as a diagram: one whose info string is `excalidraw` and whose brief is not
// blank. Any other fence is null.
export function diagramOf(open: string, body: readonly string[]): DiagramFence | null {
  if (!DIAGRAM_OPENING.test(open)) return null
  const brief = body.join('\n').trim()
  return brief === '' ? null : { kind: 'diagram', id: idOf(brief), brief }
}

// A brief already written as a .flow spec goes to the renderer as it is.
export const isFlow = (brief: string) => /^\s*panel\s+\S/m.test(brief) && /^\s*node\s+\w+:/m.test(brief)

// The model's spec, past any code fence it wrapped the spec in.
export const unfenced = (text: string) => text.replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '').trim()

// The columns a card's cells may take: the viewport less the card's border and padding.
export const roomOf = (columns: number) => Math.max(40, columns - 6)

// What the model reads: the brief, the width budget where the terminal draws cells, and, on a
// correction, its last spec and what was wrong with it.
export function specRequest(brief: string, budget: { pixels: boolean; columns: number }, failed?: { spec: string; problem: string }): ModelCompleteRequest {
  const room = roomOf(budget.columns)
  const fit = budget.pixels
    ? ''
    : `\n\nThe terminal draws the diagram in ${room} columns. A box at width 200 takes about 25 columns and each panel adds about 6, so keep at most ${Math.max(1, Math.floor(room / 26))} boxes side by side across all panels together; stack rows instead of widening them.`
  const correction = failed === undefined ? '' : `\n\nYour spec:\n${failed.spec}\n\nThe generator refused it:\n${failed.problem}\n\nReply with a corrected spec.`
  return { model: SPEC_MODEL, system: SPEC_GUIDE, prompt: `Brief:\n${brief}${fit}${correction}`, maxTokens: 4000, timeoutMs: 120000 }
}

// Why a drawn diagram does not serve where cells show it: wider than the card's room.
export function widthProblem(files: DiagramFiles, budget: { pixels: boolean; columns: number }): string | undefined {
  const room = roomOf(budget.columns)
  if (budget.pixels && files.png !== undefined) return undefined
  return files.columns > room
    ? `The diagram is ${files.columns} columns wide and the terminal has ${room}. Put fewer boxes side by side: fewer panels, fewer cells per row, more rows.`
    : undefined
}

// A member still drawing under another load's mark is an orphan: its job died with that load.
export const isOrphan = (diagram: Diagram | undefined, load: string) => diagram?.status === 'drawing' && diagram.load !== load

// Nothing drawn yet, or a job a reload cut off: the diagram is drawn again.
export const isStale = (diagram: Diagram | undefined, load: string) => diagram === undefined || isOrphan(diagram, load)

// The terminal cells a PNG takes: about 16 pixels a column, at most the room, and rows from
// the picture's shape at a cell's height of about twice its width.
export function pictureSize(files: DiagramFiles, columns: number): { columns: number; rows: number } {
  const wide = Math.max(1, Math.min(roomOf(columns), Math.ceil(files.width / 16), 255))
  return { columns: wide, rows: Math.max(1, Math.min(255, Math.round(((wide * files.height) / files.width) * 0.48))) }
}

const DIAGRAMS_HELP = 'usage: /lucid diagrams on|off'

// Diagrams are on until `/lucid diagrams off`.
export const diagramsOf = (value: unknown): boolean => value !== 'off'

const describe = (diagrams: boolean) => `diagrams: ${diagrams ? 'on' : 'off'}`

// `/lucid diagrams [on|off]`: a setting to store, or only text to show.
export function diagramsCommand(args: string, current: boolean): { diagrams?: boolean; text: string } {
  const [setting, value, extra] = args.trim().toLowerCase().split(/\s+/)
  if (setting !== 'diagrams' || extra !== undefined) return { text: DIAGRAMS_HELP }
  if (value === undefined) return { text: describe(current) }
  if (value !== 'on' && value !== 'off') return { text: DIAGRAMS_HELP }
  return { diagrams: value === 'on', text: describe(value === 'on') }
}
