import type { NPCParams } from '../types';

// ===== コスト =====
export const SINGLE_COST = 10;   // 単発
export const MULTI_COST = 90;    // 10連（1回分お得）
export const MULTI_COUNT = 10;

// ===== 排出率 =====
export const R_RATE = 0.30;          // 単発R率 30%
export const R_RATE_MULTI_BONUS = 0.03; // 10連ボーナス +3%
export const SR_RATE = 0.03;         // SR率 3%
export const SR_RATE_MULTI_BONUS = 0.03; // 10連ボーナス +3%

export function getRRate(isMulti: boolean): number {
  return isMulti ? R_RATE + R_RATE_MULTI_BONUS : R_RATE;
}

export function getSRRate(isMulti: boolean): number {
  return isMulti ? SR_RATE + SR_RATE_MULTI_BONUS : SR_RATE;
}

// ===== Rキャラ定義 =====

export interface RTemplate {
  label: string;
  role: string;
  personality: string;
  params: NPCParams;
  genderLock?: 'male' | 'female';
}

export const R_TEMPLATES: RTemplate[] = [
  {
    label: '天才軍師',
    role: '軍師',
    personality: '圧倒的な知性を持つが、人の心には無頓着。全てを計算で解く。',
    params: { logic: 50, creativity: 25, morality: 5, empathy: 0, ambition: 15, sociability: 5 },
  },
  {
    label: '狂気の発明家',
    role: '発明家',
    personality: '常識の枠を超えた発想力の持ち主。周囲は振り回されるばかり。',
    params: { logic: 15, creativity: 55, morality: 5, empathy: 0, ambition: 20, sociability: 5 },
  },
  {
    label: '鉄の聖女',
    role: '守護者',
    personality: '正義のためなら命を懸ける。情に厚いが融通が利かない。',
    params: { logic: 5, creativity: 0, morality: 50, empathy: 30, ambition: 5, sociability: 10 },
    genderLock: 'female',
  },
  {
    label: '闇商人',
    role: '密商',
    personality: '表には出ない裏の顔役。情報と人脈を金に変える。',
    params: { logic: 20, creativity: 10, morality: 0, empathy: 0, ambition: 55, sociability: 15 },
  },
  {
    label: '放浪の吟遊詩人',
    role: '吟遊詩人',
    personality: '歌と物語で人の心を動かす。誰とでも仲良くなるが、誰にも心を開かない。',
    params: { logic: 0, creativity: 30, morality: 10, empathy: 15, ambition: 0, sociability: 45 },
  },
  {
    label: '流浪の剣客',
    role: '剣士',
    personality: '刀一本で諸国を渡り歩く。寡黙だが、弱き者の前では剣を抜く。',
    params: { logic: 10, creativity: 5, morality: 25, empathy: 10, ambition: 10, sociability: -5 },
    genderLock: 'male',
  },
  {
    label: '慈母の薬師',
    role: '大薬師',
    personality: '全ての命を等しく救おうとする。自分の身を顧みない献身の人。',
    params: { logic: 10, creativity: 5, morality: 25, empathy: 55, ambition: 0, sociability: 5 },
    genderLock: 'female',
  },
  {
    label: '覇王の器',
    role: '統率者',
    personality: '生まれながらの王の器。カリスマ性で周囲を巻き込み、頂点を目指す。',
    params: { logic: 15, creativity: 5, morality: 5, empathy: 5, ambition: 50, sociability: 20 },
    genderLock: 'male',
  },
  {
    label: '風読みの巫女',
    role: '巫女',
    personality: '風と星を読み、未来を占う。不思議な雰囲気を纏い、言葉少なに真実を告げる。',
    params: { logic: 5, creativity: 40, morality: 20, empathy: 25, ambition: 0, sociability: 10 },
    genderLock: 'female',
  },
  {
    label: '呪術師',
    role: '呪術師',
    personality: '禁忌の知識を求め続ける。村人には恐れられているが、その力は本物。',
    params: { logic: 30, creativity: 35, morality: 0, empathy: 0, ambition: 30, sociability: 5 },
  },
  {
    label: '踊り子',
    role: '舞踏家',
    personality: '踊りで人を魅了する。華やかだが、その笑顔の裏に孤独を隠す。',
    params: { logic: 0, creativity: 35, morality: 10, empathy: 20, ambition: 5, sociability: 30 },
    genderLock: 'female',
  },
  {
    label: '鬼鍛冶',
    role: '刀鍛冶',
    personality: '炎の中に美を見出す狂気の職人。作品のためなら全てを犠牲にする。',
    params: { logic: 20, creativity: 45, morality: 10, empathy: 0, ambition: 20, sociability: 5 },
    genderLock: 'male',
  },
];

// ===== SRキャラ定義 =====

export const SR_TEMPLATES: RTemplate[] = [
  {
    label: '呪術師',
    role: '呪術師',
    personality: '禁忌の知識を求め続ける。村人には恐れられているが、その力は本物。',
    params: { logic: 30, creativity: 35, morality: 0, empathy: 0, ambition: 30, sociability: 5 },
    genderLock: 'female',
  },
  {
    label: '踊り子',
    role: '舞踏家',
    personality: '踊りで人を魅了する。華やかだが、その笑顔の裏に孤独を隠す。',
    params: { logic: 0, creativity: 35, morality: 10, empathy: 20, ambition: 5, sociability: 30 },
    genderLock: 'female',
  },
];

// R/SR職業判定
const R_ROLES = new Set(R_TEMPLATES.map((t) => t.role));
const SR_ROLES = new Set(SR_TEMPLATES.map((t) => t.role));
export function isRRole(role: string): boolean {
  return R_ROLES.has(role) || SR_ROLES.has(role);
}
export function isSRRole(role: string): boolean {
  return SR_ROLES.has(role);
}

// パラメータ正規化（合計100にする）
function normalizeParams(params: NPCParams): NPCParams {
  const keys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const raw = { ...params };
  for (const k of keys) {
    if (raw[k] < 0) raw[k] = 0;
  }
  const total = keys.reduce((s, k) => s + raw[k], 0);
  if (total === 0) return { logic: 17, creativity: 17, morality: 17, empathy: 17, ambition: 16, sociability: 16 };
  const ratio = 100 / total;
  for (const k of keys) raw[k] = Math.round(raw[k] * ratio);
  const newTotal = keys.reduce((s, k) => s + raw[k], 0);
  if (newTotal !== 100) raw.logic += (100 - newTotal);
  return raw;
}

export function jitterRParams(base: NPCParams): NPCParams {
  const keys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const raw: Record<string, number> = {};
  for (const k of keys) {
    raw[k] = Math.max(0, base[k] + Math.floor((Math.random() - 0.5) * 6));
  }
  return normalizeParams(raw as unknown as NPCParams);
}
