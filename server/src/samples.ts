// The notes every new owner starts with, so the live demo never opens on an empty page.
// Three are enough to show pinning, tags, search and most of what the preview renders,
// without crowding the list.

// One sample note: the text, its tags and whether it starts pinned.
export interface SampleNote {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
}

// The samples, oldest first, so the pinned welcome note sits on top and the plan below it.
export const SAMPLE_NOTES: readonly SampleNote[] = [
  {
    title: 'Markdown cheat sheet',
    body: '## Text\n\n*Italic*, **bold**, ~~struck~~ and `inline code`.\n\n> A blockquote.\n\n## Lists\n\n1. Numbered\n2. Another\n   - nested bullet\n\n## Table\n\n| Day | Lift | Sets x reps |\n| --- | --- | ---: |\n| Mon | Squat | 5 x 5 |\n| Wed | Bench | 5 x 5 |\n\n## Code\n\n```ts\nconst greet = (name: string) => `Hello, ${name}`;\n```',
    tags: ['markdown'],
    pinned: false,
  },
  {
    title: 'Weekly plan',
    body: '## This week\n\n- [x] Try the tag filter\n- [ ] Pin a note\n- [ ] Search for "squat"',
    tags: ['todo'],
    pinned: false,
  },
  {
    title: 'Welcome to Markdown Notes',
    body: '# Welcome\n\nWrite on the left, see it rendered on the right. Changes **save themselves** a moment after you stop typing, or at once with Ctrl+S.\n\n- Pin a note to keep it on top\n- Add tags under the title, then filter by them in the sidebar\n- Search finds words in titles and bodies\n\nThese notes are private to this browser.',
    tags: ['guide'],
    pinned: true,
  },
];
