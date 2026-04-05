import { useState } from 'react';
import type { NPC, NPCParams } from '../types';
import { MAP_WIDTH, MAP_HEIGHT, FACILITIES } from '../lib/constants';
import styles from './AddNPCModal.module.css';
import { randomAge, randomLifespan } from '../lib/lifespanSystem';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';

// 性格プリセット
const PRESETS = [
  { label: '穏やか者', personality: '穏やかで人当たりが良い。争いを避け、周囲に気を配る。', params: { logic: 10, creativity: 10, morality: 25, empathy: 30, ambition: 5, sociability: 20 } },
  { label: '野心家', personality: '上を目指す野心家。目的のためなら手段を選ばない一面も。', params: { logic: 20, creativity: 15, morality: 5, empathy: 5, ambition: 40, sociability: 15 } },
  { label: '職人気質', personality: '寡黙だが腕は確か。良いものを作ることに人生を捧げる。', params: { logic: 25, creativity: 30, morality: 15, empathy: 10, ambition: 10, sociability: 10 } },
  { label: '冒険好き', personality: '好奇心の塊。未知の世界を求めて走り回る自由人。', params: { logic: 10, creativity: 25, morality: 10, empathy: 15, ambition: 20, sociability: 20 } },
  { label: '聖人', personality: '慈愛に満ちた心の持ち主。全ての人を等しく助けようとする。', params: { logic: 10, creativity: 5, morality: 35, empathy: 35, ambition: 0, sociability: 15 } },
  { label: '策士', personality: '頭が切れるが腹黒い。人を操ることに長けている。', params: { logic: 35, creativity: 20, morality: 0, empathy: 0, ambition: 30, sociability: 15 } },
  { label: '陽キャ', personality: 'とにかく明るい。誰とでもすぐ仲良くなる社交の達人。', params: { logic: 5, creativity: 15, morality: 15, empathy: 20, ambition: 10, sociability: 35 } },
  { label: '隠者', personality: '人嫌いの一匹狼。静かに暮らすことだけを望む。', params: { logic: 20, creativity: 15, morality: 20, empathy: 5, ambition: 5, sociability: -5 } },
];

// ランダム名前
const NAMES_MALE = ['カズマ', 'シュウ', 'レイ', 'ジン', 'ケイ', 'トウマ', 'サトシ', 'ユウキ', 'リュウ', 'コウ', 'ダイチ', 'ミナト', 'ハヤト', 'ショウ', 'アキラ'];
const NAMES_FEMALE = ['ミサキ', 'カエデ', 'ヒナタ', 'スズ', 'ナツミ', 'ホノカ', 'チヒロ', 'ユキ', 'アカネ', 'シオリ', 'ルナ', 'メイ', 'カリン', 'イズミ', 'モモ'];
const ROLES = ['農民', '商人', '職人', '探検家', '漁師', '猟師', '薬師', '楽師', '語り部', '鍛冶師'];
const EMOJIS_MALE = ['👨', '🧑', '👦', '🧔', '👨‍🦱'];
const EMOJIS_FEMALE = ['👩', '🧑‍🦰', '👧', '👩‍🦳', '👩‍🦱'];
const COLORS = [
  // 赤系
  '#F44336', '#E53935', '#C62828', '#B71C1C', '#D32F2F',
  '#FF5252', '#FF1744', '#E91E63', '#D81B60', '#C2185B',
  '#AD1457', '#880E4F', '#FF5722', '#F4511E', '#E64A19',
  // オレンジ系
  '#FF9800', '#FB8C00', '#F57C00', '#EF6C00', '#E65100',
  '#FF6D00', '#FF9100', '#FFB300', '#FFA000', '#FF8F00',
  // 茶系
  '#795548', '#6D4C41', '#5D4037', '#4E342E', '#3E2723',
  '#A1887F', '#8D6E63', '#7B5B4E', '#694B3D', '#BCAAA4',
  // 黄・ライム系
  '#FDD835', '#F9A825', '#F57F17', '#C0CA33', '#9E9D24',
  '#827717', '#CDDC39', '#AFB42B', '#8BC34A', '#7CB342',
  // 緑系
  '#4CAF50', '#43A047', '#388E3C', '#2E7D32', '#1B5E20',
  '#009688', '#00897B', '#00796B', '#00695C', '#004D40',
  '#66BB6A', '#81C784', '#A5D6A7', '#00E676', '#00C853',
  // 青系
  '#2196F3', '#1E88E5', '#1976D2', '#1565C0', '#0D47A1',
  '#00BCD4', '#0097A7', '#00838F', '#006064', '#0277BD',
  '#03A9F4', '#039BE5', '#0288D1', '#0277BD', '#01579B',
  '#42A5F5', '#64B5F6', '#90CAF9', '#448AFF', '#2979FF',
  // 紺・インディゴ系
  '#3F51B5', '#3949AB', '#303F9F', '#283593', '#1A237E',
  '#5C6BC0', '#7986CB', '#9FA8DA', '#536DFE', '#304FFE',
  // 紫系
  '#9C27B0', '#8E24AA', '#7B1FA2', '#6A1B9A', '#4A148C',
  '#AB47BC', '#CE93D8', '#BA68C8', '#AA00FF', '#D500F9',
  '#E040FB', '#EA80FC', '#B388FF', '#7C4DFF', '#651FFF',
  // ピンク系
  '#EC407A', '#F06292', '#F48FB1', '#FF4081', '#F50057',
  '#FF80AB', '#FF1493', '#C51162', '#FF6090', '#E91E90',
  // グレー・スレート系
  '#455A64', '#37474F', '#263238', '#546E7A', '#607D8B',
  '#78909C', '#90A4AE', '#B0BEC5', '#CFD8DC', '#ECEFF1',
  // ゴールド・メタル系
  '#BF8A30', '#A67C2E', '#8D6A23', '#C9A84C', '#B8942E',
  '#D4AF37', '#CFB53B', '#C5A030', '#DAA520', '#B8860B',
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// パラメータのノイズを加えて合計100に正規化
function jitterParams(base: NPCParams): NPCParams {
  const keys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const raw: Record<string, number> = {};
  for (const k of keys) {
    raw[k] = Math.max(0, base[k] + Math.floor((Math.random() - 0.5) * 10));
  }
  const total = keys.reduce((s, k) => s + raw[k], 0);
  if (total > 0) {
    const ratio = 100 / total;
    for (const k of keys) raw[k] = Math.round(raw[k] * ratio);
    const newTotal = keys.reduce((s, k) => s + raw[k], 0);
    if (newTotal !== 100) raw.logic += (100 - newTotal);
  }
  return raw as unknown as NPCParams;
}

interface OccupiedArea {
  x: number; y: number; width: number; height: number;
}

interface Props {
  existingNames: string[];
  occupiedAreas?: OccupiedArea[];
  onAdd: (npc: NPC) => void;
  onClose: () => void;
}

export default function AddNPCModal({ existingNames, occupiedAreas, onAdd, onClose }: Props) {
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [preview, setPreview] = useState<NPC | null>(null);

  const generate = (presetIdx: number) => {
    if (!selectedGender) return;
    setSelectedPreset(presetIdx);
    const preset = PRESETS[presetIdx];
    const gender = selectedGender;
    const namePool = gender === 'male' ? NAMES_MALE : NAMES_FEMALE;
    const available = namePool.filter((n) => !existingNames.includes(n));
    const name = available.length > 0 ? randomFrom(available) : `新人${Date.now() % 1000}`;
    const role = randomFrom(ROLES);
    const emoji = randomFrom(gender === 'male' ? EMOJIS_MALE : EMOJIS_FEMALE);
    const color = randomFrom(COLORS);
    const params = jitterParams(preset.params);

    // 住処なし → 全占有領域と被らない場所にランダム配置
    const allAreas = occupiedAreas ?? FACILITIES.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height }));
    const findOpenSpot = (): { x: number; y: number } => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = 30 + Math.random() * (MAP_WIDTH - 60);
        const cy = 30 + Math.random() * (MAP_HEIGHT - 60);
        const margin = 20;
        const overlaps = allAreas.some((f) =>
          cx > f.x - margin && cx < f.x + f.width + margin &&
          cy > f.y - margin && cy < f.y + f.height + margin
        );
        if (!overlaps) return { x: cx, y: cy };
      }
      return { x: 30 + Math.random() * 60, y: 200 + Math.random() * 40 };
    };
    const { x, y } = findOpenSpot();

    const npc: NPC = {
      id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      gender,
      role,
      personality: preset.personality,
      emoji,
      color,
      x, y,
      targetX: x, targetY: y,
      homeX: x, homeY: y, // 仮の家（自分で建てるまで）
      params,
      mood: '期待',
      memory: ['この村にたどり着いた'],
      longTermMemory: [],
      relationships: {},
      beliefs: [],
      proposals: [],
      paramChangeAccum: 0,
      bubble: null,
      bubbleType: null,
      bubbleTimer: 0,
      lastAiCall: 0,
      isWaiting: false,
      age: randomAge(),
      lifespan: randomLifespan(),
    };
    setPreview(npc);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>{'\uD83D\uDC64'} 住民を追加</h3>
        <p className={styles.desc}>性別を選んでから、性格を選ぶとキャラクターが生成されます</p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            className={`${styles.presetBtn} ${selectedGender === 'male' ? styles.presetBtnActive : ''}`}
            onClick={() => { setSelectedGender('male'); setSelectedPreset(null); setPreview(null); }}
            style={{ flex: 1, fontSize: '14px', padding: '10px' }}
          >
            {'\u2642\uFE0F'} 男性
          </button>
          <button
            className={`${styles.presetBtn} ${selectedGender === 'female' ? styles.presetBtnActive : ''}`}
            onClick={() => { setSelectedGender('female'); setSelectedPreset(null); setPreview(null); }}
            style={{ flex: 1, fontSize: '14px', padding: '10px' }}
          >
            {'\u2640\uFE0F'} 女性
          </button>
        </div>

        {selectedGender && (
          <div className={styles.presets}>
            {PRESETS.map((p, i) => (
              <button
                key={i}
                className={`${styles.presetBtn} ${selectedPreset === i ? styles.presetBtnActive : ''}`}
                onClick={() => generate(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {preview && (
          <div className={styles.preview}>
            <div className={styles.previewHeader}>
              <CharacterSprite
                gender={preview.gender}
                hairColor={preview.color}
                clothColor={idToClothHex(preview.id)}
                skinColor={idToSkinHex(preview.id)}
                eyeColor={idToEyeHex(preview.id)}
                mouthColor={idToMouthHex(preview.id)}
                hairFrontVariant={idToHairFront(preview.id, preview.gender)}
                hairBackVariant={idToHairBack(preview.id)}
                hasBeard={preview.gender === 'male' ? idToHasBeard(preview.id) : false}
                role={preview.role}
                size={64}
                profile
              />
              <div>
                <div className={styles.previewName} style={{ color: preview.color }}>{preview.name}</div>
                <div className={styles.previewRole}>{preview.role} / {preview.gender === 'male' ? '男' : '女'} / {preview.age}歳</div>
              </div>
            </div>
            <div className={styles.previewPersonality}>{preview.personality}</div>
            <div className={styles.previewParams}>
              {Object.entries(preview.params).map(([k, v]) => (
                <div key={k} className={styles.paramRow}>
                  <span className={styles.paramLabel}>
                    {k === 'logic' ? '論理' : k === 'creativity' ? '創造' : k === 'morality' ? '道徳' : k === 'empathy' ? '共感' : k === 'ambition' ? '野心' : '社交'}
                  </span>
                  <div className={styles.paramBar}><div className={styles.paramFill} style={{ width: `${v}%`, background: preview.color }} /></div>
                  <span className={styles.paramVal}>{v}</span>
                </div>
              ))}
            </div>
            <p className={styles.noHome}>{'\uD83C\uDFD5\uFE0F'} 住処なし — 自分で建てる必要あり</p>
            <div className={styles.actions}>
              <button className={styles.rerollBtn} onClick={() => generate(selectedPreset!)}>
                {'\uD83C\uDFB2'} 別パターン
              </button>
              <button className={styles.addBtn} onClick={() => { onAdd(preview); onClose(); }}>
                {'\u2705'} この住民を追加
              </button>
            </div>
          </div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
