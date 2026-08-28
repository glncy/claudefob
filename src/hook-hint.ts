import { err } from './ui/out.ts'
import type { ShellDialect } from './shell/index.ts'

export function hookInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDEFOB_HOOK === '1'
}

/** rc file to suggest for the detected dialect. */
export function suggestedRcFile(shell: ShellDialect, platform: NodeJS.Platform = process.platform): string {
  if (shell === 'fish') return '~/.config/fish/config.fish'
  if (shell === 'powershell') return '$PROFILE'
  if (platform === 'darwin') return '~/.zshrc'
  return '~/.bashrc'
}

export function installCommandFor(shell: ShellDialect, platform: NodeJS.Platform = process.platform): string {
  const rc = suggestedRcFile(shell, platform)
  if (shell === 'powershell') {
    return 'claudefob init | Add-Content $PROFILE'
  }
  return `claudefob init >> ${rc}`
}

/**
 * SPEC §3 / ADDENDUM A2 — warn when the shell integration is absent, because activation has no
 * effect on the environment without it. Warning only; never prompts, never writes.
 */
export function warnIfHookMissing(shell: ShellDialect, context: 'add' | 'activate'): void {
  if (hookInstalled()) return
  if (process.env.CLAUDEFOB_NO_HOOK_CHECK === '1') return
  err('')
  err(
    context === 'activate'
      ? 'Shell integration is not installed — this had no effect on your shell.'
      : "Shell integration is not installed — activating a token won't change your environment.",
  )
  err(`    ${installCommandFor(shell)}`)
  err('  More:  claudefob guide')
}
