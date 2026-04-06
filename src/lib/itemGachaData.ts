import type { ItemDef } from '../types';

// ===== コスト =====
export const ITEM_SINGLE_COST = 10;   // 単発
export const ITEM_MULTI_COST = 90;    // 10連（1回分お得）
export const ITEM_MULTI_COUNT = 10;

// ===== 排出率 =====
export const ITEM_R_RATE = 0.30;  // R率 30%

// ===== Nアイテム（7種） =====
export const N_ITEMS: ItemDef[] = [
  {
    id: 'force_talk',
    name: '強制会話',
    emoji: '💬',
    rarity: 'N',
    description: '指定した2人のNPCを強制的に会話させる',
    targetType: 'npc2',
  },
  {
    id: 'discovery_up',
    name: '発見率UP',
    emoji: '🔍',
    rarity: 'N',
    description: '3日間、文明イベントの発生確率UP',
    targetType: 'none',
  },
  {
    id: 'hair_change',
    name: '髪色変更',
    emoji: '🎨',
    rarity: 'N',
    description: '指定NPCの髪色をランダム変更',
    targetType: 'npc1',
  },
  {
    id: 'name_change',
    name: '名前変更',
    emoji: '📝',
    rarity: 'N',
    description: '指定NPCの名前を変更',
    targetType: 'npc1',
  },
  {
    id: 'reconcile',
    name: '和解促進',
    emoji: '🕊️',
    rarity: 'N',
    description: '指定2人の好感度を+3',
    targetType: 'npc2',
  },
  {
    id: 'gender_change',
    name: '性別変更',
    emoji: '⚧️',
    rarity: 'N',
    description: '指定NPCの性別を反転',
    targetType: 'npc1',
  },
  {
    id: 'confession',
    name: '告白促進',
    emoji: '💕',
    rarity: 'N',
    description: '指定2人の次回会話時に告白衝動を注入',
    targetType: 'npc2',
  },
];

// ===== Rアイテム（4種） =====
export const R_ITEMS: ItemDef[] = [
  {
    id: 'positive_buff',
    name: 'ポジティブバフ',
    emoji: '☀️',
    rarity: 'R',
    description: '7日間、全NPCに前向き補正',
    targetType: 'none',
  },
  {
    id: 'affection_bonus',
    name: '好感度ボーナス',
    emoji: '💛',
    rarity: 'R',
    description: '7日間、会話の好感度変化に+2補正',
    targetType: 'none',
  },
  {
    id: 'cataclysm',
    name: '天変地異',
    emoji: '🌪️',
    rarity: 'R',
    description: 'ランダムイベントを即発動',
    targetType: 'none',
  },
  {
    id: 'harvest_prayer',
    name: '豊作祈願',
    emoji: '🌾',
    rarity: 'R',
    description: '図鑑収録数×1Pを物理Pとして即時獲得',
    targetType: 'none',
  },
];

export const ALL_ITEMS: ItemDef[] = [...N_ITEMS, ...R_ITEMS];

export function getItemDef(id: string): ItemDef | undefined {
  return ALL_ITEMS.find((item) => item.id === id);
}

export function rollItem(): ItemDef {
  if (Math.random() < ITEM_R_RATE) {
    return R_ITEMS[Math.floor(Math.random() * R_ITEMS.length)];
  }
  return N_ITEMS[Math.floor(Math.random() * N_ITEMS.length)];
}
