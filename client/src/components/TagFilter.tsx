// A row of tag chips under the search box. Clicking one shows only notes with that tag;
// clicking it again shows all notes.

// The { tag, count } rows from GET /api/tags.
import type { Tag } from '../../../shared/types.ts'

// What App hands in.
interface TagFilterProps {
  // Every tag in use.
  tags: Tag[]
  // The tag being filtered on, or null for all notes.
  selected: string | null
  // Called with the new filter, or null to clear it.
  onSelect: (tag: string | null) => void
}

// The chip row; nothing at all when no note has a tag yet.
export default function TagFilter({ tags, selected, onSelect }: TagFilterProps) {
  // No tags: the row would only be empty space.
  if (tags.length === 0) return null
  return (
    // Labelled for screen readers as one group of toggles.
    <div className="tag-filter" role="group" aria-label="Filter by tag">
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          type="button"
          className="chip"
          // aria-pressed marks the active filter for screen readers and for the CSS.
          aria-pressed={tag === selected}
          // A second click on the active tag clears the filter.
          onClick={() => onSelect(tag === selected ? null : tag)}
        >
          {tag} <span className="chip-count">{count}</span>
        </button>
      ))}
    </div>
  )
}
