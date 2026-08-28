import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Persistence = 'persistent' | 'ephemeral' | 'unknown'

/**
 * On Linux, libsecret falls back to the **session** collection when no unlocked login keyring
 * exists — common on a headless box reached over SSH. Writes and reads succeed for the life of
 * that session and every secret is lost on reboot, while store.json survives, leaving metadata
 * pointing at secrets that no longer exist.
 *
 * Persistence cannot be proven without rebooting, but the absence of any on-disk keyring is a
 * strong signal. Returns 'unknown' off Linux, where Keychain and Credential Manager are always
 * persistent.
 */
export function keyringPersistence(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  readDir: (p: string) => string[] = (p) => fs.readdirSync(p),
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): Persistence {
  if (platform !== 'linux') return 'unknown'

  // KWallet keeps its own store and is always on disk.
  if (exists(path.join(home, '.local', 'share', 'kwalletd'))) return 'persistent'

  const dir = path.join(home, '.local', 'share', 'keyrings')
  let entries: string[]
  try {
    entries = readDir(dir)
  } catch {
    return 'ephemeral' // no keyring directory at all
  }
  // A session keyring is memory-backed; only a real keyring file means storage survives a reboot.
  const persistent = entries.filter((e) => e.endsWith('.keyring') && !e.toLowerCase().startsWith('session'))
  return persistent.length > 0 ? 'persistent' : 'ephemeral'
}

/** Actionable guidance for an Ubuntu/Debian box whose keyring will not survive a reboot. */
export function ephemeralKeyringWarning(): string {
  return [
    'Warning: no persistent keyring was found on this machine.',
    '',
    '  Secrets are being stored in the Secret Service session collection, which lives in memory.',
    '  They work until this machine reboots, and are then gone — while claudefob\'s metadata',
    '  survives, so a token can appear to exist with nothing behind it.',
    '',
    '  On Ubuntu, create a persistent login keyring and unlock it automatically:',
    '    sudo apt-get install -y gnome-keyring libpam-gnome-keyring',
    '    # then log out and back in, so PAM creates and unlocks ~/.local/share/keyrings/login.keyring',
    '',
    '  Over SSH with no desktop session, unlock it once per session instead:',
    '    gnome-keyring-daemon --unlock --components=secrets',
    '',
    '  Check what exists now:  ls -la ~/.local/share/keyrings/',
  ].join('\n')
}
