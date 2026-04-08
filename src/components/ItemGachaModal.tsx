import { useState, useEffect, useRef, useCallback } from 'react';
import type { ItemDef } from '../types';
import {
  ITEM_SINGLE_COST, ITEM_MULTI_COST, ITEM_MULTI_COUNT,
  N_ITEMS, R_ITEMS, rollItem,
} from '../lib/itemGachaData';
import styles from './ItemGachaModal.module.css';

type ItemResult = { item: ItemDef };

// 演出フェーズ
type SinglePhase = 'idle' | 'blackout' | 'orb' | 'flash' | 'reveal';
type MultiPhase = 'idle' | 'blackout' | 'grid' | 'flash' | 'summary' | 'results';

function Sparkles({ color }: { color: string }) {
  const ps = useRef(Array.from({ length: 14 }, () => ({
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

const orbColor = (rarity: 'N' | 'R') => rarity === 'R' ? '#66bb6a' : '#e8dcc8';
const orbGlow = (rarity: 'N' | 'R') => rarity === 'R' ? '#a5d6a7' : '#fff8e8';

interface Props {
  conceptualPoints: number;
  onSpendPoints: (amount: number) => void;
  onAddItems: (items: ItemDef[]) => void;
  onClose: () => void;
}

export default function ItemGachaModal({ conceptualPoints, onSpendPoints, onAddItems, onClose }: Props) {
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const t = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  // 共通
  const [results, setResults] = useState<ItemResult[]>([]);
  const [viewIndex, setViewIndex] = useState(0);
  const [acquired, setAcquired] = useState(false);

  // 単発
  const [singlePhase, setSinglePhase] = useState<SinglePhase>('idle');
  const [pendingSingle, setPendingSingle] = useState<ItemResult | null>(null);
  const pendingSingleRef = useRef(pendingSingle);
  useEffect(() => { pendingSingleRef.current = pendingSingle; }, [pendingSingle]);

  // 10連
  const [multiPhase, setMultiPhase] = useState<MultiPhase>('idle');
  const [multiResults, setMultiResults] = useState<ItemResult[]>([]);
  const [litCount, setLitCount] = useState(0);
  const [summaryRevealCount, setSummaryRevealCount] = useState(0);

  const isAnimating = singlePhase !== 'idle' || multiPhase !== 'idle';
  const canSingle = conceptualPoints >= ITEM_SINGLE_COST && !isAnimating && results.length === 0;
  const canMulti = conceptualPoints >= ITEM_MULTI_COST && !isAnimating && results.length === 0;

  // ==================== 単発演出 ====================
  const SINGLE_SEQ: SinglePhase[] = ['blackout', 'orb', 'flash', 'reveal'];
  const SINGLE_AUTO: Partial<Record<SinglePhase, number>> = { blackout: 500, orb: 1200, flash: 400 };

  const scheduleSingleAuto = (phase: SinglePhase) => {
    const delay = SINGLE_AUTO[phase];
    if (delay == null) return;
    const next = SINGLE_SEQ[SINGLE_SEQ.indexOf(phase) + 1];
    if (!next) return;
    t(delay, () => { setSinglePhase(next); if (next !== 'reveal') scheduleSingleAuto(next); });
  };

  const pullSingle = () => {
    if (!canSingle) return;
    onSpendPoints(ITEM_SINGLE_COST);
    const item = rollItem();
    setPendingSingle({ item });
    setSinglePhase('blackout');
    scheduleSingleAuto('blackout');
  };

  const advanceSingle = () => {
    if (singlePhase === 'idle' || singlePhase === 'reveal') return;
    if (singlePhase in SINGLE_AUTO) return; // 自動進行中はスキップ不可
  };

  // reveal到達
  useEffect(() => {
    if (singlePhase !== 'reveal' || !pendingSingleRef.current) return;
    setResults([pendingSingleRef.current]);
    setViewIndex(0);
    setAcquired(false);
    setPendingSingle(null);
  }, [singlePhase]);

  // ==================== 10連演出 ====================
  const pullMulti = () => {
    if (!canMulti) return;
    onSpendPoints(ITEM_MULTI_COST);
    const batch = Array.from({ length: ITEM_MULTI_COUNT }, () => ({ item: rollItem() }));
    setMultiResults(batch);
    setLitCount(0);
    setMultiPhase('blackout');
    t(500, () => {
      setMultiPhase('grid');
      for (let i = 0; i < ITEM_MULTI_COUNT; i++) {
        t(500 * (i + 1), () => setLitCount(i + 1));
      }
      t(500 * ITEM_MULTI_COUNT + 800, () => setMultiPhase('flash'));
      t(500 * ITEM_MULTI_COUNT + 1300, () => {
        setMultiPhase('summary');
        setSummaryRevealCount(0);
        for (let i = 0; i < ITEM_MULTI_COUNT; i++) {
          t(400 * (i + 1), () => setSummaryRevealCount(i + 1));
        }
      });
    });
  };

  const advanceMulti = () => {
    if (multiPhase === 'grid' || multiPhase === 'blackout') {
      clearTimers();
      setLitCount(ITEM_MULTI_COUNT);
      setMultiPhase('flash');
      t(400, () => {
        setMultiPhase('summary');
        setSummaryRevealCount(ITEM_MULTI_COUNT);
      });
    } else if (multiPhase === 'summary') {
      if (summaryRevealCount < ITEM_MULTI_COUNT) {
        clearTimers();
        setSummaryRevealCount(ITEM_MULTI_COUNT);
      } else {
        clearTimers();
        setMultiPhase('results');
        setResults(multiResults);
        setViewIndex(0);
        setAcquired(false);
      }
    }
  };

  // 取得
  const acquireAll = () => {
    onAddItems(results.map((r) => r.item));
    setAcquired(true);
  };
  const resetAll = () => {
    setResults([]); setViewIndex(0); setSinglePhase('idle'); setMultiPhase('idle');
    setMultiResults([]); setLitCount(0); setSummaryRevealCount(0);
    setPendingSingle(null); setAcquired(false);
    clearTimers();
  };

  // ==================== 単発演出中 ====================
  if (singlePhase !== 'idle' && singlePhase !== 'reveal') {
    const rc = pendingSingle ? orbColor(pendingSingle.item.rarity) : '#e8dcc8';
    const rg = pendingSingle ? orbGlow(pendingSingle.item.rarity) : '#fff8e8';
    return (
      <div className={styles.animOverlay} onClick={advanceSingle}>
        <div className={`${styles.animBg} ${singlePhase === 'flash' ? styles.animBgFlash : ''}`}
          style={{ background: singlePhase === 'flash' ? '#fff' : '#000' }} />
        {(singlePhase === 'orb' || singlePhase === 'flash') && (
          <div className={`${styles.orb} ${singlePhase === 'flash' ? styles.orbExplode : ''}`}
            style={{ background: `radial-gradient(circle, ${rc}, transparent)`, boxShadow: `0 0 40px ${rg}, 0 0 80px ${rg}` }} />
        )}
        <div className={styles.animSkipHint}>演出中...</div>
      </div>
    );
  }

  // ==================== 10連演出中 ====================
  if (multiPhase !== 'idle' && multiPhase !== 'results') {
    const hasR = multiResults.some((r) => r.item.rarity === 'R');
    const flashColor = hasR ? '#66bb6a' : '#fff8e8';

    return (
      <div className={styles.animOverlay} onClick={advanceMulti}>
        <div className={`${styles.animBg} ${multiPhase === 'flash' ? styles.animBgFlash : ''}`}
          style={{ background: multiPhase === 'flash' ? '#fff' : '#000' }} />

        {multiPhase === 'grid' && (
          <div className={styles.multiGrid}>
            {multiResults.map((r, i) => {
              const lit = i < litCount;
              const color = orbColor(r.item.rarity);
              const glow = orbGlow(r.item.rarity);
              return (
                <div key={i} className={`${styles.gridCell} ${lit ? styles.gridCellLit : ''}`}>
                  <div
                    className={`${styles.gridOrb} ${lit && r.item.rarity === 'R' ? styles.gridOrbR : ''}`}
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

        {multiPhase === 'summary' && (
          <div className={styles.summaryWrap}>
            <div className={styles.summaryGrid}>
              {multiResults.map((r, i) => {
                const revealed = i < summaryRevealCount;
                const color = orbColor(r.item.rarity);
                const glow = orbGlow(r.item.rarity);
                return (
                  <div key={i} className={`${styles.summaryCell} ${r.item.rarity === 'R' ? styles.summaryCellR : ''}`}>
                    {revealed ? (
                      <div className={styles.revealedItem}>
                        <div className={styles.revealedItemEmoji}>{r.item.emoji}</div>
                        <div className={styles.revealedItemRarity} style={{ color: r.item.rarity === 'R' ? '#66bb6a' : '#8b7355' }}>
                          {r.item.rarity}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.gridOrb} style={{
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
    const hasR = results.some((r) => r.item.rarity === 'R');
    return (
      <div className={hasR ? styles.overlayR : styles.overlay}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {isMulti && (
            <div className={styles.multiNav}>
              {results.map((r, i) => (
                <button key={i}
                  className={`${styles.multiDot} ${i === viewIndex ? styles.multiDotActive : ''} ${r.item.rarity === 'R' ? styles.multiDotR : ''}`}
                  onClick={() => setViewIndex(i)}
                >{i + 1}</button>
              ))}
            </div>
          )}

          <Sparkles color={cur.item.rarity === 'R' ? '#66bb6a' : '#e8dcc8'} />

          <div className={`${styles.resultRarityBar} ${cur.item.rarity === 'R' ? styles.rarityR : styles.rarityN}`}>
            {cur.item.rarity === 'R' ? `\u2B50 R \u2014 ${cur.item.name}` : `N \u2014 ${cur.item.name}`}
          </div>

          <div className={`${styles.resultCard} ${cur.item.rarity === 'R' ? styles.resultCardR : ''}`}>
            <div className={styles.resultHeader}>
              <div className={styles.resultEmoji}>{cur.item.emoji}</div>
              <div>
                <span className={styles.resultName}>{cur.item.name}</span>
                <span className={`${styles.resultRarityBadge} ${cur.item.rarity === 'R' ? styles.resultRarityR : styles.resultRarityN}`}>
                  {cur.item.rarity}
                </span>
              </div>
            </div>
            <div className={styles.resultDesc}>{cur.item.description}</div>
          </div>

          <div className={styles.actions}>
            {!acquired && (
              <button className={styles.acquireBtn} onClick={acquireAll}>
                {isMulti ? 'すべて取得' : '取得する'}
              </button>
            )}
          </div>

          {acquired && (
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: '#2e7d32' }}>
              インベントリに追加しました！
            </div>
          )}

          {acquired ? (
            <>
              <button className={styles.acquireBtn} style={{ width: '100%', marginTop: 8 }} onClick={resetAll}>
                もう一度引く
              </button>
              <button className={styles.closeBtn} onClick={onClose}>
                閉じる
              </button>
            </>
          ) : (
            <button className={styles.closeBtn} onClick={onClose}>
              閉じる
            </button>
          )}
        </div>
      </div>
    );
  }

  // ==================== 待機画面 ====================
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{'\uD83C\uDF00'} 概念ガチャ</div>
        <div className={styles.desc}>概念Pを捧げてアイテムを手に入れる</div>
        <div className={styles.pointsBar}>
          <span>{'\uD83D\uDCA0'} 概念P: <strong>{conceptualPoints}</strong></span>
        </div>
        <div className={styles.rateInfo}>
          <span>N: 70% / R: 30%</span>
        </div>

        <button className={styles.pullBtn} disabled={!canSingle} onClick={pullSingle}>
          単発 {ITEM_SINGLE_COST}P
        </button>
        <button className={`${styles.pullBtn} ${styles.pullBtnMulti}`} disabled={!canMulti} onClick={pullMulti}>
          10連 {ITEM_MULTI_COST}P（1回お得）
        </button>

        {/* アイテム一覧 */}
        <details className={styles.infoSection}>
          <summary className={styles.infoTitle} style={{ cursor: 'pointer' }}>
            {'\uD83D\uDCD6'} Nアイテム一覧（{N_ITEMS.length}種）
          </summary>
          <div className={styles.itemList}>
            {N_ITEMS.map((item) => (
              <div key={item.id} className={`${styles.itemEntry} ${styles.itemEntryN}`}>
                <span className={styles.itemEmoji}>{item.emoji}</span>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemDesc}>{item.description}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.infoSection}>
          <summary className={styles.infoTitle} style={{ cursor: 'pointer' }}>
            {'\u2B50'} Rアイテム一覧（{R_ITEMS.length}種）
          </summary>
          <div className={styles.itemList}>
            {R_ITEMS.map((item) => (
              <div key={item.id} className={`${styles.itemEntry} ${styles.itemEntryR}`}>
                <span className={styles.itemEmoji}>{item.emoji}</span>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemDesc}>{item.description}</span>
              </div>
            ))}
          </div>
        </details>

        <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
