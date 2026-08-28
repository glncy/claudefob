import fs from 'node:fs'
import path from 'node:path'
import { scanFenceBlocks } from './rc-scan.ts'

export interface BlockReplacement {
  /** File text with every claudefob block replaced by `newBlock`. */
  text: string
  /** How many blocks were replaced. */
  replaced: number
  /** True when the file already contained exactly this block. */
  unchanged: boolean
}

/**
 * Replaces the contents of every fenced claudefob block, leaving everything outside the markers
 * byte-identical. Never inserts a block where none exists — claudefob only ever rewrites what the
 * user installed themselves.
 */
export function replaceBlocks(text: string, newBlock: string): BlockReplacement {
  const blocks = scanFenceBlocks(text)
  if (blocks.length === 0) return { text, replaced: 0, unchanged: true }

  const lines = text.split('\n')
  const newLines = newBlock.split('\n')
  const out: string[] = []
  let cursor = 0
  let replaced = 0

  for (const b of blocks) {
    const startIdx = b.start - 1 // the `>>>` marker line
    const endIdx = b.end - 1 // the `<<<` marker line
    out.push(...lines.slice(cursor, startIdx))
    out.push(...newLines)
    replaced++
    cursor = endIdx + 1
  }
  out.push(...lines.slice(cursor))

  const result = out.join('\n')
  return { text: result, replaced, unchanged: result === text }
}

/** Writes via a temp file in the same directory, then renames — no partially written rc file. */
export function writeFileAtomic(filePath: string, text: string): void {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.claudefob-tmp`)
  let mode = 0o644
  try {
    mode = fs.statSync(filePath).mode & 0o777
  } catch {
    // new file: keep the default
  }
  fs.writeFileSync(tmp, text, { mode })
  fs.renameSync(tmp, filePath)
}
