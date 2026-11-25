// Builds the Express app without starting it. Tests import createApp() and hand the app to
// Supertest; index.ts imports the same function and calls listen.

// Express handles HTTP: routing, JSON parsing, static files. ErrorRequestHandler is only a type.
import express, { type ErrorRequestHandler, type Express } from 'express';
// Sets the security headers (Content-Security-Policy and friends) on every answer.
import helmet from 'helmet';
// The /api routes, and the shape of what they need.
import { apiRouter, type RouteDeps } from './routes.ts';

// The largest JSON body accepted. A note may be 100,000 characters, and some characters take
// more than one byte, so this leaves room for a full note plus its title and tags. Anything
// bigger gets a 413.
const JSON_LIMIT = '400kb';

// HTTP status codes used here, by name.
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

// Render puts proxies in front of the app; trusting this many hops lets req.ip be the
// visitor's address (from X-Forwarded-For) instead of the proxy's, for the owner limit.
const TRUSTED_PROXIES = 3;

// Defaults: new owners per IP address per hour, and notes per owner.
export const OWNER_LIMIT = 10;
export const MAX_NOTES = 200;

// What createApp() takes. Only db is required; tests swap the clock and lower the limits to
// reach them quickly. clientDir is the built client (client/dist); without it the app serves
// the API alone, as in development, where Vite serves the client.
export type AppOptions = Pick<RouteDeps, 'db'> & Partial<RouteDeps> & { clientDir?: string };

// Returns a new, fully wired app.
export function createApp(options: AppOptions): Express {
  // Fills in the defaults; anything the caller passed wins.
  const deps = { now: () => new Date(), ownerLimit: OWNER_LIMIT, maxNotes: MAX_NOTES, ...options };

  // Creates the app that every middleware and route below is attached to.
  const app = express();

  // Reads the visitor's address through the hosting proxies.
  app.set('trust proxy', TRUSTED_PROXIES);

  // Security headers first, so every answer below carries them, API and pages alike. helmet's
  // default Content-Security-Policy lets scripts, styles and requests come only from this site,
  // so a script slipped into a note could neither load nor send data anywhere. Images are the
  // one exception: a note may show a picture from any https address, or an inline data: image.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { imgSrc: ["'self'", 'data:', 'https:'] },
      },
    }),
  );

  // Parses JSON request bodies into req.body, refusing anything over the limit with a 413.
  app.use(express.json({ limit: JSON_LIMIT }));

  // Every route in routes.ts answers under /api, e.g. /api/notes.
  app.use('/api', apiRouter(deps));

  // Unknown API routes get JSON, not Express's HTML page.
  // It only runs when no route above matched, because a matching route ends the request.
  app.use('/api', (req, res) => {
    // 404 "not found", naming the method and path that had no route.
    res.status(HTTP_NOT_FOUND).json({ error: `No route for ${req.method} ${req.originalUrl}` });
  });

  // Only when the client has been built (production).
  if (deps.clientDir) {
    // Narrowed to a string for the callback below.
    const root = deps.clientDir;
    // Serves index.html, the JavaScript and the CSS from the build folder.
    app.use(express.static(root));
    // Any other path that is not /api gets the page too, so a reload or a shared link still
    // opens the app. Express 5 needs the catch-all to have a name: {*splat}.
    app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root }));
  }

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

  // The caller decides whether to listen (index.ts) or to test it (Supertest).
  return app;
}
