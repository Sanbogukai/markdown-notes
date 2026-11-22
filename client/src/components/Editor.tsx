// The middle column: a toolbar (save status, Pin, Export, Delete), the title, the tags and
// the Markdown textarea. It holds no copy of the note; every keystroke goes straight up to
// App, which autosaves.

// useState for the delete confirmation; useEffect and useRef to focus the title.
import { useEffect, useRef, useState } from 'react'
// The full note type.
import type { Note } from '../../../shared/types.ts'
// The save indicator and its state type.
import SaveStatus, { type SaveState } from './SaveStatus.tsx'
// The tag chips.
import TagInput from './TagInput.tsx'

// The longest title the server accepts (server/src/routes.ts, MAX_TITLE).
const MAX_TITLE = 200
// Characters Windows, macOS or Linux refuse in file names, plus control characters.
// Matches the ":" and "?" in "Plan: v2?"; leaves "Plan v2" alone.
// Try it: https://regex101.com/?regex=%5B%5C%5C%2F%3A*%3F%22%3C%3E%7C%5Cx00-%5Cx1f%5D&flags=g&flavor=javascript&testString=Plan%3A%20v2%3F
// Control characters are matched on purpose here, so the lint rule against them is off for this line.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME = /[\\/:*?"<>|\x00-\x1f]/g

// Which half a phone shows: the textarea or the rendered preview.
export type MobileView = 'edit' | 'preview'

// The fields the editor can change.
export type EditorChanges = Partial<Pick<Note, 'title' | 'body' | 'tags'>>

// What App hands in.
interface EditorProps {
  // The note as it is on screen, with any unsaved edits.
  note: Note
  // True when the note on screen differs from the saved copy.
  dirty: boolean
  // Where the latest save stands, and its error.
  saveState: SaveState
  saveError: string | null
  // True while a pin or delete request is in flight, to stop double clicks.
  busy: boolean
  // True for a note just created, so its title is focused and selected for typing over.
  isNew: boolean
  // The phone layout's current half, and how to switch it.
  mobileView: MobileView
  onMobileView: (view: MobileView) => void
  // Called on every edit with the field that changed.
  onChange: (changes: EditorChanges) => void
  // The toolbar actions.
  onTogglePin: () => void
  onDelete: () => void
  // The phone layout's back button.
  onBack: () => void
}

// Downloads the note as "<title>.md", built in the browser from what is on screen.
function exportNote(note: Note) {
  // The file: the title as a heading, then the body.
  const blob = new Blob([`# ${note.title}\n\n${note.body}`], { type: 'text/markdown' })
  // A safe file name; trim() and the fallback cover a title of only unsafe characters.
  const name = note.title.replace(UNSAFE_FILENAME, '-').trim() || 'note'
  // A temporary URL pointing at the blob in memory.
  const url = URL.createObjectURL(blob)
  // A link with `download` saves the file instead of opening it; it never joins the page.
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.md`
  link.click()
  // Frees the blob's memory now the download has started.
  URL.revokeObjectURL(url)
}

// The editor for one note. App gives it key={note.id}, so opening another note starts
// a fresh Editor: the delete question is dropped and the focus effect runs again.
export default function Editor(props: EditorProps) {
  // Pulls out each prop by name, to keep the JSX below short.
  const { note, dirty, saveState, saveError, busy, isNew, mobileView } = props
  // True while the "Delete this note?" question is showing.
  const [confirming, setConfirming] = useState(false)
  // The title input, for focusing it.
  const titleRef = useRef<HTMLInputElement>(null)

  // On a new note, puts the cursor in the title with "Untitled" selected, so typing replaces it.
  useEffect(() => {
    if (isNew) titleRef.current?.select()
  }, [isNew])

  return (
    // A labelled region for screen readers. data-view drives the phone layout's CSS.
    <section className="editor" aria-label="Editor" data-view={mobileView}>
      {/* The toolbar row: status on the left, buttons on the right. */}
      <div className="toolbar">
        {/* Phones only: back to the list. */}
        <button type="button" className="mobile-only" onClick={props.onBack}>
          ← Notes
        </button>
        <SaveStatus dirty={dirty} state={saveState} error={saveError} />
        {/* The inline delete confirmation from project 1: one click asks, a second confirms. */}
        {confirming ? (
          <div className="confirm" role="group" aria-label="Confirm delete">
            <span>Delete this note?</span>
            <button type="button" className="danger" disabled={busy} onClick={props.onDelete}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            {/* Pins or unpins. aria-pressed makes it a toggle for screen readers. */}
            <button type="button" aria-pressed={note.pinned} disabled={busy} onClick={props.onTogglePin}>
              {note.pinned ? 'Unpin' : 'Pin'}
            </button>
            {/* Saves the note as a .md file. */}
            <button type="button" onClick={() => exportNote(note)}>
              Export .md
            </button>
            {/* Starts the delete confirmation. */}
            <button type="button" className="danger-outline" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>

      {/* Phones only: switch between writing and the rendered preview. */}
      <div className="view-toggle mobile-only" role="group" aria-label="View">
        <button type="button" aria-pressed={mobileView === 'edit'} onClick={() => props.onMobileView('edit')}>
          Edit
        </button>
        <button type="button" aria-pressed={mobileView === 'preview'} onClick={() => props.onMobileView('preview')}>
          Preview
        </button>
      </div>

      {/* The title. An empty title is saved as "Untitled" by the server. */}
      <label className="visually-hidden" htmlFor="note-title">Title</label>
      <input
        ref={titleRef}
        id="note-title"
        className="title-input"
        placeholder="Untitled"
        // The server refuses longer titles, so the input stops there too.
        maxLength={MAX_TITLE}
        value={note.title}
        onChange={(event) => props.onChange({ title: event.target.value })}
      />

      {/* The tag chips; changes autosave like the text. */}
      <TagInput tags={note.tags} onChange={(tags) => props.onChange({ tags })} />

      {/* The Markdown body. */}
      <label className="visually-hidden" htmlFor="note-body">Body, in Markdown</label>
      <textarea
        id="note-body"
        className="body-input"
        placeholder="Write in Markdown: # heading, **bold**, - list, [link](https://…)"
        // Notes are mostly prose, so the browser's spell check stays on.
        spellCheck
        value={note.body}
        onChange={(event) => props.onChange({ body: event.target.value })}
      />
    </section>
  )
}
