// Opens the SQLite database and makes sure the tables, search index and triggers exist.
// index.ts opens the real file once; each test opens its own in-memory database.

// better-sqlite3 is a synchronous SQLite driver: queries return results directly, no await needed.
import Database from 'better-sqlite3';

// The connection type, named once so other files can say `Db` instead of `Database.Database`.
export type Db = Database.Database;

// Before owners existed, every note was shared by everyone. A database from then has a notes
// table with no owner_id column. Its rows cannot be given to anyone, but they are not thrown
// away either: the two tables are renamed to *_before_owners and left alone. Only the search
// index, its triggers and the tag index go, since they hold nothing but copies of the notes.
function moveSharedTables(db: Db) {
  // The notes table's columns, or none when there is no notes table yet.
  const columns = db.prepare<[], { name: string }>("SELECT name FROM pragma_table_info('notes')").all();
  // A new database, or one that already has owners: nothing to move.
  if (columns.length === 0 || columns.some((column) => column.name === 'owner_id')) return;
  // All in one go: renamed together, or not at all.
  db.exec(`
    BEGIN;
    -- The triggers and the index are tied to the old table; dropping them frees their names.
    DROP TRIGGER IF EXISTS notes_ai;
    DROP TRIGGER IF EXISTS notes_ad;
    DROP TRIGGER IF EXISTS notes_au;
    DROP INDEX IF EXISTS idx_note_tags_tag;
    -- The search index holds only copies of the words; a new one is made for the new table.
    DROP TABLE IF EXISTS notes_fts;
    -- SQLite updates note_tags' foreign key to follow the renamed notes table.
    ALTER TABLE notes RENAME TO notes_before_owners;
    ALTER TABLE note_tags RENAME TO note_tags_before_owners;
    COMMIT;
  `);
}

// Opens (or creates) the database at `path` and returns the connection, ready to use.
// ':memory:' gives a database that lives only as long as the connection, for tests.
export function openDatabase(path: string): Db {
  // Opens the file, creating it if it does not exist yet.
  const db = new Database(path);
  // WAL (write-ahead log) mode lets reads carry on while a write is happening, and is faster.
  db.pragma('journal_mode = WAL');
  // SQLite ignores foreign keys unless told otherwise, per connection. Without this, the
  // ON DELETE CASCADE rules below would do nothing.
  db.pragma('foreign_keys = ON');
  // An old shared database keeps its notes under new names before the tables below are made.
  moveSharedTables(db);

  // exec() runs several SQL statements that return no rows.
  // IF NOT EXISTS makes every statement safe to run on each start: it only creates what is missing.
  db.exec(`
    -- One row per browser that uses the app. key is the random UUID the browser keeps and sends;
    -- the times are ISO text such as 2026-11-24T10:00:00.000Z.
    CREATE TABLE IF NOT EXISTS owners (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT    NOT NULL UNIQUE,
      created_at   TEXT    NOT NULL,
      last_seen_at TEXT    NOT NULL
    );

    -- One row per note.
    CREATE TABLE IF NOT EXISTS notes (
      -- Unique number for each note; SQLite assigns it and never reuses one.
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Whose note this is. Deleting the owner deletes the note, and note_tags' own cascade
      -- then deletes its tags.
      owner_id   INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
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
    -- Every query starts from one owner's notes, so this index finds them directly.
    CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes (owner_id, pinned, updated_at);

    -- One row per tag on a note. The pair (note_id, tag) is the key, so a note cannot carry
    -- the same tag twice. A tag belongs to an owner only through its note.
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag     TEXT    NOT NULL,
      PRIMARY KEY (note_id, tag)
    );
    -- Makes "which notes have tag X" fast; the primary key above only helps when note_id is known.
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags (tag);

    -- The full-text search index (FTS5 is SQLite's built-in search engine). content='notes'
    -- means it reads the words from the notes table instead of keeping a second copy, and
    -- content_rowid='id' says which notes column its rows line up with. It has no owner
    -- column: the search query joins back to notes and keeps only the owner's rows.
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, body, content='notes', content_rowid='id'
    );

    -- Triggers keep the index in step with the notes table, so no route has to remember to.
    -- They also run for notes removed by the owner cascade.
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

  // The connection, for the caller to keep.
  return db;
}
