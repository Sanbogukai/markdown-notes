// The app-wide guards: security headers, the body size limit, JSON errors and the built client.

// Vitest's test functions.
import { describe, expect, it } from 'vitest';
// Makes a throwaway client folder for the page tests.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Shared set-up.
import { BAD_REQUEST, KEY, NOT_FOUND, OK, TOO_LARGE, makeApp, newOwner } from './helpers.ts';

// A body bigger than the 400 kB limit.
const OVERSIZED_LENGTH = 500_000;
const OVERSIZED_BODY = 'x'.repeat(OVERSIZED_LENGTH);

describe('security headers', () => {
  it('are on API answers, with images allowed from https only', async () => {
    const { api } = makeApp();
    const res = await api.post('/api/owners');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // Express's "X-Powered-By: Express" is removed, so the stack is not advertised.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('are on the page too', async () => {
    // A minimal built client in a temporary folder.
    const clientDir = mkdtempSync(join(tmpdir(), 'notes-client-'));
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>Markdown Notes</title>');
    const { api } = makeApp({ clientDir });
    // Any page address gets index.html, with the headers.
    const res = await api.get('/notes/12');
    expect(res.status).toBe(OK);
    expect(res.text).toContain('Markdown Notes');
    expect(res.headers['content-security-policy']).toBeTruthy();
  });
});

describe('request bodies', () => {
  it('over 400 kB are refused with 413', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const res = await api.post('/api/notes').set(KEY, key).send({ body: OVERSIZED_BODY });
    expect(res.status).toBe(TOO_LARGE);
    expect(res.body.error).toBeTruthy();
  });

  it('that are not JSON get a JSON 400', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const res = await api.post('/api/notes').set(KEY, key).set('Content-Type', 'application/json').send('{not json');
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.error).toBeTruthy();
  });
});

describe('search text', () => {
  it('with FTS5 operators and quotes is searched as plain words, not run', async () => {
    const { api } = makeApp();
    const key = await newOwner(api);
    const res = await api.get('/api/notes').query({ q: '" OR NOT * NEAR(' }).set(KEY, key);
    expect(res.status).toBe(OK);
  });
});

describe('unknown API routes', () => {
  it('answer a JSON 404, not 401', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/nothing-here');
    expect(res.status).toBe(NOT_FOUND);
    expect(res.body.error).toContain('/api/nothing-here');
  });
});
