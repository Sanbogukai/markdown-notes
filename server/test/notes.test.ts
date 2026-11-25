// The note routes for one owner, the cap, and isolation: one owner can never list, search,
// read, change, delete or see the tags of another owner's notes.

// Vitest's test functions.
import { describe, expect, it } from 'vitest';
// Shared set-up.
import {
  BAD_REQUEST,
  CREATED,
  KEY,
  NOT_FOUND,
  NO_CONTENT,
  OK,
  UNPROCESSABLE,
  type Api,
  makeApp,
  newOwner,
} from './helpers.ts';
// How many notes a new owner starts with.
import { SAMPLE_NOTES } from '../src/samples.ts';

// Creates a note for `key` and returns it.
async function addNote(api: Api, key: string, fields: object) {
  const res = await api.post('/api/notes').set(KEY, key).send(fields);
  expect(res.status).toBe(CREATED);
  return res.body as { id: number; title: string; tags: string[] };
}

describe('notes for one owner', () => {
  it('creates, reads, changes and deletes a note', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const note = await addNote(api, key, { title: 'Plan', body: '# Plan', tags: ['Work', 'work '] });
    // Tags are cleaned and repeats removed.
    expect(note.tags).toEqual(['work']);
    const read = await api.get(`/api/notes/${note.id}`).set(KEY, key);
    expect(read.status).toBe(OK);
    expect(read.body.body).toBe('# Plan');
    // The owner's id is never sent.
    expect(read.body.owner_id).toBeUndefined();
    const changed = await api.patch(`/api/notes/${note.id}`).set(KEY, key).send({ pinned: true });
    expect(changed.body.pinned).toBe(true);
    const deleted = await api.delete(`/api/notes/${note.id}`).set(KEY, key);
    expect(deleted.status).toBe(NO_CONTENT);
  });

  it('searches and filters by tag', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    await addNote(api, key, { title: 'Zebra facts', body: 'stripes', tags: ['animals'] });
    const found = await api.get('/api/notes?q=zebr').set(KEY, key);
    expect(found.body.map((n: { title: string }) => n.title)).toEqual(['Zebra facts']);
    const tagged = await api.get('/api/notes?tag=animals').set(KEY, key);
    expect(tagged.body).toHaveLength(1);
  });

  it('refuses unknown fields such as owner_id', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const res = await api.post('/api/notes').set(KEY, key).send({ title: 'x', owner_id: 1 });
    expect(res.status).toBe(BAD_REQUEST);
  });

  it('answers 422 at the note cap', async () => {
    // The samples alone fill a cap of that size.
    const { api } = makeApp({ maxNotes: SAMPLE_NOTES.length });
    const key = await newOwner(api);
    const res = await api.post('/api/notes').set(KEY, key).send({});
    expect(res.status).toBe(UNPROCESSABLE);
    expect(res.body.error).toContain(`${SAMPLE_NOTES.length} notes`);
  });
});

describe('isolation between owners', () => {
  // Two owners, and a note that belongs to the first.
  async function twoOwners() {
    const { api } = makeApp();
    const mine = await newOwner(api);
    const theirs = await newOwner(api);
    const note = await addNote(api, mine, { title: 'Secret plan', body: 'unicorn', tags: ['private'] });
    return { api, mine, theirs, note };
  }

  it('hides the note from the other list, search and tag filter', async () => {
    const { api, theirs } = await twoOwners();
    const list = await api.get('/api/notes').set(KEY, theirs);
    expect(list.body).toHaveLength(SAMPLE_NOTES.length);
    const search = await api.get('/api/notes?q=unicorn').set(KEY, theirs);
    expect(search.body).toEqual([]);
    const tagged = await api.get('/api/notes?tag=private').set(KEY, theirs);
    expect(tagged.body).toEqual([]);
  });

  it('hides the tag from the other tag list', async () => {
    const { api, theirs } = await twoOwners();
    const tags = await api.get('/api/tags').set(KEY, theirs);
    expect(tags.body.map((t: { tag: string }) => t.tag)).not.toContain('private');
  });

  it('answers 404 to reading, changing or deleting it', async () => {
    const { api, mine, theirs, note } = await twoOwners();
    const read = await api.get(`/api/notes/${note.id}`).set(KEY, theirs);
    expect(read.status).toBe(NOT_FOUND);
    const changed = await api.patch(`/api/notes/${note.id}`).set(KEY, theirs).send({ title: 'Mine now', tags: [] });
    expect(changed.status).toBe(NOT_FOUND);
    const deleted = await api.delete(`/api/notes/${note.id}`).set(KEY, theirs);
    expect(deleted.status).toBe(NOT_FOUND);
    // The owner's note is untouched, tags included.
    const still = await api.get(`/api/notes/${note.id}`).set(KEY, mine);
    expect(still.body.title).toBe('Secret plan');
    expect(still.body.tags).toEqual(['private']);
  });

  it('answers 404 for a note that exists, exactly as for one that does not', async () => {
    const { api, theirs, note } = await twoOwners();
    const someoneElses = await api.get(`/api/notes/${note.id}`).set(KEY, theirs);
    const missing = await api.get('/api/notes/999999').set(KEY, theirs);
    expect(someoneElses.status).toBe(missing.status);
    expect(someoneElses.body).toEqual(missing.body);
  });
});
