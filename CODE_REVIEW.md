# Adversarial code review — claudefob (branch `build`)

Reviewer: second-pass hostile review after Opus sign-off. Scope: secret leakage, atomic
writes, shell injection, store integrity, platform breakage, exit codes, test vacuity.

Verdict: **not clean** — 4 major findings, 0 blockers, several minors. No secret-leak or
shell-injection path was found; quoting in all three dialects is correct and verified.

---

## Major findings

### M1. `list` reads every secret from the keystore — direct SPEC violation
`src/cli.ts` (listCommand): for each token it calls `keystore.get(t.name)` to compute the
`⚠ missing` marker. SPEC §2 ("`list` and `status` read only this file, so they are instant
and never trigger a keystore prompt") and §4.2 ("Metadata only — no keystore read") both
forbid this. Consequences: on Linux, `claudefob list` can pop a Secret Service unlock
prompt; on macOS an unauthorized binary can pop one keychain-access dialog *per token*;
and the full secret values are pulled into process memory just to compare against `null`.

Note: the SPEC is self-contradictory here — §4.2 also demands the `⚠ missing` marker,
which cannot be computed without touching the keystore. This must be resolved in SPEC.md
(e.g. mark missing only in `status`/`use`, or make the drift check opt-in via a flag);
the implementation silently picked the side the SPEC's rationale explicitly rejects.

### M2. `realKeystore().get` converts every keystore failure into "secret missing", and the CLI then advises token deletion
`src/keystore.ts`: the inner `try { return entry.getPassword() } catch { return null }`
cannot distinguish "no matching entry" from "keystore locked / D-Bus down / access
denied". A transient keystore failure therefore surfaces in `doActivate` as
`Secret for 'x' is missing from the keystore. Try \`claudefob remove x\` and re-add it.`
— destructive advice that leads the user to delete a healthy token's metadata (and the
`remove` path will then also fail to delete the still-present secret if the keystore
recovers oddly, or orphan it). It also makes `list` mark every token `⚠ missing` when
the keystore is merely unavailable, and makes `export` fail silent when it should
(that part is fine) while `use` exits 4 with a misleading message. At minimum inspect
the error (keyring's "No matching entry" class) and raise `KeystoreUnavailableError`
for everything else.

### M3. `guide`'s Windows removal instruction is a no-op
`src/cli.ts` (guideCommand): on win32 it prints
`(Get-Content $PROFILE) | Where-Object { -not $inBlock } | Set-Content $PROFILE`.
`$inBlock` is never assigned anywhere in that pipeline, so `-not $inBlock` is always
`$true`: the command rewrites the profile byte-for-byte and removes nothing. SPEC §4.10
requires working removal instructions. A correct one-liner needs actual fence matching,
e.g. a small `foreach` with state or
`(Get-Content $PROFILE) -notmatch ... ` over a range — as written the user is told a
broken command.

### M4. rc-scan test tests a reimplementation, and the real `guide` scan it "mirrors" is wrong
`tests/rc-scan.test.ts` defines its own `scan()` ("Mirrors the scan logic in cli.ts") and
tests that. The actual code in `guideCommand` is different and buggier:
`start = lines.findIndex(includes '>>>')`, `end = lines.findIndex(includes '<<<')` —
both searched from line 0. With two installed blocks it reports only the first; with a
stale end marker above the block it reports `end < start` (e.g. "lines 40-12"). The test
suite passes while proving nothing about the shipped code — exactly the "tests that pass
without proving anything" class. Extract the scan into a shared function and test that.

---

## Minor findings

### m1. Store read-modify-write has no locking — lost updates under concurrency
`src/store.ts` `saveStore` is atomic (temp + rename, good), but every command does
load → mutate → save with no lock. Two terminals running `add` concurrently: the second
rename wins and the first token's metadata record vanishes while its secret stays in the
keystore (permanent drift, shows as nothing at all — not even `⚠ missing`, since the
record is gone). Same for `use` vs `remove` races. An advisory lockfile (or `wx` +
retry) would close this. No corruption is possible, so minor, but the review focus named
concurrent writes explicitly.

### m2. `status` "this shell" mislabels one case
`src/cli.ts`: env var set but `active === null` reports `inactive`. Per SPEC §4.4
("differing → stale") a set variable with nothing active is a stale shell (e.g. right
after `claudefob stop` in another terminal). Logic:
`else if (!envValue || !active) thisShell = active ? 'stale' : 'inactive'`.

### m3. `~/.claude.json` patch: `VALUE_TOKEN_RE.replace` hits the *first* textual occurrence
`src/claude-config.ts`: `"hasCompletedOnboarding": false` appearing earlier in the file
inside a *string value* (real `~/.claude.json` contains a `history` array of user
prompts — a prompt discussing this very key is plausible) or in a nested object gets
patched instead of the top-level key. The round-trip verification then correctly fails
and nothing is written — fail-safe, no corruption — but the user is told to patch
manually when an automatic patch was possible. Anchor the regex to the known top-level
key position (reuse the depth-scanner you already wrote for duplicate keys).

### m4. Unknown subcommand exits 1, not 2
`claudefob frobnicate` → citty `E_UNKNOWN_COMMAND` → generic `Error` path → exit 1.
SPEC §6 defines 2 as the usage-error code; 1 is reserved for `status` inactive.
Similarly `add` cancelled at the token prompt does `process.exit(2)` — cancellation is
not a usage error (SPEC only defines cancel = 3 for auth); 0 (like the picker cancels
elsewhere) would be more consistent.

### m5. `--json` output goes to stderr
`errJson` writes to stderr, so `claudefob list --json | jq .` reads nothing. This is
arguably forced by the hook wrapper (stdout is eval'ed), but SPEC §3 only routes
*human-facing* output to stderr; machine-readable JSON on stderr deserves an explicit
SPEC note or a `guide` mention (`2>&1 >/dev/null` gymnastics required today).

### m6. `writeAtomic` has no fsync
Both `store.ts` and `claude-config.ts` rename without `fsync` on the temp file (or the
directory). On a crash/power-loss ext4 can legally leave a zero-length `~/.claude.json`
after the rename. Cheap to add for a file the tool promises to modify safely.

### m7. Release bundle still contains `CLAUDEFOB_FAKE_KEYSTORE` string
`dist/cli.js`: the branch is provably dead (`q9(){return!1}` after `--define
__CLAUDEFOB_TEST__=false`), so it is not a bypass, but the two-function split in
`keystore.ts` (`isTestBuild()` + separate env check) defeats the tree-shake that
`auth/index.ts` deliberately achieves with its single inline expression (its
`CLAUDEFOB_FAKE_AUTH` literal *is* absent from dist). Apply the same inline pattern in
`keystore.ts` so a `strings dist/cli.js` audit stays clean.

### m8. PowerShell hook wrapper swallows exit codes and depends on `Get-Command -CommandType Application`
The posix wrapper propagates `return $?`; the PS wrapper does `if ($LASTEXITCODE -ne 0)
{ return }`, so `claudefob use nope; $LASTEXITCODE` inside PowerShell does not reliably
reflect exit 2. Also `(Get-Command claudefob -CommandType Application).Source` assumes
the npm `.cmd` shim resolves as an Application ahead of anything else; if only the
`.ps1` shim is on PATH the lookup throws inside the user's profile function.

### m9. `remove` deletes the keystore entry before saving metadata
If `saveStore` then throws (disk full), the record remains and shows `⚠ missing`
forever with no recovery path except re-running remove (which works — `delete` returning
false is tolerated). Ordering the metadata write first (mirror of `add`'s rollback)
would be symmetric. Low impact.

---

## Verified non-findings (checked hostile, found correct)

- Quoting: posix `'` → `'\''`, fish `\`→`\\` then `'`→`\'` (matches SPEC errata),
  PowerShell `'` → `''`. Token and name cannot break out of single quotes in any
  dialect; names are further constrained by `^[A-Za-z0-9._-]{1,64}$` before ever
  reaching codegen.
- No secret reaches stdout except the deliberate `setEnv` emission; `show` prints to
  stderr; token never in argv (password prompt only, echo off via clack `password`);
  `store.json` stores only `last4`; debug output prints error stacks, and keyring error
  messages carry service/account, not passwords.
- `export` fail-silent: outer `uncaughtException`/`unhandledRejection` handlers force
  exit 0; corrupt store, dead keystore, missing store all verified silent by subprocess
  tests.
- `~/.claude.json` round-trip verification genuinely compares stripped parses and
  refuses to write on any mismatch; duplicate-top-level-key scanner correctly handles
  strings/escapes; empty-object and missing-key insert paths verified by tests.
- Atomic writes use unique temp names (pid + random) in the same directory + rename;
  Windows `renameSync` overwrites; mode preserved on `~/.claude.json`, 0600 on store.
- Windows auth PowerShell source is fed via stdin (never argv), only prints OK/FAIL,
  zeroes the credential buffer; `status`'s `require('node:child_process')` is resolved
  correctly by the bundler in dist.
- console.log rerouted to stderr before citty can print help to stdout; subprocess
  tests assert empty stdout for list/status/guide.
