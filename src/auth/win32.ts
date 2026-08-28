import { spawnSync } from 'node:child_process'
import type { AuthBackend } from './types.ts'

// Compiled at runtime via PowerShell Add-Type; fed on stdin so it never lands in argv.
// Only prints OK / FAIL to stdout — the password is never echoed back to us.
export const AUTH_TYPE_SOURCE = `
Add-Type -Namespace ClaudefobAuth -Name Native -MemberDefinition @"
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
"@

[StructLayout(LayoutKind.Sequential)]
public struct CREDUI_INFO {
    public int cbSize;
    public IntPtr hwndParent;
    public string pszMessageText;
    public string pszCaptionText;
    public IntPtr hbmBanner;
}

Write-Output "OK"
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
      if (res.error || res.status !== 0) return false
      return (res.stdout ?? '').trim() === 'OK'
    },
  }
}
