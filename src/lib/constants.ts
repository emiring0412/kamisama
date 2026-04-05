import type { Facility, NPC } from '../types';

// マップサイズ
export const MAP_WIDTH = 580;
export const MAP_HEIGHT = 420;

// 施設一覧
export const FACILITIES: Facility[] = [
  { name: '畑',   emoji: '\uD83C\uDF3E', x: 40,  y: 30,  width: 100, height: 80 },
  { name: '市場', emoji: '\uD83C\uDFEA', x: 240, y: 20,  width: 100, height: 70 },
  { name: '教会', emoji: '\u26EA',       x: 440, y: 30,  width: 100, height: 80 },
  { name: '鉱山', emoji: '\u26CF\uFE0F', x: 40,  y: 300, width: 100, height: 80 },
  { name: '森',   emoji: '\uD83C\uDF32', x: 440, y: 300, width: 100, height: 80 },
  { name: '水源', emoji: '\uD83D\uDCA7', x: 240, y: 320, width: 100, height: 70 },
  { name: '広場', emoji: '\uD83C\uDFDB\uFE0F', x: 220, y: 160, width: 140, height: 100 },
];

// NPC自宅の座標（マップ右上〜左下の空きスペースに配置）
export const NPC_HOMES: Record<string, { x: number; y: number }> = {
  takeshi: { x: 160, y: 60 },   // 畑の近く
  ayame:   { x: 370, y: 50 },   // 市場の近く
  genji:   { x: 400, y: 140 },  // 教会の近く
  rin:     { x: 160, y: 280 },  // 鉱山の近く
  sora:    { x: 370, y: 280 },  // 森の近く
};

// NPC移動速度（px/tick）
export const NPC_SPEED = 1.2;

// 移動tick間隔（ms）
export const MOVE_INTERVAL = 60;

// AI呼び出しデフォルト間隔（ms）
export const AI_INTERVAL_MS = 20000;

// 並列パイプライン最大数
export const MAX_CONCURRENT_REQUESTS = 3;

// 初期NPC
export const INITIAL_NPCS: Omit<NPC, 'x' | 'y' | 'targetX' | 'targetY' | 'homeX' | 'homeY' | 'bubble' | 'bubbleType' | 'bubbleTimer' | 'lastAiCall' | 'isWaiting'>[] = [
  {
    id: 'takeshi',
    name: 'タケシ',
    gender: 'male',
    role: '農民',
    personality: '勤勉で穏やか。争いを嫌い、食料を分け与える善人。畑への愛着が強い。',
    emoji: '\uD83D\uDC68\u200D\uD83C\uDF3E',
    color: '#4CAF50',
    params: { logic: 15, creativity: 10, morality: 30, empathy: 25, ambition: 5, sociability: 15 },
    mood: '穏やか',
    memory: [],
    longTermMemory: [],
    relationships: {},
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
  },
  {
    id: 'ayame',
    name: 'アヤメ',
    gender: 'female',
    role: '商人',
    personality: '野心的で口がうまい。利益を最優先するが信用も重視。密かに村の支配を狙う。',
    emoji: '\uD83D\uDC69\u200D\uD83D\uDCBC',
    color: '#FF9800',
    params: { logic: 25, creativity: 15, morality: 5, empathy: 5, ambition: 35, sociability: 15 },
    mood: '野心的',
    memory: [],
    longTermMemory: [],
    relationships: {},
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
  },
  {
    id: 'genji',
    name: 'ゲンジ',
    gender: 'male',
    role: '聖職者',
    personality: 'カリスマ的。信仰で人を導きたいが権力欲もちらつく。',
    emoji: '\uD83E\uDDD9',
    color: '#C8C0B8',
    params: { logic: 20, creativity: 20, morality: 20, empathy: 10, ambition: 20, sociability: 10 },
    mood: '厳か',
    memory: [],
    longTermMemory: [],
    relationships: {},
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
  },
  {
    id: 'rin',
    name: 'リン',
    gender: 'female',
    role: '職人',
    personality: '無口で義理堅い鍛冶屋。良いものを作ることに誇りを持つ。恩を売られるのを嫌う。',
    emoji: '\uD83D\uDC69\u200D\uD83D\uDD27',
    color: '#607D8B',
    params: { logic: 25, creativity: 25, morality: 20, empathy: 10, ambition: 15, sociability: 5 },
    mood: '集中',
    memory: [],
    longTermMemory: [],
    relationships: {},
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
  },
  {
    id: 'sora',
    name: 'ソラ',
    gender: 'male',
    role: '探検家',
    personality: '好奇心旺盛な自由人。束縛を嫌い冒険を求める。嘘が下手。',
    emoji: '\uD83E\uDDED',
    color: '#2196F3',
    params: { logic: 10, creativity: 30, morality: 15, empathy: 15, ambition: 15, sociability: 15 },
    mood: 'わくわく',
    memory: [],
    longTermMemory: [],
    relationships: {},
    beliefs: [],
    proposals: [],
    paramChangeAccum: 0,
  },
];

// NPCの初期位置をランダムに生成
export function createInitialNPC(template: typeof INITIAL_NPCS[number]): NPC {
  const home = NPC_HOMES[template.id] ?? { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const facility = FACILITIES[Math.floor(Math.random() * FACILITIES.length)];

  return {
    ...template,
    x: home.x,
    y: home.y,
    homeX: home.x,
    homeY: home.y,
    targetX: facility.x + facility.width / 2,
    targetY: facility.y + facility.height / 2,
    bubble: null,
    bubbleType: null,
    bubbleTimer: 0,
    lastAiCall: 0,
    isWaiting: false,
    age: 20 + Math.floor(Math.random() * 11),     // 20〜30歳
    lifespan: 60 + Math.floor(Math.random() * 21), // 60〜80歳
  };
}
