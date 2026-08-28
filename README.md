# claudefob

**claudefob is an unofficial, community project. It is not affiliated with, endorsed by, or
supported by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.**

A cross-platform CLI that stores multiple Claude Code OAuth tokens in your OS keystore (macOS
Keychain, Linux Secret Service, Windows Credential Manager) and activates exactly one of them as
`CLAUDE_CODE_OAUTH_TOKEN` — so switching accounts is `claudefob use work` instead of hand-editing
`export CLAUDE_CODE_OAUTH_TOKEN=…` in a shell rc file.

## Install

```sh
npm i -g claudefob
```

Then wire up shell integration — append the hook block to your rc file and restart your shell.
Pick the row for your shell; `--shell` is optional (claudefob detects it) and shown here only so
each line is copy-pasteable as-is.

| Platform | Shell | Command |
|---|---|---|
| macOS | zsh (default since Catalina) | `claudefob init --shell posix >> ~/.zshrc` |
| macOS | bash | `claudefob init --shell posix >> ~/.bash_profile` |
| Linux | bash (default on most distros) | `claudefob init --shell posix >> ~/.bashrc` |
| Linux | zsh | `claudefob init --shell posix >> ~/.zshrc` |
| macOS / Linux | fish | `claudefob init --shell fish >> ~/.config/fish/config.fish` |
| Windows | PowerShell 5.1 / 7 | see below |
| Windows | Git Bash / WSL | use the Linux bash row |

```sh
# macOS — zsh
claudefob init --shell posix >> ~/.zshrc
exec zsh

# macOS — bash (terminals are login shells here, so .bash_profile is the one that loads)
claudefob init --shell posix >> ~/.bash_profile
exec bash

# Linux — bash (terminals are non-login shells here, so .bashrc is the one that loads)
claudefob init --shell posix >> ~/.bashrc
exec bash

# macOS or Linux — fish
claudefob init --shell fish >> ~/.config/fish/config.fish
exec fish
```

```powershell
# Windows — PowerShell 5.1 or 7. The profile usually does not exist yet, so create it first.
if (!(Test-Path $PROFILE)) { New-Item -Type File -Path $PROFILE -Force }
claudefob init --shell powershell | Add-Content $PROFILE
. $PROFILE
```

Windows notes: PowerShell 5.1 and PowerShell 7 use **separate** profile files, so install into each
if you use both — `$PROFILE` always resolves to the right one for the session you are in. If
`Get-ExecutionPolicy` reports `Restricted`, profiles never load and this setup silently does
nothing; fix it with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**cmd.exe is not supported** — it has no profile mechanism and no command substitution. Use
PowerShell.

Run `claudefob guide` any time for platform-specific install steps, a scan of which rc files
already have the block installed, and removal instructions.

## Quick start

```sh
claudefob add work --description "day job"   # prompts for the token, echo disabled
claudefob                                    # picker: choose a token to activate
claudefob status                             # confirm it's active
claudefob stop                               # deactivate
```

## Command reference

| Command | What it does |
|---|---|
| `claudefob add <name> [--description <text>]` | Store a new token. Prompts for it (no argv, no echo). |
| `claudefob list [--json]` | List stored tokens. Metadata only — never touches the keystore or prompts for auth. |
| `claudefob show [<name>]` | Reveal a token after OS-level authentication. Prints to stderr only. |
| `claudefob status [--json]` | What's active, whether the shell hook is installed, and whether this shell is in sync. |
| `claudefob` / `claudefob use [<name>]` | Activate a token (interactive picker if no name given). |
| `claudefob stop` | Deactivate. Idempotent. Never touches `~/.claude.json`. |
| `claudefob remove [<name>] [--yes]` | Delete a token from the keystore and metadata. |
| `claudefob init [--shell <s>]` | Print the shell hook block to stdout, for you to append to an rc file. Never writes a file itself. |
| `claudefob guide [--shell <s>]` | Read-only: install steps, rc file scan, removal instructions. |
| `claudefob update` | Update claudefob using whichever package manager installed it. |
| `claudefob export --shell <s>` | Internal — called by the shell hook at every shell startup. Not meant to be run by hand. |

`ls` and `rm` are accepted as aliases for `list` and `remove`. `-d` is short for `--description`,
`-y` for `--yes`.

### Environment variables

| Variable | Effect |
|---|---|
| `CLAUDEFOB_NO_UPDATE_CHECK=1` | Disable the update check. Also honours `NO_UPDATE_NOTIFIER` and `CI`. |
| `CLAUDEFOB_NO_HOOK_CHECK=1` | Suppress the "shell integration is not installed" warning. |
| `NO_COLOR=1` | Disable colored output. |
| `CLAUDEFOB_DEBUG=1` | Print diagnostics that are otherwise swallowed. |
| `XDG_CONFIG_HOME` | Where `store.json` lives (macOS/Linux). |

### Update checks

claudefob checks npm for a newer version at most once every 24 hours, in a detached background
process, and prints a notice from cache on a later run. It never blocks a command, and it never
runs on the `claudefob export` path that your shell calls at startup. The request goes to
`registry.npmjs.org` and exposes your IP address to npm; disable it with
`CLAUDEFOB_NO_UPDATE_CHECK=1`.

## How it works

A child process cannot change its parent shell's environment. So instead of trying to, claudefob
writes shell code to **stdout** and lets the shell `eval` it; every human-facing message — tables,
prompts, confirmations, the revealed token from `show`, errors — goes to **stderr**. That split is
what makes `$(claudefob use work)`-style activation safe: nothing but shell code ever appears on
stdout, and nothing you'd want to keep secret is ever captured by a stray `$(...)`.

The hook block installed by `claudefob init` does two things: it evals `claudefob export` once at
every shell startup (so activation survives opening a new terminal), and it wraps the `claudefob`
command in a shell function so that running `claudefob use ...` from an already-open shell also
patches that shell's environment immediately.

## Security model

**Protects against:** secrets ending up in dotfiles, dotfile backups, Time Machine snapshots,
dotfile repos, or shell history; shoulder-surfing while a token is on screen; someone sitting down
at your already-unlocked terminal and reading a token out with `show`.

**Does not protect against:** any process already running as you. It can read the keystore
directly through the same OS API claudefob uses, and it can read an active token straight out of
its own environment. The `show` authentication gate is a speed bump against a *person*, not a
sandbox against *code* — there is no bypass, and there never will be one, but it was never designed
to stop malware running as your user.

Tokens are never written to `store.json`, argv, or a log file. Password prompts disable terminal
echo. `store.json` is written with mode `0600`. `show` prints only to stderr.

## Platform notes

- **Linux** needs a running Secret Service (gnome-keyring or kwallet). If `add` fails because none
  is running, log in to a real desktop session, or bring one up headless:
  ```sh
  dbus-run-session -- bash -c 'echo -n "" | gnome-keyring-daemon --unlock --daemonize --components=secrets; exec $SHELL'
  ```
- **Windows** PowerShell profiles live at two separate paths for 5.1 and 7+; `claudefob guide`
  prints both. If the profile silently doesn't load, your execution policy is probably
  `Restricted` — fix it with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **cmd.exe is not supported.** It has no real profile mechanism and no command substitution.
  `claudefob init --shell cmd` errors and points you at PowerShell instead.

## The `~/.claude.json` onboarding fix

Claude Code prompts for interactive auth at startup whenever `hasCompletedOnboarding` is unset in
`~/.claude.json` — even with `CLAUDE_CODE_OAUTH_TOKEN` already set. When you activate a token
(`claudefob use` or bare `claudefob`), claudefob checks that file and, only if the flag is missing
or `false`, patches it to `true` with a minimal in-place edit. Before writing anything it verifies
the round trip: the only difference between the old and new file content must be that one flag. If
verification fails for any reason (comments, an unexpected value, duplicate keys, anything it
can't confidently reason about), it writes **nothing** and prints the one-line manual fix instead.
No backup file is ever created — the round-trip check is the safety net. `claudefob stop` never
opens this file at all.

## Keeping terminals in sync

Environment variables are per-process, so a switch made in one terminal cannot reach into another
one that is already open. The hook block handles this with a prompt hook: any open terminal picks
up the change at its next prompt, with no restart and no command to run.

The check costs nothing on the unchanged path — `[ -nt ]` and `: >` are shell builtins, so
claudefob only actually runs on the first prompt after `store.json` changes.

Deactivation propagates too, but only for a token claudefob set. If you exported
`CLAUDE_CODE_OAUTH_TOKEN` yourself somewhere else, claudefob leaves it alone — it tracks its own
work with a `CLAUDEFOB_APPLIED` marker and clears the variable only when that marker is present.

**One thing this cannot fix:** a Claude Code session that is already running. Its environment was
copied when the process started, so it keeps the token it launched with until you exit and start
`claude` again. No tool can change a running process's environment.

If you installed the hook before this release, re-run `claudefob init` to pick up the sync block.

## License

MIT — see [LICENSE](./LICENSE).
