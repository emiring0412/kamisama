import type { NPC } from '../types';
import styles from './NPCSprite.module.css';
import CharacterSprite from './CharacterSprite';

// NPC IDから決定的にカラーを生成（同じIDなら毎回同じ色）
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}



function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${f(0).toString(16).padStart(2, '0')}${f(8).toString(16).padStart(2, '0')}${f(4).toString(16).padStart(2, '0')}`;
}

export function idToClothHex(id: string): string {
  const h = hashCode(id + '_cloth');
  const hue = h % 360;
  return hslToHex(hue, 45, 55);
}

// 肌色バリエーション（自然な肌色の範囲）
const SKIN_PALETTE = [
  '#F2C4A8', // 色白（赤み寄り）
  '#EBB898', // 明るい肌
  '#E5AD8C', // 標準
  '#DCA080', // やや濃い
  '#D09474', // 健康的
  '#C48868', // 日焼け
];

export function idToSkinHex(id: string): string {
  const h = hashCode(id + '_skin');
  return SKIN_PALETTE[h % SKIN_PALETTE.length];
}

const EYE_PALETTE = [
  '#4A3728', // ダークブラウン
  '#6B4226', // ブラウン
  '#2E5090', // ブルー
  '#3A7A4A', // グリーン
  '#8B4513', // アンバー
  '#333333', // ほぼ黒
];

export function idToEyeHex(id: string): string {
  const h = hashCode(id + '_eye');
  return EYE_PALETTE[h % EYE_PALETTE.length];
}

const HAIR_FRONT_F_VARIANTS = ['01', '02'];
const HAIR_BACK_F_VARIANTS = ['01', '02'];
// 03はスキンヘッド（低確率にするため01,02を多めに）
const HAIR_FRONT_M_VARIANTS = ['01', '01', '02', '02', '02', '03'];

// 初期キャラの見た目オーバーライド
const INITIAL_OVERRIDES: Record<string, { hairFront?: string; hasBeard?: boolean }> = {
  'takeshi': { hairFront: '03', hasBeard: true },   // スキンヘッド+ひげ
  'genji':   { hairFront: '02', hasBeard: true },   // 02+ひげ
  'sora':    { hairFront: '01', hasBeard: false },   // 01+ひげなし
};

export function idToHairFront(id: string, gender: 'male' | 'female' = 'female'): string {
  const override = INITIAL_OVERRIDES[id];
  if (override?.hairFront) return override.hairFront;
  const variants = gender === 'male' ? HAIR_FRONT_M_VARIANTS : HAIR_FRONT_F_VARIANTS;
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i) * (i + 1);
  return variants[sum % variants.length];
}

export function idToHairBack(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(id.length - 1 - i) * (i * 7 + 3);
  return HAIR_BACK_F_VARIANTS[sum % HAIR_BACK_F_VARIANTS.length];
}

export function idToHasBeard(id: string): boolean {
  const override = INITIAL_OVERRIDES[id];
  if (override?.hasBeard !== undefined) return override.hasBeard;
  const h = hashCode(id + '_beard_yes_no');
  return h % 3 === 0;
}

export function idToMouthHex(id: string): string {
  const h = hashCode(id + '_mouth');
  const hue = 350 + (h % 20); // 赤〜ピンク系（350-370）
  return hslToHex(hue % 360, 40, 60);
}

interface Props {
  npc: NPC;
  isSelected: boolean;
  onClick: () => void;
}

export default function NPCSprite({ npc, isSelected, onClick }: Props) {
  return (
    <div
      className={`${styles.sprite} ${isSelected ? styles.selected : ''}`}
      style={{
        left: npc.x,
        top: npc.y,
        transition: 'left 60ms linear, top 60ms linear',
      }}
      onClick={onClick}
    >
      {/* 吹き出し */}
      {npc.bubble && (
        <div className={styles.bubble}>
          <span className={styles.bubbleIcon}>
            {npc.bubbleType === 'say' ? '\uD83D\uDCAC' : '\uD83D\uDCAD'}
          </span>
          <span className={styles.bubbleText}>{npc.bubble}</span>
        </div>
      )}

      {/* キャラクター表示 */}
      <CharacterSprite
        gender={npc.gender}
        hairColor={npc.color}
        clothColor={idToClothHex(npc.id)}
        skinColor={idToSkinHex(npc.id)}
        eyeColor={idToEyeHex(npc.id)}
        mouthColor={idToMouthHex(npc.id)}
        hairFrontVariant={idToHairFront(npc.id, npc.gender)}
        hairBackVariant={idToHairBack(npc.id)}
        hasBeard={npc.gender === 'male' ? idToHasBeard(npc.id) : false}
        role={npc.role}
        rarity={npc.rarity}
        size={44}
      />

      {/* 名前 */}
      <span className={styles.name} style={{ color: npc.color }}>
        {npc.isWaiting && <span className={styles.thinking}>{'\uD83E\uDD14'}</span>}
        {npc.name}
      </span>
    </div>
  );
}
