# claudefob — specification

**Status:** v1 design, agreed. **Unofficial.** Not affiliated with or endorsed by Anthropic.

Cross-platform CLI that keeps several Claude Code OAuth tokens in the OS keystore and
activates exactly one as `CLAUDE_CODE_OAUTH_TOKEN`. Replaces hand-editing
`export CLAUDE_CODE_OAUTH_TOKEN=…` in a shell rc file.

## 1. Goals / non-goals

Goals: multiple tokens encrypted at rest in the OS keystore; activate one so it is present in
every shell opened thereafter; deactivate cleanly; macOS + Linux + Windows from one codebase;
no secret in shell history, argv, or any plaintext file.

Non-goals (v1): more than one token active at once; any variable other than
`CLAUDE_CODE_OAUTH_TOKEN`; team/cross-machine sync; defending against a process already running
as the user (see §8).

## 2. Storage — two tiers

**Secrets — OS keystore**, via `@napi-rs/keyring`. macOS Keychain, Linux Secret Service
(gnome-keyring/kwallet), Windows Credential Manager. One entry per token, keyed
`service="claudefob"`, `account=<name>`. The token appears nowhere else on disk.

**Metadata — `store.json`**, mode 0600, no secret material.
macOS/Linux `$XDG_CONFIG_HOME/claudefob/store.json` (default `~/.config/claudefob/store.json`);
Windows `%APPDATA%\claudefob\store.json`.

```json
{
  "version": 1,
  "active": "work",
  "tokens": [
    { "name": "work", "description": "day job",
      "createdAt": "2026-08-28T04:12:00.000Z", "last4": "O4DA" }
  ]
}
```

`name` unique, `^[A-Za-z0-9._-]{1,64}$`. `description` optional, max 200 chars.
`active` is the single source of truth for activation.

Rationale for the split: `list` and `status` read only this file, so they are instant and never
trigger a keystore prompt. Only `show` and shell activation touch the keystore.

## 3. Shell integration

A child process cannot mutate its parent's environment. The CLI writes shell code to **stdout**;
the shell evals it. All human-facing output goes to **stderr** so it never contaminates the eval.

Block installed by the user (see §4.9):

```sh
# >>> claudefob >>>
export CLAUDEFOB_HOOK=1
eval "$(command claudefob export --shell posix)"
claudefob() {
  local __cf_out
  __cf_out="$(command claudefob "$@" --shell posix)" || return $?
  [ -n "$__cf_out" ] && eval "$__cf_out"
}
# <<< claudefob <<<
```

Line 1 runs at every shell startup: `export` resolves `active`, reads that secret, prints an
export statement; prints nothing when `active` is null. This is what makes activation survive a
new terminal. The function wraps the CLI so activation changes also patch the current shell.

`CLAUDEFOB_HOOK` lets the CLI detect at runtime whether integration is live, without parsing rc
files. When missing, commands that depend on it print a one-line hint pointing at `claudefob init`
(non-interactive: hint only, never a prompt).

Emitted code per dialect:

| Shell | Set | Unset |
|---|---|---|
| posix | `export CLAUDE_CODE_OAUTH_TOKEN='…'` | `unset CLAUDE_CODE_OAUTH_TOKEN` |
| fish | `set -gx CLAUDE_CODE_OAUTH_TOKEN '…'` | `set -e CLAUDE_CODE_OAUTH_TOKEN` |
| powershell | `$env:CLAUDE_CODE_OAUTH_TOKEN='…'` | `Remove-Item Env:\CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue` |

Single quotes escaped unconditionally, using the dialect-correct form: posix `'` → `'\''`;
fish `\` → `\\` then `'` → `\'` (fish honours backslash escapes inside single quotes, so the
posix `'\''` idiom would emit a literal backslash there); PowerShell `'` → `''`.
*(Errata: earlier drafts said `'\''` for fish; that was wrong.)*

Known limitation, reported by `status` rather than hidden: already-open shells keep their value
until restarted.

## 4. Commands

Global flags: `--shell <posix|fish|powershell>` (detected by default), `--json` (read commands),
`--help`, `--version`.

Shell detection order: parent process name, then `$SHELL`, then platform default
(`posix` on macOS/Linux, `powershell` on Windows unless `MSYSTEM` is set). The hook block bakes
`--shell` in as a literal, so the startup path never depends on detection.

### 4.1 `add <name> [--description <text>]`
Rejects duplicate or malformed name (exit 2). Prompts for the token with echo disabled; never
accepts it as an argument. Rejects empty input. Writes secret to keystore, appends metadata with
`createdAt` and `last4`. Does not activate.

### 4.2 `list [--json]`
Table: name, description, added, masked token; `●` marks active. Metadata only — no keystore read.
Row marked `⚠ missing` when metadata exists but the secret is gone.

### 4.3 `show [<name>]`
Name omitted → picker headed `Select a token to reveal`. **Pick first, then authenticate** — a
cancelled pick issues no auth challenge. Auth is mandatory; there is no bypass flag (§5). On
success prints the full token to **stderr** so `$(…)` cannot capture it silently. Failure,
cancellation, or unavailable mechanism → exit 3, nothing printed, error names Keychain
Access / seahorse / Credential Manager as the OS-level fallback.

### 4.4 `status [--json]`
Active name, description, masked token, added date, variable name, hook installed or not, and on
Windows whether execution policy will block the profile. `This shell` compares the process's own
`CLAUDE_CODE_OAUTH_TOKEN` against the active token's `last4`: both absent → `inactive`; matching →
`in sync`; differing → `stale`. Exit 0 when active, 1 when inactive.

### 4.5 `claudefob` (no arguments)
Picker headed `Select a token to activate`, active one preselected. Requires a TTY (else exit 2).
Writes `active`, applies §4.10 onboarding fix, prints the export statement. Cancel changes nothing.

### 4.6 `use [<name>]`
Non-interactive activation; identical to §4.5 when the name is omitted. Unknown name → exit 2.

### 4.7 `stop`
Clears `active`, prints the unset statement. Stored tokens untouched. **Never touches
`~/.claude.json`.** Idempotent.

### 4.8 `remove [<name>] [--yes]`
Name omitted → picker headed `Select a token to remove`. Confirms unless `--yes`. Deletes keystore
entry and metadata record. If it was active, clears `active` and emits the unset.

### 4.9 `init [--shell <s>]`
Prints the §3 block to **stdout** and guidance to **stderr**, so `claudefob init >> ~/.zshrc`
appends only code while the user still sees instructions. **Never writes to any file.**

### 4.10 `guide [--shell <s>]`
Read-only. Detects OS and shell, then prints: install steps for that platform; alternative rc
files and when each applies; a scan of every known rc file reporting where the fenced block is
installed with line numbers; removal instructions including the `sed` one-liner. Warns when a
token is active that `claudefob stop` should be run first. Never prompts, never edits.

rc file candidates: `~/.zshrc`, `~/.zprofile`, `~/.zshenv`, `~/.bashrc`, `~/.bash_profile`,
`~/.profile`, `~/.config/fish/config.fish`, both Windows PowerShell profile paths.

### 4.11 `export --shell <s>` (internal, hidden from help)
Emits shell code for current state. Called by the hook at every shell startup. **Fails silent**
(exit 0, no output) when nothing is active, `store.json` is missing, or the keystore is
unreachable — a broken keystore must never break shell startup. Diagnostics only under
`CLAUDEFOB_DEBUG=1`.

### 4.12 Onboarding fix (on activation only)
Claude Code prompts for auth at startup when `hasCompletedOnboarding` is unset, ignoring
`CLAUDE_CODE_OAUTH_TOKEN` (see https://news.ycombinator.com/item?id=46691873). On activation
(§4.5, §4.6):

1. Read `~/.claude.json`. Missing → create `{"hasCompletedOnboarding": true}`.
2. Already `true` → no write at all.
3. Missing or `false` → build new content, then **verify the round trip**: the only difference
   between original text and new text must be `hasCompletedOnboarding`. Write atomically
   (temp file in same directory + `rename`).
4. Verification fails → write nothing, print the manual fix.
5. Report on activation when changed. **No backup files** — verification replaces them.

`stop` never touches this file.

## 5. Authentication for `show`

OS-drawn challenge, never a passphrase this tool invents. Mandatory, no bypass.

| Platform | Mechanism | Notes |
|---|---|---|
| macOS, admin | `sudo -k -v` | `-k` forces a fresh prompt. Touch ID when `pam_tid` enabled. |
| macOS, non-admin | `dscl . -authonly <user>` | No privileges needed. Password prompted by `dscl` on the TTY, so it never enters our process. Exit 0 success, non-zero failure. Local accounts only. |
| Linux | `pkexec /bin/true` | Default policy `auth_admin_keep`: administrator password, cached ~5 min. An `auth_self` policy file avoids both, but needs root to install — documented, not required. |
| Windows | `CredUIPromptForWindowsCredentials` + `LogonUser`, compiled at runtime via PowerShell `Add-Type` | OS-drawn dialog, surfaces Windows Hello. `LOGON32_LOGON_NETWORK` needs no admin. Buffer zeroed before free. |

Backend selected automatically; macOS checks `admin` group membership at runtime.
v2: LocalAuthentication shim on macOS (Touch ID, no admin, no `pam_tid`) preferred over both.

## 6. Exit codes

`0` success · `1` inactive (`status`) · `2` usage error (unknown/duplicate name, bad flag, no TTY
when required) · `3` auth failed or cancelled · `4` keystore unavailable.

## 7. Errors

Linux with no Secret Service: `add` fails loudly with the fix — log in to a desktop session, or
install and start gnome-keyring:
`dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; exec $SHELL'`.
*(Errata: an earlier draft printed `dbus-run-session -- gnome-keyring-daemon --unlock`, which blocks
the foreground shell and does not reliably expose the secrets component.)* **No plaintext fallback, by design.**
Corrupt `store.json`: reported with path, never silently recreated.
Drift (record present, secret gone): `list` marks `⚠ missing`, `use` exits 4, `remove` still works.

## 8. Security model

Protects against: secrets in dotfiles, dotfile backups, Time Machine, dotfile repos, and shell
history; shoulder-surfing during `show`; a person at an unlocked terminal.

Does **not** protect against: any process running as this user — it can read the keystore
directly via the same API, and can read an active token out of its own environment. The `show`
gate is a speed bump against a person, not a sandbox against code. README states this plainly.

Rules: tokens never written to `store.json`, argv, or a log; prompts disable echo; `show` prints
to stderr; `store.json` is 0600.

## 9. Stack

Bun + TypeScript, built with `bun build --target node` so `npm i -g` works without Bun.
Runtime dependency: `@napi-rs/keyring` only, kept external (12 prebuilt targets, no compiler at
install). `@clack/prompts`, `picocolors`, `citty` are bundled into `dist/`.
Minimal dependency count is a security property for a credential tool, not just tidiness.

## 10. Architecture

Platform differences quarantined behind interfaces so CLI logic stays OS-agnostic:

```
src/
  cli.ts          citty subcommands, no platform code
  store.ts        metadata JSON
  keystore.ts     thin wrapper, swappable for a fake in tests
  paths.ts        config dir + rc candidates per OS
  claude-config.ts  §4.12 onboarding fix
  auth/index.ts   backend selection; darwin.ts linux.ts win32.ts
  shell/index.ts  detection; posix.ts fish.ts powershell.ts
  ui/             clack wrappers, table, colors — all on stderr
```

Adding a shell touches one file in `shell/`; adding an auth mechanism one file in `auth/`.

**Clack writes to stdout by default and must be redirected to stderr** (`@clack/core` accepts an
`output` option). Verify first; if it cannot be redirected cleanly, hand-roll the prompts.

## 11. Testing

Unit tests run on any OS against a fake keystore and fake auth backend, covering shell codegen and
quote escaping, shell/OS detection, store mutations, rc-file scanning, `last4`/masking, and the
§4.12 round-trip verification including a file that fails it.

CI matrix `macos-latest` / `ubuntu-latest` / `windows-latest`: typecheck, unit tests, build, then
an integration test that stores a real token, reads it back, and asserts the emitted code sets the
variable in a real zsh/bash/pwsh session. Linux brings up the keystore with
`dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; <test>'`
— the same incantation the §7 error message tells users to run, so CI validates the advice. macOS
runners `security unlock-keychain` first, and every integration step is time-limited so a keychain
prompt fails fast rather than hanging.

Auth backends are interactive by design and cannot run in CI: injectable interface plus a
`CLAUDEFOB_FAKE_AUTH=1` test hook that is never present in release builds.

## 12. Supported shells

zsh, bash, fish, PowerShell 5.1 and 7, Git Bash, WSL. **Not cmd.exe** — no profile mechanism
(only the invasive `AutoRun` registry key) and no command substitution.
`--shell cmd` errors with an explanation pointing at PowerShell.

Windows notes for `guide`: `$PROFILE` usually does not exist and must be created with
`New-Item -Type File -Path $PROFILE -Force`; PowerShell 5.1 and 7 use separate profile files;
execution policy `Restricted` silently prevents profiles from loading
(`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
