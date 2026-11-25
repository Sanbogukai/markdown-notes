// Owners: making one, the samples it starts with, the key check, the limit on new owners,
// the 30-day clean-up, and moving an old shared database aside.

// Vitest's test functions.
import { describe, expect, it } from 'vitest';
// better-sqlite3, to build an old-style database file for the move-aside test.
import Database from 'better-sqlite3';
// A throwaway folder for that file.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The code under test, used directly where the API cannot reach.
import { openDatabase } from '../src/db.ts';
import { DAY_MS, STALE_DAYS, ownerStore } from '../src/owners.ts';
import { SAMPLE_NOTES } from '../src/samples.ts';
// Shared set-up.
import { CREATED, KEY, NOW, OK, TOO_MANY, UNAUTHORIZED, makeApp, newOwner } from './helpers.ts';

// A UUID nobody was given.
const UNKNOWN_KEY = '00000000-0000-4000-8000-000000000000';

// The shape of a key: 36 lower-case hex digits and dashes.
// "3f2b8c1e-9d4a-4e7b-8a6c-1f0e2d3c4b5a" matches; "not-a-key" does not.
// Try it: https://regex101.com/?regex=%5E%5B0-9a-f-%5D%7B36%7D%24&flags=gm&flavor=javascript&testString=3f2b8c1e-9d4a-4e7b-8a6c-1f0e2d3c4b5a%0Anot-a-key
const KEY_SHAPE = /^[0-9a-f-]{36}$/;

// A low owner limit, so the test reaches it in a few requests.
const LOW_LIMIT = 2;

describe('POST /api/owners', () => {
  it('answers 201 with a UUID key', async () => {
    const { api } = makeApp();
    const res = await api.post('/api/owners');
    expect(res.status).toBe(CREATED);
    // Only the key comes back; the owner's id stays on the server.
    expect(Object.keys(res.body)).toEqual(['key']);
    expect(res.body.key).toMatch(KEY_SHAPE);
  });

  it('starts the owner with the sample notes, pinned one first', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const res = await api.get('/api/notes').set(KEY, key);
    expect(res.status).toBe(OK);
    expect(res.body).toHaveLength(SAMPLE_NOTES.length);
    expect(res.body[0].title).toBe('Welcome to Markdown Notes');
    expect(res.body[0].pinned).toBe(true);
  });

  it('gives each owner its own copy of the samples', async () => {
    const { api } = makeApp();
    const first = await newOwner(api);
    const second = await newOwner(api);
    // The first owner deletes every sample.
    const list = await api.get('/api/notes').set(KEY, first);
    await Promise.all(list.body.map((note: { id: number }) => api.delete(`/api/notes/${note.id}`).set(KEY, first)));
    // The second owner still has all of them.
    const theirs = await api.get('/api/notes').set(KEY, second);
    expect(theirs.body).toHaveLength(SAMPLE_NOTES.length);
  });

  it('answers 429 after the hourly limit from one address', async () => {
    const { api } = makeApp({ ownerLimit: LOW_LIMIT });
    await api.post('/api/owners').set('X-Forwarded-For', '203.0.113.7');
    await api.post('/api/owners').set('X-Forwarded-For', '203.0.113.7');
    const third = await api.post('/api/owners').set('X-Forwarded-For', '203.0.113.7');
    expect(third.status).toBe(TOO_MANY);
    expect(third.body.error).toBeTruthy();
    // Another address is counted separately, which shows the proxy setting reads the real one.
    const other = await api.post('/api/owners').set('X-Forwarded-For', '198.51.100.4');
    expect(other.status).toBe(CREATED);
  });
});

describe('the owner key', () => {
  it('is required: no header answers 401', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/notes');
    expect(res.status).toBe(UNAUTHORIZED);
  });

  it('must be known: an unknown UUID answers 401', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/tags').set(KEY, UNKNOWN_KEY);
    expect(res.status).toBe(UNAUTHORIZED);
  });

  it('must be a UUID: anything else answers 401 without a lookup', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/notes').set(KEY, "' OR 1=1 --");
    expect(res.status).toBe(UNAUTHORIZED);
  });
});

describe('the clean-up', () => {
  it('removes owners unseen for 30 days, with their notes, tags and search entries', async () => {
    const { api, db } = makeApp();
    const key = await newOwner(api);
    // Run the clean-up a moment past the cutoff.
    const later = new Date(NOW.getTime() + (STALE_DAYS * DAY_MS) + 1);
    expect(ownerStore(db).deleteStaleOwners(later)).toBe(1);
    // The key no longer works.
    const res = await api.get('/api/notes').set(KEY, key);
    expect(res.status).toBe(UNAUTHORIZED);
    // Nothing is left behind.
    expect(db.prepare('SELECT COUNT(*) FROM notes').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM note_tags').pluck().get()).toBe(0);
    // FTS5's own check throws if the search index still holds words of deleted notes.
    expect(() => db.exec("INSERT INTO notes_fts (notes_fts) VALUES ('integrity-check')")).not.toThrow();
  });

  it('keeps owners seen within 30 days', async () => {
    const { api, db } = makeApp();
    await newOwner(api);
    // A day short of the cutoff.
    const later = new Date(NOW.getTime() + ((STALE_DAYS - 1) * DAY_MS));
    expect(ownerStore(db).deleteStaleOwners(later)).toBe(0);
  });
});

describe('an old shared database', () => {
  it('keeps its notes under *_before_owners and starts fresh tables', () => {
    // A database file in the shape used before owners existed.
    const path = join(mkdtempSync(join(tmpdir(), 'notes-old-')), 'notes.db');
    const old = new Database(path);
    old.exec(`
      CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 'Untitled',
        body TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE note_tags (note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag TEXT NOT NULL, PRIMARY KEY (note_id, tag));
      CREATE INDEX idx_note_tags_tag ON note_tags (tag);
      CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content='notes', content_rowid='id');
      INSERT INTO notes (title, body) VALUES ('Shared note', 'from before owners');
      INSERT INTO note_tags (note_id, tag) VALUES (1, 'old');
    `);
    old.close();
    // Opening it with the new code moves the old tables aside.
    const db = openDatabase(path);
    expect(db.prepare('SELECT title FROM notes_before_owners').pluck().all()).toEqual(['Shared note']);
    expect(db.prepare('SELECT tag FROM note_tags_before_owners').pluck().all()).toEqual(['old']);
    // The new notes table has the owner column and starts empty.
    expect(db.prepare('SELECT COUNT(*) FROM notes').pluck().get()).toBe(0);
    // And the new owners work end to end.
    expect(ownerStore(db).createOwner(NOW, SAMPLE_NOTES)).toBeTruthy();
    db.close();
  });
});
