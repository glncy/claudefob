import type { ShellCodegen } from './index.ts'

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export const powershellCodegen: ShellCodegen = {
  id: 'powershell',
  quote,
  setEnv(name, value) {
    return `$env:${name}=${quote(value)}`
  },
  unsetEnv(name) {
    return `Remove-Item Env:\\${name} -ErrorAction SilentlyContinue`
  },
  sourceBlock(scriptPath) {
    return [
      '# >>> claudefob >>>',
      `if (Test-Path ${JSON.stringify(scriptPath)}) { . ${JSON.stringify(scriptPath)} }`,
      '# <<< claudefob <<<',
    ].join('\n')
  },
  hookBlock() {
    const body = [
      "$env:CLAUDEFOB_HOOK = '1'",
      '$__cf = (claudefob export --shell powershell | Out-String)',
      'if ($__cf.Trim()) { Invoke-Expression $__cf }',
      '',
      'function claudefob {',
      '    $__cf_out = & (Get-Command claudefob -CommandType Application).Source @args --shell powershell',
      '    if ($LASTEXITCODE -ne 0) { return }',
      '    if ($__cf_out) { ($__cf_out -join "`n") | Invoke-Expression }',
      '}',
      '',
      '# Keeps already-open terminals in step with a switch made elsewhere. The unchanged path only',
      '# stats one file — claudefob runs solely when store.json has actually changed.',
      'function __claudefob_sync {',
      '    try {',
      '        $store = Join-Path $env:APPDATA "claudefob\\store.json"',
      '        if (-not (Test-Path $store)) { return }',
      '        $stamp = (Get-Item $store).LastWriteTimeUtc.Ticks',
      '        if ($global:__claudefobStamp -eq $stamp) { return }',
      '        $global:__claudefobStamp = $stamp',
      '        $out = (& (Get-Command claudefob -CommandType Application).Source export --shell powershell --sync 2>$null) -join "`n"',
      '        if ($out) { Invoke-Expression $out }',
      '    } catch { }',
      '}',
      '',
      '# Runs after each command, before the next prompt is drawn.',
      'if (-not (Test-Path Function:\\__claudefob_origPrompt)) {',
      '    Rename-Item Function:\\prompt __claudefob_origPrompt -ErrorAction SilentlyContinue',
      '}',
      'function prompt {',
      '    __claudefob_sync',
      '    if (Get-Command __claudefob_origPrompt -ErrorAction SilentlyContinue) { __claudefob_origPrompt }',
      '    else { "PS " + (Get-Location) + "> " }',
      '}',
      '',
      '# PowerShell has no preexec. Without one, a switch made while this terminal sits at a prompt',
      '# is not seen by the command you then type — only by the one after it. Syncing from the Enter',
      '# key handler closes that gap. Installed only when Enter still has its default AcceptLine',
      '# binding, so a custom keymap is never overwritten.',
      'if (Get-Module -ListAvailable -Name PSReadLine -ErrorAction SilentlyContinue) {',
      '    try {',
      '        $__cfEnter = Get-PSReadLineKeyHandler -Chord Enter -ErrorAction SilentlyContinue',
      "        if ($__cfEnter -and $__cfEnter.Function -eq 'AcceptLine') {",
      '            Set-PSReadLineKeyHandler -Chord Enter -ScriptBlock {',
      '                __claudefob_sync',
      '                [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()',
      '            }',
      '        }',
      '    } catch { }',
      '}',
    ]
    // Mirrors the posix guard: if claudefob is not on PATH the block must do nothing rather than
    // error on every new session.
    return [
      '# >>> claudefob >>>',
      'if (Get-Command claudefob -CommandType Application -ErrorAction SilentlyContinue) {',
      ...body.map((l) => (l === '' ? '' : '    ' + l)),
      '}',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
