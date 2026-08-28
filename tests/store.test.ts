import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  emptyStore,
  addToken,
  removeToken,
  setActive,
  findToken,
  validateName,
  validateDescription,
  loadStore,
  saveStore,
  CorruptStoreError,
  type Store,
} from '../src/store.ts'
import { UsageError } from '../src/ui/errors.ts'
import { makeTmpHome } from './helpers/tmpHome.ts'

describe('validateName', () => {
  test('accepts 1 char', () => expect(() => validateName('a')).not.toThrow())
  test('accepts 64 chars', () => expect(() => validateName('a'.repeat(64))).not.toThrow())
  test('rejects 65 chars', () => expect(() => validateName('a'.repeat(65))).toThrow(UsageError))
  test('rejects empty', () => expect(() => validateName('')).toThrow(UsageError))
  test('rejects illegal chars', () => expect(() => validateName('a b')).toThrow(UsageError))
  test('accepts dots, underscores, dashes', () => expect(() => validateName('a.b_c-d')).not.toThrow())
})

describe('validateDescription', () => {
  test('accepts undefined', () => expect(() => validateDescription(undefined)).not.toThrow())
  test('accepts 200 chars', () => expect(() => validateDescription('a'.repeat(200))).not.toThrow())
  test('rejects 201 chars', () => expect(() => validateDescription('a'.repeat(201))).toThrow(UsageError))
})

describe('pure mutators', () => {
  test('addToken is pure and appends', () => {
    const s0 = emptyStore()
    const s1 = addToken(s0, { name: 'a', createdAt: 'now', last4: 'aaaa' })
    expect(s0.tokens.length).toBe(0)
    expect(s1.tokens.length).toBe(1)
  })
  test('addToken rejects duplicate name', () => {
    const s0 = addToken(emptyStore(), { name: 'a', createdAt: 'now', last4: 'aaaa' })
    expect(() => addToken(s0, { name: 'a', createdAt: 'later', last4: 'bbbb' })).toThrow(UsageError)
  })
  test('removeToken removes and clears active if it matched', () => {
    let s: Store = addToken(emptyStore(), { name: 'a', createdAt: 'now', last4: 'aaaa' })
    s = setActive(s, 'a')
    const s2 = removeToken(s, 'a')
    expect(s2.tokens.length).toBe(0)
    expect(s2.active).toBeNull()
    expect(s.active).toBe('a') // original untouched
  })
  test('removeToken leaves active alone when a different token is removed', () => {
    let s: Store = addToken(emptyStore(), { name: 'a', createdAt: 'now', last4: 'aaaa' })
    s = addToken(s, { name: 'b', createdAt: 'now', last4: 'bbbb' })
    s = setActive(s, 'a')
    const s2 = removeToken(s, 'b')
    expect(s2.active).toBe('a')
  })
  test('setActive is pure', () => {
    const s0 = emptyStore()
    const s1 = setActive(s0, 'x')
    expect(s0.active).toBeNull()
    expect(s1.active).toBe('x')
  })
  test('findToken', () => {
    const s = addToken(emptyStore(), { name: 'a', createdAt: 'now', last4: 'aaaa' })
    expect(findToken(s, 'a')?.name).toBe('a')
    expect(findToken(s, 'missing')).toBeUndefined()
  })
})

describe('loadStore / saveStore', () => {
  test('missing file returns empty store', () => {
    const home = makeTmpHome()
    try {
      const p = path.join(home.storeDir, 'claudefob', 'store.json')
      expect(loadStore(p)).toEqual(emptyStore())
    } finally {
      home.cleanup()
    }
  })
  test('round trip', () => {
    const home = makeTmpHome()
    try {
      const p = path.join(home.storeDir, 'claudefob', 'store.json')
      const s = addToken(emptyStore(), { name: 'a', description: 'd', createdAt: 'now', last4: 'aaaa' })
      saveStore(s, p)
      expect(loadStore(p)).toEqual(s)
    } finally {
      home.cleanup()
    }
  })
  test('file is written with mode 0600', () => {
    if (process.platform === 'win32') return
    const home = makeTmpHome()
    try {
      const p = path.join(home.storeDir, 'claudefob', 'store.json')
      saveStore(emptyStore(), p)
      const mode = fs.statSync(p).mode & 0o777
      expect(mode).toBe(0o600)
    } finally {
      home.cleanup()
    }
  })
  test('corrupt JSON throws CorruptStoreError with path', () => {
    const home = makeTmpHome()
    try {
      const dir = path.join(home.storeDir, 'claudefob')
      fs.mkdirSync(dir, { recursive: true })
      const p = path.join(dir, 'store.json')
      fs.writeFileSync(p, '{not json')
      expect(() => loadStore(p)).toThrow(CorruptStoreError)
      try {
        loadStore(p)
      } catch (e) {
        expect((e as CorruptStoreError).path).toBe(p)
      }
    } finally {
      home.cleanup()
    }
  })
  test('wrong version throws CorruptStoreError', () => {
    const home = makeTmpHome()
    try {
      const dir = path.join(home.storeDir, 'claudefob')
      fs.mkdirSync(dir, { recursive: true })
      const p = path.join(dir, 'store.json')
      fs.writeFileSync(p, JSON.stringify({ version: 2, active: null, tokens: [] }))
      expect(() => loadStore(p)).toThrow(CorruptStoreError)
    } finally {
      home.cleanup()
    }
  })
})
