// Pictures written to files, so the terminal reads, decodes and scales them
// itself: what an Image gets is a path, not the pixels. Each session writes
// under a folder of its own, removed when the session ends.

import type { EngineInterface } from 'claude-code'

// The folder the sessions' folders sit in, the user's own.
const ROOT = '"${TMPDIR:-/tmp}"/claude-peek-$(id -u)'
// Decodes standard input into `<root>/<session $1>/<$2>.png` and prints its
// path. `$.fs` writes only text, so the bytes go through `base64 -d`, written
// under another name first so the terminal never reads half a file. A root
// someone else made fails the chmod, and with it the write.
const WRITE =
  `d=${ROOT}/"$1"; mkdir -p "$d" && chmod 700 "\${d%/*}" "$d" && f="$d/$2.png" && ` +
  'base64 -d > "$f.part" && mv "$f.part" "$f" && printf %s "$f"'
// Removes session $1's folder.
const REMOVE = `rm -rf ${ROOT}/"$1"`
// Removes what sessions that never ended cleanly left, two days on.
const SWEEP = `find ${ROOT} -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null; true`

// The path each picture went to, by picture id; undefined where writing failed.
const written = new Map<string, Promise<string | undefined>>()

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_') || '_'

async function write($: EngineInterface, id: string, data: string): Promise<string | undefined> {
  const session = safe(await $.session.id())
  const r = await $.process.run(['/bin/sh', '-c', WRITE, 'peek', session, safe(id)], { stdin: data })
  const path = r.stdout.trim()
  return r.exitCode === 0 && path.startsWith('/') ? path : undefined
}

// The file that holds PNG `id` (`data` its base64 bytes), written the first
// time it is asked for.
export function fileOf($: EngineInterface, id: string, data: string): Promise<string | undefined> {
  let path = written.get(id)
  if (path === undefined) {
    path = write($, id, data).catch(() => undefined)
    written.set(id, path)
  }
  return path
}

// Removes the files session `sessionId` wrote.
export async function removeFiles($: EngineInterface, sessionId: string): Promise<void> {
  written.clear()
  await $.process.run(['/bin/sh', '-c', REMOVE, 'peek', safe(sessionId)]).catch(() => undefined)
}

// Removes the folders of sessions long gone.
export async function sweepFiles($: EngineInterface): Promise<void> {
  await $.process.run(['/bin/sh', '-c', SWEEP]).catch(() => undefined)
}
