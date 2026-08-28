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
    claudefob init >> ~/.zshrc && exec zsh
  More:  claudefob guide
```

```
$ claudefob use work
Activated "work".

⚠ Shell integration not installed — this had no effect on your shell.
    claudefob init >> ~/.zshrc && exec zsh
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
