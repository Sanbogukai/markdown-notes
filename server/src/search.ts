// Turns what someone typed in the search box into a safe FTS5 query.
//
// FTS5 has its own query language: quotes, AND / OR / NOT, NEAR, brackets, column names.
// Passing the text in as it is would let a stray " or the word NOT throw a syntax error,
// so the text is broken into plain words and each one is quoted.

// The most words used from one search, so a pasted paragraph cannot build a huge query.
const MAX_WORDS = 10;

// Letters and digits in any language. FTS5's default tokenizer splits text on everything
// else (spaces, punctuation), so these runs are exactly the words it has indexed.
// 'C++ "hooks" NOT' gives "C", "hooks" and "NOT"; '!!!' gives no words at all.
// Try it: https://regex101.com/?regex=%5B%5Cp%7BL%7D%5Cp%7BN%7D%5D%2B&flags=gu&flavor=javascript&testString=C%2B%2B%20%22hooks%22%20NOT%0A!!!
const WORD = /[\p{L}\p{N}]+/gu;

// "react hoo" becomes '"react"* "hoo"*': notes containing a word starting with "react"
// and a word starting with "hoo". Returns null when there is nothing searchable,
// such as an empty box or only punctuation, so the caller can list every note instead.
export function toFtsQuery(text: string): string | null {
  // All the word runs in the text; match() gives null when there are none, hence `?? []`.
  const words = (text.match(WORD) ?? []).slice(0, MAX_WORDS);
  // Nothing left to search for.
  if (words.length === 0) return null;
  // Quoting makes each word a literal string, so NOT or OR are searched for as words, not
  // read as operators. The words hold only letters and digits, so they cannot contain a quote.
  // The * after the closing quote makes it a prefix search, so results appear while typing.
  return words.map((word) => `"${word}"*`).join(' ');
}
