// The search box above the note list. It only reports what is typed; App decides
// when to fetch, so this component has no state of its own.

// What App hands in: the current text and a function to call when it changes.
interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

// A labelled search input.
export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    // A label wrapping its input links the two, so screen readers announce "Search notes".
    <label className="search">
      {/* Visible to screen readers only; the placeholder shows sighted users what the box is for. */}
      <span className="visually-hidden">Search notes</span>
      {/* type="search" gives a clear button in most browsers and the right keyboard on phones. */}
      <input
        type="search"
        placeholder="Search notes"
        // A controlled input: React state holds the text, so App always knows it.
        value={value}
        // Sends each change up to App as plain text.
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
