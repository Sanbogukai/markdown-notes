// A list row's excerpt, with the words that matched the search highlighted.
// The server wraps each match in the control characters \u0002 and \u0003. Splitting on
// them builds React elements, so the excerpt text is never parsed as HTML.

// The marker characters (server/src/routes.ts, snippet()).
const MATCH_START = '\u0002'
const MATCH_END = '\u0003'

// What NoteList hands in: the raw excerpt.
interface ExcerptProps {
  text: string
}

// The excerpt as plain text and <mark> elements.
export default function Excerpt({ text }: ExcerptProps) {
  // "a \u0002b\u0003 c" splits into ["a ", "b\u0003 c"]: every piece after the first
  // starts with a match, ended by MATCH_END.
  const [before = '', ...rest] = text.split(MATCH_START)
  return (
    <span className="note-row-excerpt">
      {before}
      {rest.map((piece, index) => {
        // "b\u0003 c" becomes the match "b" and the plain text " c" after it.
        const [match = '', after = ''] = piece.split(MATCH_END)
        return (
          // The pieces never move, so their position is a stable key.
          <span key={index}>
            <mark>{match}</mark>
            {after}
          </span>
        )
      })}
    </span>
  )
}
