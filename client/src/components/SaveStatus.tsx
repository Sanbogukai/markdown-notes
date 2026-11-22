// A short line saying whether the open note's changes are saved by autosave.

// Where a save stands: nothing happening, a request in flight, or the last one failed
// and a retry is waiting.
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
  // The last save failed and a retry is scheduled; the changes are still only on this page.
  if (state === 'error') return { text: `Not saved, retrying (${error ?? 'unknown error'})`, tone: 'error' }
  // Edits waiting for the pause in typing that triggers a save.
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
