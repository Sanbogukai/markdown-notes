// The tags on the open note, shown as chips with a text box after them.
// Enter or a comma adds what was typed; × on a chip, or Backspace in an empty box,
// removes one. Changes go up to App, which autosaves them with the rest of the note.

// useState for the half-typed tag and any message about it.
import { useState } from 'react'

// The server's limits (server/src/routes.ts): at most 10 tags per note.
const MAX_TAGS = 10
// A tag is 1 to 30 lower-case letters, digits or hyphens, the same rule as the server.
// Matches "react" and "web-dev"; rejects "c++", "two words" and "".
// Try it: https://regex101.com/?regex=%5E%5Ba-z0-9-%5D%7B1%2C30%7D%24&flavor=javascript&testString=web-dev
const TAG_PATTERN = /^[a-z0-9-]{1,30}$/
// Runs of spaces inside a typed tag, turned into one hyphen ("web dev" becomes "web-dev").
// Matches the "  " in "web  dev"; leaves "web-dev" alone.
// Try it: https://regex101.com/?regex=%5Cs%2B&flags=g&flavor=javascript&testString=web%20%20dev
const SPACES = /\s+/g

// What App hands in.
interface TagInputProps {
  // The note's current tags.
  tags: string[]
  // Called with the whole new list after an add or remove.
  onChange: (tags: string[]) => void
}

// The chips and the box.
export default function TagInput({ tags, onChange }: TagInputProps) {
  // What is typed in the box so far.
  const [text, setText] = useState('')
  // Why the last tag was refused, or null.
  const [problem, setProblem] = useState<string | null>(null)

  // Tries to add the typed text as a tag.
  function add() {
    // Tidies it the way the server would: trimmed, lower case, spaces as hyphens.
    const tag = text.trim().toLowerCase().replace(SPACES, '-')
    // Nothing typed: nothing to do.
    if (!tag) return
    // Already on the note: just clear the box.
    if (tags.includes(tag)) {
      setText('')
      return
    }
    // Explains a refusal instead of letting the save fail later.
    if (!TAG_PATTERN.test(tag)) {
      setProblem('Tags use a–z, 0–9 and hyphens, up to 30 characters.')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setProblem(`A note can have at most ${MAX_TAGS} tags.`)
      return
    }
    // Accepted: sorted, as the server returns them.
    onChange([...tags, tag].sort())
    setText('')
    setProblem(null)
  }

  // Removes one tag.
  function remove(tag: string) {
    // Keeps every other tag.
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    // A group label for screen readers; the chips and box sit in one wrapping row.
    <div className="tag-input" role="group" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          {/* The × button; its label says which tag it removes. */}
          <button type="button" className="chip-remove" aria-label={`Remove tag ${tag}`} onClick={() => remove(tag)}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-text"
        placeholder={tags.length ? 'Add tag' : 'Add tags'}
        aria-label="Add a tag"
        value={text}
        onChange={(event) => {
          // Keeps the typed text; a typed comma never arrives here (onKeyDown stops it).
          setText(event.target.value)
          // Typing again clears an old refusal.
          setProblem(null)
        }}
        onKeyDown={(event) => {
          // Enter or comma adds the tag. preventDefault keeps the comma out of the box.
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add()
          }
          // Backspace in an empty box removes the last chip.
          const last = tags[tags.length - 1]
          if (event.key === 'Backspace' && !text && last) remove(last)
        }}
        // Leaving the box adds what was typed, so a tag is not lost by clicking away.
        onBlur={add}
      />
      {/* role="alert" so screen readers announce why a tag was refused. */}
      {problem && <span className="tag-problem" role="alert">{problem}</span>}
    </div>
  )
}
