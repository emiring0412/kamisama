import type { NPC } from '../types';

// 遭遇判定距離
export const ENCOUNTER_DIST = 60;

// 同じペアの会話クールダウン管理
const lastEncounterMap = new Map<string, number>();
// 同じペアのすれ違い演出クールダウン
const lastPassingMap = new Map<string, number>();

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

// 2体のNPCの距離を計算
export function getDistance(a: NPC, b: NPC): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// 遭遇抽選の確率を計算
export function calcEncounterChance(a: NPC, b: NPC, eventActive: boolean): number {
  const key = pairKey(a.id, b.id);
  const now = Date.now();

  let chance = 10; // 基本確率（AI会話はレアイベント）

  // 社交性補正
  chance += (a.params.sociability + b.params.sociability) / 2 * 0.3;

  // 関係性補正（仲良しでも敵対でも絡みやすい）
  const relA = a.relationships[b.id];
  const relB = b.relationships[a.id];
  const avgScore = ((relA ? Math.abs(relA.score) : 0) + (relB ? Math.abs(relB.score) : 0)) / 2;
  chance += avgScore * 0.2;

  // イベント発生中の補正
  if (eventActive) chance += 15;

  // 直近60秒以内に同じペアで会話済みなら減算
  const lastEnc = lastEncounterMap.get(key) ?? 0;
  if (now - lastEnc < 60000) chance -= 50;

  // 0〜90%にクランプ
  return Math.max(0, Math.min(90, chance));
}

// 遭遇抽選を実行
export function rollEncounter(a: NPC, b: NPC, eventActive: boolean): boolean {
  const chance = calcEncounterChance(a, b, eventActive);
  const roll = Math.random() * 100;
  if (roll < chance) {
    // 当選 → クールダウン記録
    lastEncounterMap.set(pairKey(a.id, b.id), Date.now());
    return true;
  }
  return false;
}

// すれ違い演出のクールダウンチェック（10秒間隔）
export function canShowPassing(a: NPC, b: NPC): boolean {
  const key = pairKey(a.id, b.id);
  const now = Date.now();
  const last = lastPassingMap.get(key) ?? 0;
  if (now - last < 15000) return false;
  lastPassingMap.set(key, now);
  return true;
}

// 定型セリフ（中立は友好寄りに）
const PASSING_NEUTRAL = ['おっ', 'やあ', 'よう', '（会釈）', 'おう！', '（軽く手を振る）', 'やぁ、どこ行くの？', '今日もお疲れ', 'こんにちは', '（微笑む）'];
const PASSING_FRIENDLY = ['よっ！', '元気？', 'また会ったね！', 'おーい！', 'いい天気だね', '調子どう？', '今日も頑張ろう！', '（笑顔で手を振る）', 'おぉ！久しぶり！'];
const PASSING_HOSTILE = ['...チッ', '（目を逸らす）', '（無視）', '...ふん', '（睨む）'];
const PASSING_ANTISOCIAL = ['...', '（小さくうなずく）', '（目を伏せる）'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getPassingLine(speaker: NPC, other: NPC): string {
  // 社交性が極端に低い場合
  if (speaker.params.sociability <= 15) {
    return pick(PASSING_ANTISOCIAL);
  }

  const rel = speaker.relationships[other.id];
  if (rel && rel.score >= 30) return pick(PASSING_FRIENDLY);
  if (rel && rel.score <= -30) return pick(PASSING_HOSTILE);
  return pick(PASSING_NEUTRAL);
}

// プログラム側の独白行動（API不使用）— 時間帯×職業
type TimePeriod = 'earlyMorning' | 'morning' | 'daytime' | 'evening' | 'night' | 'midnight';

interface SoloLine { think: string; action: string }

const SOLO_BY_PERIOD: Record<TimePeriod, Record<string, SoloLine[]>> = {
  earlyMorning: {
    '農民': [{ think: 'よし、今日も頑張るか', action: '朝露の畑を見回る' }, { think: '早起きは三文の徳', action: '井戸で顔を洗う' }, { think: '鳥が鳴いてるな', action: '伸びをする' }],
    '商人': [{ think: '今日の仕入れは…', action: '在庫の確認をする' }, { think: 'まだ眠い…', action: '帳簿を開く' }],
    '聖職者': [{ think: '朝の祈りを…', action: '静かに祈りを捧げる' }, { think: '清々しい朝だ', action: '教会の掃除をする' }],
    '職人': [{ think: '炉に火を入れるか', action: '作業場の準備をする' }, { think: '今日は何を作ろう', action: '道具を並べる' }],
    '探検家': [{ think: '朝の空気が気持ちいい', action: '荷物をまとめる' }, { think: 'どこに行こうか', action: '地図を確認する' }],
  },
  morning: {
    '農民': [{ think: '苗の調子はどうかな', action: '畑の苗を見る' }, { think: '朝飯がうまかった', action: '鼻歌を歌う' }],
    '商人': [{ think: '今日は客が来るかな', action: '商品を並べる' }, { think: '挨拶回りしとくか', action: '市場を歩く' }],
    '聖職者': [{ think: '今日の説教は…', action: '経典を読み返す' }, { think: '村人の様子を見よう', action: '広場に向かう' }],
    '職人': [{ think: '注文がたまってるな', action: '金属を叩き始める' }, { think: 'いい鉄が入った', action: '素材を吟味する' }],
    '探検家': [{ think: '森の奥が気になる', action: '方角を確認する' }, { think: '天気は良さそうだ', action: '遠くを見渡す' }],
  },
  daytime: {
    '農民': [{ think: '作物の育ちが順調だ', action: '雑草を抜く' }, { think: '昼飯にしようか', action: '木陰で休憩する' }, { think: '誰かに野菜あげようかな', action: '収穫物をかごに入れる' }],
    '商人': [{ think: 'いい取引ができそうだ', action: '値札を確認する' }, { think: '競合に負けないように', action: '商品の配置を変える' }, { think: '利益率を上げたい', action: '計算をする' }],
    '聖職者': [{ think: '民の心を導かねば', action: '説教の準備をする' }, { think: '広場で人が集まってる', action: '様子を見に行く' }],
    '職人': [{ think: '集中、集中…', action: '刃物を研ぐ' }, { think: 'もっと精度を上げたい', action: '細部を調整する' }, { think: '腕が上がった気がする', action: '出来栄えを確認する' }],
    '探検家': [{ think: 'あの丘の向こうには…', action: '草をかき分けて進む' }, { think: '珍しい石を見つけた', action: '石を拾い上げる' }, { think: '地図に載ってない道だ', action: '新しい道を記録する' }],
  },
  evening: {
    '農民': [{ think: '今日もよく働いた', action: '道具を片付ける' }, { think: '夕焼けがきれいだな', action: '畑から帰り支度' }, { think: '明日は何を植えよう', action: '種の在庫を数える' }],
    '商人': [{ think: '今日の売上はまあまあ', action: '帳簿をまとめる' }, { think: '明日の仕入れを考えないと', action: '店じまいをする' }],
    '聖職者': [{ think: '今日も村は平和だった', action: '感謝の祈りを捧げる' }, { think: '明日は何を伝えよう', action: '夕暮れの教会で瞑想' }],
    '職人': [{ think: '今日の出来はまずまず', action: '作品を眺める' }, { think: '手が疲れたな', action: '道具を手入れする' }],
    '探検家': [{ think: '今日は色々見たな', action: '見つけたものを整理する' }, { think: '焚き火でもするか', action: '薪を集める' }],
  },
  night: {
    '農民': [{ think: '明日も天気だといいな', action: '家で寛いでいる' }, { think: '今日の畑は良かった', action: 'うとうとし始める' }],
    '商人': [{ think: '明日の戦略を練らないと', action: '家で帳簿を見返す' }, { think: '夜風が気持ちいい', action: '窓辺に座る' }],
    '聖職者': [{ think: '静かな夜だ', action: '燭台の前で祈る' }, { think: '星が綺麗だな', action: '空を見上げる' }],
    '職人': [{ think: '明日こそあの技を…', action: '設計図を眺める' }, { think: '静かで集中できる', action: '小物を磨く' }],
    '探検家': [{ think: '夜の森は別世界だ', action: '星座を観察する' }, { think: '冒険日誌を書こう', action: '今日の記録をつける' }],
  },
  midnight: {
    '農民': [{ think: 'zzz...', action: 'ぐっすり眠っている' }, { think: '…夢の中で畑を耕す…', action: '寝返りをうつ' }],
    '商人': [{ think: 'zzz...', action: '眠っている' }, { think: '…金の夢を見ている…', action: '寝息を立てる' }],
    '聖職者': [{ think: 'zzz...', action: '静かに眠っている' }, { think: '…神の声が聞こえる…', action: '深い眠りの中' }],
    '職人': [{ think: 'zzz...', action: '眠っている' }, { think: '…鉄を打つ夢…', action: 'うなされている' }],
    '探検家': [{ think: 'zzz...', action: '眠っている' }, { think: '…未知の大陸を探検する夢…', action: '寝袋で丸まっている' }],
  },
};

const SOLO_DEFAULT: Record<TimePeriod, SoloLine[]> = {
  earlyMorning: [{ think: '朝か…', action: '起き上がる' }, { think: 'まだ眠い', action: '目をこする' }],
  morning: [{ think: '今日も1日が始まる', action: '辺りを見回す' }],
  daytime: [{ think: 'いい天気だ', action: '歩き回る' }, { think: 'ふむ…', action: '何かを考えている' }],
  evening: [{ think: 'そろそろ帰ろう', action: '帰り支度をする' }],
  night: [{ think: '静かだな', action: '家で寛ぐ' }],
  midnight: [{ think: 'zzz...', action: '眠っている' }],
};

// プログラム側独白のクールダウン管理
const lastSoloActionMap = new Map<string, number>();

export function canShowSoloAction(npcId: string): boolean {
  const now = Date.now();
  const last = lastSoloActionMap.get(npcId) ?? 0;
  if (now - last < 30000) return false;
  lastSoloActionMap.set(npcId, now);
  return true;
}

export function getSoloAction(npc: NPC, period: TimePeriod = 'daytime'): { think: string; action: string } {
  const periodActions = SOLO_BY_PERIOD[period];
  const roleLines = periodActions[npc.role] ?? SOLO_DEFAULT[period];
  const line = pick(roleLines);
  return { think: line.think, action: line.action };
}
