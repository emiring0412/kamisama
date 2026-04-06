import type { NPC, NPCParams } from '../types';
import { NPC_HOMES } from './constants';

// 恋人系ラベル判定
const LOVE_WORDS = ['好意', '恋', '愛', '想い', '惹かれ', '特別', '大切', '好き'];
// 夫婦系ラベル
const MARRIAGE_WORDS = ['夫婦', '伴侶', '妻', '夫', '連れ合い', '番'];
const MARRIAGE_THRESHOLD = 30; // この好感度以上で自動結婚

// 恋人同士が好感度一定以上で夫婦にランクアップ
export function checkMarriage(npcs: NPC[]): { updated: NPC[]; marriages: Array<{ a: string; b: string }> } {
  const marriages: Array<{ a: string; b: string }> = [];
  let updated = [...npcs];

  for (let i = 0; i < updated.length; i++) {
    for (let j = i + 1; j < updated.length; j++) {
      const a = updated[i];
      const b = updated[j];
      if (a.gender === b.gender) continue;

      const relA = a.relationships[b.id];
      const relB = b.relationships[a.id];
      if (!relA || !relB) continue;

      // 既に夫婦ならスキップ
      const alreadyMarriedA = MARRIAGE_WORDS.some((w) => relA.label.includes(w));
      const alreadyMarriedB = MARRIAGE_WORDS.some((w) => relB.label.includes(w));
      if (alreadyMarriedA && alreadyMarriedB) continue;

      // 双方が恋人系ラベル + 好感度が閾値以上
      const isLoveA = LOVE_WORDS.some((w) => relA.label.includes(w));
      const isLoveB = LOVE_WORDS.some((w) => relB.label.includes(w));
      if (!isLoveA || !isLoveB) continue;
      if (relA.score < MARRIAGE_THRESHOLD || relB.score < MARRIAGE_THRESHOLD) continue;

      // 夫婦にランクアップ
      updated = updated.map((n) => {
        if (n.id === a.id) {
          return { ...n, relationships: { ...n.relationships, [b.id]: { ...relA, label: '伴侶' } } };
        }
        if (n.id === b.id) {
          return { ...n, relationships: { ...n.relationships, [a.id]: { ...relB, label: '伴侶' } } };
        }
        return n;
      });
      marriages.push({ a: a.name, b: b.name });
    }
  }

  return { updated, marriages };
}

// 初期年齢: 20〜30歳
export function randomAge(): number {
  return 20 + Math.floor(Math.random() * 11);
}

// 寿命: 60〜80歳
export function randomLifespan(): number {
  return 60 + Math.floor(Math.random() * 21);
}

// 寿命が近いか（残り5年以内）
export function isNearDeath(npc: NPC): boolean {
  if (!npc.age || !npc.lifespan) return false;
  return npc.lifespan - npc.age <= 5;
}

// 死亡判定
export function isDead(npc: NPC): boolean {
  if (!npc.age || !npc.lifespan) return false;
  return npc.age >= npc.lifespan;
}

// 3等身以内の血縁チェック（親、兄弟、祖父母、叔父叔母、いとこ）
function isCloseRelative(a: NPC, b: NPC, allNPCs: NPC[]): boolean {
  const aParents = a.parentIds ?? [];
  const bParents = b.parentIds ?? [];

  // 1等身: 親子
  if (aParents.includes(b.id) || bParents.includes(a.id)) return true;

  // 2等身: 兄弟（同じ親を持つ）
  if (aParents.length > 0 && bParents.length > 0) {
    if (aParents.some((p) => bParents.includes(p))) return true;
  }

  // 3等身: 祖父母-孫、叔父叔母-甥姪、いとこ
  // aの親の親とb、bの親の親とaをチェック
  for (const pid of aParents) {
    const parent = allNPCs.find((n) => n.id === pid);
    if (!parent) continue;
    const grandParents = parent.parentIds ?? [];
    // 叔父叔母: bの親がaの祖父母の子
    if (grandParents.some((gp) => bParents.includes(gp))) return true;
    // 祖父母-孫
    if (grandParents.includes(b.id)) return true;
  }
  for (const pid of bParents) {
    const parent = allNPCs.find((n) => n.id === pid);
    if (!parent) continue;
    const grandParents = parent.parentIds ?? [];
    if (grandParents.some((gp) => aParents.includes(gp))) return true;
    if (grandParents.includes(a.id)) return true;
  }

  return false;
}

const MAX_CHILDREN_PER_PAIR = 4;

// 子どもが生まれる条件
export function canHaveChild(a: NPC, b: NPC, allNPCs: NPC[] = []): boolean {
  // 異性のみ
  if (a.gender === b.gender) return false;
  // 関係性チェック: 双方が夫婦であること
  const relA = a.relationships[b.id];
  const relB = b.relationships[a.id];
  if (!relA || !relB) return false;
  const marriageWords = ['夫婦', '伴侶', '妻', '夫', '連れ合い', '番'];
  const isMarriedA = marriageWords.some((w) => relA.label.includes(w));
  const isMarriedB = marriageWords.some((w) => relB.label.includes(w));
  if (!isMarriedA || !isMarriedB) return false;
  // 3等身以内は不可
  if (isCloseRelative(a, b, allNPCs)) return false;
  // ペアの子ども上限
  const pairChildren = allNPCs.filter((n) =>
    n.parentIds && n.parentIds.includes(a.id) && n.parentIds.includes(b.id)
  ).length;
  if (pairChildren >= MAX_CHILDREN_PER_PAIR) return false;

  return true;
}

// 子どものパラメータを生成（両親の平均+ランダム）
function inheritParams(a: NPCParams, b: NPCParams): NPCParams {
  const keys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const child: Record<string, number> = {};

  for (const k of keys) {
    // 両親の平均 ± ランダム変動
    const avg = (a[k] + b[k]) / 2;
    child[k] = Math.max(0, Math.round(avg + (Math.random() - 0.5) * 20));
  }

  // トータル100に正規化
  const total = keys.reduce((s, k) => s + child[k], 0);
  if (total > 0) {
    const ratio = 100 / total;
    for (const k of keys) child[k] = Math.round(child[k] * ratio);
    const newTotal = keys.reduce((s, k) => s + child[k], 0);
    if (newTotal !== 100) child.logic += (100 - newTotal);
  }

  return child as unknown as NPCParams;
}

// 子ども用の名前プール
const CHILD_NAMES_MALE = ['ハル', 'ユウ', 'レン', 'カイ', 'シン', 'アキ', 'テツ', 'マコト', 'ナギ', 'ヒロ'];
const CHILD_NAMES_FEMALE = ['ミユ', 'ハナ', 'ユイ', 'サキ', 'ノア', 'ココ', 'マイ', 'リコ', 'アオイ', 'ツキ'];

// 子どもNPCを生成
export function createChild(parent1: NPC, parent2: NPC, existingNames: string[]): NPC {
  const gender = Math.random() < 0.5 ? 'male' as const : 'female' as const;
  const namePool = gender === 'male' ? CHILD_NAMES_MALE : CHILD_NAMES_FEMALE;
  const availNames = namePool.filter((n) => !existingNames.includes(n));
  const name = availNames.length > 0 ? availNames[Math.floor(Math.random() * availNames.length)] : `${parent1.name}Jr`;

  const params = inheritParams(parent1.params, parent2.params);

  // 家は親の近く
  const home = NPC_HOMES[parent1.id] ?? { x: parent1.homeX, y: parent1.homeY };
  const homeX = home.x + (Math.random() - 0.5) * 30;
  const homeY = home.y + (Math.random() - 0.5) * 30;

  const childEmojis = gender === 'male' ? ['\uD83D\uDC66', '\uD83E\uDDD2'] : ['\uD83D\uDC67', '\uD83E\uDDD2'];

  return {
    id: `child-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    gender,
    role: '子ども',
    personality: `${parent1.name}と${parent2.name}の子。まだ世界を知らない。`,
    emoji: childEmojis[Math.floor(Math.random() * childEmojis.length)],
    color: Math.random() < 0.5 ? parent1.color : parent2.color,
    x: homeX,
    y: homeY,
    targetX: homeX,
    targetY: homeY,
    homeX,
    homeY,
    params,
    mood: '好奇心',
    memory: [`${parent1.name}と${parent2.name}のもとに生まれた`],
    longTermMemory: [],
    relationships: {
      [parent1.id]: { label: '親', score: 80 },
      [parent2.id]: { label: '親', score: 80 },
    },
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
    bubble: null,
    bubbleType: null,
    bubbleTimer: 0,
    lastAiCall: 0,
    isWaiting: false,
    age: 0,
    lifespan: randomLifespan(),
    parentIds: [parent1.id, parent2.id],
    childCount: 0,
  };
}
