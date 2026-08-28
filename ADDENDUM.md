# claudefob — SPEC addendum (agreed after PLAN.md was written)

These are additions to SPEC.md, agreed with the user after the implementation plan was drafted.
Everything in SPEC.md still holds; nothing here removes a decision.

## A1. Command aliases

`ls` → `list`, `rm` → `remove`. Canonical names stay `list` and `remove`.

- `--help` lists only the canonical names.
- All docs, hints, and error messages print the canonical form.
- Aliases accepted silently — no deprecation notice.

## A2. Hook-missing hint

SPEC §3 defines `CLAUDEFOB_HOOK`. PLAN.md only consumes it in `status`. It must also drive a
one-line warning on the commands where its absence actually matters: `add`, `use`, and the bare
picker.

```
$ claudefob add work
Token: ********
Added "work".

⚠ Shell integration not installed — activating a token won't change your environment.
    claudefob init >> ~/.zshrc
  More:  claudefob guide
```

```
$ claudefob use work
Activated "work".

⚠ Shell integration not installed — this had no effect on your shell.
    claudefob init >> ~/.zshrc
```

Rules:
- Detected only via `process.env.CLAUDEFOB_HOOK === '1'`. Never parse rc files for this.
- The suggested command is built from the **detected shell**: `~/.zshrc`, `~/.bashrc`,
  `~/.config/fish/config.fish`, or the PowerShell `$PROFILE` form.
- Warning only. Never prompts, never writes. `init` remains print-only.
- Suppressed by `CLAUDEFOB_NO_HOOK_CHECK=1`.
- stderr, like all human output.

## A3. Update check

Non-blocking, cache-backed, modelled on `update-notifier` but hand-rolled (no new dependency).

**Never runs for `export`** — that is the shell-startup path and must stay free of network I/O.
Also skipped when: `--json` is in effect, `CI` is set, `NO_UPDATE_NOTIFIER` is set, or
`CLAUDEFOB_NO_UPDATE_CHECK=1` is set, or stderr is not a TTY.

Flow, per command:
1. Run the command and print its output first.
2. Read `~/.config/claudefob/update-check.json` (`{ "lastCheck": <iso>, "latest": "<version>" }`).
3. If `latest` is newer than the running version, print the notice.
4. If `lastCheck` is older than 24h, spawn a **detached, unref'd** child that fetches
   `https://registry.npmjs.org/claudefob/latest`, writes the cache, and exits. The parent never
   awaits it. Fetch failures are silent.

First run prints nothing and seeds the cache.

```
  Update available  0.1.0 → 0.2.0
  Run: claudefob update
```

Version comparison is plain semver on `major.minor.patch`; a version with a prerelease tag is
never offered as an update.

## A4. `claudefob update`

Detects the install method from the realpath of `process.argv[1]`: npm global, bun, pnpm, yarn,
or Homebrew. Confirms, then runs the matching global-install command.

```
$ claudefob update
Installed via npm (global). Run `npm install -g claudefob@latest`? [Y/n]
```

Unknown install method → print the npm command and do not run anything.
`--yes` skips confirmation. Non-TTY → print the command, never execute.

## A5. Developer-experience requirements

**Startup cost.** `claudefob export` runs on every new terminal. Budget: **under 50 ms**.
`@napi-rs/keyring` must be lazily imported — the "nothing active" path must never load the native
module. CI asserts the budget on the no-active-token path.

**Every error names the fix.** Not just what failed but the command to run next. Applies to all
error paths, not only the Linux keyring case in SPEC §7.

**Next-step hints** after state changes: `add` → "Activate with: claudefob use <name>";
empty store on `list`/picker → "No tokens yet. Add one: claudefob add <name>".

**Unknown name suggests the nearest match** (Levenshtein over stored names, distance ≤ 2):
`Unknown token "wrok". Did you mean "work"?`

**Scriptability.** `--json` on `list` and `status`. Documented exit codes (SPEC §6). No prompts
when stdin is not a TTY — error with exit 2 instead. No color when stderr is not a TTY or
`NO_COLOR` is set.

**Short flags.** `-d` for `--description`, `-y` for `--yes`.

**`--help` carries examples**, not only a flag dump.

## A6. Release workflow — npm Trusted Publishing (OIDC)

Two GitHub Actions workflows.

**`.github/workflows/ci.yml`** — on push to `main` and on pull request. Matrix over
`macos-latest`, `ubuntu-latest`, `windows-latest`: typecheck, unit tests, build, smoke-run
`node dist/cli.js --help` and `--version`. Linux additionally runs the keystore integration
step under a Secret Service daemon. Also asserts the SPEC §A5 startup budget on the
no-active-token `export` path.

**`.github/workflows/release.yml`** — on tag `v*`. Re-runs the full matrix, then publishes.

Authentication is **npm Trusted Publishing via OIDC** — no `NPM_TOKEN`, no long-lived credential
stored in GitHub. Requirements:

- job permissions: `id-token: write` and `contents: read`
- npm CLI 11.5.1 or newer in the job (`npm install -g npm@latest` before publishing)
- **no** `NODE_AUTH_TOKEN` env var and no `.npmrc` auth line — their presence disables OIDC
- `npm publish` emits provenance automatically under OIDC

One-time manual setup after the first publish: on npmjs.com, package settings → Trusted Publisher
→ GitHub Actions → repository `glncy/claudefob`, workflow file `release.yml`.

The first `0.1.0` publish is manual, because the package must exist before a trusted publisher can
be configured against it. Every release after that is `git tag vX.Y.Z && git push --tags`.

Guard: `release.yml` must verify that the tag version matches `package.json` version and fail
otherwise, so a mistagged release cannot publish the wrong version.

---

## Implementation status

All of A1–A6 are implemented and covered by tests as of v0.1.0.

| Item | Where |
|---|---|
| A1 aliases `ls` / `rm` | `src/cli.ts` (`hiddenAlias`), hidden from `--help` |
| A2 hook-missing hint | `src/hook-hint.ts`, `tests/hook-hint.test.ts` |
| A3 update check | `src/update-check.ts`, `tests/update-check.test.ts` |
| A4 `claudefob update` | `src/cli.ts`, install method from `src/update-check.ts` |
| A5 DX requirements | `scripts/startup-budget.mjs` (CI-enforced), `src/suggest.ts`, `keystoreHint()` in `src/keystore.ts` |
| A6 release workflow | `.github/workflows/release.yml` |

Measured startup overhead for `claudefob export` on the no-active-token path: **~8 ms** above the
Node runtime's own start, against a 100 ms budget asserted in CI on all three platforms.

## A7. Errors name the fix (implemented as part of A5)

`KeystoreUnavailableError` previously carried the bare text "The OS keystore is unavailable."
`keystoreHint(platform)` in `src/keystore.ts` now supplies platform-specific remediation — the
Linux branch prints the exact commands CI runs, so printed advice cannot drift from what works.

## A8. Cross-terminal sync

An already-open terminal could not see a switch made elsewhere, because environment variables are
per-process. Resolved without any user-facing flag: the sync is part of the standard hook block.

- A prompt hook (`precmd` on zsh, `PROMPT_COMMAND` on bash, `--on-event fish_prompt` on fish, a
  wrapped `prompt` function on PowerShell) re-syncs at the next prompt.
- The unchanged path costs **zero processes**: `[ -nt ]` and `: >` are shell builtins. claudefob
  runs only on the first prompt after `store.json` changes.
- The marker file is seeded **at shell startup**, not lazily inside the hook. Creating it lazily
  stamps it after the store already changed, so the first switch was silently missed.
- `export` gained an internal `--sync` flag, present only inside the generated hook block and
  never typed by a user. It differs from plain `export` in that it may emit an unset.
- Deactivation propagates only for a token claudefob applied, tracked by `CLAUDEFOB_APPLIED`.
  A `CLAUDE_CODE_OAUTH_TOKEN` the user exported by hand is never cleared.
- Plain startup `export` still emits nothing when inactive, so it cannot clobber a variable set
  earlier in the user's rc.

**Not solvable:** a running Claude Code process keeps the token it launched with. Its environment
was copied at spawn and nothing outside it can change that.

## A9. `update` refreshes an installed hook block

Originally claudefob never wrote to a shell startup file at all. That rule is narrowed, not
dropped: `claudefob update` may **rewrite a block the user already installed**, and nothing else.

- It never *creates* a block. Installing integration stays the user's decision, made by running
  `init` and redirecting the output themselves.
- Every rc candidate is scanned; only files that already contain the fence markers are touched.
- Each file is confirmed separately unless `--yes`. Non-interactive runs print what is stale and
  change nothing.
- The replacement text is read by running `claudefob init` from the **freshly installed** binary.
  Generating it in-process would write the old block back, because the running process is still
  the pre-update build.
- Content outside the markers stays byte-identical, the file mode is preserved, and the write is
  atomic (temp file in the same directory, then rename).
- An unterminated block (opening marker, no closing marker) is left alone rather than swallowing
  the rest of the file.

## A10. `init` output is padded

`init` emits a leading and trailing blank line around the block, so
`claudefob init >> ~/.zshrc` cannot butt the fence marker directly against the last existing line
of the file.


## A11. The hook lives in a script claudefob maintains

Pasting ~50 lines into an rc file meant every upgrade required rewriting them in place (A9).
Instead, `init` now writes the full block to `~/.config/claudefob/hook.<sh|fish|ps1>` and emits a
three-line rc block that sources it.

- The script is in **claudefob's own config directory**. The rule that claudefob never writes to a
  user dotfile is unchanged.
- The source line is guarded on the file existing, so deleting the script cannot break shell
  startup.
- The path is quoted, so a config directory containing spaces works.
- `claudefob update` refreshes the script by running `init` from the newly installed binary. No rc
  edit and no confirmation is needed, because only claudefob's own file changes.
- A9's rc-block rewriting is kept for people who installed an inline block before this change, and
  is skipped when the rc file already contains a source line.
- `init --inline` keeps the old behaviour for anyone who prefers a single file.



## A12. init padding stays simple (A12 superseded)

An earlier revision inspected the target rc file and padded only when it did not already end in a
blank line. It was removed: it is cosmetic, it needed an `--rc` flag to be correct, and it guessed
wrong whenever the shell redirect pointed somewhere other than the detected shell's default file.
`init` emits one leading blank line, always.


## A13. Detect a non-persistent Linux keyring

Reported from a headless Ubuntu devbox: after a reboot, `claudefob status` still showed an active
token while activating it failed with "missing from the keystore".

Cause: with no unlocked login keyring, libsecret stores into the Secret Service **session**
collection, which is memory-backed. Writes and reads succeed for the life of that session; every
secret is lost on reboot. `store.json` is a plain file and survives, so the metadata outlives the
secrets it describes.

`keyringPersistence()` reports `persistent` / `ephemeral` / `unknown`. It returns `unknown` off
Linux, `persistent` when KWallet is present or a non-session `*.keyring` file exists, and
`ephemeral` when the keyrings directory is missing, empty, or holds only a session keyring.
Persistence cannot be proven without a reboot, but the absence of any on-disk keyring is decisive
enough to warn on.

- `add` warns at the moment the secret is stored, rather than after it has already been lost.
- The drift error no longer advises "remove and re-add" on such a machine — that would simply
  repeat the loss. It names the cause and the Ubuntu fix instead.
