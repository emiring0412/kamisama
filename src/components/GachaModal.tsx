import { useState, useEffect, useRef, useCallback } from 'react';
import type { NPC, NPCParams } from '../types';
import { MAP_WIDTH, MAP_HEIGHT, FACILITIES } from '../lib/constants';
import { SINGLE_COST, MULTI_COST, MULTI_COUNT, getRRate, getSRRate, R_TEMPLATES, SR_TEMPLATES, jitterRParams } from '../lib/gachaData';
import type { RTemplate } from '../lib/gachaData';
import { randomAge, randomLifespan } from '../lib/lifespanSystem';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';
import styles from './GachaModal.module.css';

// ===== 共通データ =====
const NAMES_MALE = ['カズマ', 'シュウ', 'レイ', 'ジン', 'ケイ', 'トウマ', 'サトシ', 'ユウキ', 'リュウ', 'コウ', 'ダイチ', 'ミナト', 'ハヤト', 'ショウ', 'アキラ'];
const NAMES_FEMALE = ['ミサキ', 'カエデ', 'ヒナタ', 'スズ', 'ナツミ', 'ホノカ', 'チヒロ', 'ユキ', 'アカネ', 'シオリ', 'ルナ', 'メイ', 'カリン', 'イズミ', 'モモ'];
const ROLES = ['農民', '商人', '職人', '探検家', '漁師', '猟師', '薬師', '楽師', '語り部', '鍛冶師'];
const EMOJIS_MALE = ['👨', '🧑', '👦', '🧔', '👨‍🦱'];
const EMOJIS_FEMALE = ['👩', '🧑‍🦰', '👧', '👩‍🦳', '👩‍🦱'];
const COLORS = [
  '#F44336', '#E53935', '#C62828', '#D32F2F', '#FF5252',
  '#FF9800', '#FB8C00', '#F57C00', '#EF6C00', '#E65100',
  '#795548', '#6D4C41', '#5D4037', '#4E342E', '#A1887F',
  '#4CAF50', '#43A047', '#388E3C', '#2E7D32', '#1B5E20',
  '#2196F3', '#1E88E5', '#1976D2', '#1565C0', '#0D47A1',
  '#9C27B0', '#8E24AA', '#7B1FA2', '#6A1B9A', '#AB47BC',
  '#BF8A30', '#D4AF37', '#C5A030', '#DAA520', '#B8860B',
];
const N_PRESETS: Array<{ personality: string; params: NPCParams }> = [
  { personality: '穏やかで人当たりが良い。争いを避け、周囲に気を配る。', params: { logic: 10, creativity: 10, morality: 25, empathy: 30, ambition: 5, sociability: 20 } },
  { personality: '上を目指す野心家。目的のためなら手段を選ばない。', params: { logic: 20, creativity: 15, morality: 5, empathy: 5, ambition: 40, sociability: 15 } },
  { personality: '寡黙だが腕は確か。良いものを作ることに人生を捧げる。', params: { logic: 25, creativity: 30, morality: 15, empathy: 10, ambition: 10, sociability: 10 } },
  { personality: '好奇心の塊。未知の世界を求めて走り回る自由人。', params: { logic: 10, creativity: 25, morality: 10, empathy: 15, ambition: 20, sociability: 20 } },
  { personality: 'とにかく明るい。誰とでもすぐ仲良くなる。', params: { logic: 5, creativity: 15, morality: 15, empathy: 20, ambition: 10, sociability: 35 } },
  { personality: '人嫌いの一匹狼。静かに暮らすことだけを望む。', params: { logic: 20, creativity: 15, morality: 20, empathy: 5, ambition: 5, sociability: 5 } },
];

function randomFrom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function jitterParams(base: NPCParams): NPCParams {
  const keys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const raw: Record<string, number> = {};
  for (const k of keys) raw[k] = Math.max(0, base[k] + Math.floor((Math.random() - 0.5) * 10));
  const total = keys.reduce((s, k) => s + raw[k], 0);
  if (total > 0) { const r = 100 / total; for (const k of keys) raw[k] = Math.round(raw[k] * r); }
  const diff = 100 - (['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const).reduce((s, k) => s + raw[k], 0);
  if (diff !== 0) raw.logic += diff;
  return raw as unknown as NPCParams;
}

function findOpenSpot(): { x: number; y: number } {
  const areas = FACILITIES.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height }));
  for (let i = 0; i < 30; i++) {
    const cx = 30 + Math.random() * (MAP_WIDTH - 60), cy = 30 + Math.random() * (MAP_HEIGHT - 60);
    if (!areas.some((f) => cx > f.x - 20 && cx < f.x + f.width + 20 && cy > f.y - 20 && cy < f.y + f.height + 20))
      return { x: cx, y: cy };
  }
  return { x: 30 + Math.random() * 60, y: 200 + Math.random() * 40 };
}

function buildNPC(gender: 'male' | 'female', role: string, personality: string, params: NPCParams, existingNames: string[]): NPC {
  const pool = gender === 'male' ? NAMES_MALE : NAMES_FEMALE;
  const avail = pool.filter((n) => !existingNames.includes(n));
  const name = avail.length > 0 ? randomFrom(avail) : `旅人${Date.now() % 1000}`;
  const { x, y } = findOpenSpot();
  return {
    id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name, gender, role, personality,
    emoji: randomFrom(gender === 'male' ? EMOJIS_MALE : EMOJIS_FEMALE),
    color: randomFrom(COLORS),
    x, y, targetX: x, targetY: y, homeX: x, homeY: y,
    params, mood: '期待', memory: ['この村にたどり着いた'], longTermMemory: [],
    relationships: {}, beliefs: [], proposals: [], paramChangeAccum: 0,
    bubble: null, bubbleType: null, bubbleTimer: 0,
    lastAiCall: 0, isWaiting: false, age: randomAge(), lifespan: randomLifespan(),
  };
}

const PARAM_COLORS: Record<string, string> = { logic: '#42a5f5', creativity: '#ab47bc', morality: '#66bb6a', empathy: '#ff7043', ambition: '#ffa726', sociability: '#ec407a' };
const PARAM_LABELS: Record<string, string> = { logic: '論理', creativity: '創造', morality: '道徳', empathy: '共感', ambition: '野心', sociability: '社交' };

type GachaResult = { npc: NPC; rarity: 'N' | 'R' | 'SR'; template?: RTemplate };

// 単発演出フェーズ
type SinglePhase = 'idle' | 'blackout' | 'orb' | 'flash' | 'rarity' | 'silhouette' | 'reveal';
// 10連演出フェーズ
type MultiPhase = 'idle' | 'blackout' | 'grid' | 'flash' | 'summary' | 'results';

function Sparkles({ color }: { color: string }) {
  const ps = useRef(Array.from({ length: 20 }, () => ({
    x: 50 + (Math.random() - 0.5) * 60, y: 50 + (Math.random() - 0.5) * 60,
    size: 3 + Math.random() * 5, delay: Math.random() * 0.6, dur: 0.6 + Math.random() * 0.8,
  }))).current;
  return (
    <div className={styles.sparklesContainer}>
      {ps.map((p, i) => <div key={i} className={styles.sparkle} style={{
        left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size,
        background: color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
      }} />)}
    </div>
  );
}

interface Props {
  existingNames: string[];
  physicalPoints: number;
  onAdd: (npc: NPC) => void;
  onSpendPoints: (amount: number) => void;
  onClose: () => void;
}

export default function GachaModal({ existingNames, physicalPoints, onAdd, onSpendPoints, onClose }: Props) {
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const t = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  // 共通state
  const [results, setResults] = useState<GachaResult[]>([]);
  const [viewIndex, setViewIndex] = useState(0);

  // 単発
  const [singlePhase, setSinglePhase] = useState<SinglePhase>('idle');
  const [pendingSingle, setPendingSingle] = useState<GachaResult | null>(null);
  const pendingSingleRef = useRef(pendingSingle);
  useEffect(() => { pendingSingleRef.current = pendingSingle; }, [pendingSingle]);

  // 10連
  const [multiPhase, setMultiPhase] = useState<MultiPhase>('idle');
  const [multiResults, setMultiResults] = useState<GachaResult[]>([]);
  const [litCount, setLitCount] = useState(0); // グリッドで何個光ったか
  const [summaryRevealCount, setSummaryRevealCount] = useState(0); // サマリーで何個シルエットになったか
  const [_revealIndex, setRevealIndex] = useState(-1);

  const isAnimating = singlePhase !== 'idle' || multiPhase !== 'idle';
  const canSingle = physicalPoints >= SINGLE_COST && !isAnimating && results.length === 0;
  const canMulti = physicalPoints >= MULTI_COST && !isAnimating && results.length === 0;

  // 1体分の抽選
  const rollOne = (isMulti: boolean): GachaResult => {
    // SR判定（SR_TEMPLATESが空なら出ない）
    if (SR_TEMPLATES.length > 0 && Math.random() < getSRRate(isMulti)) {
      const tmpl = randomFrom(SR_TEMPLATES);
      const g = tmpl.genderLock ?? (Math.random() < 0.5 ? 'male' : 'female');
      const npc = buildNPC(g, tmpl.role, tmpl.personality, jitterRParams(tmpl.params), existingNames);
      npc.rarity = 'SR';
      return { npc, rarity: 'SR', template: tmpl };
    }
    // R判定
    if (Math.random() < getRRate(isMulti)) {
      const tmpl = randomFrom(R_TEMPLATES);
      const g = tmpl.genderLock ?? (Math.random() < 0.5 ? 'male' : 'female');
      const npc = buildNPC(g, tmpl.role, tmpl.personality, jitterRParams(tmpl.params), existingNames);
      npc.rarity = 'R';
      return { npc, rarity: 'R', template: tmpl };
    }
    const g = Math.random() < 0.5 ? 'male' : 'female';
    const p = randomFrom(N_PRESETS);
    return { npc: buildNPC(g, randomFrom(ROLES), p.personality, jitterParams(p.params), existingNames), rarity: 'N' };
  };

  // ==================== 単発演出 ====================
  const SINGLE_SEQ: SinglePhase[] = ['blackout', 'orb', 'flash', 'rarity', 'silhouette', 'reveal'];
  const SINGLE_AUTO: Partial<Record<SinglePhase, number>> = { blackout: 600, orb: 1400, flash: 500 };

  const scheduleSingleAuto = (phase: SinglePhase) => {
    const delay = SINGLE_AUTO[phase];
    if (delay == null) return;
    const next = SINGLE_SEQ[SINGLE_SEQ.indexOf(phase) + 1];
    if (!next) return;
    t(delay, () => { setSinglePhase(next); if (next !== 'reveal') scheduleSingleAuto(next); });
  };

  const pullSingle = () => {
    if (!canSingle) return;
    onSpendPoints(SINGLE_COST);
    const res = rollOne(false);
    setPendingSingle(res);
    setSinglePhase('blackout');
    scheduleSingleAuto('blackout');
  };

  const lastAdvanceTime = useRef(0);
  const advanceSingle = () => {
    if (singlePhase === 'idle' || singlePhase === 'reveal') return;
    // 自動進行中のフェーズ（blackout/orb/flash）はタップで飛ばさない
    if (singlePhase in SINGLE_AUTO) return;
    // 連打防止（300ms）
    const now = Date.now();
    if (now - lastAdvanceTime.current < 300) return;
    lastAdvanceTime.current = now;

    clearTimers();
    const next = SINGLE_SEQ[SINGLE_SEQ.indexOf(singlePhase) + 1];
    if (!next) return;
    setSinglePhase(next);
    if (next !== 'reveal') scheduleSingleAuto(next);
  };

  // reveal到達
  useEffect(() => {
    if (singlePhase !== 'reveal' || !pendingSingleRef.current) return;
    setResults([pendingSingleRef.current]);
    setViewIndex(0);
    setPendingSingle(null);
  }, [singlePhase]);

  // ==================== 10連演出 ====================
  const pullMulti = () => {
    if (!canMulti) return;
    onSpendPoints(MULTI_COST);
    const batch = Array.from({ length: MULTI_COUNT }, () => rollOne(true));
    setMultiResults(batch);
    setLitCount(0);
    setRevealIndex(-1);
    setMultiPhase('blackout');
    // 暗転 → グリッド表示
    t(600, () => {
      setMultiPhase('grid');
      // 1個ずつ光らせる（700msごと）
      for (let i = 0; i < MULTI_COUNT; i++) {
        t(700 * (i + 1), () => setLitCount(i + 1));
      }
      // 全部光った後に余韻 → フラッシュ → サマリー
      t(700 * MULTI_COUNT + 1200, () => setMultiPhase('flash'));
      t(700 * MULTI_COUNT + 2000, () => {
        setMultiPhase('summary');
        setSummaryRevealCount(0);
        // 500msごとに1つずつ変化
        for (let i = 0; i < MULTI_COUNT; i++) {
          t(500 * (i + 1), () => setSummaryRevealCount(i + 1));
        }
      });
    });
  };

  // 10連: タップで進む
  const advanceMulti = () => {
    if (multiPhase === 'grid' || multiPhase === 'blackout') {
      // グリッド/暗転中: 全部光らせてフラッシュ→サマリーへスキップ
      clearTimers();
      setLitCount(MULTI_COUNT);
      setMultiPhase('flash');
      t(500, () => {
        setMultiPhase('summary');
        setSummaryRevealCount(MULTI_COUNT); // 即全部表示
      });
    } else if (multiPhase === 'summary') {
      if (summaryRevealCount < MULTI_COUNT) {
        // まだ変化中: 全部即表示
        clearTimers();
        setSummaryRevealCount(MULTI_COUNT);
      } else {
        // 全部表示済み: リザルトへ
        clearTimers();
        setMultiPhase('results');
        setResults(multiResults);
        setViewIndex(0);
        setRevealIndex(0);
      }
    }
    // flash中はタップ無視（自動でsummaryに遷移する）
  };

  // 村に迎える / 見送る
  const confirmAdd = (idx: number) => {
    onAdd(results[idx].npc);
    removeResult(idx);
  };
  const skipResult = (idx: number) => removeResult(idx);
  const removeResult = (idx: number) => {
    const next = results.filter((_, i) => i !== idx);
    if (next.length === 0) { resetAll(); return; }
    setResults(next);
    setViewIndex(Math.min(idx, next.length - 1));
  };
  const skipAll = () => resetAll();
  const resetAll = () => {
    setResults([]); setViewIndex(0); setSinglePhase('idle'); setMultiPhase('idle');
    setMultiResults([]); setLitCount(0); setSummaryRevealCount(0); setRevealIndex(-1); setPendingSingle(null);
    clearTimers();
  };

  // レアリティカラー
  const orbColor = (rarity: 'N' | 'R' | 'SR') => rarity === 'SR' ? '#9c27b0' : rarity === 'R' ? '#4a6cf7' : '#e8dcc8';
  const orbGlow = (rarity: 'N' | 'R' | 'SR') => rarity === 'SR' ? '#ce93d8' : rarity === 'R' ? '#4a6cf7' : '#fff8e8';

  const renderParams = (params: NPCParams) => (
    <div className={styles.resultParams}>
      {(['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const).map((k) => (
        <div key={k} className={styles.paramRow}>
          <span className={styles.paramLabel}>{PARAM_LABELS[k]}</span>
          <div className={styles.paramBar}>
            <div className={styles.paramFill} style={{ width: `${params[k]}%`, background: PARAM_COLORS[k] }} />
          </div>
          <span className={styles.paramVal}>{params[k]}</span>
        </div>
      ))}
    </div>
  );

  const renderSprite = (npc: NPC, size: number, silhouette = false) => (
    <CharacterSprite
      gender={npc.gender}
      hairColor={silhouette ? '#000' : npc.color}
      clothColor={silhouette ? '#000' : idToClothHex(npc.id)}
      skinColor={silhouette ? '#111' : idToSkinHex(npc.id)}
      eyeColor={silhouette ? '#000' : idToEyeHex(npc.id)}
      mouthColor={silhouette ? '#000' : idToMouthHex(npc.id)}
      hairFrontVariant={idToHairFront(npc.id, npc.gender)}
      hairBackVariant={idToHairBack(npc.id)}
      hasBeard={npc.gender === 'male' ? idToHasBeard(npc.id) : false}
      role={npc.role} rarity={npc.rarity} size={size} profile={true}
    />
  );

  // ==================== 単発演出中 ====================
  if (singlePhase !== 'idle' && singlePhase !== 'reveal') {
    const rc = pendingSingle ? orbColor(pendingSingle.rarity) : '#e8dcc8';
    const rg = pendingSingle ? orbGlow(pendingSingle.rarity) : '#fff8e8';
    return (
      <div className={styles.animOverlay} onClick={advanceSingle}>
        <div className={`${styles.animBg} ${singlePhase === 'flash' ? styles.animBgFlash : ''}`}
          style={{ background: singlePhase === 'flash' ? '#fff' : '#000' }} />
        {(singlePhase === 'orb' || singlePhase === 'flash') && (
          <div className={`${styles.orb} ${singlePhase === 'flash' ? styles.orbExplode : ''}`}
            style={{ background: `radial-gradient(circle, ${rc}, transparent)`, boxShadow: `0 0 60px ${rg}, 0 0 120px ${rg}` }} />
        )}
        {singlePhase === 'rarity' && pendingSingle && (
          <div className={styles.animRarity}>
            <div className={styles.animRarityText} style={{ color: pendingSingle.rarity === 'SR' ? '#ce93d8' : pendingSingle.rarity === 'R' ? '#4a6cf7' : '#c8b896' }}>
              {pendingSingle.rarity}
            </div>
            <Sparkles color={rc} />
          </div>
        )}
        {singlePhase === 'silhouette' && pendingSingle && (
          <div className={styles.animSilhouette}>
            <div className={styles.silhouetteWrap}>{renderSprite(pendingSingle.npc, 96, true)}</div>
            <Sparkles color={rc} />
          </div>
        )}
        <div className={styles.animSkipHint}>タップで進む</div>
      </div>
    );
  }

  // ==================== 10連演出中 ====================
  if (multiPhase !== 'idle' && multiPhase !== 'results') {
    // 最高レアリティの色でフラッシュ
    const hasR = multiResults.some((r) => r.rarity === 'R');
    const flashColor = hasR ? '#4a6cf7' : '#fff8e8';

    return (
      <div className={styles.animOverlay} onClick={advanceMulti}>
        <div className={`${styles.animBg} ${multiPhase === 'flash' ? styles.animBgFlash : ''}`}
          style={{ background: multiPhase === 'flash' ? '#fff' : '#000' }} />

        {multiPhase === 'grid' && (
          <div className={styles.multiGrid}>
            {multiResults.map((r, i) => {
              const lit = i < litCount;
              const color = orbColor(r.rarity);
              const glow = orbGlow(r.rarity);
              return (
                <div key={i} className={`${styles.gridCell} ${lit ? styles.gridCellLit : ''}`}>
                  <div
                    className={`${styles.gridOrb} ${lit && (r.rarity === 'SR' ? styles.gridOrbSR : r.rarity === 'R' ? styles.gridOrbR : '')}`}
                    style={lit ? {
                      background: `radial-gradient(circle, ${color}, transparent)`,
                      boxShadow: `0 0 15px ${glow}, 0 0 30px ${glow}`,
                      opacity: 1,
                    } : { opacity: 0 }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {multiPhase === 'flash' && <Sparkles color={flashColor} />}

        {/* サマリー: 光の玉が1つずつシルエットに変化 */}
        {multiPhase === 'summary' && (
          <div className={styles.summaryWrap}>
            <div className={styles.silhouetteGrid}>
              {multiResults.map((r, i) => {
                const revealed = i < summaryRevealCount;
                const color = orbColor(r.rarity);
                const glow = orbGlow(r.rarity);
                return (
                  <div key={i} className={`${styles.silhouetteCell} ${r.rarity === 'R' ? styles.silhouetteCellR : ''}`}>
                    {revealed ? (
                      <div className={`${styles.revealedSilhouette} ${r.rarity === 'SR' ? styles.revealedSilhouetteSR : r.rarity === 'R' ? styles.revealedSilhouetteR : ''}`}>
                        <div className={styles.silhouetteFigure}>
                          {renderSprite(r.npc, 48, true)}
                        </div>
                        <div className={styles.silhouetteRarity} style={{ color: r.rarity === 'R' ? '#7ba0ff' : '#888' }}>
                          {r.rarity}
                        </div>
                      </div>
                    ) : (
                      <div className={`${styles.gridOrb} ${r.rarity === 'SR' ? styles.gridOrbSR : r.rarity === 'R' ? styles.gridOrbR : ''}`} style={{
                        background: `radial-gradient(circle, ${color}, transparent)`,
                        boxShadow: `0 0 15px ${glow}, 0 0 30px ${glow}`,
                        opacity: 1, width: 30, height: 30,
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
            <Sparkles color={flashColor} />
          </div>
        )}

        <div className={styles.animSkipHint}>
          {multiPhase === 'summary' ? 'タップで結果を見る' : 'タップでスキップ'}
        </div>
      </div>
    );
  }

  // ==================== 結果表示 ====================
  if (results.length > 0) {
    const cur = results[viewIndex];
    const isMulti = results.length > 1;
    return (
      <div className={cur.rarity === 'R' ? styles.overlayR : styles.overlay}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {isMulti && (
            <div className={styles.multiNav}>
              {results.map((r, i) => (
                <button key={r.npc.id}
                  className={`${styles.multiDot} ${i === viewIndex ? styles.multiDotActive : ''} ${r.rarity === 'SR' ? styles.multiDotSR : r.rarity === 'R' ? styles.multiDotR : ''}`}
                  onClick={() => setViewIndex(i)}
                >{i + 1}</button>
              ))}
            </div>
          )}

          <Sparkles color={cur.rarity === 'R' ? '#4a6cf7' : '#f0e6d0'} />

          <div className={`${styles.resultRarity} ${cur.rarity === 'SR' ? styles.raritySR : cur.rarity === 'R' ? styles.rarityR : styles.rarityN}`}>
            {cur.rarity === 'SR' ? `\u2728 SR \u2014 ${cur.template?.label}` : cur.rarity === 'R' ? `\u2B50 R \u2014 ${cur.template?.label}` : 'N \u2014 通常住民'}
          </div>

          <div className={`${styles.resultCard} ${cur.rarity === 'SR' ? styles.resultCardSR : cur.rarity === 'R' ? styles.resultCardR : ''} ${styles.resultCardBounce}`}>
            <div className={styles.resultHeader}>
              {renderSprite(cur.npc, 64)}
              <div>
                <div className={styles.resultName}>{cur.npc.name}</div>
                <div className={styles.resultRole}>{cur.npc.role} / {cur.npc.gender === 'female' ? '女' : '男'}</div>
              </div>
            </div>
            <div className={styles.resultPersonality}>{cur.npc.personality}</div>
            {renderParams(cur.npc.params)}
            <div className={styles.actions}>
              <button className={styles.addBtn} onClick={() => confirmAdd(viewIndex)}>村に迎える</button>
              <button className={styles.skipBtn} onClick={() => skipResult(viewIndex)}>見送る</button>
            </div>
          </div>

          <button className={styles.closeBtn} onClick={skipAll}>
            {isMulti ? '全員見送って閉じる' : '閉じる'}
          </button>
        </div>
      </div>
    );
  }

  // ==================== 待機画面 ====================
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{'\uD83C\uDFB0'} 召喚の儀</div>
        <div className={styles.desc}>物理Pを捧げて新たな住民を召喚する</div>
        <div className={styles.pointsBar}>
          <span>{'\u2B50'} 物理P: <strong>{physicalPoints}</strong></span>
        </div>
        <div className={styles.rateInfo}>
          <span>{SR_TEMPLATES.length > 0 ? 'N: 67% / R: 30% / SR: 3%' : 'N: 70% / R: 30%'}</span>
          <span className={styles.rateBonus}>10連はR率{SR_TEMPLATES.length > 0 ? '・SR率' : ''} +3%</span>
        </div>

        <button className={styles.pullBtn} disabled={!canSingle} onClick={pullSingle}>
          単発 {SINGLE_COST}P
        </button>
        <button className={`${styles.pullBtn} ${styles.pullBtnMulti}`} disabled={!canMulti} onClick={pullMulti}>
          10連 {MULTI_COST}P（1回お得）
        </button>

        {/* 説明セクション */}
        <div className={styles.infoSection}>
          <div className={styles.infoTitle}>{'\uD83D\uDCD6'} 召喚について</div>
          <table className={styles.infoTable}>
            <tbody>
              <tr>
                <td className={styles.infoRarityN}>N</td>
                <td>通常の住民。ランダムな職業・性格で村にやってくる。転職することがある。</td>
              </tr>
              <tr>
                <td className={styles.infoRarityR}>R</td>
                <td>特殊な職業と極端なパラメータを持つ住民。職業は<strong>生涯固定</strong>で、村に独自の影響を与える。</td>
              </tr>
              <tr>
                <td className={styles.infoRaritySR}>SR</td>
                <td>専用の見た目を持つ特別な住民。<strong>期間限定</strong>でのみ出現。</td>
              </tr>
            </tbody>
          </table>
          <div className={styles.infoNote}>
            {SR_TEMPLATES.length > 0
              ? <>
                  {'\u2728'} SR率: 単発{Math.round(getSRRate(false) * 100)}% / 10連{Math.round(getSRRate(true) * 100)}%<br/>
                  現在排出中SR: {SR_TEMPLATES.map((t) => t.label).join('、')}
                </>
              : '\u2728 現在はN・Rのみ排出されます。SRが出現する特別な期間が訪れることがあります。'}
          </div>
        </div>

        {/* R職業一覧 */}
        <details className={styles.infoSection}>
          <summary className={styles.infoTitle} style={{ cursor: 'pointer' }}>
            {'\u2B50'} R キャラクター一覧（{R_TEMPLATES.length}種）
          </summary>
          <div className={styles.rList}>
            {R_TEMPLATES.map((tmpl) => (
              <div key={tmpl.role} className={styles.rEntry}>
                <div className={styles.rEntryHeader}>
                  <span className={styles.rEntryLabel}>{tmpl.label}</span>
                  <span className={styles.rEntryRole}>{tmpl.role}{tmpl.genderLock ? (tmpl.genderLock === 'female' ? ' ♀' : ' ♂') : ''}</span>
                </div>
                <div className={styles.rEntryPersonality}>{tmpl.personality}</div>
              </div>
            ))}
          </div>
        </details>

        <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
