// Thin, typed wrappers over fetch. This is the only file that talks to the server;
// components call these functions instead. Every failure becomes an ApiError whose
// message is safe to show, with the server's per-field issues attached when validation failed.

// The shapes the server sends back. `import type` is erased before the code runs.
import type { Note, NoteSummary, Tag } from '../../shared/types.ts'

// 204 "No Content" is what a successful delete returns; it has no body to read.
const HTTP_NO_CONTENT = 204
// Statuses from 500 up are the server's fault, not the request's.
const HTTP_SERVER_ERROR = 500

// One validation problem, as the server reports it: which field, and what is wrong.
export interface FieldIssue {
  // The field's path, for example 'title' or 'tags.0'.
  field: string
  // A human-readable explanation.
  message: string
}

// The fields a note can be created or changed with. Partial makes every one optional,
// so a PATCH can send only what changed, such as { pinned: true }.
export type NoteChanges = Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned'>>

// What the note list can be narrowed by: search text and one tag. Both optional.
export interface ListFilter {
  q?: string
  tag?: string
}

// An Error that also carries the field issues from a 400 response.
export class ApiError extends Error {
  // Empty for anything but a validation failure.
  issues: FieldIssue[]

  // Takes the message to show and any field issues.
  constructor(message: string, issues: FieldIssue[] = []) {
    // Sets the standard Error message.
    super(message)
    // Names the class in stack traces and console output.
    this.name = 'ApiError'
    // Keeps the issues for whoever catches this.
    this.issues = issues
  }
}

// The error body the server sends: { error, issues? }. Every field is optional here because
// a proxy or crash page might send something else entirely.
interface ErrorBody {
  error?: string
  issues?: FieldIssue[]
}

// Sends one request to /api + path and returns the parsed JSON body as type T.
// The caller names T, for example request<Note>(...); TypeScript trusts that the server
// sends that shape, which holds because both sides share the types in shared/types.ts.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Relative URL: in development Vite forwards /api to the server (vite.config.ts);
  // in production the same Express server serves both the page and /api.
  const res = await fetch(`/api${path}`, {
    // Only requests with a body say they are sending JSON. The server refuses anything else.
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    // Copies in method, body and anything else the caller passed.
    ...init,
  })
  // A successful delete has no body. Only deleteNote reaches this, and it asks for void.
  if (res.status === HTTP_NO_CONTENT) return undefined as T

  // Reads the JSON body; if the body is not JSON at all, use null instead of crashing.
  const body: unknown = await res.json().catch(() => null)
  // res.ok is true for statuses 200 to 299; anything else is an error.
  if (!res.ok) {
    // Treat the body as an error body; a null body becomes an empty object.
    const problem = (body ?? {}) as ErrorBody
    // With no message of its own, a 5xx usually means the API server is down (Vite's proxy
    // answers 502 then), so say that rather than a bare status code.
    const fallback = res.status >= HTTP_SERVER_ERROR ? 'The server is not responding' : 'Request failed'
    // Prefer the server's own message; otherwise the fallback with the status code.
    throw new ApiError(problem.error ?? `${fallback} (${res.status})`, problem.issues ?? [])
  }
  // Success: the parsed data, as the type the caller asked for.
  return body as T
}

// Builds "?q=react&tag=ideas" from a filter, leaving out empty values.
function toQuery(filter: ListFilter): string {
  // URLSearchParams handles the encoding of spaces and special characters.
  const params = new URLSearchParams()
  // Copies each key that has a non-empty value, so the server never sees ?q= with nothing after it.
  Object.entries(filter).forEach(([key, value]) => {
    // Skips '' and undefined.
    if (value) params.set(key, value)
  })
  // "q=react&tag=ideas", or '' when nothing was set.
  const text = params.toString()
  // Adds the leading ? only when there is something to send.
  return text ? `?${text}` : ''
}

// Turns anything thrown into a message fit to show on screen.
export function messageOf(error: unknown): string {
  // Errors (ApiError included) carry their own message; fetch failing offline is a TypeError.
  if (error instanceof Error) return error.message
  // Anything else thrown is unexpected; say so plainly.
  return 'Something went wrong'
}

// The note list, newest first with pinned notes on top, narrowed by search text and tag.
export const listNotes = (filter: ListFilter = {}) => request<NoteSummary[]>(`/notes${toQuery(filter)}`)

// One full note, body included.
export const getNote = (id: number) => request<Note>(`/notes/${id}`)

// Creates a note; every field is optional, so {} makes an empty "Untitled" note.
export const createNote = (changes: NoteChanges = {}) =>
  request<Note>('/notes', { method: 'POST', body: JSON.stringify(changes) })

// Changes only the fields given and returns the whole note as saved. keepalive lets the
// request finish even while the page is closing, for the last save on beforeunload.
export const updateNote = (id: number, changes: NoteChanges, keepalive = false) =>
  request<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(changes), keepalive })

// Deletes one note; its tags go with it on the server.
export const deleteNote = (id: number) => request<void>(`/notes/${id}`, { method: 'DELETE' })

// Every tag in use, with how many notes carry it.
export const listTags = () => request<Tag[]>('/tags')
