#!/usr/bin/env node
// Windows-only smoke test: compiles the Add-Type P/Invoke source used by src/auth/win32.ts
// without ever calling CredUIPromptForWindowsCredentials (no dialog, so it runs headless in CI).
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.log('SKIP: not running on win32')
  process.exit(0)
}

// Duplicated intentionally (rather than importing dist/cli.js's bundled copy): this script's
// only job is to prove the P/Invoke source compiles under a real powershell.exe, independent of
// the build pipeline.
const AUTH_TYPE_SOURCE = `
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

const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
  input: AUTH_TYPE_SOURCE,
  encoding: 'utf8',
})

if (res.status !== 0 || res.stdout.trim() !== 'OK') {
  console.error(`P/Invoke source failed to compile. status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`)
  process.exit(1)
}

console.log('WIN AUTHTYPE SMOKE OK')
