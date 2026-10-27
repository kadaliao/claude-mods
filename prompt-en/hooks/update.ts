import type { EngineInterface } from 'claude-code'

// Saying when a newer version of the mod is out. Once a day at most, the plugin.json
// on GitHub is read and set against the installed one's; a newer version is mentioned
// once, with the commands that install it. Nothing is installed for the person.

const MARKETPLACE = 'kadaliao'
const LATEST_URL = 'https://raw.githubusercontent.com/kadaliao/claude-mods/main/prompt-en/.claude-plugin/plugin.json'
const CHECK_EVERY_MS = 24 * 3_600_000
const CHECKED_KEY = 'update:checkedAt'
const TOLD_KEY = 'update:told'

// "0.3.1" as [0, 3, 1], or null.
function parseVersion(s: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (a === null || b === null) return false
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

// The `version` of a plugin.json's text, or undefined.
export function versionOf(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' && parseVersion(version) !== null ? version : undefined
  } catch {
    return undefined
  }
}

export const updateText = (latest: string, current: string) =>
  `prompt-en 有新版本 ${latest}（当前 ${current}）。更新：! claude plugin marketplace update ${MARKETPLACE} && claude plugin update prompt-en@${MARKETPLACE}，然后 /reload-plugins`

export async function checkForUpdate($: EngineInterface): Promise<void> {
  if (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) return
  const now = await $.clock.now()
  if (now - Number((await $.store.get(CHECKED_KEY)) ?? 0) < CHECK_EVERY_MS) return
  const current = versionOf(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  if (current === undefined) return
  // Counted before asking, so a network that fails is not asked again at every start.
  await $.store.set(CHECKED_KEY, now)
  const r = await $.http.fetch(LATEST_URL)
  const latest = r.ok ? versionOf(r.text) : undefined
  if (latest === undefined || !isNewer(latest, current) || (await $.store.get(TOLD_KEY)) === latest) return
  await $.store.set(TOLD_KEY, latest)
  $.ui.toast(updateText(latest, current), { timeoutMs: 15_000 })
}
