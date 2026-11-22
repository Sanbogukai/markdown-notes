// Opens the SQLite database and makes sure the tables, search index and triggers exist.
// Every other server file imports `db` from here, so there is exactly one connection.

// better-sqlite3 is a synchronous SQLite driver: queries return results directly, no await needed.
import Database from 'better-sqlite3';
// Converts a file:// URL into a normal Windows or Linux path.
import { fileURLToPath } from 'node:url';

// Where the database file lives. DB_PATH wins when set, so tests can use a throwaway file;
// otherwise it is server/notes.db, one folder up from this file.
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../notes.db', import.meta.url));

// Opens the file, creating it if it does not exist yet.
const db = new Database(dbPath);
// WAL (write-ahead log) mode lets reads carry on while a write is happening, and is faster.
db.pragma('journal_mode = WAL');
// SQLite ignores foreign keys unless told otherwise, per connection. Without this,
// ON DELETE CASCADE below would do nothing and deleted notes would leave their tags behind.
db.pragma('foreign_keys = ON');

// exec() runs several SQL statements that return no rows.
// IF NOT EXISTS makes every statement safe to run on each start: it only creates what is missing.
db.exec(`
  -- One row per note.
  CREATE TABLE IF NOT EXISTS notes (
    -- Unique number for each note; SQLite assigns it and never reuses one.
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- A blank title is stored as 'Untitled', so the list always has something to show.
    title      TEXT    NOT NULL DEFAULT 'Untitled',
    -- The Markdown text; an empty note is '' rather than NULL, so the code never checks for NULL.
    body       TEXT    NOT NULL DEFAULT '',
    -- SQLite has no true/false type, so 1 means pinned and 0 means not. CHECK refuses anything else.
    pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    -- When the note was made, filled in by SQLite (UTC, 'YYYY-MM-DD HH:MM:SS').
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    -- When it was last saved; the PATCH route updates it, and the list sorts on it.
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per tag on a note. The pair (note_id, tag) is the key, so a note cannot carry
  -- the same tag twice. REFERENCES ties note_id to a real note; ON DELETE CASCADE removes
  -- the tag rows automatically when their note is deleted.
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag     TEXT    NOT NULL,
    PRIMARY KEY (note_id, tag)
  );
  -- Makes "which notes have tag X" fast; the primary key above only helps when note_id is known.
  CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags (tag);

  -- The full-text search index (FTS5 is SQLite's built-in search engine). content='notes'
  -- means it reads the words from the notes table instead of keeping a second copy, and
  -- content_rowid='id' says which notes column its rows line up with.
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, body, content='notes', content_rowid='id'
  );

  -- Triggers keep the index in step with the notes table, so no route has to remember to.
  -- After an insert: add the new note's words to the index.
  CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  -- After a delete: inserting the special 'delete' command removes the old words.
  -- It needs the old text, because the index looks the words up to remove them.
  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  END;
  -- After an update: remove the old words, then add the new ones.
  CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
`);

// Shares the one open connection with the rest of the server.
export default db;
