// A short line saying whether the open note's changes are saved. Phase 4 swaps the
// Save button for autosave; this indicator stays and gains a "retrying" state.

// Where a save stands: nothing happening, a request in flight, or the last one failed.
export type SaveState = 'idle' | 'saving' | 'error'

// What App hands in.
interface SaveStatusProps {
  // True when the title or body differs from what the server last saved.
  dirty: boolean
  // Where the latest save stands.
  state: SaveState
  // The failure message when state is 'error'.
  error: string | null
}

// Picks the text and style for the current situation.
function describe({ dirty, state, error }: SaveStatusProps): { text: string; tone: string } {
  // A save is on its way.
  if (state === 'saving') return { text: 'Saving…', tone: 'busy' }
  // The last save failed; the changes are still only on this page.
  if (state === 'error') return { text: `Not saved: ${error ?? 'unknown error'}`, tone: 'error' }
  // Edits made since the last save.
  if (dirty) return { text: 'Unsaved changes', tone: 'dirty' }
  // Everything on screen matches the server.
  return { text: 'Saved', tone: 'saved' }
}

// The status text itself.
export default function SaveStatus(props: SaveStatusProps) {
  // Works out what to say.
  const { text, tone } = describe(props)
  // role="status" makes screen readers read changes out politely, without interrupting.
  return <span className={`save-status ${tone}`} role="status">{text}</span>
}
