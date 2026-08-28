import { describe, expect, test } from 'bun:test'
import { last4, mask } from '../src/store.ts'

describe('last4', () => {
  test('normal token', () => {
    expect(last4('sk-ant-abcdO4DA')).toBe('O4DA')
  })
  test('token shorter than 4 chars', () => {
    expect(last4('ab')).toBe('ab')
  })
  test('exactly 4 chars', () => {
    expect(last4('abcd')).toBe('abcd')
  })
  test('empty', () => {
    expect(last4('')).toBe('')
  })
})

describe('mask', () => {
  test('shape is ellipsis + last4', () => {
    expect(mask({ name: 'x', createdAt: 'now', last4: 'O4DA' })).toBe('…O4DA')
  })
})
