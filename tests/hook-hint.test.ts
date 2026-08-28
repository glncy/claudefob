import { describe, test, expect } from 'bun:test'
import { hookInstalled, suggestedRcFile, installCommandFor } from '../src/hook-hint.ts'

describe('hookInstalled', () => {
  test('is true only for the exact marker value', () => {
    expect(hookInstalled({ CLAUDEFOB_HOOK: '1' } as NodeJS.ProcessEnv)).toBe(true)
    expect(hookInstalled({ CLAUDEFOB_HOOK: '0' } as NodeJS.ProcessEnv)).toBe(false)
    expect(hookInstalled({} as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('suggestedRcFile', () => {
  test('picks the rc file for the dialect and platform', () => {
    expect(suggestedRcFile('fish', 'darwin')).toBe('~/.config/fish/config.fish')
    expect(suggestedRcFile('powershell', 'win32')).toBe('$PROFILE')
    expect(suggestedRcFile('posix', 'darwin')).toBe('~/.zshrc')
    expect(suggestedRcFile('posix', 'linux')).toBe('~/.bashrc')
  })
})

describe('installCommandFor', () => {
  test('uses redirection on posix and Add-Content on Windows', () => {
    expect(installCommandFor('posix', 'darwin')).toBe('claudefob init >> ~/.zshrc')
    expect(installCommandFor('powershell', 'win32')).toBe('claudefob init | Add-Content $PROFILE')
  })
})
