// Pictures written to files, so the terminal reads, decodes and scales them
// itself: what an Image gets is a path, not the pixels. Each session writes
// under a folder of its own, removed when the session ends.

import type { EngineInterface } from 'claude-code'

// The folder the sessions' folders sit in, the user's own.
const ROOT = '"${TMPDIR:-/tmp}"/claude-peek-$(id -u)'
// Writes standard input, base64, as `<root>/<session $1>/<$2>.png` by `steps`
// (which leave the PNG at `$t`) and prints its path. `$.fs` writes only text, so
// the bytes go through `base64 -d`; the PNG is moved in whole, so the terminal
// never reads half a file. A root someone else made fails the chmod, and with
// it the write. What is left half-made is removed, written or not.
const script = (steps: string) =>
  `d=${ROOT}/"$1"; f="$d/$2.png"; t="$d/$2.tmp.png"; s="$d/$2.src"; ` +
  `mkdir -p "$d" && chmod 700 "\${d%/*}" "$d" && ${steps} && mv "$t" "$f" && printf %s "$f"; ` +
  'r=$?; rm -f "$t" "$s"; exit $r'
// By the picture's type: a PNG as it is; a JPEG, which terminals do not read,
// turned into a PNG by macOS's sips. Without sips the write fails, and the
// picture goes as its pixels.
const WRITE: Record<string, string> = {
  'image/png': script('base64 -d > "$t"'),
  'image/jpeg': script('[ -x /usr/bin/sips ] && base64 -d > "$s" && /usr/bin/sips -s format png "$s" --out "$t" >/dev/null 2>&1'),
}
// Removes session $1's folder.
const REMOVE = `rm -rf ${ROOT}/"$1"`
// Removes what sessions that never ended cleanly left, two days on.
const SWEEP = `find ${ROOT} -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null; true`

// The path each picture went to, by picture id; undefined where writing failed.
const written = new Map<string, Promise<string | undefined>>()

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_') || '_'

// Whether a picture of this type can go to the terminal as a file.
export const canWrite = (mime: string): boolean => mime in WRITE

async function write($: EngineInterface, id: string, mime: string, data: string): Promise<string | undefined> {
  const steps = WRITE[mime]
  if (steps === undefined) return undefined
  const session = safe(await $.session.id())
  const r = await $.process.run(['/bin/sh', '-c', steps, 'peek', session, safe(id)], { stdin: data })
  const path = r.stdout.trim()
  return r.exitCode === 0 && path.startsWith('/') ? path : undefined
}

// The PNG file that holds picture `id` (`data` its base64 bytes, of type
// `mime`), written the first time it is asked for.
export function fileOf($: EngineInterface, id: string, mime: string, data: string): Promise<string | undefined> {
  let path = written.get(id)
  if (path === undefined) {
    path = write($, id, mime, data).catch(() => undefined)
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
