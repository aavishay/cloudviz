// ─── CSV export ───────────────────────────────────────────────────────────────

const NUMBER = /^-?\d+(\.\d+)?$/;

// csvCell quotes a value for CSV and neutralizes spreadsheet formula injection: text that
// starts with =, +, -, @, tab or carriage return is evaluated as a formula by Excel and
// others, so it gets a leading apostrophe. Plain numbers (including negatives) are kept.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (s && !NUMBER.test(s) && '=+-@\t\r'.includes(s[0])) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}
