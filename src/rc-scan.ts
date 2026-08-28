export interface FenceBlock {
  /** 1-indexed line number of the first line inside the block (after the `>>>` marker line) */
  start: number
  /** 1-indexed line number of the `<<<` marker line */
  end: number
}

// Finds every fenced claudefob block in an rc file's text, pairing each `>>> claudefob >>>`
// with the next `<<< claudefob <<<` sequentially. An unterminated opening marker (no closing
// marker before EOF, or before the next opening marker) is dropped rather than reported with a
// bogus end<start range.
export function scanFenceBlocks(text: string): FenceBlock[] {
  const lines = text.split('\n')
  const blocks: FenceBlock[] = []
  let start = -1
  lines.forEach((l, i) => {
    if (l.includes('>>> claudefob >>>')) {
      start = i
      return
    }
    if (l.includes('<<< claudefob <<<')) {
      if (start !== -1) {
        blocks.push({ start: start + 1, end: i + 1 })
      }
      start = -1
    }
  })
  return blocks
}
