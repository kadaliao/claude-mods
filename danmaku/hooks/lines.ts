// What the comments say: heckles in Chinese and English; lines from philosophers of
// many schools with who said them; and philosophers heckling in their own voice. Each
// table answers the moments the hooks module reacts to at once; the model writes the
// rest. The lines quoted here have a known source; the philosophers' heckles are made up,
// and say so by putting the speaker in front, as a chat name, rather than after.

// The `language` option: Chinese, English, or both side by side.
export type Lang = 'zh' | 'en' | 'both'
// The `style` option: Bilibili heckles, philosophers' lines, or philosophers heckling.
export type Style = 'heckle' | 'philosophy' | 'philosopher-heckle'

export const langOf = (option: unknown): Lang => (option === 'english' ? 'en' : option === 'bilingual' ? 'both' : 'zh')
export const styleOf = (option: unknown): Style =>
  option === 'philosophy' || option === 'philosopher-heckle' ? option : 'heckle'

export type Line = { zh: string; en: string }
export type Thinker = Line & { school: Line }
export type Saying = Line & { by: Thinker }

export type Moment =
  | 'start'
  | 'aborted'
  | 'failed'
  | 'long'
  | 'done'
  | 'danger'
  | 'testFail'
  | 'testPass'
  | 'push'
  | 'commit'
  | 'cmdError'
  | 'install'
  | 'cmd'
  | 'editError'
  | 'edit'
  | 'write'
  | 'read'
  | 'agent'
  | 'web'
  | 'todo'

// What a moment gets: one of the items, this likely, in this color.
export type Entry<T> = { chance: number; color?: string; items: readonly T[] }

// --- how a comment reads -----------------------------------------------------------------

const pair = (l: Line): string => (l.zh === l.en ? l.zh : `${l.zh} ${l.en}`)

export function heckleText(l: Line, lang: Lang): string {
  return lang === 'zh' ? l.zh : lang === 'en' ? l.en : `${l.zh} / ${l.en}`
}

// A line as the lanes show it: the words, then who said it (drawn dim).
export function quoteOf(s: Saying, lang: Lang): { text: string; by: string } {
  if (lang === 'zh') return { text: s.zh, by: ` ——${s.by.zh}（${s.by.school.zh}）` }
  if (lang === 'en') return { text: s.en, by: ` — ${s.by.en} (${s.by.school.en})` }
  return { text: `${s.zh} / ${s.en}`, by: ` —— ${pair(s.by)}（${pair(s.by.school)}）` }
}

// A philosopher's heckle as the lanes show it: who says it (drawn dim), then the words.
export function jibeOf(s: Saying, lang: Lang): { from: string; text: string } {
  if (lang === 'zh') return { from: `${s.by.zh}（${s.by.school.zh}）：`, text: s.zh }
  if (lang === 'en') return { from: `${s.by.en} (${s.by.school.en}): `, text: s.en }
  return { from: `${pair(s.by)}（${pair(s.by.school)}）：`, text: `${s.zh} / ${s.en}` }
}

// --- heckles -------------------------------------------------------------------------------

const h = (zh: string, en: string): Line => ({ zh, en })

export const HELLO_HECKLES: readonly Line[] = [h('前排占座', 'first!'), h('来了来了', 'here we go'), h('弹幕护体！', 'chat shield up!')]

export const HECKLES: Record<Moment, Entry<Line>> = {
  start: {
    chance: 0.8,
    items: [h('前排', 'first'), h('来了来了', 'here we go'), h('前排围观', 'front row seats'), h('坐等', 'waiting 👀'), h('开工了', 'work time')],
  },
  aborted: { chance: 1, items: [h('被打断了', 'interrupted lol'), h('主播把 Claude 叫停了', 'streamer hit the brakes'), h('急刹车', 'emergency stop')] },
  failed: { chance: 1, color: 'error', items: [h('寄了', "it's so over"), h('服务器炸了？', 'server down?'), h('出事了', 'uh oh')] },
  long: { chance: 1, items: [h('终于好了', 'finally'), h('憋了个大招', 'charging the ult'), h('这轮好久', 'that took forever')] },
  done: {
    chance: 0.8,
    items: [h('下播', 'gg'), h('666', 'W'), h('完结撒花', "that's a wrap"), h('学到了', 'TIL'), h('辛苦了', 'good work')],
  },
  danger: {
    chance: 1,
    color: 'error',
    items: [h('前方高能！！', 'here it comes!!'), h('危险操作警告', 'danger zone'), h('手别抖啊', 'steady hands…'), h('高能预警', 'brace yourselves')],
  },
  testFail: {
    chance: 1,
    color: 'error',
    items: [h('红了红了', 'red red red'), h('翻车现场', 'and it crashed'), h('测试挂了😂', 'tests failed 😂'), h('修 bug 时间到', 'bug hunt time')],
  },
  testPass: {
    chance: 1,
    color: 'success',
    items: [h('全绿！！', 'all green!!'), h('稳了', 'clean'), h('测试通过🎉', 'tests pass 🎉'), h('绿了绿了（好的那种）', 'green (the good kind)')],
  },
  push: { chance: 1, items: [h('推了推了', 'pushed!'), h('上线咯', 'shipping it'), h('push 了，祈祷', 'pushed, praying')] },
  commit: { chance: 1, items: [h('存档成功', 'game saved'), h('commit +1', 'commit +1'), h('提交了提交了', 'committed')] },
  cmdError: { chance: 0.5, items: [h('报错了', 'error lol'), h('哦豁', 'oops'), h('红字警告', 'red text alert')] },
  install: { chance: 0.8, items: [h('又装依赖', 'more deps'), h('node_modules 又胖了', 'node_modules got heavier'), h('下载中…', 'downloading…')] },
  cmd: { chance: 0.15, items: [h('敲命令中', 'typing commands'), h('终端战士', 'terminal warrior'), h('指令输入中…', 'hacking in progress')] },
  editError: { chance: 0.8, items: [h('改歪了', 'missed'), h('没找到要改的😂', "where'd it go 😂")] },
  edit: { chance: 0.3, items: [h('改改改', 'edit edit edit'), h('手速好快', 'fast hands'), h('这行写得好', 'nice line')] },
  write: { chance: 0.5, items: [h('新文件+1', 'new file +1'), h('从零开始写', 'from scratch')] },
  read: { chance: 0.12, items: [h('又在看代码', 'reading again'), h('认真读代码中', 'studying the code'), h('又在 grep 了', 'grep again')] },
  agent: { chance: 1, items: [h('召唤分身！', 'summoning clones!'), h('影分身之术', 'shadow clone jutsu'), h('摇人了', 'calling for backup')] },
  web: { chance: 0.6, items: [h('上网冲浪中', 'surfing the web'), h('查资料去了', 'googling it')] },
  todo: { chance: 0.5, items: [h('列计划了', 'making a plan'), h('先写 todo，专业', 'todo list first, pro move')] },
}

// --- philosophers ----------------------------------------------------------------------------

const RU = h('儒家', 'Confucianism')
const DAO = h('道家', 'Taoism')
const MO = h('墨家', 'Mohism')
const FA = h('法家', 'Legalism')
const MING = h('名家', 'School of Names')
const FO = h('佛家', 'Buddhism')
const CHAN = h('禅宗', 'Zen')
const XINXUE = h('心学', 'School of Mind')
const PRESOCRATIC = h('前苏格拉底', 'Pre-Socratic')
const GREEK = h('古希腊哲学', 'Classical Greek')
const STOIC = h('斯多葛学派', 'Stoicism')
const EPICUREAN = h('伊壁鸠鲁学派', 'Epicureanism')
const SCHOLASTIC = h('经院哲学', 'Scholasticism')
const RATIONALISM = h('理性主义', 'Rationalism')
const EMPIRICISM = h('经验主义', 'Empiricism')
const IDEALISM = h('德国古典哲学', 'German Idealism')
const EXISTENTIALISM = h('存在主义', 'Existentialism')
const ABSURDISM = h('荒诞主义', 'Absurdism')
const PHENOMENOLOGY = h('现象学', 'Phenomenology')
const PRAGMATISM = h('实用主义', 'Pragmatism')
const ANALYTIC = h('分析哲学', 'Analytic philosophy')
const MARXISM = h('马克思主义', 'Marxism')
const CYNICISM = h('犬儒学派', 'Cynicism')
const VOLUNTARISM = h('唯意志论', 'Voluntarism')
const CRITICAL = h('批判理性主义', 'Critical rationalism')

const who = (zh: string, en: string, school: Line): Thinker => ({ zh, en, school })
const LAOZI = who('老子', 'Laozi', DAO)
const ZHUANGZI = who('庄子', 'Zhuangzi', DAO)
const CONFUCIUS = who('孔子', 'Confucius', RU)
const ZENGZI = who('曾子', 'Zengzi', RU)
const MENCIUS = who('孟子', 'Mencius', RU)
const XUNZI = who('荀子', 'Xunzi', RU)
const MOZI = who('墨子', 'Mozi', MO)
const HANFEI = who('韩非', 'Han Fei', FA)
const GONGSUN = who('公孙龙', 'Gongsun Long', MING)
const WANG = who('王阳明', 'Wang Yangming', XINXUE)
const BUDDHA = who('佛陀', 'the Buddha', FO)
const HUINENG = who('慧能', 'Huineng', CHAN)
const ZHAOZHOU = who('赵州', 'Zhaozhou', CHAN)
const HERACLITUS = who('赫拉克利特', 'Heraclitus', PRESOCRATIC)
const SOCRATES = who('苏格拉底', 'Socrates', GREEK)
const PLATO = who('柏拉图', 'Plato', GREEK)
const EPICTETUS = who('爱比克泰德', 'Epictetus', STOIC)
const MARCUS = who('马可·奥勒留', 'Marcus Aurelius', STOIC)
const SENECA = who('塞涅卡', 'Seneca', STOIC)
const EPICURUS = who('伊壁鸠鲁', 'Epicurus', EPICUREAN)
const OCKHAM = who('奥卡姆的威廉', 'William of Ockham', SCHOLASTIC)
const DESCARTES = who('笛卡尔', 'Descartes', RATIONALISM)
const SPINOZA = who('斯宾诺莎', 'Spinoza', RATIONALISM)
const LEIBNIZ = who('莱布尼茨', 'Leibniz', RATIONALISM)
const BACON = who('培根', 'Francis Bacon', EMPIRICISM)
const KANT = who('康德', 'Kant', IDEALISM)
const HEGEL = who('黑格尔', 'Hegel', IDEALISM)
const KIERKEGAARD = who('克尔凯郭尔', 'Kierkegaard', EXISTENTIALISM)
const NIETZSCHE = who('尼采', 'Nietzsche', EXISTENTIALISM)
const SARTRE = who('萨特', 'Sartre', EXISTENTIALISM)
const CAMUS = who('加缪', 'Camus', ABSURDISM)
const HUSSERL = who('胡塞尔', 'Husserl', PHENOMENOLOGY)
const HEIDEGGER = who('海德格尔', 'Heidegger', PHENOMENOLOGY)
const JAMES = who('威廉·詹姆斯', 'William James', PRAGMATISM)
const WITTGENSTEIN = who('维特根斯坦', 'Wittgenstein', ANALYTIC)
const MARX = who('马克思', 'Marx', MARXISM)
const DIOGENES = who('第欧根尼', 'Diogenes', CYNICISM)
const LOCKE = who('洛克', 'Locke', EMPIRICISM)
const HUME = who('休谟', 'Hume', EMPIRICISM)
const SCHOPENHAUER = who('叔本华', 'Schopenhauer', VOLUNTARISM)
const POPPER = who('波普尔', 'Popper', CRITICAL)

const say = (by: Thinker, zh: string, en: string): Saying => ({ zh, en, by })

export const HELLO_SAYINGS: readonly Saying[] = [
  say(CONFUCIUS, '有朋自远方来，不亦乐乎', 'Is it not a joy to have friends come from afar?'),
  say(CONFUCIUS, '朝闻道，夕死可矣', 'Hear the Way in the morning, and you may die content at dusk.'),
  say(WITTGENSTEIN, '我的语言的界限意味着我的世界的界限', 'The limits of my language mean the limits of my world.'),
]

const MARX_CHANGE = say(MARX, '哲学家们只是解释世界，问题在于改变世界', 'The philosophers have only interpreted the world; the point is to change it.')

export const SAYINGS: Record<Moment, Entry<Saying>> = {
  start: {
    chance: 0.5,
    items: [
      say(LAOZI, '千里之行，始于足下', 'A journey of a thousand miles begins with a single step.'),
      say(CONFUCIUS, '工欲善其事，必先利其器', 'A craftsman who wants to do good work must first sharpen his tools.'),
      say(PLATO, '开头是一项工作最重要的部分', 'The beginning is the most important part of the work.'),
      say(KANT, '要有勇气运用你自己的理智', 'Have courage to use your own understanding!'),
      say(DESCARTES, '我思故我在', 'I think, therefore I am.'),
    ],
  },
  aborted: {
    chance: 1,
    items: [
      say(LAOZI, '知足不辱，知止不殆', 'Know contentment and avoid disgrace; know when to stop and avoid danger.'),
      say(EPICTETUS, '有些事取决于我们，有些事不取决于我们', 'Some things are up to us, and some are not.'),
    ],
  },
  failed: {
    chance: 1,
    color: 'error',
    items: [
      say(LAOZI, '祸兮福之所倚，福兮祸之所伏', 'Misfortune is what fortune leans on; fortune is where misfortune hides.'),
      say(WITTGENSTEIN, '凡不可说的，应当保持沉默', 'Whereof one cannot speak, thereof one must be silent.'),
      say(NIETZSCHE, '那些杀不死我的，使我更强大', 'What does not kill me makes me stronger.'),
    ],
  },
  long: {
    chance: 1,
    items: [
      say(XUNZI, '锲而不舍，金石可镂', 'Keep carving without stopping, and even metal and stone will yield.'),
      say(XUNZI, '不积跬步，无以至千里', 'Without piling up small steps, there is no reaching a thousand miles.'),
      say(LAOZI, '大器晚成', 'The great vessel is the last to be finished.'),
      say(SPINOZA, '一切高贵的事物，都既艰难又稀少', 'All things excellent are as difficult as they are rare.'),
    ],
  },
  done: {
    chance: 0.6,
    items: [
      say(LAOZI, '功成而弗居', 'The work done, he does not dwell on it.'),
      say(ZENGZI, '吾日三省吾身', 'Every day I examine myself on three counts.'),
      say(ZHAOZHOU, '吃茶去', 'Go have some tea.'),
      say(HEGEL, '密涅瓦的猫头鹰要等黄昏到来才会起飞', 'The owl of Minerva spreads its wings only with the falling of the dusk.'),
    ],
  },
  danger: {
    chance: 1,
    color: 'error',
    items: [
      say(LAOZI, '天地不仁，以万物为刍狗', 'Heaven and Earth are not kind; they treat all things as straw dogs.'),
      say(HUINENG, '本来无一物，何处惹尘埃', 'Originally there is not a single thing; where could dust alight?'),
      say(BUDDHA, '诸行无常', 'All conditioned things are impermanent.'),
      say(EPICURUS, '死亡与我们无关', 'Death is nothing to us.'),
      say(MENCIUS, '知命者不立乎岩墙之下', 'One who knows fate does not stand beneath a tottering wall.'),
      say(SENECA, '我们在想象中受的苦，多于在现实中', 'We suffer more often in imagination than in reality.'),
    ],
  },
  testFail: {
    chance: 1,
    color: 'error',
    items: [
      say(CAMUS, '应当想象西西弗斯是幸福的', 'One must imagine Sisyphus happy.'),
      say(CONFUCIUS, '过而不改，是谓过矣', 'To err and not to change: that is the real error.'),
      say(WANG, '破山中贼易，破心中贼难', 'It is easy to beat the bandits in the hills, hard to beat the bandits in the heart.'),
      say(MARCUS, '挡在路上的，就成了路', 'What stands in the way becomes the way.'),
    ],
  },
  testPass: {
    chance: 1,
    color: 'success',
    items: [
      say(SOCRATES, '未经审视的人生不值得过', 'The unexamined life is not worth living.'),
      say(CONFUCIUS, '从心所欲，不逾矩', 'I follow what my heart desires without overstepping the line.'),
      say(LEIBNIZ, '这是所有可能的世界中最好的一个', 'This is the best of all possible worlds.'),
      say(HANFEI, '法不阿贵，绳不挠曲', 'The law does not fawn on the noble; the plumb line does not bend.'),
    ],
  },
  push: {
    chance: 1,
    items: [
      say(CONFUCIUS, '逝者如斯夫，不舍昼夜', 'It flows on like this, never ceasing day or night.'),
      say(SARTRE, '人是被判定为自由的', 'Man is condemned to be free.'),
      say(HERACLITUS, '人不能两次踏进同一条河流', 'No man ever steps in the same river twice.'),
    ],
  },
  commit: {
    chance: 0.8,
    items: [
      say(KIERKEGAARD, '人生只能向后理解，却必须向前生活', 'Life can only be understood backwards; but it must be lived forwards.'),
      say(CONFUCIUS, '温故而知新', 'Review the old and you will know the new.'),
    ],
  },
  cmdError: {
    chance: 0.4,
    items: [
      say(CONFUCIUS, '过犹不及', 'To go too far is as bad as to fall short.'),
      say(LAOZI, '反者道之动', 'Reversal is the movement of the Way.'),
      say(MARCUS, '阻碍行动的，反而推动行动', 'The impediment to action advances action.'),
    ],
  },
  install: {
    chance: 0.6,
    items: [
      say(OCKHAM, '如无必要，勿增实体', 'Plurality should never be posited without necessity.'),
      say(LAOZI, '少则得，多则惑', 'Have little and gain; have much and be confused.'),
    ],
  },
  cmd: { chance: 0.08, items: [say(WANG, '知行合一', 'Knowing and doing are one.'), MARX_CHANGE] },
  editError: {
    chance: 0.6,
    items: [
      say(LAOZI, '道可道，非常道', 'The Way that can be told is not the eternal Way.'),
      say(GONGSUN, '白马非马', 'A white horse is not a horse.'),
    ],
  },
  edit: { chance: 0.15, items: [say(HERACLITUS, '万物皆流', 'Everything flows.'), MARX_CHANGE] },
  write: {
    chance: 0.4,
    items: [
      say(LAOZI, '道生一，一生二，二生三，三生万物', 'The Way begets one; one begets two; two begets three; three begets all things.'),
      say(LAOZI, '有生于无', 'Being is born of non-being.'),
      say(HEIDEGGER, '语言是存在的家', 'Language is the house of Being.'),
    ],
  },
  read: {
    chance: 0.08,
    items: [
      say(CONFUCIUS, '学而不思则罔，思而不学则殆', 'Learning without thought is lost; thought without learning is perilous.'),
      say(ZHUANGZI, '吾生也有涯，而知也无涯', 'My life has a limit, but knowledge has none.'),
      say(NIETZSCHE, '你凝视深渊时，深渊也在凝视你', 'If you gaze long into an abyss, the abyss also gazes into you.'),
      say(HUSSERL, '回到事物本身', 'Back to the things themselves!'),
      say(JAMES, '明智的艺术，就是懂得忽略什么的艺术', 'The art of being wise is the art of knowing what to overlook.'),
    ],
  },
  agent: {
    chance: 0.8,
    items: [
      say(CONFUCIUS, '三人行，必有我师焉', 'When three walk together, one of them can be my teacher.'),
      say(MOZI, '兼相爱，交相利', 'Love all alike, and benefit one another.'),
      say(SARTRE, '他人即地狱', 'Hell is other people.'),
      say(ZHUANGZI, '不知周之梦为胡蝶与，胡蝶之梦为周与', 'Did Zhou dream he was a butterfly, or does a butterfly dream it is Zhou?'),
    ],
  },
  web: {
    chance: 0.5,
    items: [
      say(CONFUCIUS, '知之为知之，不知为不知，是知也', "To know what you know and admit what you don't: that is knowing."),
      say(MENCIUS, '尽信书，则不如无书', 'Better no books at all than to believe every book.'),
      say(BACON, '知识就是力量', 'Knowledge is power.'),
    ],
  },
  todo: {
    chance: 0.4,
    items: [say(LAOZI, '天下难事，必作于易；天下大事，必作于细', 'The hard things of the world begin as easy ones; the great things begin as small ones.')],
  },
}

// --- philosophers heckling ---------------------------------------------------------------

// Made up, each in the voice of the one who says it: their own ideas turned on the moment.
export const HELLO_JIBES: readonly Saying[] = [
  say(CONFUCIUS, '有朋自远方来，不亦弹幕乎', 'Friends from afar, joining the chat: is it not a joy?'),
  say(SOCRATES, '我来了，准备好回答问题吧', "I'm here. Get ready for some questions."),
  say(DIOGENES, '别挡着我的阳光，弹幕要从这儿飞', 'Stand out of my sun; the comments fly here.'),
]

export const JIBES: Record<Moment, Entry<Saying>> = {
  start: {
    chance: 0.5,
    items: [
      say(SOCRATES, '先别急：你说的"改一下"，到底什么是"改"？', 'Wait. When you say "fix it", what exactly is fixing?'),
      say(DESCARTES, '先怀疑一切，包括这个需求', 'First, doubt everything. Including this request.'),
      say(LAOZI, '无为而治，要不咱就别写了？', 'Wu wei. What if we just… did nothing?'),
      say(KANT, '动手前想想：这个需求能成为普遍法则吗', 'Before you start: could this request be a universal law?'),
    ],
  },
  aborted: {
    chance: 1,
    items: [
      say(EPICTETUS, '被叫停不在你的掌控之内，坦然接受吧', 'Being stopped is not up to you. Accept it.'),
      say(LAOZI, '知止不殆，停得好', 'Know when to stop and avoid danger. Good stop.'),
    ],
  },
  failed: {
    chance: 1,
    color: 'error',
    items: [
      say(WITTGENSTEIN, '服务器对不可说之事，保持了沉默', 'Whereof the server cannot speak, thereof it is silent.'),
      say(NIETZSCHE, '杀不死你的报错，会让你更强大', 'The error that does not kill you makes you stronger.'),
      say(ZHUANGZI, '服务器挂了？无用之用，方为大用', 'Server down? The use of the useless is the greatest use.'),
    ],
  },
  long: {
    chance: 1,
    items: [
      say(SCHOPENHAUER, '人生在痛苦和无聊之间摆荡，比如等这轮跑完', 'Life swings between pain and boredom. Like waiting for this turn.'),
      say(XUNZI, '锲而不舍，金石可镂，代码亦然', 'Keep carving and even stone yields. So does code.'),
      say(HEIDEGGER, '等这么久，也算是向死而生了', 'Waiting this long is a kind of being-toward-death.'),
    ],
  },
  done: {
    chance: 0.6,
    items: [
      say(ZHAOZHOU, '干完了？吃茶去', 'Done? Go have some tea.'),
      say(HEGEL, '猫头鹰黄昏才起飞：干完了才看懂这轮在干嘛', 'The owl flies at dusk: only now do we see what this turn was about.'),
      say(ZENGZI, '干完先三省：测了吗？提交了吗？文档写了吗？', 'Done? Examine yourself thrice: tested? committed? documented?'),
      say(LEIBNIZ, '这已经是所有可能的代码里最好的一版了', 'This is the best of all possible codebases.'),
    ],
  },
  danger: {
    chance: 1,
    color: 'error',
    items: [
      say(HUINENG, '本来无一物，你删了个寂寞', 'Originally there was not a single thing. What did you even delete?'),
      say(NIETZSCHE, '上帝已死，这个目录也死了', 'God is dead. So is this directory.'),
      say(EPICURUS, '文件在时你不在乎，文件没了你也感觉不到', "While the file was here you didn't care; now it's gone you can't tell."),
      say(MENCIUS, '知命者不立乎 rm -rf 之下', 'One who knows fate does not stand beneath an rm -rf.'),
      say(DIOGENES, '删吧删吧，我连桶都嫌多', 'Delete it all. I find even my barrel excessive.'),
    ],
  },
  testFail: {
    chance: 1,
    color: 'error',
    items: [
      say(POPPER, '被证伪了！恭喜，这才叫科学', "Falsified! Congratulations, that's science."),
      say(CAMUS, '又红了？推石头的人早就习惯了', 'Red again? Sisyphus is used to it.'),
      say(SOCRATES, '我唯一知道的，就是我对这段代码一无所知', 'All I know is that I know nothing about this code.'),
      say(WANG, '破山中贼易，破心中 bug 难', 'Easy to beat the bandits in the hills; hard to beat the bugs in the heart.'),
    ],
  },
  testPass: {
    chance: 1,
    color: 'success',
    items: [
      say(POPPER, '全绿只说明还没被证伪', 'All green only means not yet falsified.'),
      say(HUME, '过去每次都绿，凭什么下次也绿？', 'Green every time so far. Why should next time be green?'),
      say(LEIBNIZ, '这是所有可能的世界中最绿的一个', 'The greenest of all possible worlds.'),
      say(CONFUCIUS, '从心所欲，不逾断言', 'I follow my heart and never break an assertion.'),
    ],
  },
  push: {
    chance: 1,
    items: [
      say(HERACLITUS, '人不能两次 push 同一个 commit', 'You cannot push the same commit twice.'),
      say(SARTRE, 'push 了就得负责，你是被判定为自由的', 'You pushed it; now own it. You are condemned to be free.'),
      say(CONFUCIUS, '逝者如斯夫，推出去就收不回了', 'It flows on like this: once pushed, there is no pulling it back.'),
    ],
  },
  commit: {
    chance: 0.8,
    items: [
      say(KIERKEGAARD, 'commit 只能向后理解，代码却得向前写', 'Commits are understood backwards; code must be written forwards.'),
      say(ZENGZI, '吾日三 commit 吾身', 'Each day I commit myself thrice.'),
      say(CONFUCIUS, '温故而知新，git log 可以为师矣', 'Review the old to know the new: git log can be your teacher.'),
    ],
  },
  cmdError: {
    chance: 0.4,
    items: [
      say(MARCUS, '挡在路上的报错，就是路', 'The error in the way becomes the way.'),
      say(CONFUCIUS, '过而不改，是谓过矣。快改', 'To err and not fix it: that is the real error. Fix it.'),
      say(LAOZI, '反者道之动，报错也是道', 'Reversal is the movement of the Way. Errors too.'),
    ],
  },
  install: {
    chance: 0.6,
    items: [
      say(OCKHAM, '如无必要，勿增依赖', 'Do not multiply dependencies beyond necessity.'),
      say(DIOGENES, '我住桶里都够用，你要装这么多包？', 'I live in a barrel. You need all these packages?'),
      say(LAOZI, '少则得，多则惑，node_modules 尤其惑', 'Have little and gain; have much and be confused. Especially node_modules.'),
    ],
  },
  cmd: {
    chance: 0.08,
    items: [
      say(WANG, '知行合一，想好了就跑', 'Knowing and doing are one. Run it.'),
      say(MARX, '以前只是解释终端，现在要改变终端', 'Until now we only interpreted the terminal; the point is to change it.'),
    ],
  },
  editError: {
    chance: 0.6,
    items: [
      say(GONGSUN, '白马非马，你要找的那行也不是这行', 'A white horse is not a horse, and that line is not this line.'),
      say(LAOZI, '可改之码，非常码', 'The code that can be edited is not the eternal code.'),
      say(HERACLITUS, '那行代码早就流走了', 'That line has already flowed away.'),
    ],
  },
  edit: {
    chance: 0.15,
    items: [
      say(HERACLITUS, '人不能两次改同一行代码', 'No one edits the same line twice.'),
      say(MARX, '程序员们只是解释代码，问题在于改变代码', 'Programmers have only interpreted the code; the point is to change it.'),
    ],
  },
  write: {
    chance: 0.4,
    items: [
      say(LAOZI, '一生二，二生三，三生万个文件', 'One begets two, two begets three, three begets ten thousand files.'),
      say(LOCKE, '新文件，一块白板', 'A new file: a blank slate.'),
    ],
  },
  read: {
    chance: 0.08,
    items: [
      say(NIETZSCHE, '你 grep 深渊时，深渊也在 grep 你', 'When you grep into the abyss, the abyss greps into you.'),
      say(DESCARTES, '我读故我在', 'I read, therefore I am.'),
      say(HUSSERL, '回到代码本身！', 'Back to the code itself!'),
      say(ZHUANGZI, '吾生也有涯，而代码也无涯', 'My life has a limit; this codebase has none.'),
    ],
  },
  agent: {
    chance: 0.8,
    items: [
      say(SARTRE, '他人即地狱，子代理也是', 'Hell is other people. Subagents too.'),
      say(CONFUCIUS, '三个 Claude 行，必有我师焉', 'When three Claudes walk together, one can be my teacher.'),
      say(ZHUANGZI, '不知是 Claude 派了分身，还是分身梦见了 Claude', 'Did Claude spawn a subagent, or did a subagent dream of Claude?'),
      say(MOZI, '兼相爱，交相利，分身们好好配合', 'Love all alike and help each other, clones.'),
    ],
  },
  web: {
    chance: 0.5,
    items: [
      say(SOCRATES, '去网上查？肯承认自己不知道，很好', "Going to search? Admitting you don't know: a good start."),
      say(MENCIUS, '尽信搜索结果，不如不搜', 'Better not to search than to believe every result.'),
      say(BACON, '知识就是力量，可惜搜到的不一定是知识', 'Knowledge is power. Search results are not always knowledge.'),
    ],
  },
  todo: {
    chance: 0.4,
    items: [
      say(KANT, '这份 todo，你愿意它成为普遍法则吗？', 'Could you will this todo list to become a universal law?'),
      say(LAOZI, '图难于其易，先列个清单', 'Tackle the hard while it is easy: make a list.'),
    ],
  },
}
