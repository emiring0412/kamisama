// NPC型定義
export interface NPCParams {
  logic: number;       // 論理的思考
  creativity: number;  // 創造性
  morality: number;    // 道徳観
  empathy: number;     // 共感力
  ambition: number;    // 野心
  sociability: number; // 社交性
}

export interface Relationship {
  label: string;   // 関係ラベル（信頼、警戒、恩人など）
  score: number;   // 好感度（-100 〜 +100）
}

export interface NPC {
  id: string;
  name: string;
  role: string;
  gender: 'male' | 'female';
  personality: string;
  emoji: string;
  color: string;

  // 位置
  x: number;
  y: number;
  targetX: number;
  targetY: number;

  // 自宅
  homeX: number;
  homeY: number;

  // パラメータ（トータル100ポイント）
  params: NPCParams;

  // 状態
  mood: string;
  memory: string[];              // 短期記憶（直近6件）
  longTermMemory: string[];      // 長期記憶（最大20件、日付付き）
  relationships: Record<string, Relationship>;

  // 創発システム
  beliefs: string[];    // 信念・信仰（AIが自発的に追加）
  proposals: string[];  // 提案したルールや組織（AI生成）

  // 動的変化トラッキング
  paramChangeAccum: number;
  age?: number;
  lifespan?: number;

  // 家族
  parentIds?: string[];     // 両親のID
  childCount?: number;      // 子どもの数

  // 吹き出し
  bubble: string | null;
  bubbleType: 'say' | 'think' | null;
  bubbleTimer: number;

  // AI制御
  lastAiCall: number;
  isWaiting: boolean;
  whisperMoving?: boolean;       // ささやきによる移動中フラグ
  whisperTask?: string;          // 到着後にやるべきこと
}

// 村の歴史: 過去の時代
export interface PastEra {
  eraName: string;    // "黎明期"
  period: string;     // "Day1-15"
  summary: string;    // 2〜3行の要約
}

// 村の歴史
export interface VillageHistory {
  ancientLog: string[];    // 古代の記録（1行圧縮・無制限）
  pastEras: PastEra[];     // 圧縮済みの時代（詳細5件）
  recentHistory: string[]; // 最近の歴史（10〜15件）
}

// 文明アイテム
export interface CivilizationItem {
  id: string;
  day: number;
  category: 'exchange' | 'rule' | 'belief' | 'organization' | 'technology' | 'custom' | 'demolish' | 'discovery';
  name: string;
  description: string;
  proposedBy: string;
  status: 'proposed' | 'adopted' | 'abandoned';
  locations?: string[];      // 発見カテゴリ: 目撃された場所のリスト
  discoveredBy?: string[];   // 発見カテゴリ: 発見者のリスト
}

// 祈り（住民→神）
export interface Prayer {
  id: string;
  npcId: string;
  npcName: string;
  npcEmoji: string;
  message: string;        // 「広場に噴水を作ってほしい」
  keywords: string[];     // ['広場', '噴水']
  day: number;
  fulfilled: boolean;
  fulfilledDay?: number;
}

// ささやき
export interface Whisper {
  targetNpcId: string;
  message: string;
  consumed: boolean;
}

// 季節
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

// 施設
export interface Facility {
  name: string;
  emoji: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 会話ログの1行
export interface ConversationLogLine {
  who: string;
  emoji: string;
  color: string;
  say: string;
}

// ログエントリ
export interface LogEntry {
  id: string;
  timestamp: string;
  npcName: string;
  npcEmoji: string;
  npcColor: string;
  targetName?: string;
  targetEmoji?: string;
  say?: string;
  conversation?: ConversationLogLine[]; // 会話ラリーの個別セリフ
  think?: string;
  action?: string;
  isEvent?: boolean;
  source?: 'ai' | 'program';
  fallback?: boolean;
  modelTag?: string;          // モデル名の頭文字4文字（Qwen/Gemi/Ll70/Ll8B等）
}
