import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { COMMIT_COMMAND, TEST_COMMAND, countLines, emptyReport, fmtDuration, formatReport } from '../hooks/register'

const PRESENTATION = { isFullscreen: false, columns: 120 } as const

// The engine beneath the plugin: a clock, a store, and records of what it played,
// pinned to the status line and sent as notifications.
function world(
  on: On,
  tool: (e: { tool: string }) => unknown = () => ({ result: {} }),
  stored: Record<string, unknown> = {},
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, stored)
  const played: string[] = []
  const status: Array<string | undefined> = []
  const notes: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'ambience' } }))
  on('audio.play', (_, e) => {
    played.push(e.clip.asset ?? '')
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', (_, e) => tool(e) as never)
  return { clock, played, status, notes }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
}

const lastStatus = (status: Array<string | undefined>) => status[status.length - 1]

test('formats the tally', () => {
  const r = { ...emptyReport(0), files: ['a.ts', 'b.ts'], added: 12, removed: 3, commands: 4, failed: 1, reads: 7 }
  expect(formatReport(r, 65_000)).toBe('⚔ 本轮  ✎ 2 文件 +12 −3 · ⚡ 4 命令 1✗ · 📖 7 · ⏱ 1m05s')
  expect(formatReport({ ...r, endedAt: 9_000 }, 65_000)).toBe('🏁 上轮  ✎ 2 文件 +12 −3 · ⚡ 4 命令 1✗ · 📖 7 · ⏱ 9s')
  expect(formatReport(emptyReport(0), 3_000)).toBe('⚔ 本轮  ⏱ 3s')
  expect(fmtDuration(3_725_000)).toBe('1h02m')
})

test('counts the lines a patch adds and removes, and a new file whole', () => {
  const patch = { structuredPatch: [{ lines: [' keep', '-old', '+new', '+more'] }] }
  expect(countLines(patch)).toEqual({ added: 2, removed: 1 })
  expect(countLines({ type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })).toEqual({ added: 3, removed: 0 })
  expect(countLines(undefined)).toEqual({ added: 0, removed: 0 })
})

test('knows a test command and a commit', () => {
  expect(TEST_COMMAND.test('npm test')).toBe(true)
  expect(TEST_COMMAND.test('cd x && pnpm run test -- --watch=false')).toBe(true)
  expect(TEST_COMMAND.test('claude plugin test ./ambience')).toBe(true)
  expect(TEST_COMMAND.test('cat test.txt')).toBe(false)
  expect(COMMIT_COMMAND.test('git add . && git commit -m "x"')).toBe(true)
  expect(COMMIT_COMMAND.test('git log --oneline')).toBe(false)
})

test('an edit pops and lands in the tally', async ($, on) => {
  const { played, status, clock } = world(on, () => ({
    result: { filePath: '/r/a.ts', structuredPatch: [{ lines: ['-x', '+y', '+z'] }] },
  }))
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'x', new_string: 'y\nz' })
  await clock.settle()
  expect(played).toEqual(['sounds/pop.wav'])
  expect(lastStatus(status)).toBe('⚔ 本轮  ✎ 1 文件 +2 −1 · ⏱ 0s')
})

test('a passing test command clicks then plays the fanfare; a failing one the trombone', async ($, on) => {
  let isError = false
  const { played, status, clock } = world(on, () =>
    isError ? { isError: true, result: 'FAIL', text: 'FAIL' } : { result: { stdout: 'ok' } },
  )
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()
  expect(played).toEqual(['sounds/click.wav', 'sounds/fanfare.wav'])

  isError = true
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()
  expect(played.slice(2)).toEqual(['sounds/click.wav', 'sounds/fail.wav'])
  expect(lastStatus(status)).toContain('⚡ 2 命令 1✗')
})

test("a subagent's calls are counted and make no sound", async ($, on) => {
  const { played, status, clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await clock.settle()
  expect(played).toEqual([])
  expect(lastStatus(status)).toContain('⚡ 1 命令')
})

test('a long turn chimes and notifies; the tally stays as the last turn', async ($, on) => {
  const { played, status, notes, clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(90_000)
  await $.turn.complete({ answer: 'All done.', durationMs: 90_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(played).toContain('sounds/chime.wav')
  expect(notes).toEqual(['⚡ 1 命令 · ⏱ 1m30s\nAll done.'])
  expect(lastStatus(status)).toBe('🏁 上轮  ⚡ 1 命令 · ⏱ 1m30s')
})

test('a short turn chimes without a notification', async ($, on) => {
  const { played, notes, clock } = world(on)
  await start($)
  await clock.advance(5_000)
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(played).toEqual(['sounds/chime.wav'])
  expect(notes).toEqual([])
})

test('/ambience mute keeps it quiet', async ($, on) => {
  const { played, clock } = world(on)
  await start($)
  const ran = await $.command.run({
    command: 'ambience',
    args: 'mute',
    origin: { kind: 'composer' },
    presentation: PRESENTATION,
  })
  expect(ran.text).toContain('sounds muted')
  await $.tool.call({ tool: 'Write', file_path: '/r/b.ts', content: 'x' })
  await clock.settle()
  expect(played).toEqual([])
})

test('/ambience report off clears the status line', async ($, on) => {
  const { status, clock } = world(on)
  await start($)
  await $.command.run({ command: 'ambience', args: 'report off', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await clock.settle()
  expect(lastStatus(status)).toBeUndefined()
})

test('a mute saved by an earlier session is read at the start', async ($, on) => {
  const { played, clock } = world(on, undefined, { prefs: { isMuted: true, isReportOn: true } })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()
  expect(played).toEqual([])
})
