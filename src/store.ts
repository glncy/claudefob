import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { storePath } from './paths.ts'
import { UsageError } from './ui/errors.ts'

export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/

export interface TokenRecord {
  name: string
  description?: string
  createdAt: string
  last4: string
}

export interface Store {
  version: 1
  active: string | null
  tokens: TokenRecord[]
}

export class CorruptStoreError extends Error {
  path: string
  constructor(message: string, path: string) {
    super(message)
    this.path = path
  }
}

export function emptyStore(): Store {
  return { version: 1, active: null, tokens: [] }
}

function isTokenRecord(v: unknown): v is TokenRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.name === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.last4 === 'string' &&
    (r.description === undefined || typeof r.description === 'string')
  )
}

function validateStoreShape(v: unknown, p: string): Store {
  if (!v || typeof v !== 'object') throw new CorruptStoreError(`Store file is not a JSON object: ${p}`, p)
  const r = v as Record<string, unknown>
  if (r.version !== 1) throw new CorruptStoreError(`Store file has unsupported version: ${p}`, p)
  if (r.active !== null && typeof r.active !== 'string') {
    throw new CorruptStoreError(`Store file has invalid "active" field: ${p}`, p)
  }
  if (!Array.isArray(r.tokens) || !r.tokens.every(isTokenRecord)) {
    throw new CorruptStoreError(`Store file has invalid "tokens" field: ${p}`, p)
  }
  return { version: 1, active: r.active as string | null, tokens: r.tokens as TokenRecord[] }
}

export function loadStore(p: string = storePath()): Store {
  let text: string
  try {
    text = fs.readFileSync(p, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
    throw new CorruptStoreError(`Could not read store file: ${p}`, p)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CorruptStoreError(`Store file is not valid JSON: ${p}`, p)
  }
  return validateStoreShape(parsed, p)
}

export function saveStore(s: Store, p: string = storePath()): void {
  const dir = path.dirname(p)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.store.json.claudefob-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, p)
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    // Windows ignores mode; acceptable.
  }
}

export function findToken(s: Store, name: string): TokenRecord | undefined {
  return s.tokens.find((t) => t.name === name)
}

export function addToken(s: Store, rec: TokenRecord): Store {
  if (findToken(s, rec.name)) {
    throw new UsageError(`A token named '${rec.name}' already exists.`)
  }
  return { ...s, tokens: [...s.tokens, rec] }
}

export function removeToken(s: Store, name: string): Store {
  const tokens = s.tokens.filter((t) => t.name !== name)
  const active = s.active === name ? null : s.active
  return { ...s, tokens, active }
}

export function setActive(s: Store, name: string | null): Store {
  return { ...s, active: name }
}

export function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new UsageError(
      `Invalid token name '${name}'. Names must match ${NAME_RE.source} (1-64 chars: letters, digits, '.', '_', '-').`,
    )
  }
}

export function validateDescription(d?: string): void {
  if (d !== undefined && d.length > 200) {
    throw new UsageError('Description must be 200 characters or fewer.')
  }
}

export function last4(token: string): string {
  return token.slice(-4)
}

export function mask(rec: TokenRecord): string {
  return `…${rec.last4}`
}
