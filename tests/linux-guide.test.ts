import { describe, expect, test } from 'bun:test'
import { linuxKeyringGuide } from '../src/linux-keyring-guide.ts'
import fs from 'node:fs'
import path from 'node:path'

describe('linuxKeyringGuide', () => {
  const g = linuxKeyringGuide()

  test('explains why a headless box loses secrets', () => {
    expect(g).toContain('memory-only collection')
    expect(g).toContain('lost at the next reboot')
  })

  test('gives the diagnostic, the install, and both startup guards', () => {
    expect(g).toContain('ls -la ~/.local/share/keyrings/')
    expect(g).toContain('apt-get install -y gnome-keyring dbus-x11')
    expect(g).toContain('DBUS_SESSION_BUS_ADDRESS')
    expect(g).toContain('GNOME_KEYRING_CONTROL')
  })

  test('marks enable-linger as optional, since the fallback covers it', () => {
    expect(g).toContain('loginctl enable-linger')
    expect(g).toMatch(/Optional/)
    expect(g).toContain('not required')
  })

  test('includes a way to verify persistence rather than assuming it', () => {
    expect(g).toContain('sudo reboot')
  })

  test('states the empty-passphrase trade-off honestly', () => {
    // The recipe only works unattended because the passphrase is empty; that must not be sold as
    // encryption at rest.
    expect(g).toContain('encryption protects nothing')
    expect(g).toContain('0700')
  })

  test('explains why show uses sudo here', () => {
    expect(g).toContain('no polkit agent')
  })
})

describe('guide install examples', () => {
  test('name every common startup file, not just one', () => {
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const block = src.match(/const guideCommand[\s\S]*?\n\}\)\n/)
    expect(block).not.toBeNull()
    for (const rc of ['~/.zshrc', '~/.bashrc', '~/.bash_profile', '~/.zprofile', 'config.fish']) {
      expect(block![0]).toContain(rc)
    }
  })

  test('the Linux keyring recipe is printed only on Linux', () => {
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const block = src.match(/const guideCommand[\s\S]*?\n\}\)\n/)
    expect(block![0]).toContain("process.platform === 'linux'")
    expect(block![0]).toContain('linuxKeyringGuide()')
  })
})
