// The server's entry point: builds the Express app, wires up the routes and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Express handles HTTP: routing and JSON parsing. ErrorRequestHandler is only a type.
import express, { type ErrorRequestHandler } from 'express';
// All /api routes.
import router from './routes.ts';
// Sample notes for an empty database.
import { seedIfEmpty } from './seed.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The largest JSON body accepted. A note may be 100,000 characters, and some characters take
// more than one byte, so this leaves room for a full note plus its title and tags.
const JSON_LIMIT = '400kb';

// A request error (4xx) explains itself; anything from 500 up is the server's fault.
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

// Creates the app that every middleware and route below is attached to.
const app = express();

// Middleware runs on every request, top to bottom, in the order it is added.

// Parses JSON request bodies into req.body, refusing anything over the limit with a 413.
app.use(express.json({ limit: JSON_LIMIT }));
// Every route in routes.ts now answers under /api, e.g. /api/notes.
app.use('/api', router);

// Unknown API routes get JSON, not Express's HTML page.
// It only runs when no route above matched, because a matching route ends the request.
app.use('/api', (req, res) => {
  // 404 "not found", naming the method and path that had no route.
  res.status(HTTP_NOT_FOUND).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// Errors always come back as JSON. Bad JSON bodies arrive here with status 400, and bodies
// over the limit with 413. Express knows this is the error handler because it takes four
// arguments; `_next` is unused, but it must be listed. The leading _ marks it as unused.
const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  // Use the error's own status when it has one, otherwise 500.
  const status: number = err.status ?? err.statusCode ?? HTTP_SERVER_ERROR;
  // Server faults are logged for debugging; client mistakes (4xx) are not.
  if (status >= HTTP_SERVER_ERROR) console.error(err);
  // A 500 never shows its internal message to the visitor; a 4xx explains what was wrong.
  res.status(status).json({ error: status >= HTTP_SERVER_ERROR ? 'Something went wrong' : err.message });
};
// Added last, so it catches errors from everything above.
app.use(handleError);

// With SEED_IF_EMPTY set (as on a fresh demo deploy), an empty database gets the sample notes.
if (process.env.SEED_IF_EMPTY) {
  console.log(`Seeded ${seedIfEmpty()} sample notes.`);
}

// Starts the HTTP server on PORT; the callback runs once it is ready.
app.listen(PORT, () => {
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});
