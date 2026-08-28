import type { ShellCodegen } from './index.ts'

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export const posixCodegen: ShellCodegen = {
  id: 'posix',
  quote,
  setEnv(name, value) {
    return `export ${name}=${quote(value)}`
  },
  unsetEnv(name) {
    return `unset ${name}`
  },
  hookBlock() {
    // Everything inside the guard: if claudefob is not on PATH — uninstalled, or (under a version
    // manager like fnm/nvm) installed for a different runtime version than this shell uses — the
    // block must do nothing rather than print "command not found" on every new terminal.
    const body = [
      'export CLAUDEFOB_HOOK=1',
      'eval "$(command claudefob export --shell posix)"',
      '',
      '# Seed the sync marker now, so the first store change after this shell started is what the',
      '# prompt hook compares against. Creating it lazily inside the hook would stamp it AFTER the',
      '# change and miss that first switch.',
      ': > "${TMPDIR:-/tmp}/claudefob-sync-$$" 2>/dev/null',
      '',
      'claudefob() {',
      '  local __cf_out',
      '  __cf_out="$(command claudefob "$@" --shell posix)" || return $?',
      '  [ -n "$__cf_out" ] && eval "$__cf_out"',
      '}',
      '',
      '# Keeps already-open terminals in step with a switch made elsewhere. The unchanged path costs',
      '# no processes at all: `[ -nt ]` and `: >` are shell builtins, so claudefob runs only on the',
      '# first prompt after store.json actually changes.',
      '_claudefob_sync() {',
      '  local __cf_store="${XDG_CONFIG_HOME:-$HOME/.config}/claudefob/store.json"',
      '  local __cf_marker="${TMPDIR:-/tmp}/claudefob-sync-$$"',
      '  if [ ! -e "$__cf_marker" ]; then',
      '    : > "$__cf_marker" 2>/dev/null',
      '  else',
      '    [ "$__cf_store" -nt "$__cf_marker" ] || return 0',
      '  fi',
      '  : > "$__cf_marker" 2>/dev/null',
      '  local __cf_out',
      '  __cf_out="$(command claudefob export --shell posix --sync 2>/dev/null)" || return 0',
      '  [ -n "$__cf_out" ] && eval "$__cf_out"',
      '  return 0',
      '}',
      '',
      'if [ -n "${ZSH_VERSION:-}" ]; then',
      '  # Both hooks: precmd refreshes before the prompt is drawn, preexec before the command you',
      '  # just typed runs. Without preexec the first command after a switch made elsewhere still',
      '  # sees the old value, and only the one after it is correct.',
      '  autoload -Uz add-zsh-hook \\',
      '    && add-zsh-hook precmd _claudefob_sync \\',
      '    && add-zsh-hook preexec _claudefob_sync',
      'elif [ -n "${BASH_VERSION:-}" ]; then',
      '  case ";${PROMPT_COMMAND:-};" in',
      '    *";_claudefob_sync;"*) ;;',
      '    *) PROMPT_COMMAND="_claudefob_sync;_claudefob_armed=0${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
      '  esac',
      '  # bash has no preexec, so a DEBUG trap stands in for it — without one the first command',
      '  # after a switch made elsewhere still runs with the old value. DEBUG fires once per simple',
      '  # command, so _claudefob_armed limits it to the first of each prompt cycle. Installed only',
      '  # when nothing else owns the DEBUG trap, so bash-preexec and prompt frameworks are',
      '  # untouched; those users still get the PROMPT_COMMAND path.',
      '  if [ -z "$(trap -p DEBUG 2>/dev/null)" ]; then',
      '    _claudefob_armed=0',
      "    trap '[ \"$_claudefob_armed\" = 0 ] && { _claudefob_armed=1; _claudefob_sync; }' DEBUG",
      '  fi',
      'fi',
    ]
    return [
      '# >>> claudefob >>>',
      'if command -v claudefob >/dev/null 2>&1; then',
      ...body.map((l) => (l === '' ? '' : '  ' + l)),
      'fi',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
