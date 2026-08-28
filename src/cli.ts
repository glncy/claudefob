import { defineCommand, runMain } from 'citty'
import { loadStore, saveStore, findToken, addToken, removeToken, setActive, validateName, validateDescription, last4, mask, type TokenRecord } from './store.ts'
import { getKeystore, KeystoreUnavailableError } from './keystore.ts'
import { codegenFor, detectShell, parseShellFlag, type ShellDialect } from './shell/index.ts'
import { ensureOnboarding } from './claude-config.ts'
import { rcCandidates } from './paths.ts'
import { selectBackend, AuthUnavailableError } from './auth/index.ts'
import { emitShellCode, err, errJson } from './ui/out.ts'
import { runExport, VAR } from './export.ts'
import { UsageError, AuthError, KeystoreError, reportAndExit } from './ui/errors.ts'
import { selectToken, passwordPrompt, confirmPrompt, isCancelled, requireTTY, note } from './ui/prompts.ts'
import { renderTable } from './ui/table.ts'
import { colors } from './ui/colors.ts'
import { unknownTokenMessage } from './suggest.ts'
import { warnIfHookMissing, installCommandFor, suggestedRcFile } from './hook-hint.ts'
import { maybeNotifyUpdate, detectInstallMethod, updateCommandFor, probe } from './update-check.ts'
import { scanFenceBlocks } from './rc-scan.ts'
import fs from 'node:fs'

// citty's runMain catches everything thrown from a command's run() itself and always exits with
// code 1, so our exit-code taxonomy (UsageError=2, AuthError=3, KeystoreError=4) must be enforced
// from inside each command, not via runMain's outer catch. This wrapper does that.
function guard<A extends unknown[]>(fn: (...a: A) => Promise<void>): (...a: A) => Promise<void> {
  return async (...a: A) => {
    try {
      await fn(...a)
    } catch (e) {
      reportAndExit(e)
    }
  }
}

function resolveShell(args: { shell?: string }): ShellDialect {
  if (args.shell) return parseShellFlag(args.shell)
  return detectShell()
}

function debug(e: unknown): void {
  if (process.env.CLAUDEFOB_DEBUG === '1') {
    err(`[debug] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  }
}

async function pickTokenName(title: string, activeHint?: string): Promise<string | undefined> {
  requireTTY()
  const store = loadStore()
  if (store.tokens.length === 0) {
    throw new UsageError('No tokens stored yet. Run `claudefob add <name>` first.')
  }
  const options = store.tokens.map((t) => ({
    value: t.name,
    label: t.name,
    hint: [t.description, t.name === store.active ? '(active)' : undefined].filter(Boolean).join(' '),
  }))
  const initial = activeHint ?? store.active ?? undefined
  const picked = await selectToken(title, options, initial)
  if (isCancelled(picked)) return undefined
  return picked as string
}

const addCommand = defineCommand({
  meta: { name: 'add', description: 'Add a new token to the keystore' },
  args: {
    name: { type: 'positional', required: true },
    description: { type: 'string', alias: 'd' },
    shell: { type: 'string' },
  },
  run: guard(async ({ args }) => {
    validateName(args.name)
    validateDescription(args.description)
    const store = loadStore()
    if (findToken(store, args.name)) {
      throw new UsageError(`A token named '${args.name}' already exists.`)
    }
    requireTTY()
    const tokenInput = await passwordPrompt(`Enter the token for '${args.name}'`)
    if (isCancelled(tokenInput)) {
      err('Cancelled.')
      process.exit(2)
    }
    const token = (tokenInput as string).trim()
    if (!token) {
      throw new UsageError('Token must not be empty.')
    }
    const keystore = getKeystore()
    keystore.set(args.name, token)
    const rec: TokenRecord = {
      name: args.name,
      description: args.description,
      createdAt: new Date().toISOString(),
      last4: last4(token),
    }
    try {
      saveStore(addToken(store, rec))
    } catch (e) {
      try {
        keystore.delete(args.name)
      } catch {
        // best effort rollback
      }
      throw e
    }
    err(`Added '${args.name}'.`)
    err(`Activate it with: claudefob use ${args.name}`)
    warnIfHookMissing(resolveShell(args as { shell?: string }), 'add')
  }),
})

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List stored tokens' },
  args: { json: { type: 'boolean' } },
  run: guard(async ({ args }) => {
    // §2's rationale is that `list`/`status` read only store.json so they are instant and never
    // trigger a keystore prompt. §4.2's "⚠ missing" marker would require a keystore read per
    // token, which contradicts that — this is a SPEC self-contradiction (flagged in review).
    // Resolved here in favor of §2: list stays metadata-only, no keystore calls. Drift detection
    // (record present, secret gone) instead surfaces where the spec already requires a keystore
    // read anyway: `use` (exits 4, §7) and `show`.
    const store = loadStore()
    if (args.json) {
      errJson({
        active: store.active,
        tokens: store.tokens.map((t) => ({
          name: t.name,
          description: t.description ?? null,
          createdAt: t.createdAt,
          masked: mask(t),
          active: t.name === store.active,
        })),
      })
      return
    }
    if (store.tokens.length === 0) {
      err('No tokens stored yet. Run `claudefob add <name>` first.')
      return
    }
    const tableRows = store.tokens.map((t) => ({
      active: t.name === store.active ? '●' : '',
      name: t.name,
      description: t.description ?? '',
      added: t.createdAt.slice(0, 10),
      token: mask(t),
    }))
    err(
      renderTable(tableRows, [
        { header: '', key: 'active' },
        { header: 'NAME', key: 'name' },
        { header: 'DESCRIPTION', key: 'description' },
        { header: 'ADDED', key: 'added' },
        { header: 'TOKEN', key: 'token' },
      ]),
    )
  }),
})

const showCommand = defineCommand({
  meta: { name: 'show', description: 'Reveal a token (requires OS authentication)' },
  args: { name: { type: 'positional', required: false } },
  run: guard(async ({ args }) => {
    const store = loadStore()
    let name = args.name as string | undefined
    if (!name) {
      name = await pickTokenName('Select a token to reveal')
      if (!name) return // cancelled: exit 0, no auth challenge
    } else if (!findToken(store, name)) {
      throw new UsageError(unknownTokenMessage(name, store.tokens.map((t) => t.name)))
    }

    let backend
    try {
      backend = selectBackend()
    } catch (e) {
      if (e instanceof AuthUnavailableError) {
        throw new AuthError(e.message)
      }
      throw e
    }
    let ok = false
    try {
      ok = await backend.challenge()
    } catch (e) {
      debug(e)
      ok = false
    }
    if (!ok) {
      throw new AuthError(
        'Authentication failed or was cancelled. To inspect the keystore directly, use Keychain Access (macOS), seahorse (Linux), or Credential Manager (Windows).',
      )
    }
    const keystore = getKeystore()
    let secret: string | null
    try {
      secret = keystore.get(name)
    } catch (e) {
      throw new KeystoreError((e as Error).message)
    }
    if (secret === null) {
      throw new KeystoreError(`Secret for '${name}' is missing from the keystore.`)
    }
    err(secret)
  }),
})

const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Show activation status' },
  args: { json: { type: 'boolean' } },
  run: guard(async ({ args }) => {
    const store = loadStore()
    const hookInstalled = process.env.CLAUDEFOB_HOOK === '1'
    const active = store.active ? findToken(store, store.active) : undefined
    const envValue = process.env[VAR]
    let thisShell: 'inactive' | 'in sync' | 'stale'
    if (!envValue && !active) thisShell = 'inactive'
    // A set variable with nothing active (e.g. after `stop` in another terminal) or an active
    // token this shell hasn't picked up yet is drift, not simple "inactive" — SPEC §4.4.
    else if (!envValue || !active) thisShell = 'stale'
    else thisShell = last4(envValue) === active.last4 ? 'in sync' : 'stale'

    let execPolicyBlocked: boolean | undefined
    if (process.platform === 'win32') {
      try {
        const { execFileSync } = require('node:child_process')
        const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-ExecutionPolicy -Scope CurrentUser'], {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
        }).trim()
        execPolicyBlocked = out === 'Restricted'
      } catch {
        execPolicyBlocked = undefined
      }
    }

    if (args.json) {
      errJson({
        active: store.active,
        description: active?.description ?? null,
        masked: active ? mask(active) : null,
        addedAt: active?.createdAt ?? null,
        variable: VAR,
        hookInstalled,
        thisShell,
        executionPolicyBlocked: execPolicyBlocked ?? null,
      })
    } else {
      if (!store.active || !active) {
        err('No token is active.')
      } else {
        err(`Active: ${colors.bold(active.name)} ${active.description ? `(${active.description})` : ''}`)
        err(`Token: ${mask(active)}  Added: ${active.createdAt.slice(0, 10)}`)
      }
      err(`Variable: ${VAR}`)
      err(`Hook installed: ${hookInstalled ? 'yes' : 'no (run `claudefob guide`)'}`)
      err(`This shell: ${thisShell}`)
      if (execPolicyBlocked) {
        err('Warning: PowerShell execution policy is Restricted; the profile will not load.')
      }
    }
    process.exit(store.active ? 0 : 1)
  }),
})

async function doActivate(args: { name?: string; shell?: string }) {
  const shell = resolveShell(args)
  const store = loadStore()
  let name = args.name
  if (!name) {
    name = await pickTokenName('Select a token to activate', store.active ?? undefined)
    if (!name) return // cancelled
  }
  const rec = findToken(store, name)
  if (!rec) {
    throw new UsageError(unknownTokenMessage(name, store.tokens.map((t) => t.name)))
  }
  const keystore = getKeystore()
  let secret: string | null
  try {
    secret = keystore.get(name)
  } catch (e) {
    throw new KeystoreError((e as Error).message)
  }
  if (secret === null) {
    throw new KeystoreError(`Secret for '${name}' is missing from the keystore. Try \`claudefob remove ${name}\` and re-add it.`)
  }
  saveStore(setActive(store, name))
  try {
    const result = ensureOnboarding()
    if (result.kind === 'created' || result.kind === 'patched') {
      note('Fixed ~/.claude.json so Claude Code will not prompt for auth again.')
    } else if (result.kind === 'verify-failed' || result.kind === 'error') {
      err(`Could not update ~/.claude.json automatically (${result.reason}). Manual fix: set "hasCompletedOnboarding": true in ~/.claude.json.`)
    }
  } catch (e) {
    debug(e)
  }
  err(`Activated '${name}'.`)
  emitShellCode(codegenFor(shell).setEnv(VAR, secret))
  warnIfHookMissing(shell, 'activate')
}

const useCommand = defineCommand({
  meta: { name: 'use', description: 'Activate a token' },
  args: {
    name: { type: 'positional', required: false },
    shell: { type: 'string' },
  },
  run: guard(async ({ args }) => {
    await doActivate({ name: args.name as string | undefined, shell: args.shell })
  }),
})

const stopCommand = defineCommand({
  meta: { name: 'stop', description: 'Deactivate the current token' },
  args: { shell: { type: 'string' } },
  run: guard(async ({ args }) => {
    const shell = resolveShell(args)
    const store = loadStore()
    saveStore(setActive(store, null))
    err('Deactivated.')
    emitShellCode(codegenFor(shell).unsetEnv(VAR))
  }),
})

const removeCommand = defineCommand({
  meta: { name: 'remove', description: 'Remove a stored token' },
  args: {
    name: { type: 'positional', required: false },
    yes: { type: 'boolean', alias: 'y' },
    shell: { type: 'string' },
  },
  run: guard(async ({ args }) => {
    const shell = resolveShell(args)
    const store = loadStore()
    let name = args.name as string | undefined
    if (!name) {
      name = await pickTokenName('Select a token to remove')
      if (!name) return
    }
    const rec = findToken(store, name)
    if (!rec) {
      throw new UsageError(unknownTokenMessage(name, store.tokens.map((t) => t.name)))
    }
    if (!args.yes) {
      requireTTY()
      const confirmed = await confirmPrompt(`Remove token '${name}'? This cannot be undone.`)
      if (isCancelled(confirmed) || !confirmed) {
        err('Cancelled.')
        return
      }
    }
    const keystore = getKeystore()
    try {
      keystore.delete(name)
    } catch (e) {
      if (e instanceof KeystoreUnavailableError) {
        throw new KeystoreError(e.message)
      }
      throw e
    }
    const wasActive = store.active === name
    saveStore(removeToken(store, name))
    err(`Removed '${name}'.`)
    if (wasActive) {
      emitShellCode(codegenFor(shell).unsetEnv(VAR))
    }
  }),
})

const initCommand = defineCommand({
  meta: { name: 'init', description: 'Print the shell integration block' },
  args: { shell: { type: 'string' } },
  run: guard(async ({ args }) => {
    const shell = resolveShell(args)
    // Names the detected shell and its usual rc file, but does not imply the user must use that
    // file — `claudefob init >> ~/.zprofile` is equally valid and the CLI cannot see the redirect.
    err(`Detected shell: ${shell}. Override with --shell.`)
    err('The block below goes in a shell startup file — commonly ' + `${suggestedRcFile(shell)}` + '. For example:')
    err(`  ${installCommandFor(shell)}`)
    err('It takes effect in any terminal you open afterwards.')
    err('Run `claudefob guide` for the full list of startup files and which one to pick.')
    emitShellCode(codegenFor(shell).hookBlock())
  }),
})

const guideCommand = defineCommand({
  meta: { name: 'guide', description: 'Print setup and troubleshooting guidance' },
  args: { shell: { type: 'string' } },
  run: guard(async ({ args }) => {
    const shell = resolveShell(args)
    const store = loadStore()
    err(`Detected platform: ${process.platform}, shell: ${shell}`)
    err('')
    err('Install: append the hook block to your rc file, e.g.:')
    err(`  claudefob init --shell ${shell} >> <rc file>`)
    err('')
    err('rc file candidates and when each applies:')
    for (const c of rcCandidates()) {
      err(`  ${c.path}  (${c.shell}) — ${c.note}`)
    }
    err('')
    err('Scanning for installed hook blocks...')
    let foundAny = false
    for (const c of rcCandidates()) {
      let text: string
      try {
        text = fs.readFileSync(c.path, 'utf8')
      } catch {
        continue
      }
      for (const block of scanFenceBlocks(text)) {
        foundAny = true
        err(`  ${c.path}: lines ${block.start}-${block.end}`)
      }
    }
    if (!foundAny) err('  (none found)')
    err('')
    if (store.active) {
      err('A token is currently active. Run `claudefob stop` before removing the hook.')
    }
    err('To remove the hook block:')
    if (process.platform === 'darwin') {
      err("  sed -i '' '/# >>> claudefob >>>/,/# <<< claudefob <<</d' <file>")
    } else if (process.platform === 'win32') {
      err('  PowerShell:')
      err('  $inBlock = $false')
      err('  (Get-Content $PROFILE) | Where-Object {')
      err("    if ($_ -match '# >>> claudefob >>>') { $inBlock = $true; return $false }")
      err("    if ($_ -match '# <<< claudefob <<<') { $inBlock = $false; return $false }")
      err('    -not $inBlock')
      err('  } | Set-Content $PROFILE')
    } else {
      err("  sed -i '/# >>> claudefob >>>/,/# <<< claudefob <<</d' <file>")
    }
  }),
})

const updateCommand = defineCommand({
  meta: { name: 'update', description: 'Update claudefob to the latest version' },
  args: { yes: { type: 'boolean', alias: 'y' } },
  run: guard(async ({ args }) => {
    const method = detectInstallMethod()
    const cmd = updateCommandFor(method)
    if (method === 'unknown' || !process.stdin.isTTY) {
      err(`To update claudefob, run:\n  ${cmd}`)
      return
    }
    if (!args.yes) {
      const ok = await confirmPrompt(`Installed via ${method}. Run \`${cmd}\`?`)
      if (isCancelled(ok) || !ok) {
        err('Cancelled.')
        return
      }
    }
    const { spawnSync } = await import('node:child_process')
    const parts = cmd.split(' ')
    const bin = parts[0] as string
    const res = spawnSync(bin, parts.slice(1), { stdio: 'inherit' })
    if (res.status !== 0) {
      err(`Update command failed. Run it manually:\n  ${cmd}`)
      process.exit(1)
    }
  }),
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Internal: emit shell code for current state', hidden: true },
  // `--sync` is internal: it appears only inside the generated hook block, never in help, and is
  // never something a user types. It differs from plain `export` in that it may emit an unset.
  args: { shell: { type: 'string' }, sync: { type: 'boolean' } },
  run: guard(async ({ args }) => {
    let shell: ShellDialect
    try {
      shell = args.shell ? parseShellFlag(args.shell) : detectShell()
    } catch (e) {
      debug(e)
      return
    }
    runExport(shell, { sync: Boolean(args.sync) })
  }),
})

export const VERSION = '0.1.2'

/** Same command under another name, hidden from --help so only the canonical name is advertised. */
function hiddenAlias<T extends { meta?: unknown }>(cmd: T, name: string): T {
  return {
    ...cmd,
    meta: { ...((cmd.meta ?? {}) as Record<string, unknown>), name, hidden: true },
  } as T
}

const main = defineCommand({
  meta: {
    name: 'claudefob',
    version: VERSION,
    description: 'Unofficial CLI to store multiple Claude Code OAuth tokens and activate one at a time.',
  },
  args: {
    shell: { type: 'string' },
    json: { type: 'boolean' },
  },
  subCommands: {
    add: addCommand,
    list: listCommand,
    show: showCommand,
    status: statusCommand,
    use: useCommand,
    stop: stopCommand,
    remove: removeCommand,
    init: initCommand,
    guide: guideCommand,
    update: updateCommand,
    export: exportCommand,
    // ADDENDUM A1: `ls`/`rm` are accepted spellings; `list`/`remove` stay canonical and are the
    // only names shown in --help or printed in hints and error messages.
    ls: hiddenAlias(listCommand, 'ls'),
    rm: hiddenAlias(removeCommand, 'rm'),
  },
  run: guard(async ({ args, rawArgs }) => {
    // citty invokes the parent's `run` unconditionally, even after dispatching to a matched
    // subcommand — so this only performs the bare-invocation activation picker when no known
    // subcommand token is present in the raw args; otherwise the subcommand already ran.
    const subNames = ['add', 'list', 'ls', 'show', 'status', 'use', 'stop', 'remove', 'rm', 'init', 'guide', 'update', 'export']
    if (rawArgs.some((a) => subNames.includes(a))) return
    await doActivate({ shell: args.shell as string | undefined })
  }),
})

const HELP_EXAMPLES = [
  '',
  'EXAMPLES',
  '  claudefob init >> ~/.zshrc     Install the shell integration (one time)',
  '  claudefob add work -d "day job"  Store a token',
  '  claudefob                      Pick a token to activate',
  '  claudefob use work             Activate a token by name',
  '  claudefob status               Show what is active in this shell',
  '  claudefob stop                 Deactivate',
  '  claudefob show work            Reveal a token (asks for OS authentication)',
  '  claudefob guide                Platform setup and removal instructions',
  '',
  'Set CLAUDEFOB_NO_UPDATE_CHECK=1 to disable update checks, NO_COLOR=1 to disable color.',
].join('\n')

async function start() {
  const argv = process.argv.slice(2)

  // Detached background probe for the update check (ADDENDUM A3). Never prints anything.
  if (argv[0] === '__update-probe') {
    await probe(new Date().toISOString())
    process.exit(0)
  }

  const isExport = argv[0] === 'export'
  if (isExport) {
    // export has its own outermost guard: swallow everything, always exit 0.
    process.on('uncaughtException', () => process.exit(0))
    process.on('unhandledRejection', () => process.exit(0))
    try {
      await runMain(main, { rawArgs: argv })
    } catch {
      // fall through
    }
    process.exit(0)
  }

  // ADDENDUM A3: the notice prints from cache on exit, so it never delays the command. Registered
  // as an exit hook because several commands call process.exit() directly.
  const command = argv.find((a) => !a.startsWith('-')) ?? ''
  const json = argv.includes('--json')
  process.on('exit', () => {
    try {
      maybeNotifyUpdate(VERSION, { command, json })
    } catch {
      // an update notice must never change the outcome of a command
    }
  })

  const wantsHelp = argv.length === 0 || argv.includes('--help') || argv.includes('-h')

  try {
    await runMain(main, {
      rawArgs: argv,
      // citty prints help/usage via console.log by default (stdout); redirect via process shim below.
    })
  } catch (e) {
    reportAndExit(e)
  }
  if (wantsHelp && argv.includes('--help')) err(HELP_EXAMPLES)
}

// citty's default renderer writes --help/--version to stdout via console.log. Route console.log to
// stderr globally in this process so help text never contaminates the shell eval.
const realConsoleLog = console.log.bind(console)
console.log = (...a: unknown[]) => {
  process.stderr.write(a.map(String).join(' ') + '\n')
}
void realConsoleLog

start()
