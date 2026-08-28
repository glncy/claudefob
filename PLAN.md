# claudefob — implementation plan

Derived from `SPEC.md` (v1, agreed). SPEC.md is authoritative; this file only says *how*.
Nothing here adds a feature SPEC.md does not have. Explicitly **out of scope, do not build**:
PATH shim, `run` command, `uninstall` command, `--env` flag, auto-writing `init`, backup files,
`--force`/`--no-auth` bypass on `show`.

## 0. Verified prerequisite: clack on stderr

Checked `node_modules/@clack/prompts/dist/index.d.mts`. Every prompt option interface
(`TextOptions`, `PasswordOptions`, `SelectOptions`, `ConfirmOptions`, `NoteOptions`,
`LogMessageOptions`, `SpinnerOptions`, …) extends:

```ts
interface CommonOptions { input?: Readable; output?: Writable; signal?: AbortSignal; withGuide?: boolean }
```

So `output: process.stderr` is supported on every call, and `isTTY(output)` takes the stream too.
**Conclusion: no hand-rolled prompts needed.** The mitigation is structural rather than trusted:
every clack call is funnelled through `src/ui/prompts.ts`, which is the only module in the repo
allowed to import `@clack/prompts`, and it passes `output: process.stderr` / `input: process.stdin`
on every call. A unit test asserts no other `src/**` file imports `@clack/prompts` (grep over
source), so a future contributor cannot leak a prompt onto stdout by calling clack directly.

## 1. stdout/stderr discipline (SPEC §3) — global invariant

**stdout carries only shell code.** Human output, tables, prompts, errors, hints, and the
revealed token from `show` all go to stderr.

Enforcement plan:

- `src/ui/out.ts` exports the *only* sanctioned stdout writer:
  `emitShellCode(code: string): void` — writes `code` plus a trailing `\n` to `process.stdout`.
  It is a no-op on empty string (so `export` with nothing active prints literally nothing).
- Everything else writes via `src/ui/out.ts`'s `err(msg: string): void` → `process.stderr`.
- Lint-style unit test: grep `src/**` for `process.stdout`, `console.log`; the only permitted
  hits are inside `src/ui/out.ts`. `console.log` is banned repo-wide in `src/`.
- citty prints `--help`/`--version` to stdout by default; we override by passing our own
  renderer/`showUsage` that routes to stderr (see §3, cli.ts). Help text on stdout would corrupt
  the eval inside the shell function wrapper.

## 2. Module map, file by file

### `src/paths.ts`
Owns: every filesystem path decision, per OS. Pure, no I/O other than `os.homedir()`.

```ts
export function configDir(env = process.env, platform = process.platform): string
export function storePath(): string                    // configDir()/store.json
export function claudeConfigPath(): string             // ~/.claude.json
export interface RcCandidate { path: string; shell: ShellDialect; note: string }
export function rcCandidates(platform?, env?): RcCandidate[]
export function powershellProfilePaths(env?): { ps51: string; ps7: string }
```

- `configDir`: `$XDG_CONFIG_HOME/claudefob` else `~/.config/claudefob` on darwin/linux;
  `%APPDATA%\claudefob` on win32 (fall back to `~/AppData/Roaming/claudefob` if APPDATA unset).
- `rcCandidates` returns the SPEC §4.10 list: `~/.zshrc`, `~/.zprofile`, `~/.zshenv`, `~/.bashrc`,
  `~/.bash_profile`, `~/.profile`, `~/.config/fish/config.fish`, plus both PowerShell profiles on
  Windows. Each carries the `note` explaining when that file applies (login vs interactive, etc.).
- MUST NOT: read or write any file; know about tokens; create directories (that is `store.ts`).
- Takes `env`/`platform` as defaulted parameters purely so unit tests can run all three OS
  variants on any host.

### `src/keystore.ts`
Owns: the only import of `@napi-rs/keyring` in the codebase.

```ts
export const SERVICE = 'claudefob'
export interface Keystore {
  get(name: string): string | null      // null = entry absent
  set(name: string, secret: string): void
  delete(name: string): boolean         // false = nothing to delete
}
export class KeystoreUnavailableError extends Error { cause?: unknown }
export function realKeystore(): Keystore
export function getKeystore(): Keystore          // realKeystore(), or the injected fake
export function __setKeystoreForTests(k: Keystore | null): void
```

- `realKeystore` lazily `require`s `@napi-rs/keyring` inside each method and wraps any throw in
  `KeystoreUnavailableError` (exit code 4 upstream) — on Linux with no Secret Service the throw
  happens at call time, not import time.
- Test injection, two seams with different scopes:
  - `__setKeystoreForTests` — an in-process module-level override, used by unit tests that import
    the modules directly. Not guarded (it cannot be reached without importing the module and
    calling it), and it is unreachable from a spawned CLI.
  - `CLAUDEFOB_FAKE_KEYSTORE=<path>` (a JSON-file-backed fake) — the *subprocess* seam, guarded by
    the same `isTestBuild()` predicate as fake auth (§ auth). Because that predicate is false from
    unbuilt source, this hook is live **only in the test bundle** (`dist-test/cli.js`,
    `bun run build:test`). Every subprocess test therefore spawns `dist-test/cli.js`, never
    `bun src/cli.ts`. Both hooks are dead-code-eliminated from the release bundle.
- MUST NOT: touch `store.json`, prompt, print, or decide exit codes.

### `src/store.ts`
Owns: `store.json` — parse, validate, mutate, persist at mode 0600.

```ts
export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/
export interface TokenRecord { name: string; description?: string; createdAt: string; last4: string }
export interface Store { version: 1; active: string | null; tokens: TokenRecord[] }

export function emptyStore(): Store
export function loadStore(): Store                    // missing file -> emptyStore()
export function saveStore(s: Store): void             // mkdir -p 0700, write 0600, atomic rename
export class CorruptStoreError extends Error { path: string }

export function findToken(s: Store, name: string): TokenRecord | undefined
export function addToken(s: Store, rec: TokenRecord): Store      // throws on duplicate name
export function removeToken(s: Store, name: string): Store       // also clears active if it matched
export function setActive(s: Store, name: string | null): Store
export function validateName(name: string): void                 // throws UsageError on !NAME_RE
export function validateDescription(d?: string): void            // max 200 chars
export function last4(token: string): string
export function mask(rec: TokenRecord): string                   // e.g. `sk-ant-…O4DA` shape: `…` + last4
```

- Mutators are **pure**: take a `Store`, return a new `Store`. Only `saveStore` does I/O. This is
  what makes store mutations trivially unit-testable.
- `loadStore`: `ENOENT` → `emptyStore()`. Malformed JSON, wrong `version`, or a shape that fails
  validation → `CorruptStoreError` carrying the path (SPEC §7: reported, never silently recreated).
- `saveStore`: `mkdirSync(dir, { recursive: true, mode: 0o700 })`, write temp file in the same dir
  with `mode: 0o600`, `fs.renameSync` over the target, then `chmodSync(0o600)` defensively (Windows
  ignores the mode; that is acceptable — `%APPDATA%` is already per-user).
- MUST NOT: contain a secret value at any point; call the keystore; print; prompt.

### `src/claude-config.ts` (SPEC §4.12 — correctness-critical)
Owns: the `~/.claude.json` onboarding fix. Called **only** on activation (`use`, bare `claudefob`).

```ts
export type OnboardingResult =
  | { kind: 'already-ok' }            // hasCompletedOnboarding === true, no write performed
  | { kind: 'created' }               // file was absent, created with {"hasCompletedOnboarding": true}
  | { kind: 'patched' }               // verified round trip, atomic rename done
  | { kind: 'verify-failed'; reason: string }   // NOTHING written, caller prints manual fix
  | { kind: 'error'; reason: string }           // unreadable/unwritable, NOTHING written

export function ensureOnboarding(path = claudeConfigPath()): OnboardingResult
export function buildPatched(originalText: string): { text: string; ok: boolean; reason?: string } // exported for tests
```

Algorithm, exactly as SPEC §4.12:

1. Read the file as **text**. `ENOENT` → write `{"hasCompletedOnboarding": true}\n` atomically →
   `created`. Any other read error → `error`, no write.
2. `JSON.parse`. Not an object / parse failure → `verify-failed` with the reason; never overwrite a
   file we cannot understand.
3. `parsed.hasCompletedOnboarding === true` → `already-ok`, **return without writing at all**
   (not even a no-op rewrite — a rewrite would reformat someone's file).
4. Otherwise build the new text. Preferred strategy is a **minimal textual edit**, not a
   re-serialize: if the key already exists, regex-replace only its value token in place, preserving
   all surrounding whitespace and key order. If the key is absent, insert `"hasCompletedOnboarding": true`
   as the first member of the top-level object, matching the file's detected indentation.
5. **Round-trip verification before writing.** Parse both `originalText` and `newText`. Deep-compare
   the two objects after deleting `hasCompletedOnboarding` from each: they must be structurally
   identical (same keys, same order via `Object.keys` sequence, same values, recursively). Also
   assert `JSON.parse(newText).hasCompletedOnboarding === true`. Any mismatch → `verify-failed`,
   **write nothing**.
6. Write atomically: temp file `<dir>/.claude.json.claudefob-<pid>-<rand>` in the **same directory**
   (so `rename` stays on one filesystem), copy the original file's mode when it existed (else 0600),
   `fs.renameSync` onto the target. On any error unlink the temp and return `error`.
7. **No backup file is ever created.** Verification is the safety mechanism (SPEC §4.12.5).

Two degenerate inputs, specified explicitly because this module is correctness-critical:

- **Existing value is not a boolean** (`"hasCompletedOnboarding": "yes"`, an object, an array, a
  number). The "value token" regex is defined only for the literals `true` / `false` / `null`;
  anything else takes the same path as a regex miss → `verify-failed` with the manual fix, **write
  nothing**. We never attempt a multi-token in-place replace.
- **Duplicate top-level keys** in the original (`{"a":1,"a":2}`). `JSON.parse` silently keeps the
  last, so a textual edit that dropped one duplicate would still deep-compare equal and pass
  verification while changing the file. Guard: before verifying, scan the top level of the original
  text for repeated key names; any duplicate → `verify-failed`, write nothing.

Both go into the §4.12 test matrix with accepted outcome `verify-failed` + file byte-identical.

- MUST NOT: be invoked by `stop`, `remove`, `status`, `list`, `show`, `export`, `init`, `guide`.
  A unit test asserts `stop` does not touch the file (mtime + content unchanged).

### `src/shell/index.ts`
Owns: dialect type, detection, and dispatch to the three dialect modules.

```ts
export type ShellDialect = 'posix' | 'fish' | 'powershell'
export interface ShellCodegen {
  id: ShellDialect
  setEnv(name: string, value: string): string
  unsetEnv(name: string): string
  quote(value: string): string
  hookBlock(): string            // the fenced §3 block for `init`
}
export function codegenFor(d: ShellDialect): ShellCodegen
export function detectShell(env = process.env, platform = process.platform,
                            parentName?: string): ShellDialect
export function parseShellFlag(raw: string): ShellDialect   // throws UsageError; 'cmd' -> the §12 message
export function parentProcessName(): string | undefined
```

- Detection order (SPEC §4): parent process name → `$SHELL` basename → platform default
  (`posix` on darwin/linux; on win32 `powershell` unless `MSYSTEM` is set, then `posix`).
- `parentProcessName()`: `ps -o comm= -p <ppid>` on posix; on Windows `wmic`/`Get-CimInstance` is
  slow and unreliable, so we skip the parent probe there and fall straight through to `$SHELL` /
  platform default. Any failure is swallowed and returns `undefined` — detection must never throw.
- `parseShellFlag('cmd')` throws a `UsageError` (exit 2) with the SPEC §12 explanation pointing at
  PowerShell.
- MUST NOT: read the keystore or store; print anything; know the variable name is a token.

### `src/shell/posix.ts`, `fish.ts`, `powershell.ts`
Each exports one `ShellCodegen`. The whole point of the split: **adding a shell touches one file.**

| dialect | set | unset | quoting |
|---|---|---|---|
| posix | `export CLAUDE_CODE_OAUTH_TOKEN='<q>'` | `unset CLAUDE_CODE_OAUTH_TOKEN` | wrap in `'`, replace every `'` with `'\''` |
| fish | `set -gx CLAUDE_CODE_OAUTH_TOKEN '<q>'` | `set -e CLAUDE_CODE_OAUTH_TOKEN` | wrap in `'`, replace `\` → `\\` then `'` → `\'` (fish single quotes honour backslash escapes, so `'\''` is **wrong** here) |
| powershell | `$env:CLAUDE_CODE_OAUTH_TOKEN='<q>'` | `Remove-Item Env:\CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue` | wrap in `'`, replace every `'` with `''` |

> Note for review: SPEC §3 says "`'\''` posix/fish". For fish that is literally correct only
> because fish also accepts `\'`; `'\''` inside fish single quotes yields a backslash. The plan
> follows the SPEC's *intent* (a correctly escaped single quote) with the dialect-correct form and
> pins it with a real `fish -c` assertion in the integration test. Flagged here rather than
> silently deviating.

Escaping is applied **unconditionally**, never conditionally on whether the value contains a quote.
Each module also owns its `hookBlock()`: the posix block is verbatim SPEC §3. fish and PowerShell
carry the equivalent idiom and **must mirror the posix semantics exactly** — propagate the CLI's exit
status and eval only a non-empty, successful result. An unconditional `eval` of a failed run is
precisely the bug SPEC §3's `|| return $?` exists to prevent:

```fish
# >>> claudefob >>>
set -gx CLAUDEFOB_HOOK 1
eval (command claudefob export --shell fish)
function claudefob
    set -l __cf_out (command claudefob $argv --shell fish)
    or return $status
    test -n "$__cf_out"; and eval $__cf_out
end
# <<< claudefob <<<
```

```powershell
# >>> claudefob >>>
$env:CLAUDEFOB_HOOK = '1'
$__cf = (claudefob export --shell powershell | Out-String)
if ($__cf.Trim()) { Invoke-Expression $__cf }
function claudefob {
    $__cf_out = & (Get-Command claudefob -CommandType Application).Source @args --shell powershell
    if ($LASTEXITCODE -ne 0) { return }
    if ($__cf_out) { ($__cf_out -join "`n") | Invoke-Expression }
}
# <<< claudefob <<<
```

All three bake `--shell` in as a literal so shell startup never depends on detection. SPEC §4.11
makes `export` fail silent (exit 0, no output) when nothing is active, so the startup line can
never abort a shell. posix `eval ""` and fish `eval` with empty input are both no-ops, but
PowerShell's `Invoke-Expression` rejects an empty string
(`ParameterArgumentValidationErrorEmptyStringNotAllowed`) and would print a red error at every
shell start, so the PowerShell startup line is guarded with `if ($__cf.Trim())` — the same guard
the function wrapper uses.

### `src/auth/index.ts` (SPEC §5 — mandatory, no bypass)

```ts
export interface AuthBackend { id: string; describe(): string; challenge(): Promise<boolean> }
export class AuthUnavailableError extends Error {}
export function selectBackend(platform = process.platform): AuthBackend   // throws AuthUnavailable
export function isFakeAuthEnabled(): boolean     // CLAUDEFOB_FAKE_AUTH === '1' && isTestBuild()
```

- `challenge()` resolves `true` only on a clean success; **cancellation, timeout, unavailable
  mechanism, and failure all resolve `false` or throw**, and both lead to exit 3 with nothing on
  stdout or stderr except the error line naming the OS fallback (Keychain Access / seahorse /
  Credential Manager).
- **No bypass exists.** There is no flag, no env var, and no code path in `show` that skips
  `challenge()`. The only substitute is the CI hook, and it requires **three** independent
  conditions to hold at once:

```ts
declare const __CLAUDEFOB_TEST__: boolean | undefined   // defined only by a built bundle
export function isFakeAuthEnabled(): boolean {
  if (process.env.CLAUDEFOB_FAKE_AUTH !== '1') return false      // 1. explicit opt-in
  if (typeof __CLAUDEFOB_TEST__ === 'undefined') return false    // 2. not a built bundle at all
  return __CLAUDEFOB_TEST__ === true                             // 3. and it is the *test* bundle
}
```

  `package.json` carries two build scripts: `build` defines `__CLAUDEFOB_TEST__` as `false`
  (so the branch is dead-code-eliminated out of `dist/`) and `build:test` defines it as `true`,
  emitting `dist-test/cli.js`. `dist-test/` is git-ignored and never published (`files` in
  `package.json` lists `dist` only). Deliberate consequences, each pinned by a test:
  - Running **unbuilt source** (`bun src/cli.ts`) leaves the constant undefined, so the `typeof`
    guard returns `false` — `CLAUDEFOB_FAKE_AUTH=1` is inert from source. It must never default to
    `true`, which would be a bypass-adjacent hole for anyone running from a checkout. The bare
    identifier is safe only because it is reached exclusively through `typeof`.
  - Running `dist/cli.js` with `CLAUDEFOB_FAKE_AUTH=1` **must still fail** the auth gate. A test
    asserts this against the real release bundle.
  - Consequently `CLAUDEFOB_FAKE_AUTH=1` is inert against `bun src/cli.ts` **and** against
    `dist/cli.js`. Any test that must get past `show`'s auth gate in a subprocess therefore runs
    the **test bundle** — `dist-test/cli.js`, produced by
    `bun run build:test` (`bun build src/cli.ts --target node --define __CLAUDEFOB_TEST__=true
    --outdir dist-test --external @napi-rs/keyring`). In-process unit tests that import
    `auth/index.ts` directly may substitute an `AuthBackend` through the module seam; that seam
    cannot cross a process boundary and is never claimed to.
  - A unit test greps the release bundle for the string `CLAUDEFOB_FAKE_AUTH` and asserts it is
    absent.
- All backends spawn with `stdio: 'inherit'` so the OS prompt draws on the real TTY and **no
  password ever passes through our process**.

### `src/auth/darwin.ts`

```ts
export function isAdmin(user = os.userInfo().username): boolean   // `id -Gn <user>` contains 'admin'
export function darwinBackend(): AuthBackend
```

- Admin detection at runtime via `id -Gn` (parse group names; also accept `dscl . -read /Groups/admin GroupMembership` as fallback). Failure to determine → assume **non-admin** (the `dscl` path needs no privileges, so it is the safe default).
- admin → `sudo -k -v` (the `-k` is mandatory: it forces a fresh prompt, defeating a cached
  sudo timestamp — without it `show` would be a no-op gate).
- non-admin → `dscl . -authonly <username>`; exit 0 = success, non-zero = failure. Local accounts
  only; a non-zero exit for a network account is reported as auth failure with the OS fallback hint.
- v2 note only, **not implemented**: LocalAuthentication shim.

### `src/auth/linux.ts`
`pkexec /bin/true`. Exit 0 success; 126/127 = dismissed/not authorized → failure; `ENOENT` on
`pkexec` → `AuthUnavailableError` (exit 3) naming seahorse. Docs mention the optional `auth_self`
policy file but the tool never installs it.

### `src/auth/win32.ts`
`CredUIPromptForWindowsCredentials` + `LogonUser`, P/Invoke compiled at runtime through PowerShell
`Add-Type`. The C# source lives as a template string in this file; we spawn
`powershell -NoProfile -ExecutionPolicy Bypass -Command -` and feed the script on stdin (keeping it
out of argv). **`-NonInteractive` is deliberately omitted** — interactive is the default, and the
`-Switch:$false` colon form is PowerShell *parameter-binding* syntax that `powershell.exe`/`pwsh.exe`
reject as an unrecognised argument on a native command line, which would make the backend fail to
launch and (since there is correctly no bypass) render `show` unusable on Windows. The exact spawn
line is verified by hand on Windows, and CI runs a `windows-latest` smoke test that pipes only the
`Add-Type` compile step (no dialog call) and asserts it compiles and exits 0. `LOGON32_LOGON_NETWORK` + `LOGON32_PROVIDER_DEFAULT`
so no admin rights are needed. The credential buffer is zeroed and `CoTaskMemFree`d before return;
the script's stdout is only `OK` / `FAIL` — **the password is never echoed back to us**. User
dismissal of the dialog → failure.

### `src/ui/*` — all on stderr
- `ui/out.ts` — `emitShellCode(code)` (the only stdout writer), `err(line)`, `errJson(obj)`.
- `ui/colors.ts` — picocolors wrappers; auto-disable when `!process.stderr.isTTY` or `NO_COLOR`.
- `ui/prompts.ts` — the only importer of `@clack/prompts`. Exports
  `selectToken(title, options, initial)`, `passwordPrompt(message)`, `confirmPrompt(message)`,
  `isCancelled(v)`, `note(msg)`, `intro/outro`. Every call passes
  `{ input: process.stdin, output: process.stderr }`. `requireTTY()` throws `UsageError` (exit 2)
  when `!process.stdin.isTTY || !process.stderr.isTTY`.
- `ui/table.ts` — pure string formatter (`renderTable(rows, cols): string`), unit-testable, no I/O.
- `ui/errors.ts` — `UsageError` (2), `AuthError` (3), `KeystoreError` (4), plus
  `reportAndExit(e): never` mapping error → stderr line + exit code.

### `src/cli.ts`
citty `defineCommand` tree; **no platform code, no `fs`, no keyring import**. Owns argument
parsing, orchestration, and exit codes only.

- `main` with subcommands `add`, `list`, `show`, `status`, `use`, `stop`, `remove`, `init`,
  `guide`, `export`. Bare invocation (no subcommand) → the activate picker (§4.5).
- `export` is hidden from help (citty `meta.hidden`) — it is an internal hook command.
- Global flags: `--shell`, `--json`, `--help`, `--version`. Help/usage rendering routed to stderr.
- Every command body is wrapped in a single `try/catch` → `reportAndExit`, so exit codes live in
  exactly one place.
- The one exception is `export`, which has its **own** outermost try/catch that swallows
  *everything* and `process.exit(0)` with no output (see §4 below).

## 3. Command implementations, with the correctness-critical bits

| cmd | stdout | stderr | exit |
|---|---|---|---|
| `add` | — | prompt + confirmation | 0 / 2 / 4 |
| `list` | — | table or JSON | 0 |
| `show` | — | the token | 0 / 2 / 3 / 4 |
| `status` | — | report or JSON | 0 active, 1 inactive |
| bare / `use` | export stmt | confirmation + onboarding note | 0 / 2 / 4 |
| `stop` | unset stmt | confirmation | 0 |
| `remove` | unset stmt (if it was active) | confirm | 0 / 2 / 4 |
| `init` | the hook block | guidance | 0 |
| `guide` | — | everything | 0 |
| `export` | export/unset stmt | — (nothing, ever) | **always 0** |

- **`add`**: validate name (regex, duplicate) *before* prompting. Token via
  `passwordPrompt` (echo disabled) — **never an argv parameter**; reject empty/whitespace-only
  (exit 2, no writes). **Cancelled prompt** (Ctrl-C / clack `isCancel`): no keystore write, no store
  write, **zero bytes on stdout** — it runs inside the shell wrapper, which would `eval` anything we
  printed — one `Cancelled.` line on stderr, and **exit 2** (a cancelled `add` did not do what was
  asked, so it is not exit 0). Covered by `tests/streams.test.ts`. Keystore write first, then
  `saveStore` — if the store write fails the keystore entry is rolled
  back with `delete`. Does not activate.
- **`list`**: metadata-only for every displayed column (name, description, added, masked token,
  `●` active) — the masked token comes from the stored `last4`, so the common path makes **no
  keystore call and triggers no OS prompt**, which is the whole point of the two-tier split
  (SPEC §2). The `⚠ missing` marker is the single exception and requires an existence probe:
  `keystore.get(name)` inside try/catch, marking the row only on a definite `null`. On
  `KeystoreUnavailableError` the row renders unmarked rather than the command failing — `list` must
  stay usable on a machine with no Secret Service.
- **`show`**: (1) resolve name — picker headed `Select a token to reveal` when omitted; a cancelled
  pick returns exit 0 having issued **no** auth challenge; (2) `selectBackend().challenge()`;
  (3) on `false`/throw → exit 3, print nothing but the error naming the OS fallback; (4) on success
  read the secret and `err(token)` — **stderr**, so `$(claudefob show x)` captures nothing.
- **`status`**: reads store only; `hookInstalled = process.env.CLAUDEFOB_HOOK === '1'`;
  `thisShell` compares `last4(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '')` to the record's `last4`
  → `inactive` / `in sync` / `stale`. On Windows also reports execution policy
  (`Get-ExecutionPolicy -Scope CurrentUser`) when it is `Restricted`. Exit 1 when inactive.
- **bare / `use`** — *order is correctness-critical: nothing is committed until the secret is in
  hand.* Exact sequence:
  1. Resolve the name (picker when omitted; picker requires a TTY, else exit 2). Cancel → exit 0,
     nothing written, nothing emitted.
  2. Look up the metadata record. Unknown name → exit 2, **no writes**.
  3. **Read the secret from the keystore.** `null` (drift: record present, secret gone) → exit 4;
     `KeystoreUnavailableError` → exit 4. In both cases `store.json` and `~/.claude.json` are left
     **byte-identical** — activation must not commit a broken token (SPEC §7: "`use` exits 4").
  4. Only now: `setActive` → `saveStore`.
  5. `ensureOnboarding()` (SPEC §4.12). Report the outcome on stderr when it changed anything; on
     `verify-failed` print the manual fix. A failed onboarding fix does **not** roll back step 4 and
     does not change the exit code — activation itself succeeded.
  6. `emitShellCode(setEnv(VAR, secret))`.

  Tested: `use` against a record whose secret is missing, and against a throwing keystore, must
  exit 4 with `store.json` and `~/.claude.json` unchanged (compare bytes and mtime) and stdout
  empty.
- **`stop`**: `setActive(null)` → save → `emitShellCode(unsetEnv(...))`. Idempotent. **Never opens
  `~/.claude.json`.**
- **`remove`**: picker/confirm (skipped with `--yes`), delete the keystore entry, then `removeToken`
  in the metadata, and if it had been active emit the unset. **Keystore-first, deliberately**, so we
  never orphan a live secret with no metadata record pointing at it. Two distinct keystore outcomes:
  - *Entry already missing* (drift; SPEC §7 "`remove` still works") → tolerated, proceed to delete
    the metadata record, exit 0.
  - *`KeystoreUnavailableError`* (no Secret Service, unreachable keychain) → **exit 4 with
    `store.json` untouched.** SPEC §7 only covers the drift case; this is the unspecified hard
    failure. Leaving the metadata alone keeps the record and the (probably still-present) secret
    consistent, so a retry once the keystore is back does the right thing. Added to the exit-code
    table above and to `tests/`: throwing-keystore fake + `remove --yes` → exit 4, store
    byte-identical.
- **`init`**: `emitShellCode(hookBlock())` to stdout, guidance to stderr. **Never writes a file.**
- **`guide`**: read-only. Detect OS+shell, print install steps, the rc-file table with `when each
  applies`, then a scan: read each candidate, find `# >>> claudefob >>>` / `# <<< claudefob <<<`,
  report path + line numbers, and a **platform-correct** removal one-liner (`guide` already knows the
  OS, so it must not print GNU syntax on macOS, where BSD `sed -i` consumes the next word as a backup
  suffix and then fails with `extra characters at the end of d command`):
  - linux / Git Bash / WSL: `sed -i '/# >>> claudefob >>>/,/# <<< claudefob <<</d' <file>`
  - darwin (BSD sed): `sed -i '' '/# >>> claudefob >>>/,/# <<< claudefob <<</d' <file>`
  - windows: a PowerShell equivalent — a small state-machine over `Get-Content $PROFILE` that drops
    the lines between the two fences inclusive and writes back with `Set-Content`.

  A unit test asserts the emitted one-liner matches the platform passed in, and that each variant
  actually removes the fenced block from a fixture file on its own platform. Warn to run `claudefob stop` first when a token is active. Never prompts,
  never edits.

## 4. `export` — fail silent (SPEC §4.11), correctness-critical

```ts
async function runExport(shell: ShellDialect) {
  try {
    const s = loadStore()
    if (!s.active) return                      // no output, exit 0
    const rec = findToken(s, s.active); if (!rec) return
    const secret = getKeystore().get(s.active); if (!secret) return
    emitShellCode(codegenFor(shell).setEnv(VAR, secret))
  } catch (e) { debug(e) }                     // swallow: corrupt store, missing store, dead keystore
  // no finally-throw path; process exits 0
}
```

- Wrapped so that **every** failure mode — missing `store.json`, corrupt JSON, `@napi-rs/keyring`
  failing to load, no Secret Service, a locked keychain — produces exit 0 and zero bytes on stdout.
  A broken keystore must never break shell startup.
- `debug(e)` writes to stderr **only** when `CLAUDEFOB_DEBUG=1`.
- `export` never prompts, never runs auth, never touches `~/.claude.json`, and never emits the
  unset statement (an inactive state prints nothing at all — the shell had nothing set).
- A `process.on('uncaughtException')`/`unhandledRejection` guard installed for this subcommand only,
  exiting 0, covers a throw from native code outside the try.

## 5. Exit codes (SPEC §6)
`0` success · `1` `status` inactive · `2` usage (unknown/duplicate/malformed name, bad flag, `--shell cmd`,
no TTY where required) · `3` auth failed/cancelled/unavailable · `4` keystore unavailable or secret
missing on activation. Centralised in `ui/errors.ts`; `export` overrides everything to 0.

## 6. Test suite (SPEC §11) — `tests/`, `bun test`

Runs on **any** OS: no keystore, no auth, no real shells required.

- `tests/shell-codegen.test.ts` — set/unset per dialect; quoting table incl. `a'b`, `''`,
  backslashes, newline, unicode; asserts escaping is unconditional; asserts `--shell cmd` → exit 2.
- `tests/shell-detect.test.ts` — detection matrix over `(platform, $SHELL, MSYSTEM, parentName)`.
- `tests/store.test.ts` — add/remove/setActive purity, duplicate rejection, name regex bounds
  (1/64/65 chars, illegal chars), description >200, corrupt JSON → `CorruptStoreError` with path,
  missing file → empty store, 0600 mode assertion (skipped on win32).
- `tests/claude-config.test.ts` — **the §4.12 matrix**: missing file → created; `true` → no write
  at all (mtime unchanged); `false` → patched; absent key → inserted; comments/trailing-garbage
  file → `verify-failed`, file byte-identical afterwards; a file whose patch would reorder or drop
  a key → `verify-failed`; a non-boolean existing `hasCompletedOnboarding` → `verify-failed`;
  a duplicate-top-level-key fixture → `verify-failed`; nested-object preservation; atomic-rename leaves no temp file behind;
  and `stop` never opens the file.
- `tests/mask.test.ts` — `last4` and masking, incl. tokens shorter than 4 chars.
- `tests/rc-scan.test.ts` — fenced-block detection with correct line numbers, multiple blocks,
  unterminated block, absent file.
- `tests/streams.test.ts` — spawns the **test bundle** `dist-test/cli.js <cmd>` (built by
  `bun run build:test`, the only bundle where `__CLAUDEFOB_TEST__` is `true`) with
  `CLAUDEFOB_FAKE_KEYSTORE` and `CLAUDEFOB_FAKE_AUTH=1`; both hooks are inert from source and in
  `dist/`, so a subprocess test cannot use `bun src/cli.ts` (see §2 `auth/index.ts`). The suite
  skips with a clear message if `dist-test/cli.js` is absent. It asserts **stdout is empty** for `add`/`list`/`show`/`status`/`guide`, and
  contains *only* shell code for `use`/`stop`/`init`/`export`. Also: a cancelled `add` (fake prompt
  returning clack's cancel symbol) → empty stdout, exit 2, store unchanged; and `use` on a record
  whose secret is missing → empty stdout, exit 4, `store.json` and `~/.claude.json` byte-identical.
- `tests/export-silent.test.ts` — corrupt store, absent store, and a keystore fake that throws:
  each must give exit 0 and empty stdout; with `CLAUDEFOB_DEBUG=1` stderr is non-empty.
- `tests/no-stray-stdout.test.ts` + `tests/no-direct-clack.test.ts` — source greps enforcing §1.
- Fakes in `tests/helpers/`: `fakeKeystore.ts` (Map-backed, plus throwing and empty variants),
  `fakeAuth.ts`, `tmpHome.ts` (per-test `HOME`/`XDG_CONFIG_HOME`/`APPDATA` sandbox).

## 7. CI — `.github/workflows/ci.yml`

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run build:test            # dist-test/cli.js — __CLAUDEFOB_TEST__=true; the only
                                           # bundle in which CLAUDEFOB_FAKE_* hooks are live
      - run: bun test                      # unit tests (pure) + subprocess tests driving dist-test/cli.js
      - run: bun run build                 # dist/cli.js — the release bundle, hooks dead-code-eliminated
      - name: integration (macos)
        if: matrix.os == 'macos-latest'
        timeout-minutes: 5
        run: |
          security unlock-keychain -p "" "$HOME/Library/Keychains/login.keychain-db" || \
            security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"
          node scripts/integration.mjs
      - name: integration (windows)
        if: matrix.os == 'windows-latest'
        timeout-minutes: 5
        run: node scripts/integration.mjs
      - name: auth compile smoke (windows)
        if: matrix.os == 'windows-latest'
        run: node scripts/win-authtype-smoke.mjs
      - name: integration (linux)
        if: matrix.os == 'ubuntu-latest'
        timeout-minutes: 5
        run: |
          sudo apt-get update && sudo apt-get install -y gnome-keyring dbus-x11
          dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; node scripts/integration.mjs'
```

- **Linux keystore bring-up.** The bare `gnome-keyring-daemon --unlock` form blocks in the
  foreground and does not necessarily expose a reachable Secret Service, so CI uses the
  known-working pattern: `dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock
  --daemonize --components=secrets; …'`. `--daemonize` makes it fork and print the control env vars
  it sets; because the daemon and the test run inside the *same* `bash -c` under one
  `dbus-run-session`, `DBUS_SESSION_BUS_ADDRESS` is already in the environment and the secrets
  component registers on that bus. If the printed `GNOME_KEYRING_CONTROL` / `SSH_AUTH_SOCK` lines
  turn out to be needed, the step `eval`s them before running the integration test.
- **Reconcile the printed advice with what actually works (SPEC §7 / §11).** SPEC's error text
  (`dbus-run-session -- gnome-keyring-daemon --unlock`) blocks a user's foreground shell and is not
  what CI runs, so the "CI validates the advice" claim does not hold as written. The message the CLI
  prints is therefore the daemonized form:
  `dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; exec $SHELL'`
  (with the usual advice first: log in to a desktop session, or install and start gnome-keyring).
  CI runs the same daemonize+components incantation, so the advice is again the tested path.
  **SPEC errata applied** — see the errata note at the end of this file.
- **macOS runners.** The `macos-latest` login keychain is unlocked for the runner user, but a locked
  or password-prompting keychain would hang the job on a headless machine, so the step explicitly
  `security unlock-keychain`s first and every integration step carries `timeout-minutes: 5` so a
  keychain prompt fails fast instead of burning the job's wall clock.
- `scripts/win-authtype-smoke.mjs` feeds only the `Add-Type` C# template to
  `powershell -NoProfile -ExecutionPolicy Bypass -Command -`, asserting the P/Invoke source compiles
  and that the exact spawn line launches; it never calls `CredUIPromptForWindowsCredentials`.
- `scripts/integration.mjs` (Node, runs the **release** bundle `dist/cli.js` against the *real*
  keystore): store a real token by piping it to `add`'s stdin prompt (no test hook exists in this
  bundle), `use` it, capture stdout, then assert the emitted code actually sets
  the variable in a real shell — `zsh -c`/`bash -c` on macOS/Linux, `pwsh -Command` on Windows,
  and `fish -c` where fish is available (validating the fish quoting note in §2). Auth backends are
  interactive by design and are **not** exercised, so `show` is **not** covered here — against
  `dist/cli.js` `CLAUDEFOB_FAKE_AUTH=1` is dead code. Instead the script asserts the negative:
  `CLAUDEFOB_FAKE_AUTH=1 dist/cli.js show <name>` still exits 3 and prints no token. `show`'s
  success path is covered by `tests/streams.test.ts` against `dist-test/cli.js`.

## 8. README.md

Sections, in order:
1. **One-line description + a bold unaffiliated notice at the very top**: "claudefob is an
   unofficial, community project. It is not affiliated with, endorsed by, or supported by
   Anthropic. 'Claude' and 'Claude Code' are trademarks of Anthropic." Repeated in the footer.
2. Install (`npm i -g claudefob`), then `claudefob init` with the append example per shell.
3. Quick start: `add` → bare `claudefob` picker → `status` → `stop`.
4. Command reference mirroring SPEC §4 (with `export` marked internal).
5. How it works: the stdout-is-shell-code/stderr-is-human split, and why a child process cannot
   set its parent's environment.
6. **Security model — honest, per SPEC §8**, verbatim in substance: what it protects against
   (secrets in dotfiles, dotfile backups, Time Machine, dotfile repos, shell history;
   shoulder-surfing; a person at an unlocked terminal) and, in the same prominence, what it does
   **not** protect against — *any process running as your user can read the keystore through the
   same API and can read an active token out of its own environment; the `show` gate is a speed
   bump against a person, not a sandbox against code.*
7. Platform notes: Linux Secret Service requirement and the `dbus-run-session` fix; Windows
   execution policy and the two profile paths; no cmd.exe support.
8. The `~/.claude.json` onboarding fix — what it changes, that it verifies the round trip, that it
   writes no backup, and the manual fix.
9. Known limitation: already-open shells keep their old value until restarted.
10. License: MIT.

## 9. LICENSE
Standard unmodified MIT text, `Copyright (c) 2026 <author>`, matching `"license": "MIT"` in
`package.json`. A single trademark sentence lives in README, not in LICENSE.

## 10. Build order
`paths` → `store` → `keystore` → `shell/*` → `ui/*` → `claude-config` → `auth/*` → `cli` →
tests → CI → README/LICENSE. Each layer lands with its unit tests before the next starts.


## 11. SPEC errata (agreed corrections, not redesigns)

Two places where SPEC.md is internally inconsistent or factually wrong. Both are corrected in
SPEC.md itself and recorded here; no feature is added or removed.

1. **§3 quoting — fish.** SPEC says single quotes are escaped `'\''` for "posix/fish". Inside fish
   single quotes a backslash is an escape character, so `'\''` yields a literal backslash rather
   than a quote. The dialect-correct fish form is `\` → `\\` then `'` → `\'` (§2 table above).
   SPEC §3 amended to state the per-dialect rule.
2. **§7 / §11 — Linux Secret Service advice.** `dbus-run-session -- gnome-keyring-daemon --unlock`
   blocks the user's foreground shell and does not reliably expose the secrets component. Both the
   printed error and the CI step now use
   `dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; …'`,
   which restores SPEC §11's intent that CI validates the exact advice we print.
