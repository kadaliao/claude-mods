import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { isNewer, updateText, versionOf } from '../hooks/update'

const NOW = 1_000_000_000
const DAY = 86_400_000
const LATEST_URL = 'https://raw.githubusercontent.com/kadaliao/claude-mods/main/prompt-en/.claude-plugin/plugin.json'

// The installed plugin.json, and GitHub's (null: the network fails).
function world(on: On, installed: string, github: { version: string | null }, env: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, env)
  const fetched: string[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.read', (_, e) => {
    if (!e.path.endsWith('/.claude-plugin/plugin.json')) throw new Error('ENOENT')
    return { value: JSON.stringify({ name: 'prompt-en', version: installed }) }
  })
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    if (github.version === null) throw new Error('offline')
    const text = JSON.stringify({ name: 'prompt-en', version: github.version })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, fetched, toasts }
}

async function start($: Engine, isInteractive = true) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive })
}

test('versions are compared as numbers', () => {
  expect(isNewer('0.3.1', '0.3.0')).toBe(true)
  expect(isNewer('0.10.0', '0.9.9')).toBe(true)
  expect(isNewer('0.3.1', '0.3.1')).toBe(false)
  expect(isNewer('0.3.0', '0.3.1')).toBe(false)
  expect(isNewer('main', '0.3.1')).toBe(false)
  expect(versionOf('{"version":"1.2.3"}')).toBe('1.2.3')
  expect(versionOf('404: Not Found')).toBeUndefined()
  expect(versionOf('{"version":"next"}')).toBeUndefined()
})

test('a newer version on GitHub is mentioned once, and GitHub is asked once a day', async ($, on) => {
  const github = { version: '0.4.0' as string | null }
  const w = world(on, '0.3.1', github)
  await start($)
  await w.clock.settle()
  expect(w.fetched).toEqual([LATEST_URL])
  expect(w.toasts).toEqual([updateText('0.4.0', '0.3.1')])
  expect(w.toasts[0]).toContain('claude plugin update prompt-en@kadaliao')

  // The same day: not asked again.
  await start($)
  await w.clock.settle()
  expect(w.fetched).toHaveLength(1)

  // The next day: asked, and the version already mentioned is not mentioned again.
  await w.clock.advance(DAY + 1)
  await start($)
  await w.clock.settle()
  expect(w.fetched).toHaveLength(2)
  expect(w.toasts).toHaveLength(1)

  // A newer one still is.
  github.version = '0.4.1'
  await w.clock.advance(DAY + 1)
  await start($)
  await w.clock.settle()
  expect(w.toasts.at(-1)).toBe(updateText('0.4.1', '0.3.1'))
})

test('nothing is said when the installed version is the latest or newer', async ($, on) => {
  const github = { version: '0.3.1' as string | null }
  const w = world(on, '0.3.1', github)
  await start($)
  await w.clock.settle()
  github.version = '0.3.0'
  await w.clock.advance(DAY + 1)
  await start($)
  await w.clock.settle()
  expect(w.fetched).toHaveLength(2)
  expect(w.toasts).toEqual([])
})

test('a failing network says nothing and is not asked again that day', async ($, on) => {
  const w = world(on, '0.3.1', { version: null })
  await start($)
  await w.clock.settle()
  await start($)
  await w.clock.settle()
  expect(w.fetched).toHaveLength(1)
  expect(w.toasts).toEqual([])
})

test('no check with nonessential traffic off, or in a session nobody watches', async ($, on) => {
  const w = world(on, '0.3.1', { version: '0.4.0' }, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  await start($)
  await w.clock.settle()
  await start($, false)
  await w.clock.settle()
  expect(w.fetched).toEqual([])
  expect(w.toasts).toEqual([])
})

test('a session nobody watches does not check', async ($, on) => {
  const w = world(on, '0.3.1', { version: '0.4.0' })
  await start($, false)
  await w.clock.settle()
  expect(w.fetched).toEqual([])
})
