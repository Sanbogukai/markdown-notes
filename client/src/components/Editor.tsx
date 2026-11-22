// The middle column: a toolbar (save status, Save, Pin, Delete), the title and the
// Markdown textarea. It holds no copy of the note; every keystroke goes straight up to App.

// useState for the delete confirmation, which only this component cares about.
import { useState } from 'react'
// The full note type.
import type { Note } from '../../../shared/types.ts'
// The save indicator and its state type.
import SaveStatus, { type SaveState } from './SaveStatus.tsx'

// The longest title the server accepts (server/src/routes.ts, MAX_TITLE).
const MAX_TITLE = 200

// What App hands in.
interface EditorProps {
  // The note as it is on screen, with any unsaved edits.
  note: Note
  // True when the title or body differs from the saved copy.
  dirty: boolean
  // Where the latest save stands, and its error.
  saveState: SaveState
  saveError: string | null
  // True while a pin or delete request is in flight, to stop double clicks.
  busy: boolean
  // Called on every edit with the field that changed.
  onChange: (changes: Partial<Pick<Note, 'title' | 'body'>>) => void
  // The toolbar actions.
  onSave: () => void
  onTogglePin: () => void
  onDelete: () => void
}

// The editor for one note. App gives it key={note.id}, so opening another note starts
// a fresh Editor and any open delete confirmation is dropped.
export default function Editor(props: EditorProps) {
  // Pulls out each prop by name, to keep the JSX below short.
  const { note, dirty, saveState, saveError, busy, onChange, onSave, onTogglePin, onDelete } = props
  // True while the "Delete this note?" question is showing.
  const [confirming, setConfirming] = useState(false)

  return (
    // A labelled region for screen readers, like the preview beside it.
    <section className="editor" aria-label="Editor">
      {/* The toolbar row: status on the left, buttons on the right. */}
      <div className="toolbar">
        <SaveStatus dirty={dirty} state={saveState} error={saveError} />
        {/* The inline delete confirmation from project 1: one click asks, a second confirms. */}
        {confirming ? (
          // A group of the question and its two answers; role="group" ties them together.
          <div className="confirm" role="group" aria-label="Confirm delete">
            <span>Delete this note?</span>
            {/* Confirms: App deletes the note. */}
            <button type="button" className="danger" disabled={busy} onClick={onDelete}>
              Delete
            </button>
            {/* Backs out without deleting. */}
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          // The normal buttons. A fragment groups them without adding an element.
          <>
            {/* Saves now; there is nothing to save while the note is clean or a save is running. */}
            <button
              type="button"
              className="primary"
              disabled={!dirty || saveState === 'saving'}
              onClick={onSave}
            >
              Save
            </button>
            {/* Pins or unpins. aria-pressed makes it a toggle for screen readers. */}
            <button type="button" aria-pressed={note.pinned} disabled={busy} onClick={onTogglePin}>
              {note.pinned ? 'Unpin' : 'Pin'}
            </button>
            {/* Starts the delete confirmation. */}
            <button type="button" className="danger-outline" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>

      {/* The title. An empty title is saved as "Untitled" by the server. */}
      <label className="visually-hidden" htmlFor="note-title">Title</label>
      <input
        id="note-title"
        className="title-input"
        placeholder="Untitled"
        // The server refuses longer titles, so the input stops there too.
        maxLength={MAX_TITLE}
        // Controlled: the note in App's state is the single source of truth.
        value={note.title}
        // Sends the new title up to App.
        onChange={(event) => onChange({ title: event.target.value })}
      />

      {/* The Markdown body. */}
      <label className="visually-hidden" htmlFor="note-body">Body, in Markdown</label>
      <textarea
        id="note-body"
        className="body-input"
        placeholder="Write in Markdown: # heading, **bold**, - list, [link](https://…)"
        // Notes are mostly prose, so the browser's spell check stays on.
        spellCheck
        value={note.body}
        // Sends the new body up to App on every keystroke.
        onChange={(event) => onChange({ body: event.target.value })}
      />
    </section>
  )
}
