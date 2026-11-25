// Owners: one per browser. Creating one copies the sample notes in; every other request finds
// the owner by the key the browser sends; owners unseen for 30 days are removed with their notes.

// Makes the random key; a version 4 UUID has 122 random bits, too many to guess.
import { randomUUID } from 'node:crypto';
// The connection type.
import type { Db } from './db.ts';
// The shape of a sample note.
import type { SampleNote } from './samples.ts';

// Lengths of time, in milliseconds.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
// Owners not seen for this many days are deleted with everything they saved.
export const STALE_DAYS = 30;

// What ownerStore() hands back: the three things the rest of the server does with owners.
export interface OwnerStore {
  createOwner(now: Date, samples: readonly SampleNote[]): string;
  findOwnerId(key: string, now: Date): number | null;
  deleteStaleOwners(now: Date): number;
}

// The owner queries for one database, prepared once.
export function ownerStore(db: Db): OwnerStore {
  // Adds an owner and returns its new id.
  const insertOwner = db.prepare<[{ key: string; now: string }], { id: number }>(`
    INSERT INTO owners (key, created_at, last_seen_at) VALUES (@key, @now, @now) RETURNING id
  `);
  // Adds one of the owner's notes and returns its id, for the tags.
  const insertNote = db.prepare<[{ owner_id: number; title: string; body: string; pinned: number }], { id: number }>(`
    INSERT INTO notes (owner_id, title, body, pinned) VALUES (@owner_id, @title, @body, @pinned) RETURNING id
  `);
  // Adds one tag to a note.
  const insertTag = db.prepare<[number, string]>('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)');
  // Finds an owner by key.
  const findByKey = db.prepare<[string], { id: number; last_seen_at: string }>(
    'SELECT id, last_seen_at FROM owners WHERE key = ?',
  );
  // Records a new last-seen time.
  const touch = db.prepare<[string, number]>('UPDATE owners SET last_seen_at = ? WHERE id = ?');
  // Removes every owner last seen before a cutoff; the foreign keys remove their notes and tags.
  const deleteBefore = db.prepare<[string]>('DELETE FROM owners WHERE last_seen_at < ?');

  // The owner and its samples in one transaction: saved together or not at all.
  const create = db.transaction((key: string, now: Date, samples: readonly SampleNote[]) => {
    // The new owner's id, for the samples' owner_id. `!`: INSERT ... RETURNING always returns the row.
    const { id: ownerId } = insertOwner.get({ key, now: now.toISOString() })!;
    // Every sample, as this owner's note, with its tags.
    samples.forEach((sample) => {
      // SQLite stores booleans as 0 or 1.
      const { id: noteId } = insertNote.get({
        owner_id: ownerId,
        title: sample.title,
        body: sample.body,
        pinned: sample.pinned ? 1 : 0,
      })!;
      // The note's tags.
      sample.tags.forEach((tag) => insertTag.run(noteId, tag));
    });
  });

  return {
    // Makes an owner holding a copy of `samples` and returns its key.
    createOwner(now, samples) {
      // The key the browser will keep and send back with every request.
      const key = randomUUID();
      // Saves the owner and the samples.
      create(key, now, samples);
      // Only the key leaves the server; the id stays private.
      return key;
    },

    // The id of the owner with this key, or null if there is none. It also records that the
    // owner was seen, but writes only when the last record is over an hour old: one small
    // write per hour of use instead of one per request (autosave sends many), which is
    // precise enough for a 30-day cutoff.
    findOwnerId(key, now) {
      // The owner row, or undefined.
      const owner = findByKey.get(key);
      // Unknown key.
      if (owner === undefined) return null;
      // How long ago the owner was last recorded.
      const sinceSeen = now.getTime() - Date.parse(owner.last_seen_at);
      // Only a stale record is refreshed.
      if (sinceSeen > HOUR_MS) touch.run(now.toISOString(), owner.id);
      // The id the routes filter by.
      return owner.id;
    },

    // Deletes owners not seen for STALE_DAYS days and returns how many went.
    deleteStaleOwners(now) {
      // The moment STALE_DAYS days before now, as an ISO time to compare with.
      const cutoff = new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();
      // `changes` counts the owners removed; their notes and tags go by cascade.
      return deleteBefore.run(cutoff).changes;
    },
  };
}
