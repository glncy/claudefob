import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { claudeConfigPath } from './paths.ts'

export type OnboardingResult =
  | { kind: 'already-ok' }
  | { kind: 'created' }
  | { kind: 'patched' }
  | { kind: 'verify-failed'; reason: string }
  | { kind: 'error'; reason: string }

function findDuplicateTopLevelKeys(text: string): string | null {
  // Scan the top-level object only (depth tracking), collecting "key": occurrences at depth 1.
  let depth = 0
  let inString = false
  let escape = false
  const seen = new Set<string>()
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (c === '\\') {
        escape = true
      } else if (c === '"') {
        inString = false
      }
      i++
      continue
    }
    if (c === '"') {
      if (depth === 1) {
        // possible key start; parse the string
        const start = i
        let j = i + 1
        let esc = false
        while (j < text.length) {
          const cj = text[j]
          if (esc) {
            esc = false
          } else if (cj === '\\') {
            esc = true
          } else if (cj === '"') {
            break
          }
          j++
        }
        const raw = text.slice(start, j + 1)
        // determine if this is a key (followed by optional whitespace then ':')
        let k = j + 1
        while (k < text.length && /\s/.test(text[k]!)) k++
        if (text[k] === ':') {
          let key: string
          try {
            key = JSON.parse(raw)
          } catch {
            key = raw
          }
          if (seen.has(key)) return key
          seen.add(key)
        }
        i = j + 1
        continue
      }
      inString = true
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return null
}

const VALUE_TOKEN_RE = /("hasCompletedOnboarding"\s*:\s*)(true|false|null)/

export function buildPatched(originalText: string): { text: string; ok: boolean; reason?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(originalText)
  } catch {
    return { text: originalText, ok: false, reason: 'File is not valid JSON.' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { text: originalText, ok: false, reason: 'File does not contain a JSON object at the top level.' }
  }
  const dup = findDuplicateTopLevelKeys(originalText)
  if (dup) {
    return { text: originalText, ok: false, reason: `File has duplicate top-level key "${dup}".` }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.hasCompletedOnboarding === true) {
    return { text: originalText, ok: true }
  }

  let newText: string
  const existingValue = obj.hasCompletedOnboarding
  const keyExists = Object.prototype.hasOwnProperty.call(obj, 'hasCompletedOnboarding')

  if (keyExists) {
    if (!VALUE_TOKEN_RE.test(originalText) || (existingValue !== true && existingValue !== false && existingValue !== null)) {
      return { text: originalText, ok: false, reason: 'Existing "hasCompletedOnboarding" value is not a recognized literal (true/false/null).' }
    }
    newText = originalText.replace(VALUE_TOKEN_RE, '$1true')
  } else {
    // Insert as first member of the top-level object, matching detected indentation.
    const openBraceIdx = originalText.indexOf('{')
    if (openBraceIdx === -1) {
      return { text: originalText, ok: false, reason: 'Could not locate top-level opening brace.' }
    }
    // Detect indentation from the first key line, if any.
    const indentMatch = originalText.slice(openBraceIdx + 1).match(/\n(\s*)\S/)
    const indent = indentMatch ? indentMatch[1]! : '  '
    const afterBrace = originalText.slice(openBraceIdx + 1)
    const restTrimmed = afterBrace.replace(/^\s*/, '')
    const isEmptyObject = restTrimmed.startsWith('}')
    if (isEmptyObject) {
      newText =
        originalText.slice(0, openBraceIdx + 1) +
        `\n${indent}"hasCompletedOnboarding": true\n` +
        restTrimmed
    } else {
      newText =
        originalText.slice(0, openBraceIdx + 1) +
        `\n${indent}"hasCompletedOnboarding": true,` +
        afterBrace
    }
  }

  // Round-trip verification.
  let newParsed: unknown
  try {
    newParsed = JSON.parse(newText)
  } catch {
    return { text: originalText, ok: false, reason: 'Patched text failed to parse (internal verification failure).' }
  }
  const stripHco = (o: unknown): unknown => {
    if (!o || typeof o !== 'object') return o
    const clone: Record<string, unknown> = { ...(o as Record<string, unknown>) }
    delete clone.hasCompletedOnboarding
    return clone
  }
  const a = JSON.stringify(stripHco(parsed))
  const b = JSON.stringify(stripHco(newParsed))
  if (a !== b) {
    return { text: originalText, ok: false, reason: 'Round-trip verification failed: patch would change more than "hasCompletedOnboarding".' }
  }
  if ((newParsed as Record<string, unknown>).hasCompletedOnboarding !== true) {
    return { text: originalText, ok: false, reason: 'Round-trip verification failed: patched value is not true.' }
  }
  return { text: newText, ok: true }
}

export function ensureOnboarding(configPath: string = claudeConfigPath()): OnboardingResult {
  let originalText: string
  try {
    originalText = fs.readFileSync(configPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        writeAtomic(configPath, '{"hasCompletedOnboarding": true}\n', 0o600)
        return { kind: 'created' }
      } catch (writeErr) {
        return { kind: 'error', reason: `Could not create ${configPath}: ${(writeErr as Error).message}` }
      }
    }
    return { kind: 'error', reason: `Could not read ${configPath}: ${(e as Error).message}` }
  }

  const result = buildPatched(originalText)
  if (result.text === originalText && result.ok) {
    return { kind: 'already-ok' }
  }
  if (!result.ok) {
    return { kind: 'verify-failed', reason: result.reason ?? 'unknown' }
  }

  let mode = 0o600
  try {
    mode = fs.statSync(configPath).mode & 0o777
  } catch {
    // keep default
  }
  try {
    writeAtomic(configPath, result.text, mode)
  } catch (e) {
    return { kind: 'error', reason: `Could not write ${configPath}: ${(e as Error).message}` }
  }
  return { kind: 'patched' }
}

function writeAtomic(targetPath: string, content: string, mode: number): void {
  const dir = path.dirname(targetPath)
  const tmp = path.join(dir, `.claude.json.claudefob-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  try {
    fs.writeFileSync(tmp, content, { mode })
    fs.renameSync(tmp, targetPath)
  } catch (e) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw e
  }
}
