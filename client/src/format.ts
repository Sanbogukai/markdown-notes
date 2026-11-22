// Small helpers that turn server data into text for the screen.

// Shows dates like "21 Nov 2026, 20:15" in the visitor's own language and time zone.
// Built once and reused, because creating a formatter is the slow part.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// SQLite stores times as "2026-11-21 20:15:00" in UTC, with no zone marker. Swapping the
// space for a T and adding Z turns it into the ISO form Date understands, read as UTC.
export function formatDate(sqliteTime: string): string {
  // Builds the Date from the ISO text, then formats it in local time.
  return dateFormat.format(new Date(`${sqliteTime.replace(' ', 'T')}Z`))
}
