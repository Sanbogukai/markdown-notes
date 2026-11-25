// The server's entry point: opens the database, builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// existsSync checks whether a file or folder is there, without throwing if it is not.
import { existsSync } from 'node:fs';
// Turns a file: URL into a normal path for the operating system.
import { fileURLToPath } from 'node:url';
// Builds the Express app with every route attached.
import { createApp } from './app.ts';
// Opens the SQLite file and creates any missing tables.
import { openDatabase } from './db.ts';
// The daily clean-up of owners nobody has used for 30 days.
import { DAY_MS, ownerStore } from './owners.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The database file: DB_PATH when set, otherwise server/notes.db, one folder up from this file.
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../notes.db', import.meta.url));
// One connection, shared by the app and the clean-up.
const db = openDatabase(dbPath);

// The built client (npm run build in client/). In production the same server hands out the
// page and the API, so there is one service and no cross-origin requests. In development
// Vite serves the page instead and this folder is usually missing.
const builtClient = fileURLToPath(new URL('../../client/dist', import.meta.url));
// Passed on only when it is there.
const clientDir = existsSync(builtClient) ? builtClient : undefined;

// The app over that database, with the real clock (the default), and the client when built.
const app = createApp({ db, clientDir });

// The owner queries, for the clean-up below.
const owners = ownerStore(db);

// Removes stale owners and logs how many. A failure is logged and the server keeps running;
// the next day's run tries again.
function cleanUp() {
  try {
    // Owners unseen for 30 days go, with their notes and tags.
    const count = owners.deleteStaleOwners(new Date());
    // Shows up in the Render log.
    console.log(`Removed ${count} owner(s) unseen for 30 days`);
  } catch (err) {
    // Logged for debugging only.
    console.error('Clean-up failed', err);
  }
}
// Once at start-up, then daily. unref() lets the process exit without waiting for the timer.
cleanUp();
setInterval(cleanUp, DAY_MS).unref();

// Starts the HTTP server on PORT. Express 5 hands a failure (such as the port already being
// in use) to the callback instead of throwing, so the callback checks for one and stops the
// process rather than claiming to be listening.
app.listen(PORT, (error) => {
  // Port taken or similar: stop with the error.
  if (error) throw error;
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});
