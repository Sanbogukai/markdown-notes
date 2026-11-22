// The whole app's state lives here, in useState, and flows down to the components as
// props (the same shape as project 1). Components report changes back through callbacks.
//
// Two copies of the open note are kept:
//   saved: the note exactly as the server last returned it.
//   draft: what is on screen, with any edits not yet saved.
// Comparing the two tells whether there are unsaved changes. Autosave sends the draft
// after a pause in typing, retries with backoff when that fails, and runs at once on
// Ctrl+S, before switching notes and when the page closes.

// React's state, effect and ref hooks.
import { useEffect, useRef, useState } from 'react'
// The shared note types.
import type { Note, NoteSummary, Tag } from '../../shared/types.ts'
// Every server call, and the helper that turns errors into text.
import * as api from './api.ts'
// The screen's pieces.
import Editor, { type EditorChanges, type MobileView } from './components/Editor.tsx'
import NoteList from './components/NoteList.tsx'
import Preview from './components/Preview.tsx'
import type { SaveState } from './components/SaveStatus.tsx'
import SearchBar from './components/SearchBar.tsx'
import TagFilter from './components/TagFilter.tsx'

// How long the search box must be still before the list is fetched, so typing "react"
// sends one request instead of five.
const SEARCH_DELAY_MS = 250
// How long typing must pause before the note is saved.
const AUTOSAVE_DELAY_MS = 800
// The first retry after a failed save waits this long; each later one waits twice as long...
const RETRY_BASE_MS = 2000
// ...multiplied by this each time...
const RETRY_FACTOR = 2
// ...up to this ceiling, so a long outage retries every 30 seconds.
const RETRY_MAX_MS = 30_000

// The fields autosave sends, as they were sent in one request.
type SentText = Pick<Note, 'title' | 'body' | 'tags'>

// True when the saveable fields of two copies of a note differ. Tags are compared as
// JSON text because arrays are never === to each other.
function differs(a: SentText, b: SentText): boolean {
  return a.title !== b.title || a.body !== b.body || JSON.stringify(a.tags) !== JSON.stringify(b.tags)
}

// Folds a save's result into the draft. The server may tidy what it was sent (a blank
// title comes back as "Untitled"), and the user may have kept typing while the request
// was out. A field takes the server's version only if it is unchanged since it was sent.
function mergeSaved(draft: Note | null, result: Note, sent: SentText): Note | null {
  // The user moved to another note meanwhile; leave that one alone.
  if (draft?.id !== result.id) return draft
  // Start from the server's note (new updated_at and so on), then keep newer edits.
  const merged = { ...result }
  // Edits since the save went out: keep them, they are newer than the result.
  if (draft.title !== sent.title) merged.title = draft.title
  if (draft.body !== sent.body) merged.body = draft.body
  if (JSON.stringify(draft.tags) !== JSON.stringify(sent.tags)) merged.tags = draft.tags
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
  // Every tag in use with its count, for the filter row; and the tag being filtered on.
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  // Bumped after any change on the server, to make the list and tags fetch again.
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
  // The id of the note just made with New note, so its title is focused and selected.
  const [createdId, setCreatedId] = useState<number | null>(null)
  // On a phone, whether the open note shows its textarea or its preview.
  const [mobileView, setMobileView] = useState<MobileView>('edit')

  // Counts open requests, so a late answer to an older open is dropped.
  const openRequest = useRef(0)
  // Copies of draft and saved that the save code reads. Timers and window listeners
  // outlive the render that made them, so they read these refs, never stale state.
  const draftRef = useRef<Note | null>(null)
  const savedRef = useRef<Note | null>(null)
  // The pending autosave or retry timer.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The save request in flight, so a second save waits for it instead of racing it.
  const inFlight = useRef<Promise<boolean> | null>(null)
  // How many saves in a row have failed, for the backoff.
  const retries = useRef(0)

  // True when the note on screen differs from what the server has.
  const dirty = draft !== null && saved !== null && differs(draft, saved)

  // Fetches the list whenever the search text or tag changes, or something was saved.
  useEffect(() => {
    // Set when this effect is replaced, so a late answer cannot overwrite a newer list.
    let ignore = false
    // An effect cannot itself be async, so the async work lives in this inner function.
    async function load() {
      try {
        // trim() so "react " and "react" are the same search; null tag means no filter.
        const list = await api.listNotes({ q: search.trim(), tag: selectedTag ?? undefined })
        if (ignore) return
        setNotes(list)
        setListError(null)
      } catch (error) {
        if (!ignore) setListError(api.messageOf(error))
      } finally {
        // The first answer, good or bad, ends the loading state.
        if (!ignore) setLoading(false)
      }
    }
    // Waits for typing to pause before fetching.
    const wait = setTimeout(() => void load(), SEARCH_DELAY_MS)
    // Cleanup: cancel the wait and drop the answer.
    return () => {
      ignore = true
      clearTimeout(wait)
    }
  }, [search, selectedTag, listVersion])

  // Fetches the tag counts after every change, since a save can add or drop a tag.
  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const list = await api.listTags()
        if (!ignore) setTags(list)
      } catch {
        // The filter row is a convenience; the list's own error message covers an outage.
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [listVersion])

  // Asks the list and tags to fetch again.
  const refreshList = () => setListVersion((version) => version + 1)

  // Sends the draft to the server if it has unsaved changes. Resolves true when everything
  // is saved, false when the save failed (a retry is then scheduled).
  async function flush(): Promise<boolean> {
    // Whatever was pending is happening now.
    clearTimeout(timer.current)
    // One save at a time: wait for the one in flight, then look again, since the draft
    // may have changed while it was out.
    if (inFlight.current) {
      await inFlight.current
      return flush()
    }
    const current = draftRef.current
    const base = savedRef.current
    // Nothing open, or nothing changed: already saved.
    if (!current || !base || !differs(current, base)) return true
    // A copy of exactly what is being sent, to compare against later edits.
    const sent: SentText = { title: current.title, body: current.body, tags: current.tags }
    setSaveState('saving')
    // The request and what follows it, kept in a ref so a second flush can wait on it.
    const attempt = (async () => {
      try {
        const result = await api.updateNote(current.id, sent)
        // Updated at once, not after the next render, so a flush straight after this
        // one compares against the new copy.
        savedRef.current = result
        setSaved(result)
        // Takes the server's tidy-ups without losing newer edits.
        setDraft((latest) => mergeSaved(latest, result, sent))
        setSaveState('idle')
        setSaveError(null)
        retries.current = 0
        // The title, excerpt, order and tag counts in the sidebar may have changed.
        refreshList()
        return true
      } catch (error) {
        // Keeps the edits on screen, says why, and tries again later.
        setSaveState('error')
        setSaveError(api.messageOf(error))
        // 2s, 4s, 8s... capped at 30s.
        const delay = Math.min(RETRY_BASE_MS * RETRY_FACTOR ** retries.current, RETRY_MAX_MS)
        retries.current += 1
        timer.current = setTimeout(() => void flush(), delay)
        return false
      }
    })()
    inFlight.current = attempt
    try {
      return await attempt
    } finally {
      inFlight.current = null
    }
  }

  // After every edit: keeps the refs current and schedules an autosave.
  useEffect(() => {
    draftRef.current = draft
    savedRef.current = saved
    // Nothing to save.
    if (!draft || !saved || !differs(draft, saved)) return
    // After a failure, a new edit retries at once; otherwise wait for typing to pause.
    const delay = retries.current > 0 ? 0 : AUTOSAVE_DELAY_MS
    timer.current = setTimeout(() => void flush(), delay)
    // A newer edit replaces this timer.
    return () => clearTimeout(timer.current)
    // flush reads only refs and stable setters, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saved])

  // Ctrl+S (Cmd+S on a Mac) saves at once, and the last edits go out when the page closes.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        // Stops the browser's own "Save page as" dialog.
        event.preventDefault()
        void flush()
      }
    }
    // The page is closing: send any unsaved edits with keepalive, which lets the request
    // finish after the page is gone. There is no time to wait for an answer.
    async function onUnload() {
      const current = draftRef.current
      const base = savedRef.current
      if (!current || !base || !differs(current, base)) return
      try {
        await api.updateNote(current.id, { title: current.title, body: current.body, tags: current.tags }, true)
      } catch {
        // The page is gone; nothing can report this.
      }
    }
    const unload = () => void onUnload()
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', unload)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shows a note in the editor as both the saved and the on-screen copy.
  function show(note: Note | null) {
    savedRef.current = note
    draftRef.current = note
    setSaved(note)
    setDraft(note)
    // A fresh note has nothing pending and no old errors.
    retries.current = 0
    setSaveState('idle')
    setSaveError(null)
    setActionError(null)
    setMobileView('edit')
  }

  // Opens a note from the list, saving the current one first.
  async function openNote(id: number) {
    if (id === draft?.id) return
    // If the save fails, stay, so the edits are not lost.
    if (!(await flush())) return
    const request = ++openRequest.current
    try {
      const note = await api.getNote(id)
      // Another open started meanwhile; it wins.
      if (request !== openRequest.current) return
      setCreatedId(null)
      show(note)
    } catch (error) {
      if (request === openRequest.current) setActionError(`Could not open the note: ${api.messageOf(error)}`)
    }
  }

  // Creates an empty note and opens it with its title ready to type over.
  async function newNote() {
    if (!(await flush())) return
    // Any open still in flight is now stale.
    openRequest.current++
    setBusy(true)
    try {
      const note = await api.createNote()
      setCreatedId(note.id)
      show(note)
      refreshList()
    } catch (error) {
      setActionError(`Could not create a note: ${api.messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  // The phone layout's back button: saves, then returns to the list.
  async function closeNote() {
    if (!(await flush())) return
    openRequest.current++
    show(null)
  }

  // Pins or unpins the open note. Only the flag is sent; autosave handles the text.
  async function togglePin() {
    if (!saved) return
    setBusy(true)
    try {
      const result = await api.updateNote(saved.id, { pinned: !saved.pinned })
      // Keeps the saved copy's text as it was, so unsaved edits still count as unsaved.
      const next = { ...saved, pinned: result.pinned }
      savedRef.current = next
      setSaved(next)
      setDraft((current) => (current?.id === result.id ? { ...current, pinned: result.pinned } : current))
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
    // A pending autosave for a deleted note would only fail.
    clearTimeout(timer.current)
    try {
      await api.deleteNote(saved.id)
      show(null)
      refreshList()
    } catch (error) {
      setActionError(`Could not delete the note: ${api.messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  // Applies an edit from the editor to the on-screen copy; the effect above saves it.
  function edit(changes: EditorChanges) {
    setDraft((current) => (current ? { ...current, ...changes } : current))
  }

  return (
    // The grid. has-note and data-view drive the phone layout, which shows one screen at a time.
    <div className={draft ? 'app has-note' : 'app'} data-view={mobileView}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Notes</h1>
          <button type="button" className="primary" disabled={busy} onClick={newNote}>
            New note
          </button>
        </header>
        <SearchBar value={search} onChange={setSearch} />
        <TagFilter tags={tags} selected={selectedTag} onSelect={setSelectedTag} />
        <NoteList
          notes={notes}
          selectedId={draft?.id ?? null}
          loading={loading}
          error={listError}
          search={search}
          tag={selectedTag}
          onOpen={openNote}
        />
      </aside>

      {draft ? (
        <>
          <div className="editor-column">
            {actionError && <p className="action-error" role="alert">{actionError}</p>}
            {/* key starts a fresh editor per note (delete question, title focus). */}
            <Editor
              key={draft.id}
              note={draft}
              dirty={dirty}
              saveState={saveState}
              saveError={saveError}
              busy={busy}
              isNew={draft.id === createdId}
              mobileView={mobileView}
              onMobileView={setMobileView}
              onChange={edit}
              onTogglePin={togglePin}
              onDelete={removeNote}
              onBack={closeNote}
            />
          </div>
          <Preview body={draft.body} />
        </>
      ) : (
        <main className="empty-pane">
          {actionError && <p className="action-error" role="alert">{actionError}</p>}
          {/* Three empty states: nothing at all yet, or notes but none open. */}
          <p>{notes.length === 0 && !search && !selectedTag ? 'No notes yet. Create your first with New note.' : 'Pick a note from the list, or create one with New note.'}</p>
        </main>
      )}
    </div>
  )
}
