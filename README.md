# Markdown Notes

Write notes in Markdown with a live preview, search them, tag and pin them, and export them as `.md` files. Changes save themselves while you type.

**Live:** https://markdown-notes-kmzy.onrender.com/

> Runs on Render's free tier. After about 15 minutes without visitors it goes to sleep, so the first visit can take up to a minute. Its disk is wiped on every restart, so anything you add disappears and the sample notes load again.

<p>
  <img src="docs/desktop.png" alt="Desktop view: note list with tag filter on the left, the Markdown editor in the middle, the rendered preview on the right" width="640">
  <img src="docs/phone.png" alt="Phone view: one note in Preview mode, with Back, Pin, Export and Delete above a rendered table" width="200">
</p>

Project 2 of a full-stack practice series, and the first one in TypeScript.

## Features

- Write in Markdown, including GitHub extras: tables, task lists, strikethrough and bare links. The preview updates as you type.
- Autosave a moment after you stop typing, on `Ctrl+S`, before switching notes and when the page closes. If a save fails, it retries after 2, 4, 8 seconds and so on, up to every 30 seconds, and the status line says so.
- Full-text search over titles and bodies, with the matching words highlighted in the list.
- Tags as chips under the title; a row of tag chips with counts filters the list.
- Pin notes to keep them on top.
- Export a note as a `.md` file.
- HTML typed into a note shows as text and never runs.
- On a phone, the list and the note are separate screens, with an Edit / Preview switch.
- Light and dark themes follow the system setting.

## Stack

| Part | Tools |
| ---- | ----- |
| Language | TypeScript on both sides, with types shared in `shared/types.ts` |
| Client | React 19, Vite, `react-markdown` with `remark-gfm`, oxlint |
| Server | Node, Express 5, Zod 4; Node runs the `.ts` files directly, and `tsc --noEmit` checks them |
| Database | SQLite through `better-sqlite3`, with an FTS5 full-text index kept in step by triggers |
| Hosting | Render free web service; Express serves the built client |

## API

| Method | Route | Does |
| ------ | ----- | ---- |
| `GET` | `/api/notes?q=&tag=` | Note summaries, pinned first then newest; `q` searches, `tag` filters, both optional |
| `GET` | `/api/notes/:id` | One note with its body; `404` if it does not exist |
| `POST` | `/api/notes` | Create one; every field is optional; returns `201` |
| `PATCH` | `/api/notes/:id` | Change any of `title`, `body`, `tags`, `pinned`; returns the saved note |
| `DELETE` | `/api/notes/:id` | Delete one; `204`, or `404` if it does not exist |
| `GET` | `/api/tags` | Every tag in use, with how many notes carry it |

Bad input gets a `400` with `{ error, issues: [{ field, message }] }`.

## Run it locally

Needs a Node version that runs TypeScript files directly (22.18 or later; the repo pins 26 in `.node-version`).

```bash
git clone https://github.com/Sanbogukai/markdown-notes.git
cd markdown-notes
cd server && npm install && npm run seed && cd ..
cd client && npm install && cd ..
```

Then in two terminals:

```bash
cd server && npm run dev    # API on http://localhost:3000
```

```bash
cd client && npm run dev    # app on http://localhost:5173
```

`npm run seed` adds 8 sample notes that show off headings, lists, a table, a task list, code and links. It adds them again each time it runs. The database file is `server/notes.db`; set `DB_PATH` to use another file.

Checks: `npm run typecheck` in `server/` and `client/`, and `npm run lint` in `client/`.

### Production build

```bash
cd client && npm run build && cd ../server && npm start
```

Express then serves the app and the API together on `PORT` (default 3000). Set `SEED_IF_EMPTY=1` to load the sample notes when the database is empty, as the Render service does.
