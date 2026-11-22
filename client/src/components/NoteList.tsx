// The list of notes in the sidebar: title, a short excerpt and when it was last edited.
// Clicking a note asks App to open it.

// The list rows the server sends.
import type { NoteSummary } from '../../../shared/types.ts'
// Date and excerpt text helpers.
import { formatDate } from '../format.ts'
// The excerpt with search matches highlighted.
import Excerpt from './Excerpt.tsx'

// What App hands in.
interface NoteListProps {
  // The rows to show, already sorted by the server.
  notes: NoteSummary[]
  // The open note's id, so its row can be marked; null when none is open.
  selectedId: number | null
  // True until the first list arrives, so "No notes yet" does not flash on load.
  loading: boolean
  // A message when the list could not be loaded.
  error: string | null
  // The search text, used to name the search when nothing matches.
  search: string
  // The tag being filtered on, also named when nothing matches.
  tag: string | null
  // Called with a note's id when its row is clicked.
  onOpen: (id: number) => void
}

// Picks the message to show when there are no rows to list.
function emptyMessage(loading: boolean, search: string, tag: string | null): string {
  // The first fetch has not come back yet.
  if (loading) return 'Loading…'
  // A search is active, so the search is what found nothing. trim() ignores stray spaces.
  if (search.trim()) return `No notes match “${search.trim()}”${tag ? ` tagged ${tag}` : ''}.`
  // Only a tag filter is active.
  if (tag) return `No notes tagged ${tag}.`
  // No search and no rows: the database has no notes at all.
  return 'No notes yet. Create one with New note.'
}

// The list itself, or a message when there is nothing to list.
export default function NoteList({ notes, selectedId, loading, error, search, tag, onOpen }: NoteListProps) {
  // A failed load wins over everything else; role="alert" makes screen readers announce it.
  if (error) return <p className="list-message error" role="alert">Could not load notes: {error}</p>
  // Nothing to list: say why.
  if (notes.length === 0) return <p className="list-message">{emptyMessage(loading, search, tag)}</p>

  return (
    // An unordered list, so screen readers say how many notes there are.
    <ul className="note-list">
      {/* One row per note; key lets React match rows between renders. */}
      {notes.map((note) => (
        <li key={note.id}>
          {/* A real button, so the row works with the keyboard as well as the mouse. */}
          <button
            type="button"
            // The open note's row gets the "selected" class for its highlight.
            className={note.id === selectedId ? 'note-row selected' : 'note-row'}
            // Tells screen readers which row is the open one.
            aria-current={note.id === selectedId ? 'true' : undefined}
            // Asks App to open this note.
            onClick={() => onOpen(note.id)}
          >
            {/* Title line, with a pin marker in front when the note is pinned. */}
            <span className="note-row-title">
              {/* The pin is decoration; the hidden word says it to screen readers. */}
              {note.pinned && <span className="pin-mark" aria-hidden="true">📌 </span>}
              {note.pinned && <span className="visually-hidden">Pinned: </span>}
              {note.title}
            </span>
            {/* A short piece of the body, with search matches highlighted. */}
            <Excerpt text={note.excerpt} />
            {/* When it was last edited, as a real <time> element with the raw value for machines. */}
            <time className="note-row-date" dateTime={note.updated_at}>
              {formatDate(note.updated_at)}
            </time>
          </button>
        </li>
      ))}
    </ul>
  )
}
