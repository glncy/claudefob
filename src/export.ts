import { loadStore, findToken } from './store.ts'
import { getKeystore } from './keystore.ts'
import { codegenFor, type ShellDialect } from './shell/index.ts'
import { emitShellCode, err } from './ui/out.ts'

export const VAR = 'CLAUDE_CODE_OAUTH_TOKEN'

function debug(e: unknown): void {
  if (process.env.CLAUDEFOB_DEBUG === '1') {
    err(`[debug] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  }
}

/**
 * SPEC §4.11 — fail silent. Every failure mode (missing store, corrupt store, dead keystore) must
 * produce zero output and never throw past this function.
 */
export function runExport(shell: ShellDialect): void {
  try {
    const store = loadStore()
    if (!store.active) return
    const rec = findToken(store, store.active)
    if (!rec) return
    let secret: string | null
    try {
      secret = getKeystore().get(store.active)
    } catch (e) {
      debug(e)
      return
    }
    if (!secret) return
    emitShellCode(codegenFor(shell).setEnv(VAR, secret))
  } catch (e) {
    debug(e)
  }
}
