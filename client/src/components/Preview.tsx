// The rendered Markdown, beside the editor. react-markdown turns the text into React
// elements rather than an HTML string, so HTML typed into a note is shown as text and
// never runs. Never add rehype-raw here: it would undo that.

// The Markdown renderer, and the type of its custom-element map.
import Markdown, { type Components } from 'react-markdown'
// GitHub's extras: tables, task lists, strikethrough and bare links.
import remarkGfm from 'remark-gfm'

// The plugin list, built once rather than on every render.
const REMARK_PLUGINS = [remarkGfm]

// Replacements for some elements react-markdown would otherwise render plainly.
const COMPONENTS: Components = {
  // Links open in a new tab, so following one does not leave the note.
  // `node` is react-markdown's own syntax-tree data; it is pulled out so it is not
  // passed on to <a> as an attribute.
  a: ({ node: _node, ...props }) => (
    // noopener stops the new page from controlling this one through window.opener;
    // noreferrer also keeps this page's address from being sent to it.
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
}

// What App hands in: the note's body as Markdown text.
interface PreviewProps {
  body: string
}

// The rendered note, or a hint when the body is empty.
export default function Preview({ body }: PreviewProps) {
  return (
    // A labelled region, so screen-reader users can jump straight to it.
    <section className="preview" aria-label="Preview">
      {/* trim() so a body of only spaces or blank lines still counts as empty. */}
      {body.trim() ? (
        // The "markdown" class holds the heading, table and code styles in index.css.
        <div className="markdown">
          <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
            {body}
          </Markdown>
        </div>
      ) : (
        <p className="preview-empty">The preview shows here as you write.</p>
      )}
    </section>
  )
}
