import { spawnSync } from 'node:child_process'
import { AuthUnavailableError, type AuthBackend } from './types.ts'

// Compiled at runtime via PowerShell Add-Type; fed on stdin so it never lands in argv.
// Only prints OK / FAIL to stdout — the password is never echoed back to us.
// Flow: pop the native Windows credential dialog, unpack the entered username/password,
// call LogonUser to actually verify them against the local/domain authority, then zero
// and free the native buffer. OK is emitted only when LogonUser succeeds.
export const AUTH_TYPE_SOURCE = `
Add-Type -Namespace ClaudefobAuth -Name Native -MemberDefinition @"
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDUI_INFO {
    public int cbSize;
    public IntPtr hwndParent;
    public string pszMessageText;
    public string pszCaptionText;
    public IntPtr hbmBanner;
}

[DllImport("credui.dll", CharSet = CharSet.Unicode)]
public static extern int CredUIPromptForWindowsCredentials(
    ref CREDUI_INFO notificationInfo, int authError, ref uint authPackage,
    IntPtr InAuthBuffer, uint InAuthBufferSize, out IntPtr refOutAuthBuffer,
    out uint refOutAuthBufferSize, ref bool fSave, int flags);

[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool LogonUser(string lpszUsername, string lpszDomain, string lpszPassword,
    int dwLogonType, int dwLogonProvider, out IntPtr phToken);

[DllImport("credui.dll", CharSet = CharSet.Unicode)]
public static extern bool CredUnPackAuthenticationBuffer(int dwFlags, IntPtr pAuthBuffer,
    uint cbAuthBuffer, System.Text.StringBuilder pszUserName, ref int pcchMaxUserName,
    System.Text.StringBuilder pszDomainName, ref int pcchMaxDomainame,
    System.Text.StringBuilder pszPassword, ref int pcchMaxPassword);

[DllImport("ole32.dll")]
public static extern void CoTaskMemFree(IntPtr ptr);

[DllImport("kernel32.dll")]
public static extern void RtlZeroMemory(IntPtr dst, uint length);
"@

$credui = New-Object ClaudefobAuth.Native+CREDUI_INFO
$credui.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][ClaudefobAuth.Native+CREDUI_INFO])
$credui.hwndParent = [IntPtr]::Zero
$credui.pszCaptionText = "claudefob"
$credui.pszMessageText = "Confirm your Windows account password to unlock claudefob tokens"

$authPackage = 0
$outBuf = [IntPtr]::Zero
$outBufSize = 0
$save = $false
# CREDUIWIN_GENERIC = 0x1
$flags = 0x1

$result = [ClaudefobAuth.Native]::CredUIPromptForWindowsCredentials(
    [ref]$credui, 0, [ref]$authPackage, [IntPtr]::Zero, 0,
    [ref]$outBuf, [ref]$outBufSize, [ref]$save, $flags)

if ($result -ne 0) {
    Write-Output "FAIL"
    exit 0
}

$maxUser = 256
$maxDomain = 256
$maxPass = 256
$userSb = New-Object System.Text.StringBuilder $maxUser
$domainSb = New-Object System.Text.StringBuilder $maxDomain
$passSb = New-Object System.Text.StringBuilder $maxPass

$unpacked = [ClaudefobAuth.Native]::CredUnPackAuthenticationBuffer(
    0, $outBuf, $outBufSize, $userSb, [ref]$maxUser, $domainSb, [ref]$maxDomain, $passSb, [ref]$maxPass)

if (-not $unpacked) {
    [ClaudefobAuth.Native]::RtlZeroMemory($outBuf, $outBufSize)
    [ClaudefobAuth.Native]::CoTaskMemFree($outBuf)
    Write-Output "FAIL"
    exit 0
}

$username = $userSb.ToString()
$domain = $domainSb.ToString()
$password = $passSb.ToString()
if ([string]::IsNullOrEmpty($domain)) { $domain = $env:COMPUTERNAME }

$token = [IntPtr]::Zero
# LOGON32_LOGON_NETWORK = 3, LOGON32_PROVIDER_DEFAULT = 0
$loggedOn = [ClaudefobAuth.Native]::LogonUser($username, $domain, $password, 3, 0, [ref]$token)

[ClaudefobAuth.Native]::RtlZeroMemory($outBuf, $outBufSize)
[ClaudefobAuth.Native]::CoTaskMemFree($outBuf)
$password = $null

if ($loggedOn) {
    Write-Output "OK"
} else {
    Write-Output "FAIL"
}
`.trim()

export function win32Backend(): AuthBackend {
  return {
    id: 'win32',
    describe() {
      return 'Windows credential dialog (CredUIPromptForWindowsCredentials)'
    },
    async challenge(): Promise<boolean> {
      const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
        input: AUTH_TYPE_SOURCE,
        stdio: ['pipe', 'pipe', 'inherit'],
        encoding: 'utf8',
      })
      if (res.error) {
        throw new AuthUnavailableError(res.error.message)
      }
      if (res.status !== 0) return false
      return (res.stdout ?? '').trim() === 'OK'
    },
  }
}
