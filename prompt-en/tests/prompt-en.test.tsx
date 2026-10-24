import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { buildPrompt, clamp, keyOf, markChanges, modeOf, parseReview, prepare } from '../hooks/register'

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SURFACES = ['terminal', 'desktop'] as const
const VIEWPORT = { columns: 60, rows: 40 }

// The engine beneath the plugin: a store, a clock, a model that answers `reply`,
// and a UserMessage row the plugin draws under.
function world(on: On, reply: (prompt: string) => string = () => 'I want to create a mod.') {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const prompts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'prompt-en' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: reply(e.prompt), usage: USAGE } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  return { clock, prompts }
}

const row = (text: string, isExpanded = false): RenderPropsOf['UserMessage'] => ({
  text,
  origin: { kind: 'composer' },
  isExpanded,
})

async function submit($: Engine, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
}

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('a Chinese prompt gets its English under the row, on every surface', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, '我想要创建一个 mod')
  await w.clock.settle()

  expect(w.prompts.length).toBe(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'prompt-en',
      surface,
      component: 'UserMessage',
      props: row('我想要创建一个 mod'),
      viewport: VIEWPORT,
    })
    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    expect(await ui.find({ type: 'Text', text: /^EN$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /I want to create a mod\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('a two-word English prompt is left alone and costs no call', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, 'commit it')
  await w.clock.settle()

  expect(w.prompts.length).toBe(0)
  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row('commit it'),
  })
  expect(await ui.find({ type: 'Text', text: /^EN$/ })).toBeUndefined()
  await ui.unmount()
})

test('the same prompt twice is translated once', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, '继续')
  await w.clock.settle()
  await submit($, '继续')
  await w.clock.settle()
  expect(w.prompts.length).toBe(1)
})

test('a slash command is not translated', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit({
    text: '/review 看看这个分支',
    command: { name: 'review', args: '看看这个分支' },
    origin: { kind: 'composer' },
    wait: false,
  })
  await w.clock.settle()
  expect(w.prompts.length).toBe(0)
})

test('pasted code is folded before anything is sent', () => {
  const code = Array.from({ length: 120 }, (_, i) => `  const x${i} = ${i};`).join('\n')
  const p = prepare(`帮我看看这段代码为什么报错\n\n\`\`\`ts\n${code}\n\`\`\`\n\n谢谢`)
  expect(p.materials).toEqual([{ lines: 120, head: 'const x0 = 0;', lang: 'ts' }])
  expect(p.prose).toBe('帮我看看这段代码为什么报错\n\n[[M1]]\n\n谢谢')
  expect(p.prose.length).toBeLessThan(40)

  // An unfenced paste: a tall block with no foreign letters.
  const log = Array.from({ length: 30 }, (_, i) => `ERROR build step ${i} failed at src/a.ts:${i}`).join('\n')
  const q = prepare(`构建失败了：\n\n${log}`)
  expect(q.materials.length).toBe(1)
  expect(q.prose).toBe('构建失败了：\n\n[[M1]]')

  // Chinese inside the code alone does not make a prompt foreign.
  expect(modeOf(`Why does this fail?\n\n\`\`\`\nconsole.log("你好")\n\`\`\``)).toBe('review')
  expect(modeOf('fix 这个 bug')).toBe('translate')
  expect(modeOf('ok')).toBe(null)
})

test('a long prompt asks for its gist, a short one for a translation', () => {
  const long = buildPrompt(prepare('我'.repeat(800)))
  expect(long.isCondensed).toBe(true)
  expect(long.prompt).toContain('gist')
  expect(long.maxTokens).toBe(600)

  const short = buildPrompt(prepare('帮我加个超时'))
  expect(short.isCondensed).toBe(false)
  expect(short.prompt).toContain('faithfully')
})

test('a gist is marked as one', async ($, on) => {
  const w = world(on, () => 'I want a mod that shows my prompt in English.')
  await start($)
  const long = `我想要${'很长的背景资料，'.repeat(120)}`
  await submit($, long)
  await w.clock.settle()

  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row(long),
    viewport: VIEWPORT,
  })
  expect(await ui.find({ type: 'Text', text: /gist of 963 chars/ })).toBeDefined()
  await ui.unmount()
})

test('long English is clamped on the terminal until ctrl+o', async ($, on) => {
  const english = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} of a long reply.`).join(' ')
  const w = world(on, () => english)
  await start($)
  await submit($, '翻译这个')
  await w.clock.settle()

  const collapsed = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row('翻译这个'),
    viewport: VIEWPORT,
  })
  expect(await collapsed.find({ type: 'Text', text: /ctrl\+o for all/ })).toBeDefined()
  await collapsed.unmount()

  const expanded = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row('翻译这个', true),
    viewport: VIEWPORT,
  })
  expect(await expanded.find({ type: 'Text', text: /ctrl\+o for all/ })).toBeUndefined()
  expect(await expanded.find({ type: 'Text', text: /Sentence number 39/ })).toBeDefined()
  await expanded.unmount()
})

test('clamp keeps whole lines that fit and cuts the one that does not', () => {
  expect(clamp('short', 40, 6)).toEqual({ text: 'short', isCut: false })
  const cut = clamp('word '.repeat(100).trim(), 40, 2)
  expect(cut.isCut).toBe(true)
  expect(cut.text.length).toBeLessThanOrEqual(60)
})

test('a row the transcript shows otherwise than submitted is found by its id', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, '看看这个：一大段粘贴的内容')
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '看看这个：一大段粘贴的内容' }] },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'row-1',
  })
  await w.clock.settle()

  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'row-1',
    props: row('看看这个：[Pasted text #1]'),
    viewport: VIEWPORT,
  })
  expect(await ui.find({ type: 'Text', text: /I want to create a mod\./ })).toBeDefined()
  await ui.unmount()
})

test('/prompt-en off hides the English and stops the calls', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, '第一句')
  await w.clock.settle()
  const ran = await $.command.run({
    command: 'prompt-en',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran.text).toContain('off')

  await submit($, '第二句')
  await w.clock.settle()
  expect(w.prompts.length).toBe(1)

  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row('第一句'),
  })
  expect(await ui.find({ type: 'Text', text: /^EN$/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed call says so in one dim line', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'prompt-en' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({
    value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  await start($)
  await submit($, '你好')
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'prompt-en', surface: 'terminal', component: 'UserMessage', props: row('你好') })
  expect(await ui.find({ type: 'Text', text: /no translation \(overloaded\)/ })).toBeDefined()
  await ui.unmount()
})

test('keys ignore spacing differences', () => {
  expect(keyOf('你好  世界\n')).toBe(keyOf('你好 世界'))
  expect(keyOf('你好')).not.toBe(keyOf('您好'))
})

// --- reviewing English -------------------------------------------------------------

const FIXED = [
  'VERDICT: fix',
  'TEXT: Make this function async and add a timeout.',
  'NOTE: article: "add timeout" → "add a timeout"',
].join('\n')

test('an English prompt with a mistake gets the fix, its new words marked, on every surface', async ($, on) => {
  const w = world(on, () => FIXED)
  await start($)
  await submit($, 'Make this function async and add timeout.')
  await w.clock.settle()

  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('VERDICT')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'prompt-en',
      surface,
      component: 'UserMessage',
      props: row('Make this function async and add timeout.'),
      viewport: { columns: 120, rows: 40 },
    })
    expect(await ui.find({ type: 'Text', text: /^ ✎$/ })).toBeDefined()
    const marked = await ui.find({ type: 'Text', text: /^a $/ })
    expect(marked?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /article: "add timeout"/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an English prompt that reads well gets other ways to say it', async ($, on) => {
  const w = world(on, () =>
    ['VERDICT: ok', 'ALT: Can you make this async?', 'ALT: Please convert this function to async.'].join('\n'),
  )
  await start($)
  await submit($, 'Could you make this function async?')
  await w.clock.settle()

  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row('Could you make this function async?'),
    viewport: { columns: 120, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /^ ✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /also Can you make this async\? · Please convert/ })).toBeDefined()
  await ui.unmount()
})

test('reviewEnglish off leaves English prompts alone', { options: { reviewEnglish: false } }, async ($, on) => {
  const w = world(on, () => FIXED)
  await start($)
  await submit($, 'Make this function async and add timeout.')
  await submit($, '把这个函数改成异步')
  await w.clock.settle()
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).not.toContain('VERDICT')
})

test('an English list is reviewed, not folded as a paste', () => {
  const list = Array.from({ length: 10 }, (_, i) => `- step ${i}: check the build output and fix what breaks`).join('\n')
  const p = prepare(`Please do these:\n${list}`)
  expect(p.materials.length).toBe(0)
  expect(modeOf('', p)).toBe('review')
})

test('a review reply is read into its fields', () => {
  const p = prepare('Make this function async and add timeout.')
  expect(parseReview(FIXED, p)).toEqual({
    verdict: 'fix',
    text: 'Make this function async and add a timeout.',
    base: 'Make this function async and add timeout.',
    note: 'article: "add timeout" → "add a timeout"',
  })
  // A rewrite that changes nothing reads as ok; a reply with no verdict is unreadable.
  expect(parseReview('VERDICT: polish\nTEXT: Make this function async and add timeout.', p)?.verdict).toBe('ok')
  expect(parseReview('Looks fine to me!', p)).toBe(null)
  // A long review lists its fixes; a multi-line TEXT keeps its lines.
  expect(parseReview('VERDICT: fix\nFIX: "it\'s" -> "its"', p)?.fixes).toEqual(['"it\'s" → "its"'])
  expect(parseReview('VERDICT: fix\nTEXT: line one\nline two\nNOTE: x', p)?.text).toBe('line one\nline two')
})

test('markChanges marks the words the fix added', () => {
  expect(markChanges('add timeout now', 'add a timeout now')).toEqual([
    { text: 'add ', isNew: false },
    { text: 'a ', isNew: true },
    { text: 'timeout now', isNew: false },
  ])
  expect(markChanges('same words', 'same words')).toEqual([{ text: 'same words', isNew: false }])
})

test('a paste at the end of an English prompt stays out of its review', () => {
  const code = Array.from({ length: 40 }, (_, i) => `  const v${i} = await refresh($)`).join('\n')
  const p = prepare(`can you look why the branch dont refresh?\n\n\`\`\`ts\n${code}\n\`\`\``)
  const r = parseReview('VERDICT: fix\nTEXT: can you look into why the branch doesn\'t refresh?\n\n[[M1]]\nNOTE: "look why" → "look into why"', p)
  expect(r?.text).toBe("can you look into why the branch doesn't refresh?")
  expect(r?.base).toBe('can you look why the branch dont refresh?')
})
