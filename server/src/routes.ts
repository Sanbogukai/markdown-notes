// All /api routes: validate the input, run SQL, send JSON back.

// Router groups routes so index.ts can mount them all under /api in one line.
// Response is only a type, so it is imported with `import type` and erased before running.
import { Router, type Response } from 'express';
// Zod describes what valid input looks like, checks it, and gives TypeScript types for it.
import { z } from 'zod';
// The shared database connection.
import db from './db.ts';
// Turns search box text into a safe FTS5 query.
import { toFtsQuery } from './search.ts';
// The shapes the client expects back. Type-only, so nothing is loaded at runtime.
import type { Note, NoteSummary, Tag } from '../../shared/types.ts';

// ---------------------------------------------------------------------------------------
// Limits and status codes
// ---------------------------------------------------------------------------------------

// Named once here, so the numbers and their error messages cannot drift apart.
// The most tags one note can carry.
const MAX_TAGS = 10;
// The longest title, in characters.
const MAX_TITLE = 200;
// The longest note body, in characters. index.ts sizes the JSON body limit to fit it.
const MAX_BODY = 100_000;
// The longest search text, in characters.
const MAX_QUERY = 200;

// The HTTP status codes this file sends, by name.
// 201: a new note was made.
const HTTP_CREATED = 201;
// 204: deleted; nothing to send back.
const HTTP_NO_CONTENT = 204;
// 400: the request itself was wrong.
const HTTP_BAD_REQUEST = 400;
// 404: no note with that id.
const HTTP_NOT_FOUND = 404;

// ---------------------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------------------

// A whole tag: 1 to 30 lower-case letters, digits or dashes, and nothing else.
// "react-hooks" passes; "react hooks" (a space) and "c++" fail.
// Try it: https://regex101.com/?regex=%5E%5Ba-z0-9-%5D%7B1%2C30%7D%24&flags=gm&flavor=javascript&testString=react-hooks%0Areact%20hooks%0Ac%2B%2B
const TAG_PATTERN = /^[a-z0-9-]{1,30}$/;

// One tag: trimmed and lower-cased first, so "React " becomes "react", then checked.
const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(TAG_PATTERN, 'Tags use letters, digits and -, up to 30 characters');

// A note's whole tag list: at most 10, with repeats removed ("a", "A" and "a " are one tag).
// new Set() keeps only distinct values; [...set] turns it back into an array.
const tagList = z
  .array(tag)
  .max(MAX_TAGS, `At most ${MAX_TAGS} tags`)
  .transform((tags) => [...new Set(tags)]);

// The fields a client may send when creating or updating a note. Every one is optional:
// POST may send nothing for a blank note, and PATCH sends only what changed.
// strictObject refuses unknown keys, so a typo like "titel" is an error instead of being ignored.
const noteInput = z.strictObject({
  // Trimmed; a blank title becomes 'Untitled', matching the database default.
  title: z
    .string()
    .max(MAX_TITLE, `Title is limited to ${MAX_TITLE} characters`)
    .transform((title) => title.trim() || 'Untitled')
    .optional(),
  // Kept exactly as typed, spaces and blank lines included, since they matter in Markdown.
  body: z.string().max(MAX_BODY, `Notes are limited to ${MAX_BODY.toLocaleString('en-CA')} characters`).optional(),
  // Replaces the note's whole tag list when sent.
  tags: tagList.optional(),
  // A real true or false; the database stores it as 1 or 0.
  pinned: z.boolean().optional(),
});

// The TypeScript type Zod works out from the schema above, after its transforms:
// { title?: string; body?: string; tags?: string[]; pinned?: boolean }.
type NoteInput = z.infer<typeof noteInput>;

// The query string of GET /notes: both filters may be left out.
const listQuery = z.object({
  // The search box text. Up to 200 characters; it is cleaned by toFtsQuery() before use.
  q: z.string().max(MAX_QUERY).optional(),
  // Show only notes carrying this tag.
  tag: tag.optional(),
});

// The :id in a URL is always text. coerce turns "12" into 12, then it must be a whole
// number above zero; "abc" or "-1" fail and get a 400.
const idParam = z.coerce.number().int().positive();

// Turns a failed Zod check into a 400 body the client can show next to each field.
function validationError(res: Response, error: z.ZodError) {
  // 400 means "your request was wrong"; the body says what was wrong, field by field.
  return res.status(HTTP_BAD_REQUEST).json({
    // One summary line for the whole request.
    error: 'Validation failed',
    // Each issue as a field name and a readable message. path is an array such as
    // ['tags', 2]; join('.') makes it "tags.2".
    issues: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

// ---------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------
// Prepared statements: the SQL is compiled once at start-up and reused for every request.
// Values go in separately as ? or @named parameters, never pasted into the SQL text,
// which is what stops SQL injection.

// A notes row as SQLite returns it. pinned is 0 or 1 here; toNote() turns it into a boolean.
interface NoteRow {
  id: number;
  title: string;
  body: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

// A row of the list queries below. tags arrives as JSON text, such as '["ideas","react"]'.
interface SummaryRow {
  id: number;
  title: string;
  pinned: number;
  updated_at: string;
  excerpt: string;
  tags: string;
}

// A note's tags as a JSON array, alphabetical, for use inside the list queries.
// json_group_array gathers the rows into one JSON value; with no tags it gives '[]'.
const TAGS_JSON = `
  (SELECT json_group_array(tag) FROM (
    SELECT tag FROM note_tags WHERE note_id = n.id ORDER BY tag
  )) AS tags`;

// Keeps a note only when no tag filter is set, or when it carries that tag.
// EXISTS stops at the first matching row, so it is cheap.
const TAG_FILTER = `
  (@tag IS NULL OR EXISTS (
    SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag = @tag
  ))`;

// The list without a search: pinned notes first, then the most recently saved.
// The excerpt is the first 300 characters of the body; toSummary() tidies it.
// The generic <[{ tag: string | null }], SummaryRow> tells TypeScript what goes in and comes out.
const listAll = db.prepare<[{ tag: string | null }], SummaryRow>(`
  SELECT n.id, n.title, n.pinned, n.updated_at, substr(n.body, 1, 300) AS excerpt, ${TAGS_JSON}
  FROM notes n
  WHERE ${TAG_FILTER}
  -- id DESC breaks ties between notes saved in the same second.
  ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
`);

// The list for a search. MATCH runs the FTS5 query against the index; joining back to notes
// fetches the other columns. rank is FTS5's relevance score (bm25), best match first.
// snippet() cuts the body (column 1) down to about 16 words around the matches and wraps
// each matched word in the markers \u0002 and \u0003. Those are control characters nobody
// types, unlike [ and ], which Markdown uses for links. '…' marks where text was cut.
const listMatching = db.prepare<[{ q: string; tag: string | null }], SummaryRow>(`
  SELECT n.id, n.title, n.pinned, n.updated_at,
         snippet(notes_fts, 1, char(2), char(3), '…', 16) AS excerpt, ${TAGS_JSON}
  FROM notes_fts
  JOIN notes n ON n.id = notes_fts.rowid
  WHERE notes_fts MATCH @q AND ${TAG_FILTER}
  ORDER BY n.pinned DESC, rank
`);

// One note by id; undefined when there is none.
const findNote = db.prepare<[number], NoteRow>('SELECT * FROM notes WHERE id = ?');
// One note's tags, alphabetical. pluck() returns just the tag values instead of row objects.
const findTags = db.prepare<[number], string>('SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag').pluck();

// Adds a note. Missing values fall back to the same defaults as the table.
// RETURNING id gives back the new id in the same statement.
const insertNote = db.prepare<[{ title: string; body: string; pinned: number }], { id: number }>(`
  INSERT INTO notes (title, body, pinned) VALUES (@title, @body, @pinned) RETURNING id
`);

// Changes only the fields that were sent: coalesce(@x, x) keeps the old value when @x is NULL.
// updated_at moves only when the content changed (@touch is 1), so pinning a note does not
// count as editing it and does not move it down the list.
const updateNote = db.prepare<
  [{ id: number; title: string | null; body: string | null; pinned: number | null; touch: number }]
>(`
  UPDATE notes SET
    title      = coalesce(@title, title),
    body       = coalesce(@body, body),
    pinned     = coalesce(@pinned, pinned),
    updated_at = CASE WHEN @touch = 1 THEN datetime('now') ELSE updated_at END
  WHERE id = @id
`);

// Removes all of a note's tags, before the new list is written.
const clearTags = db.prepare<[number]>('DELETE FROM note_tags WHERE note_id = ?');
// Adds one tag to a note.
const insertTag = db.prepare<[number, string]>('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)');
// Deletes one note; its tags go too, through ON DELETE CASCADE.
const deleteNote = db.prepare<[number]>('DELETE FROM notes WHERE id = ?');

// Every tag in use, with how many notes carry it, alphabetical.
const allTags = db.prepare<[], Tag>(`
  SELECT tag, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag
`);

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

// Replaces a note's tag list. Called only inside a db.transaction below.
function writeTags(noteId: number, tags: string[]) {
  // Start from none...
  clearTags.run(noteId);
  // ...then add each tag in the new list.
  tags.forEach((t) => insertTag.run(noteId, t));
}

// Reads a full note with its tags, in the shape the client expects; undefined when missing.
function loadNote(id: number): Note | undefined {
  // The notes row, or undefined.
  const row = findNote.get(id);
  // No such note.
  if (!row) return undefined;
  // Copies the row, turns 0/1 into false/true, and adds the tags.
  return { ...row, pinned: row.pinned === 1, tags: findTags.all(id) };
}

// Runs of spaces, tabs and line breaks, so they can be collapsed to one space.
// "line one\n\n  line two" becomes "line one line two"; "one two" has nothing to collapse.
// Try it: https://regex101.com/?regex=%5Cs%2B&flags=g&flavor=javascript&testString=line%20one%0A%0A%20%20line%20two
const WHITESPACE_RUN = /\s+/g;

// SQLite stores true/false as 1/0. undefined (not sent) becomes null, which the UPDATE reads
// as "keep the old value".
function toFlag(value: boolean | undefined): number | null {
  // Not sent: leave it as it is.
  if (value === undefined) return null;
  // true to 1, false to 0.
  return value ? 1 : 0;
}

// Turns a list row into a NoteSummary.
function toSummary(row: SummaryRow): NoteSummary {
  return {
    // Copies id, title and updated_at as they are.
    ...row,
    // 0/1 to false/true.
    pinned: row.pinned === 1,
    // Line breaks and runs of spaces become single spaces, so the excerpt reads as one line.
    excerpt: row.excerpt.replace(WHITESPACE_RUN, ' ').trim(),
    // The JSON text from SQLite back into a real array. `as string[]` tells TypeScript
    // what JSON.parse returns, since it cannot know on its own.
    tags: JSON.parse(row.tags) as string[],
  };
}

// Creates a note and its tags as one transaction: both land, or neither does.
// db.transaction() wraps the function so its statements commit together or roll back on error.
const createNote = db.transaction((input: NoteInput): number => {
  // Inserts the note with defaults for whatever was not sent, and gets its new id.
  const { id } = insertNote.get({
    title: input.title ?? 'Untitled',
    body: input.body ?? '',
    // true/false to 1/0 for SQLite; not sent means not pinned.
    pinned: toFlag(input.pinned) ?? 0,
  })!; // `!` says "this is never undefined": INSERT ... RETURNING always returns the new row.
  // Writes the tags, if any were sent.
  if (input.tags) writeTags(id, input.tags);
  // The caller loads the full note by this id.
  return id;
});

// Updates a note and its tags as one transaction. Returns false when the note does not exist.
const changeNote = db.transaction((id: number, input: NoteInput): boolean => {
  // Runs the update; changes is how many rows it touched, 0 when there is no such note.
  const { changes } = updateNote.run({
    id,
    // Fields not sent become NULL, which coalesce() in the SQL reads as "keep the old value".
    title: input.title ?? null,
    body: input.body ?? null,
    pinned: toFlag(input.pinned),
    // The content changed if the title, body or tags were sent.
    touch: input.title !== undefined || input.body !== undefined || input.tags !== undefined ? 1 : 0,
  });
  // No such note: nothing to do. Returning ends the transaction with nothing changed.
  if (changes === 0) return false;
  // Replaces the tags only when a new list was sent.
  if (input.tags) writeTags(id, input.tags);
  return true;
});

// ---------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------

// The router index.ts mounts under /api.
const router = Router();

// GET /api/notes?q=&tag= — the note list, optionally searched and filtered by tag.
router.get('/notes', (req, res) => {
  // safeParse checks without throwing; it returns { success, data } or { success, error }.
  const parsed = listQuery.safeParse(req.query);
  // Bad filters, such as a tag with spaces: say what was wrong.
  if (!parsed.success) return validationError(res, parsed.error);
  // The tag filter, or null for "any tag", since SQL needs NULL rather than undefined.
  const tagFilter = parsed.data.tag ?? null;
  // The cleaned search, or null when the box is empty or has nothing searchable in it.
  const q = toFtsQuery(parsed.data.q ?? '');
  // With a search, ranked matches; without, every note, pinned and newest first.
  const rows = q ? listMatching.all({ q, tag: tagFilter }) : listAll.all({ tag: tagFilter });
  // 200 with the summaries.
  res.json(rows.map(toSummary));
});

// GET /api/notes/:id — one full note.
router.get('/notes/:id', (req, res) => {
  // Checks the id in the URL.
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return validationError(res, id.error);
  // Loads it with its tags.
  const note = loadNote(id.data);
  // 404 "not found" when there is no note with that id.
  if (!note) return res.status(HTTP_NOT_FOUND).json({ error: 'Note not found' });
  // 200 with the note.
  res.json(note);
});

// POST /api/notes — create a note. Every field is optional, so {} makes a blank note.
router.post('/notes', (req, res) => {
  // `?? {}` treats a request with no body at all as an empty object.
  const parsed = noteInput.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  // Inserts the note and its tags together.
  const id = createNote(parsed.data);
  // 201 "created", with the stored note, so the client gets its id and timestamps.
  res.status(HTTP_CREATED).json(loadNote(id));
});

// PATCH /api/notes/:id — change any of title, body, tags and pinned. Autosave uses this.
router.patch('/notes/:id', (req, res) => {
  // Checks the id, then the body.
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return validationError(res, id.error);
  const parsed = noteInput.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  // Applies the change; false means there was no such note.
  if (!changeNote(id.data, parsed.data)) return res.status(HTTP_NOT_FOUND).json({ error: 'Note not found' });
  // 200 with the note as it is now stored.
  res.json(loadNote(id.data));
});

// DELETE /api/notes/:id — delete one note and, through the cascade, its tags.
router.delete('/notes/:id', (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return validationError(res, id.error);
  // changes is 0 when there was nothing to delete.
  const { changes } = deleteNote.run(id.data);
  if (changes === 0) return res.status(HTTP_NOT_FOUND).json({ error: 'Note not found' });
  // 204 "no content": deleted, nothing to send back.
  res.status(HTTP_NO_CONTENT).end();
});

// GET /api/tags — every tag in use, with counts, for the tag filter.
router.get('/tags', (req, res) => {
  res.json(allTags.all());
});

// Shares the router with index.ts.
export default router;
