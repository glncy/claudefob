/** Levenshtein distance, capped for short CLI identifiers. */
export function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[n] ?? 0
}

/** Nearest candidate within edit distance 2, case-insensitive. Undefined when nothing is close. */
export function didYouMean(input: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestScore = Infinity
  for (const c of candidates) {
    const d = distance(input.toLowerCase(), c.toLowerCase())
    if (d < bestScore) {
      bestScore = d
      best = c
    }
  }
  return bestScore <= 2 ? best : undefined
}

/** Builds the "No token named 'x'. Did you mean 'y'?" message. */
export function unknownTokenMessage(name: string, candidates: string[]): string {
  const hint = didYouMean(name, candidates)
  const base = `No token named '${name}'.`
  if (hint) return `${base} Did you mean '${hint}'?`
  if (candidates.length === 0) return `${base} No tokens stored yet. Add one: claudefob add <name>`
  return `${base} Stored tokens: ${candidates.join(', ')}`
}
