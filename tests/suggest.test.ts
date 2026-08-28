import { describe, test, expect } from 'bun:test'
import { distance, didYouMean, unknownTokenMessage } from '../src/suggest.ts'

describe('distance', () => {
  test('identical strings are zero', () => expect(distance('work', 'work')).toBe(0))
  test('single transposition counts as two edits', () => expect(distance('wrok', 'work')).toBe(2))
  test('empty against non-empty is the length', () => expect(distance('', 'work')).toBe(4))
})

describe('didYouMean', () => {
  test('suggests within distance 2', () => expect(didYouMean('wrok', ['work', 'personal'])).toBe('work'))
  test('is case-insensitive', () => expect(didYouMean('WORK', ['work'])).toBe('work'))
  test('returns undefined when nothing is close', () =>
    expect(didYouMean('zzzzzzzz', ['work', 'personal'])).toBeUndefined())
  test('returns undefined for an empty candidate list', () => expect(didYouMean('work', [])).toBeUndefined())
})

describe('unknownTokenMessage', () => {
  test('includes the suggestion when one is close', () => {
    expect(unknownTokenMessage('wrok', ['work'])).toBe("No token named 'wrok'. Did you mean 'work'?")
  })
  test('directs to add when the store is empty', () => {
    expect(unknownTokenMessage('work', [])).toContain('claudefob add <name>')
  })
  test('lists stored names when nothing is close', () => {
    expect(unknownTokenMessage('zzzzzzzz', ['work', 'personal'])).toContain('work, personal')
  })
})
