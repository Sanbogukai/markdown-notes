// The whole app's state lives here, in useState, and flows down to the components as
// props (the same shape as project 1). Components report changes back through callbacks.
//
// Two copies of the open note are kept:
//   saved: the note exactly as the server last returned it.
//   draft: what is on screen, with any edits not yet saved.
// Comparing the two tells whether there are unsaved changes.

// React's state, effect and ref hooks.
import { useEffect, useRef, useState } from 'react'
// The shared note types.
import type { Note, NoteSummary } from '../../shared/types.ts'
// Every server call, and the helper that turns errors into text.
import * as api from './api.ts'
// The screen's pieces.
import Editor from './components/Editor.tsx'
import NoteList from './components/NoteList.tsx'
import Preview from './components/Preview.tsx'
import type { SaveState } from './components/SaveStatus.tsx'
import SearchBar from './components/SearchBar.tsx'

// How long the search box must be still before the list is fetched, so typing "react"
// sends one request instead of five.
const SEARCH_DELAY_MS = 250

// The title and body as they were sent in one save request.
type SentText = Pick<Note, 'title' | 'body'>

// Folds a save's result into the draft. The server may tidy what it was sent (a blank
// title comes back as "Untitled"), and the user may have kept typing while the request
// was out. A field takes the server's version only if it is unchanged since it was sent.
function mergeSaved(draft: Note | null, result: Note, sent: SentText): Note | null {
  // The user moved to another note meanwhile; leave that one alone.
  if (draft?.id !== result.id) return draft
  // Start from the server's note (new updated_at and so on), then keep newer typing.
  const merged = { ...result }
  // Typing since the save went out: keep it, it is newer than the result.
  if (draft.title !== sent.title) merged.title = draft.title
  if (draft.body !== sent.body) merged.body = draft.body
  // The merged note becomes the new draft.
  return merged
}

export default function App() {
  // The rows in the sidebar list.
  const [notes, setNotes] = useState<NoteSummary[]>([])
  // True until the first list arrives.
  const [loading, setLoading] = useState(true)
  // A message when the list could not be loaded.
  const [listError, setListError] = useState<string | null>(null)
  // The search box text.
  const [search, setSearch] = useState('')
  // Bumped after any change on the server, to make the list fetch again.
  const [listVersion, setListVersion] = useState(0)

  // The open note as last saved, and as on screen. Both null when no note is open.
  const [saved, setSaved] = useState<Note | null>(null)
  const [draft, setDraft] = useState<Note | null>(null)
  // Where the latest save stands, and its error message.
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // True while a pin, delete or create request is in flight.
  const [busy, setBusy] = useState(false)
  // A message for a failed open, create, pin or delete, shown above the editor.
  const [actionError, setActionError] = useState<string | null>(null)

  // Counts open requests. Each one remembers its number; when a response arrives and a
  // newer open has started since, the response is stale and is dropped. A ref, because
  // changing it should not re-render anything.
  const openRequest = useRef(0)

  // True when the title or body on screen differs from what the server has.
  const dirty = draft !== null && saved !== null && (draft.title !== saved.title || draft.body !== saved.body)

  // Fetches the list whenever the search text changes or something was saved.
  useEffect(() => {
    // Set when this effect is replaced by a newer one, so an older response that arrives
    // late cannot overwrite a newer list (the `ignore` flag from project 1).
    let ignore = false
    // Fetches once and stores the answer. An effect cannot itself be async (it must return
    // its cleanup function, not a promise), so the async work lives in this inner function.
    async function load() {
      try {
        // trim() so "react " and "react" are the same search.
        const list = await api.listNotes({ q: search.trim() })
        // A newer fetch has started; this answer is out of date.
        if (ignore) return
        // Shows the new rows and clears any earlier error.
        setNotes(list)
        setListError(null)
      } catch (error) {
        // Only the latest fetch may report an error.
        if (!ignore) setListError(api.messageOf(error))
      } finally {
        // The first answer, good or bad, ends the loading state.
        if (!ignore) setLoading(false)
      }
    }
    // Waits for typing to pause before fetching. `void` marks the promise as deliberately
    // not awaited; load() handles its own errors.
    const timer = setTimeout(() => void load(), SEARCH_DELAY_MS)
    // Cleanup, run before the next effect and on unmount: cancel the wait, drop the answer.
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [search, listVersion])

  // Asks the list to fetch again.
  const refreshList = () => setListVersion((version) => version + 1)

  // Shows a note in the editor as both the saved and the on-screen copy.
  function show(note: Note | null) {
    setSaved(note)
    setDraft(note)
    // A fresh note has nothing pending and no old errors.
    setSaveState('idle')
    setSaveError(null)
    setActionError(null)
  }

  // Sends the draft's title and body to the server. Resolves true when everything is
  // saved (or there was nothing to save), false when the save failed.
  async function save(): Promise<boolean> {
    // Nothing open, or nothing changed: already saved.
    if (!draft || !dirty) return true
    // A copy of exactly what is being sent, to compare against later typing.
    const sent: SentText = { title: draft.title, body: draft.body }
    // Shows "Saving…".
    setSaveState('saving')
    setSaveError(null)
    try {
      // PATCH only the text; pinned and tags are left as they are.
      const result = await api.updateNote(draft.id, sent)
      // The server's copy is now the saved one.
      setSaved(result)
      // Takes the server's tidy-ups without losing newer typing.
      setDraft((current) => mergeSaved(current, result, sent))
      setSaveState('idle')
      // The title, excerpt and order in the list may have changed.
      refreshList()
      return true
    } catch (error) {
      // Keeps the edits on screen and says why they were not saved.
      setSaveState('error')
      setSaveError(api.messageOf(error))
      return false
    }
  }

  // Opens a note from the list, saving the current one first.
  async function openNote(id: number) {
    // Already open: nothing to do.
    if (id === draft?.id) return
    // Unsaved edits are saved before leaving; if that fails, stay so they are not lost.
    if (!(await save())) return
    // Numbers this request; ++ first, so the new number is the one stored.
    const request = ++openRequest.current
    try {
      // The full note, body included.
      const note = await api.getNote(id)
      // Another open started meanwhile; it wins.
      if (request !== openRequest.current) return
      show(note)
    } catch (error) {
      // Only the latest open reports its failure.
      if (request === openRequest.current) setActionError(`Could not open the note: ${api.messageOf(error)}`)
    }
  }

  // Creates an empty note and opens it.
  async function newNote() {
    // Saves the current note first, as when switching.
    if (!(await save())) return
    // Any open still in flight is now stale.
    openRequest.current++
    setBusy(true)
    try {
      // {} makes an "Untitled" note with an empty body.
      show(await api.createNote())
      refreshList()
    } catch (error) {
      setActionError(`Could not create a note: ${api.messageOf(error)}`)
    } finally {
      // Runs after success and failure alike.
      setBusy(false)
    }
  }

  // Pins or unpins the open note. Unsaved text is not sent; only the flag changes.
  async function togglePin() {
    // The button only shows with a note open, but TypeScript cannot know that.
    if (!saved) return
    setBusy(true)
    try {
      // Sends the opposite of the current flag.
      const result = await api.updateNote(saved.id, { pinned: !saved.pinned })
      // The server copy now has the new flag (pinning does not move updated_at).
      setSaved(result)
      // The draft keeps its unsaved text and takes only the new flag.
      setDraft((current) => (current?.id === result.id ? { ...current, pinned: result.pinned } : current))
      // Pinned notes sort to the top of the list.
      refreshList()
    } catch (error) {
      setActionError(`Could not change the pin: ${api.messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  // Deletes the open note after the editor's inline confirmation.
  async function removeNote() {
    if (!saved) return
    setBusy(true)
    try {
      await api.deleteNote(saved.id)
      // Nothing is open any more.
      show(null)
      refreshList()
    } catch (error) {
      setActionError(`Could not delete the note: ${api.messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  // Applies an edit from the editor to the on-screen copy only.
  function edit(changes: Partial<Pick<Note, 'title' | 'body'>>) {
    // Spreads the change over the current draft; nothing happens if no note is open.
    setDraft((current) => (current ? { ...current, ...changes } : current))
    // A new edit clears an old save failure's message from the status line.
    if (saveState === 'error') setSaveState('idle')
  }

  return (
    // The three-column grid: list, editor, preview.
    <div className="app">
      {/* The left column. */}
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Notes</h1>
          {/* Creates and opens a fresh note. */}
          <button type="button" className="primary" disabled={busy} onClick={newNote}>
            New note
          </button>
        </header>
        <SearchBar value={search} onChange={setSearch} />
        <NoteList
          notes={notes}
          selectedId={draft?.id ?? null}
          loading={loading}
          error={listError}
          search={search}
          onOpen={openNote}
        />
      </aside>

      {/* The editor and preview, or a hint when no note is open. */}
      {draft ? (
        // A fragment: the two sections become the grid's second and third columns.
        <>
          <div className="editor-column">
            {/* Errors from open, create, pin and delete. */}
            {actionError && <p className="action-error" role="alert">{actionError}</p>}
            {/* key resets the editor's own state (the delete question) per note. */}
            <Editor
              key={draft.id}
              note={draft}
              dirty={dirty}
              saveState={saveState}
              saveError={saveError}
              busy={busy}
              onChange={edit}
              onSave={save}
              onTogglePin={togglePin}
              onDelete={removeNote}
            />
          </div>
          <Preview body={draft.body} />
        </>
      ) : (
        <main className="empty-pane">
          {actionError && <p className="action-error" role="alert">{actionError}</p>}
          <p>Pick a note from the list, or create one with New note.</p>
        </main>
      )}
    </div>
  )
}
