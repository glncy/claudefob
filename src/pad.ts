import fs from 'node:fs'

/**
 * Whether `init` should emit a leading blank line before the block.
 *
 * A blank line keeps the block from butting against the previous entry, but adding one
 * unconditionally stacks blank lines when the file already ends with one. init cannot see the
 * shell's `>>` redirect, so it inspects the file it is suggesting (or one named with --rc).
 *
 * Returns false when the file does not exist, is empty, or already ends in a blank line.
 */
export function needsLeadingBlankLine(rcPath: string | undefined): boolean {
  if (!rcPath) return true
  let text: string
  try {
    text = fs.readFileSync(rcPath, 'utf8')
  } catch {
    return false // nothing to separate from
  }
  if (text.trim() === '') return false
  // Normalise CRLF so a Windows profile is judged the same way.
  const normalised = text.replace(/\r\n/g, '\n')
  return !normalised.endsWith('\n\n')
}
