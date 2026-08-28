import { describe, expect, test } from 'bun:test'
import { detectShell } from '../src/shell/index.ts'

describe('detectShell', () => {
  test('parent process name wins: zsh -> posix', () => {
    expect(detectShell({}, 'darwin', 'zsh')).toBe('posix')
  })
  test('parent process name wins: fish -> fish', () => {
    expect(detectShell({}, 'linux', 'fish')).toBe('fish')
  })
  test('parent process name wins: pwsh -> powershell', () => {
    expect(detectShell({}, 'win32', 'pwsh')).toBe('powershell')
  })
  test('falls back to $SHELL when no parent name', () => {
    expect(detectShell({ SHELL: '/usr/bin/fish' }, 'linux', undefined)).toBe('fish')
    expect(detectShell({ SHELL: '/bin/zsh' }, 'linux', undefined)).toBe('posix')
  })
  test('falls back to platform default: darwin -> posix', () => {
    expect(detectShell({}, 'darwin', undefined)).toBe('posix')
  })
  test('falls back to platform default: linux -> posix', () => {
    expect(detectShell({}, 'linux', undefined)).toBe('posix')
  })
  test('falls back to platform default: win32 -> powershell', () => {
    expect(detectShell({}, 'win32', undefined)).toBe('powershell')
  })
  test('win32 with MSYSTEM set -> posix (Git Bash)', () => {
    expect(detectShell({ MSYSTEM: 'MINGW64' }, 'win32', undefined)).toBe('posix')
  })
})
