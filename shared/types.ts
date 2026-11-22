// The shapes the client and server agree on. Both sides import these with `import type`,
// which is erased before the code runs, so this file is only ever read by the type checker.

// One full note, as returned by GET /api/notes/:id, POST and PATCH.
export interface Note {
  // The database id; numbers count up from 1.
  id: number
  // Shown in the list and as the exported file's first line; 'Untitled' when left blank.
  title: string
  // The Markdown text itself.
  body: string
  // Lower-case tag names, for example ['react', 'ideas'].
  tags: string[]
  // Pinned notes stay at the top of the list. Stored as 0 or 1, sent as a real boolean.
  pinned: boolean
  // When the note was made, as SQLite's 'YYYY-MM-DD HH:MM:SS' text in UTC.
  created_at: string
  // When it was last saved, in the same format; the list sorts on this.
  updated_at: string
}

// One row of the note list, as returned by GET /api/notes. It leaves out the full body,
// so the list stays small even when notes are long.
export interface NoteSummary {
  // The same fields as on a full note.
  id: number
  title: string
  tags: string[]
  pinned: boolean
  updated_at: string
  // A short piece of the body. During a search, the matched words are wrapped in [ and ].
  excerpt: string
}

// One tag in use, as returned by GET /api/tags.
export interface Tag {
  // The tag's name.
  tag: string
  // How many notes carry it.
  count: number
}
