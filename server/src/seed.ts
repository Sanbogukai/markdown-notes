// Sample notes for a fresh database, so the app has something to show and every kind of
// Markdown the preview supports can be seen at once. Run it with `npm run seed`, or set
// SEED_IF_EMPTY=1 and the server seeds an empty database when it starts.

// The open database connection.
import db from './db.ts';

// One sample note: the text, its tags and whether it starts pinned.
interface SampleNote {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
}

// The samples, each showing off a different part of Markdown.
const SAMPLES: SampleNote[] = [
  {
    title: 'Welcome to Markdown Notes',
    body: '# Welcome\n\nWrite on the left, see it rendered on the right. Changes **save themselves** a moment after you stop typing, or at once with Ctrl+S.\n\n- Pin a note to keep it on top\n- Add tags under the title, then filter by them in the sidebar\n- Search finds words in titles and bodies',
    tags: ['guide'],
    pinned: true,
  },
  {
    title: 'Headings and emphasis',
    body: '# Heading 1\n## Heading 2\n### Heading 3\n\nText can be *italic*, **bold**, ~~struck through~~ or `inline code`.\n\n> A blockquote, for quoting someone else.',
    tags: ['guide', 'markdown'],
    pinned: false,
  },
  {
    title: 'Lists',
    body: '1. Numbered item\n2. Another\n   - nested bullet\n   - and one more\n3. Last\n\n- Plain bullet\n- Second bullet',
    tags: ['markdown'],
    pinned: false,
  },
  {
    title: 'Weekly plan',
    body: '## This week\n\n- [x] Finish the tag filter\n- [x] Write the seed script\n- [ ] Deploy to Render\n- [ ] Write the README',
    tags: ['todo'],
    pinned: false,
  },
  {
    title: 'Gym log table',
    body: '| Day | Lift | Sets x reps |\n| --- | --- | ---: |\n| Mon | Squat | 5 x 5 |\n| Wed | Bench | 5 x 5 |\n| Fri | Deadlift | 1 x 5 |',
    tags: ['markdown', 'tables'],
    pinned: false,
  },
  {
    title: 'Code snippet',
    body: 'A fenced block keeps its spacing:\n\n```ts\nfunction greet(name: string): string {\n  return `Hello, ${name}`;\n}\n```',
    tags: ['code'],
    pinned: false,
  },
  {
    title: 'Useful links',
    body: '- [CommonMark spec](https://commonmark.org)\n- [GitHub Flavored Markdown](https://github.github.com/gfm/)\n- Bare links work too: https://react.dev',
    tags: ['links'],
    pinned: false,
  },
  {
    title: 'Book ideas',
    body: 'Short notes with no tags still show up in search. Try searching for "ideas".',
    tags: [],
    pinned: false,
  },
];

// The two inserts, prepared once and reused for every sample.
const insertNote = db.prepare('INSERT INTO notes (title, body, pinned) VALUES (?, ?, ?)');
const insertTag = db.prepare('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)');

// Inserts every sample in one transaction: all or nothing, and much faster than one by one.
const insertAll = db.transaction((samples: SampleNote[]) => {
  samples.forEach((sample) => {
    // SQLite stores booleans as 0 or 1.
    const { lastInsertRowid } = insertNote.run(sample.title, sample.body, sample.pinned ? 1 : 0);
    sample.tags.forEach((tag) => insertTag.run(lastInsertRowid, tag));
  });
});

// Adds the samples. Returns how many notes were added.
export function seed(): number {
  insertAll(SAMPLES);
  return SAMPLES.length;
}

// Adds the samples only when the database has no notes, so a restart never duplicates them.
export function seedIfEmpty(): number {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number };
  return count === 0 ? seed() : 0;
}

// Run directly (`node src/seed.ts`), seed and report; imported, do nothing.
if (import.meta.main) {
  console.log(`Added ${seed()} sample notes.`);
}
