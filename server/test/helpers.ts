// Shared set-up for the tests: a fresh in-memory database and app per test, a fixed clock,
// and the status codes by name.

// Sends requests to an Express app without opening a port.
import request from 'supertest';
// The app and the database it runs on.
import { createApp, type AppOptions } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import { OWNER_HEADER } from '../src/routes.ts';

// A fixed "now", so last-seen times are predictable.
export const NOW = new Date('2026-11-24T10:00:00.000Z');

// The header name, re-exported so tests read .set(KEY, key).
export const KEY = OWNER_HEADER;

// HTTP status codes the tests expect, by name.
export const OK = 200;
export const CREATED = 201;
export const NO_CONTENT = 204;
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;
export const TOO_LARGE = 413;
export const UNPROCESSABLE = 422;
export const TOO_MANY = 429;

// The Supertest agent type, for the helpers below.
export type Api = ReturnType<typeof request>;

// A new app over a new, empty in-memory database. `options` overrides the defaults, such as
// a lower limit. Returns the Supertest agent and the database, for checks behind the API.
export function makeApp(options: Partial<AppOptions> = {}) {
  // ':memory:' is a database that lives only as long as this connection.
  const db = openDatabase(':memory:');
  // The app with the fixed clock.
  const app = createApp({ db, now: () => NOW, ...options });
  // The agent sends requests straight to the app.
  return { api: request(app), db };
}

// Makes an owner through the API and returns its key.
export async function newOwner(api: Api): Promise<string> {
  // POST /api/owners answers { key }.
  const res = await api.post('/api/owners');
  // Hands back just the key.
  return res.body.key as string;
}
