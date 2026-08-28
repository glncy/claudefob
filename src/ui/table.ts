export interface Column {
  header: string
  key: string
}

export function renderTable(rows: Record<string, string>[], cols: Column[]): string {
  const widths = cols.map((c) => Math.max(c.header.length, ...rows.map((r) => (r[c.key] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
  const lines = [line(cols.map((c) => c.header))]
  for (const row of rows) {
    lines.push(line(cols.map((c) => row[c.key] ?? '')))
  }
  return lines.join('\n')
}
