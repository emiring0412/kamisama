import { useEffect, useRef, useState, useMemo } from 'react';
import type { LogEntry, VillageHistory, CivilizationItem, Prayer } from '../types';
import styles from './LogPanel.module.css';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';

type TabKind = 'all' | 'solo' | 'conversation' | 'whisper' | 'history' | 'encyclopedia' | 'prayer';

// ささやき関連ログ
function isWhisperLog(log: LogEntry): boolean {
  return !!(log.npcName === '神' || log.think?.includes('神の声'));
}

// 会話ラリー（AI生成の複数往復）のみ
function isConversationLog(log: LogEntry): boolean {
  return !!(log.conversation && log.conversation.length > 0);
}

// 独白+行動+すれ違い（ラリー以外すべて）
function isSoloLog(log: LogEntry): boolean {
  return !isConversationLog(log);
}

interface NPCInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
  gender?: 'male' | 'female';
  role?: string;
  rarity?: 'N' | 'R' | 'SR';
}

interface Props {
  logs: LogEntry[];
  villageHistory?: VillageHistory;
  civilizations?: CivilizationItem[];
  npcs?: NPCInfo[];
  currentDay?: number;
  harvestedIds?: Set<string>;
  civilizationPoints?: { physical: number; conceptual: number };
  onHarvest?: (civId: string, category: string) => void;
  onHarvestAll?: () => void;
  prayers?: Prayer[];
  faithPoints?: number;
  onDismissPrayer?: (prayerId: string) => void;
  onWhisperForPrayer?: (npcId: string) => void;
}

// NPC名→スプライト or 絵文字
function NpcIcon({ name, emoji, npcs, size = 16 }: { name: string; emoji: string; npcs?: NPCInfo[]; size?: number }) {
  const npc = npcs?.find((n) => n.name === name);
  if (npc?.gender) {
    return (
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
        size={size}
      />
    );
  }
  return <span>{emoji}</span>;
}

export default function LogPanel({ logs, villageHistory, civilizations, npcs, currentDay: _currentDay, harvestedIds, civilizationPoints, onHarvest, onHarvestAll, prayers, faithPoints, onDismissPrayer, onWhisperForPrayer }: Props) {
  const [tab, setTab] = useState<TabKind>('all');
  const [filterNpc, setFilterNpc] = useState<string | null>(null); // NPC名でフィルタ
  const [filterCivCategory, setFilterCivCategory] = useState<string | null>(null); // 図鑑カテゴリフィルタ
  const [ancientOpen, setAncientOpen] = useState(false); // 古代の記録アコーディオン
  const [showEncyclopediaModal, setShowEncyclopediaModal] = useState(false); // 図鑑モーダル
  const [recentAllOpen, setRecentAllOpen] = useState(false); // 最近の出来事展開
  const [erasOpen, setErasOpen] = useState(false); // 過去の時代アコーディオン
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyMode, setCopyMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // NPCフィルタ適用
  const npcFilteredLogs = useMemo(() => {
    if (!filterNpc) return logs;
    return logs.filter((l) =>
      l.npcName === filterNpc || l.targetName === filterNpc ||
      l.conversation?.some((c) => c.who === filterNpc)
    );
  }, [logs, filterNpc]);

  const filteredLogs = useMemo(() => {
    const base = npcFilteredLogs;
    if (tab === 'all') return base;
    if (tab === 'conversation') return base.filter(isConversationLog);
    if (tab === 'whisper') return base.filter(isWhisperLog);
    if (tab === 'history') return base;
    return base.filter(isSoloLog);
  }, [npcFilteredLogs, tab]);

  // スクロール位置を監視（最新が上なのでトップ基準）
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atTop = el.scrollTop < 60;
    setAutoScroll(atTop);
  };

  // 自動スクロール（最新が上なのでトップへ）
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filteredLogs.length, autoScroll]);

  const tabCounts = useMemo(() => ({
    all: npcFilteredLogs.length,
    solo: npcFilteredLogs.filter(isSoloLog).length,
    conversation: npcFilteredLogs.filter(isConversationLog).length,
    whisper: npcFilteredLogs.filter(isWhisperLog).length,
  }), [npcFilteredLogs]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const logToText = (log: LogEntry): string => {
    const lines: string[] = [];
    lines.push(`[${log.timestamp}]`);
    if (log.targetName) {
      lines[0] += ` ${log.npcEmoji} ${log.npcName} → ${log.targetEmoji} ${log.targetName}`;
    } else {
      lines[0] += ` ${log.npcEmoji} ${log.npcName}`;
    }
    if (log.conversation && log.conversation.length > 0) {
      for (const c of log.conversation) {
        lines.push(`${c.emoji} ${c.who}「${c.say}」`);
      }
    }
    if (log.say && !log.conversation) lines.push(`💬 ${log.say}`);
    if (log.think) lines.push(`💭 ${log.think}`);
    if (log.action) lines.push(`→ ${log.action}`);
    return lines.join('\n');
  };

  const handleCopy = () => {
    const reversed = [...filteredLogs].reverse();
    const selected = reversed.filter((l) => selectedIds.has(l.id));
    if (selected.length === 0) return;
    const text = selected.map(logToText).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyMode(false);
      setSelectedIds(new Set());
    });
  };

  return (
    <div className={styles.panel}>
      {/* NPCフィルタ */}
      {npcs && npcs.length > 0 && (
        <div className={styles.npcFilter}>
          <button
            className={`${styles.filterBtn} ${!filterNpc ? styles.filterBtnActive : ''}`}
            onClick={() => setFilterNpc(null)}
          >
            全員
          </button>
          {npcs.map((npc) => (
            <button
              key={npc.id}
              className={`${styles.filterBtn} ${filterNpc === npc.name ? styles.filterBtnActive : ''}`}
              onClick={() => setFilterNpc(filterNpc === npc.name ? null : npc.name)}
              style={{ borderColor: filterNpc === npc.name ? npc.color : 'transparent' }}
            >
              <NpcIcon name={npc.name} emoji={npc.emoji} npcs={npcs} size={20} />
            </button>
          ))}
        </div>
      )}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
          onClick={() => setTab('all')}
        >
          全部 ({tabCounts.all})
        </button>
        <button
          className={`${styles.tab} ${tab === 'solo' ? styles.tabActive : ''}`}
          onClick={() => setTab('solo')}
        >
          {'\uD83D\uDCAD'} 独白&行動 ({tabCounts.solo})
        </button>
        <button
          className={`${styles.tab} ${tab === 'conversation' ? styles.tabActive : ''}`}
          onClick={() => setTab('conversation')}
        >
          {'\uD83D\uDCAC'} 会話ラリー ({tabCounts.conversation})
        </button>
        <button
          className={`${styles.tab} ${tab === 'whisper' ? styles.tabActive : ''}`}
          onClick={() => setTab('whisper')}
        >
          {'\uD83D\uDD2E'} 神の声 ({tabCounts.whisper})
        </button>
        <button
          className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
          onClick={() => setTab('history')}
        >
          {'\uD83D\uDCDC'} 歴史
        </button>
        <button
          className={`${styles.tab} ${showEncyclopediaModal ? styles.tabActive : ''}`}
          onClick={() => setShowEncyclopediaModal(true)}
        >
          {'\uD83D\uDCD6'} 図鑑{civilizations && civilizations.length > 0 ? ` (${civilizations.length})` : ''}
        </button>
        <button
          className={`${styles.tab} ${tab === 'prayer' ? styles.tabActive : ''}`}
          onClick={() => setTab('prayer')}
        >
          {'\uD83D\uDE4F'} 祈り{prayers && prayers.filter((p) => !p.fulfilled).length > 0 ? ` (${prayers.filter((p) => !p.fulfilled).length})` : ''}
        </button>
        <button
          className={`${styles.tab} ${copyMode ? styles.tabActive : ''}`}
          onClick={() => { setCopyMode(!copyMode); setSelectedIds(new Set()); }}
          style={{ marginLeft: 'auto' }}
        >
          {'\uD83D\uDCCB'} {copyMode ? '選択中' : 'コピー'}
        </button>
      </div>

      {/* コピペモードバー */}
      {copyMode && (
        <div style={{
          display: 'flex', gap: '8px', alignItems: 'center',
          padding: '6px 8px', background: '#f5ece0', borderRadius: '6px', marginBottom: '4px',
          fontSize: '12px', color: '#8b7355',
        }}>
          <span>{selectedIds.size}件選択中</span>
          <button
            onClick={() => {
              const allIds = new Set([...filteredLogs].reverse().map((l) => l.id));
              setSelectedIds(selectedIds.size === allIds.size ? new Set() : allIds);
            }}
            style={{
              background: 'none', border: '1px solid #c4b4a0', borderRadius: '4px',
              color: '#8b7355', padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >
            {selectedIds.size === filteredLogs.length ? '全解除' : '全選択'}
          </button>
          <button
            onClick={handleCopy}
            disabled={selectedIds.size === 0}
            style={{
              background: selectedIds.size > 0 ? 'linear-gradient(135deg, #c41e3a, #9a1630)' : '#e0d4c4',
              border: 'none', borderRadius: '4px', color: selectedIds.size > 0 ? '#fff' : '#9a8a70',
              padding: '4px 14px', fontSize: '12px', fontWeight: 700, cursor: selectedIds.size > 0 ? 'pointer' : 'default',
              marginLeft: 'auto',
            }}
          >
            {'\uD83D\uDCCB'} コピー
          </button>
          <button
            onClick={() => { setCopyMode(false); setSelectedIds(new Set()); }}
            style={{
              background: 'none', border: '1px solid #c4b4a0', borderRadius: '4px',
              color: '#8b7355', padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >
            {'\u2715'}
          </button>
        </div>
      )}

      {/* 歴史タブ */}
      {tab === 'history' && (
        <div className={styles.list}>
          {/* 古代の記録（アコーディオン） */}
          {villageHistory?.ancientLog && villageHistory.ancientLog.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.accordionHeader} onClick={() => setAncientOpen(!ancientOpen)}>
                <span>{ancientOpen ? '\u25BC' : '\u25B6'}</span>
                <span>{'\uD83D\uDDFF'} 古代の記録 ({villageHistory.ancientLog.length})</span>
              </div>
              {ancientOpen && villageHistory.ancientLog.map((line, i) => (
                <div key={`ancient-${i}`} className={styles.historyItem} style={{ color: '#9a8a70', fontStyle: 'italic' }}>{line}</div>
              ))}
            </div>
          )}

          {/* 過去の時代（アコーディオン） */}
          {villageHistory?.pastEras && villageHistory.pastEras.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.accordionHeader} onClick={() => setErasOpen(!erasOpen)}>
                <span>{erasOpen ? '\u25BC' : '\u25B6'}</span>
                <span>{'\uD83C\uDFDB\uFE0F'} 過去の時代 ({villageHistory.pastEras.length})</span>
              </div>
              {erasOpen && villageHistory.pastEras.map((era, i) => (
                <div key={i} className={styles.eraCard}>
                  <div className={styles.eraName}>{'\u300A'}{era.eraName}{'\u300B'} {era.period}</div>
                  <div className={styles.eraSummary}>{era.summary}</div>
                </div>
              ))}
            </div>
          )}

          {/* 最近の歴史（直近20件、展開で全件） */}
          {villageHistory?.recentHistory && villageHistory.recentHistory.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.historyLabel}>{'\uD83D\uDDD3\uFE0F'} 最近の出来事 ({villageHistory.recentHistory.length})</div>
              {villageHistory.recentHistory.slice(-20).map((entry, i) => (
                <div key={i} className={styles.historyItem}>{entry}</div>
              ))}
              {villageHistory.recentHistory.length > 20 && (
                <button
                  className={styles.accordionHeader}
                  onClick={() => setRecentAllOpen((prev) => !prev)}
                  style={{ marginTop: '4px', fontSize: '11px' }}
                >
                  {recentAllOpen ? '\u25BC 閉じる' : `\u25B6 もっと見る（残り${villageHistory.recentHistory.length - 20}件）`}
                </button>
              )}
              {recentAllOpen && villageHistory.recentHistory.length > 20 && (
                villageHistory.recentHistory.slice(0, -20).map((entry, i) => (
                  <div key={`old-${i}`} className={styles.historyItem} style={{ color: '#9a8a70' }}>{entry}</div>
                ))
              )}
            </div>
          )}

          {(!villageHistory?.pastEras?.length && !villageHistory?.recentHistory?.length) && (
            <div className={styles.empty}>まだ歴史は刻まれていません...</div>
          )}
        </div>
      )}

      {/* 祈りタブ */}
      {tab === 'prayer' && (
        <div className={styles.list}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px', fontSize: '12px' }}>
            <span style={{ color: '#8b7355' }}>
              {'\uD83D\uDE4F'} 信仰P: <strong style={{ color: '#c41e3a' }}>{faithPoints ?? 0}</strong>
            </span>
          </div>
          {prayers && prayers.length > 0 ? (
            <>
              {prayers.filter((p) => !p.fulfilled).length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#8b7355', fontWeight: 700, marginBottom: '4px' }}>{'\u2728'} 未成就の祈り</div>
                  {prayers.filter((p) => !p.fulfilled).map((p) => (
                    <div key={p.id} style={{
                      padding: '8px', marginBottom: '4px', borderRadius: '6px',
                      background: '#f5ece0', border: '1px solid #e0d4c4',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                        <NpcIcon name={p.npcName} emoji={p.npcEmoji} npcs={npcs} size={16} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#2a1a0a' }}>{p.npcName}</span>
                        <span style={{ fontSize: '10px', color: '#9a8a70', marginLeft: 'auto' }}>Day{p.day}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#2a1a0a' }}>「{p.message}」</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                        <div style={{ fontSize: '10px', color: '#9a8a70' }}>
                          {'\uD83D\uDD11'} {p.keywords.join('・')}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {onWhisperForPrayer && (
                            <button
                              onClick={() => onWhisperForPrayer(p.npcId)}
                              style={{
                                fontSize: '10px', color: '#c41e3a', background: 'none', border: '1px solid #c41e3a',
                                borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
                              }}
                              title="ささやきで導く"
                            >
                              {'\uD83D\uDD2E'} ささやく
                            </button>
                          )}
                          {onDismissPrayer && (
                            <button
                              onClick={() => onDismissPrayer(p.id)}
                              style={{
                                fontSize: '10px', color: '#9a8a70', background: 'none', border: '1px solid #d4c8b4',
                                borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
                              }}
                              title="この祈りを無視する"
                            >
                              {'\u274C'} 無視
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {prayers.filter((p) => p.fulfilled).length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', color: '#8b7355', fontWeight: 700, marginBottom: '4px' }}>{'\u2705'} 成就した祈り</div>
                  {prayers.filter((p) => p.fulfilled).map((p) => (
                    <div key={p.id} style={{
                      padding: '6px 8px', marginBottom: '3px', borderRadius: '6px',
                      background: '#f0f8f0', border: '1px solid #c4e0c4', opacity: 0.7,
                    }}>
                      <div style={{ fontSize: '11px', color: '#4CAF50' }}>
                        {p.npcEmoji} {p.npcName}「{p.message}」
                        <span style={{ color: '#9a8a70' }}> — Day{p.fulfilledDay}成就</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className={styles.empty}>まだ祈りは届いていません... 教会がある村では、住民が神に願い事をすることがあります</div>
          )}
        </div>
      )}

      {/* 図鑑タブ */}
      {showEncyclopediaModal && (
        <div className={styles.encyclopediaOverlay} onClick={() => setShowEncyclopediaModal(false)}>
        <div className={styles.encyclopediaModal} onClick={(e) => e.stopPropagation()}>
          <button className={styles.encyclopediaClose} onClick={() => setShowEncyclopediaModal(false)}>{'\u2715'}</button>
          {civilizations && civilizations.length > 0 ? (() => {
            const categoryIcon: Record<string, string> = {
              building: '\uD83C\uDFD7\uFE0F', tool: '\uD83D\uDD28', technology: '\u2699\uFE0F',
              rule: '\uD83D\uDCDC', exchange: '\uD83E\uDD1D', belief: '\u2728', new_belief: '\u2728',
              custom: '\uD83C\uDF8E', demolish: '\uD83D\uDEAB', organization: '\uD83C\uDFDB\uFE0F',
              discovery: '\uD83D\uDD0D',
            };
            const categoryLabel: Record<string, string> = {
              building: '建築', tool: '道具', technology: '技術',
              rule: '制度', exchange: '交易', belief: '信仰', new_belief: '信仰',
              custom: '文化', demolish: '撤去', organization: '組織',
              discovery: '発見',
            };
            // NEW判定: 最後の時代圧縮以降に追加されたもの
            const lastEra = villageHistory?.pastEras?.slice(-1)[0];
            const newSinceDay = lastEra?.period
              ? parseInt(lastEra.period.split('-')[1] ?? '0', 10) + 1
              : 1;
            const isNew = (civ: CivilizationItem) => civ.day >= newSinceDay;
            const newCount = civilizations.filter(isNew).length;

            // 存在するカテゴリだけフィルタボタンに出す
            const existingCategories = [...new Set(civilizations.map((c) => c.category))];
            const filtered = filterCivCategory === 'new'
              ? civilizations.filter(isNew)
              : filterCivCategory
                ? civilizations.filter((c) => c.category === filterCivCategory)
                : civilizations;
            return (
              <>
                {/* Pバー */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#8b7355' }}>
                    {'\uD83D\uDD28'} 物理P: <strong style={{ color: '#c41e3a' }}>{civilizationPoints?.physical ?? 0}</strong>
                  </span>
                  <span style={{ color: '#8b7355' }}>
                    {'\u2728'} 概念P: <strong style={{ color: '#c41e3a' }}>{civilizationPoints?.conceptual ?? 0}</strong>
                  </span>
                  {(() => {
                    const unharvestedCount = civilizations.filter((c) => !harvestedIds?.has(c.id) && c.category !== 'demolish').length;
                    return unharvestedCount > 0 ? (
                      <button
                        onClick={() => onHarvestAll?.()}
                        style={{
                          marginLeft: 'auto', padding: '3px 10px', fontSize: '11px', fontWeight: 700,
                          background: 'linear-gradient(135deg, #c41e3a, #9a1630)', color: '#fff',
                          border: 'none', borderRadius: '4px', cursor: 'pointer',
                        }}
                      >
                        {'\uD83C\uDF3E'} 全収穫 ({unharvestedCount})
                      </button>
                    ) : null;
                  })()}
                </div>

                <div className={styles.civFilter}>
                  <button
                    className={`${styles.civFilterBtn} ${!filterCivCategory ? styles.civFilterBtnActive : ''}`}
                    onClick={() => setFilterCivCategory(null)}
                  >
                    全て ({civilizations.length})
                  </button>
                  {newCount > 0 && (
                    <button
                      className={`${styles.civFilterBtn} ${styles.civFilterNew} ${filterCivCategory === 'new' ? styles.civFilterBtnActive : ''}`}
                      onClick={() => setFilterCivCategory(filterCivCategory === 'new' ? null : 'new')}
                    >
                      NEW ({newCount})
                    </button>
                  )}
                  {existingCategories.map((cat) => (
                    <button
                      key={cat}
                      className={`${styles.civFilterBtn} ${filterCivCategory === cat ? styles.civFilterBtnActive : ''}`}
                      onClick={() => setFilterCivCategory(filterCivCategory === cat ? null : cat)}
                    >
                      {categoryIcon[cat] ?? '\uD83D\uDCA1'} {categoryLabel[cat] ?? cat} ({civilizations.filter((c) => c.category === cat).length})
                    </button>
                  ))}
                </div>
                <div className={styles.encyclopediaGrid}>
                {[...filtered].reverse().map((civ) => (
                  <div key={civ.id} className={`${styles.encyclopediaCard} ${isNew(civ) ? styles.encyclopediaCardNew : ''}`}>
                    {isNew(civ) && <span className={styles.newBadge}>NEW</span>}
                    <div className={styles.encyclopediaIcon}>
                      {categoryIcon[civ.category] ?? '\uD83D\uDCA1'}
                    </div>
                    <div className={styles.encyclopediaName}>{civ.name}</div>
                    <div className={styles.encyclopediaCategory}>
                      {categoryLabel[civ.category] ?? civ.category}
                    </div>
                    <div className={styles.encyclopediaDesc}>{civ.description}</div>
                    {civ.locations && civ.locations.length > 0 && (
                      <div style={{ fontSize: '10px', color: '#8b7355', marginTop: '2px' }}>
                        {'\uD83D\uDCCD'} {civ.locations.join('・')}
                        {civ.discoveredBy && civ.discoveredBy.length > 0 && (
                          <span style={{ color: '#9a8a70' }}> ({civ.discoveredBy.join('・')})</span>
                        )}
                      </div>
                    )}
                    <div className={styles.encyclopediaMeta}>
                      Day{civ.day} / {civ.proposedBy}
                    </div>
                    {civ.category !== 'demolish' && (
                      harvestedIds?.has(civ.id) ? (
                        <div style={{ fontSize: '10px', color: '#9a8a70', marginTop: '4px' }}>{'\u2705'} 収穫済</div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onHarvest?.(civ.id, civ.category); }}
                          style={{
                            marginTop: '4px', padding: '2px 8px', fontSize: '10px', fontWeight: 600,
                            background: '#c41e3a', color: '#fff', border: 'none', borderRadius: '3px',
                            cursor: 'pointer',
                          }}
                        >
                          {'\uD83C\uDF3E'} +1P
                        </button>
                      )
                    )}
                  </div>
                ))}
                </div>
              </>
            );
          })() : (
            <div className={styles.empty}>まだ発明・発見はありません...</div>
          )}
        </div>
        </div>
      )}

      {/* ログタブ */}
      {tab !== 'history' && tab !== 'prayer' && (
      <div className={styles.list} ref={listRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 && (
          <div className={styles.empty}>
            {tab === 'all' ? 'NPCたちの行動がここに表示されます' :
             tab === 'solo' ? '独白ログはまだありません' :
             '会話ログはまだありません'}
          </div>
        )}
        {[...filteredLogs].reverse().map((log, idx) => (
          <div
            key={log.id}
            className={styles.entry}
            style={{
              borderLeftColor: idx % 2 === 0 ? '#c41e3a' : '#d4af37',
              opacity: copyMode && !selectedIds.has(log.id) ? 0.5 : 1,
              cursor: copyMode ? 'pointer' : undefined,
            }}
            onClick={copyMode ? () => toggleSelect(log.id) : undefined}
          >
            <div className={styles.header}>
              {copyMode && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0,
                  border: selectedIds.has(log.id) ? '2px solid #c41e3a' : '2px solid #c4b4a0',
                  background: selectedIds.has(log.id) ? '#c41e3a' : 'transparent',
                  color: '#fff', fontSize: '10px', fontWeight: 700, marginRight: '4px',
                }}>
                  {selectedIds.has(log.id) ? '\u2713' : ''}
                </span>
              )}
              <span className={styles.time}>[{log.timestamp}]</span>
              {log.source && (() => {
                const tagToStatus: Record<string, { label: string; color: string }> = {
                  'Qwen235B': { label: '明晰', color: '#4CAF50' },
                  'Qwen': { label: '平凡', color: '#c41e3a' },
                  'L70B': { label: '疲弊', color: '#FF9800' },
                  'Ll8B': { label: '困難', color: '#ff6b6b' },
                  'CIV': { label: '平凡', color: '#c41e3a' },
                  'retry': { label: '平凡', color: '#c41e3a' },
                };
                const status = log.source === 'program' && log.modelTag !== 'passing'
                  ? { label: '平凡', color: '#c41e3a' }
                  : tagToStatus[log.modelTag ?? ''] ?? { label: '平凡', color: '#c41e3a' };
                return (
                  <span
                    className={styles.sourceTag}
                    style={{ background: `${status.color}22`, color: status.color }}
                  >
                    {status.label}
                  </span>
                );
              })()}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                <NpcIcon name={log.npcName} emoji={log.npcEmoji} npcs={npcs} size={18} /> {log.npcName}
              </span>
              {log.targetName && (
                <span className={styles.target} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  {' \u2192 '}<NpcIcon name={log.targetName} emoji={log.targetEmoji ?? ''} npcs={npcs} size={18} /> {log.targetName}
                </span>
              )}
            </div>
            {log.conversation && log.conversation.length > 0 && (
              <div className={styles.conversation}>
                {log.conversation.map((line, i) => (
                  <div key={i} className={styles.convLine}>
                    <span className={styles.convWho} style={{ color: line.color, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                      <NpcIcon name={line.who} emoji={line.emoji} npcs={npcs} size={16} /> {line.who}
                    </span>
                    <span className={styles.convSay}>{'\u300C'}{line.say}{'\u300D'}</span>
                  </div>
                ))}
              </div>
            )}
            {log.say && !log.conversation && (
              <div className={styles.say}>
                {'\uD83D\uDCAC'} {log.say}
              </div>
            )}
            {log.think && (
              <div className={styles.think}>
                {'\uD83D\uDCAD'} {log.think}
              </div>
            )}
            {log.action && (
              <div className={styles.action}>
                {'\u2192'} {log.action}
              </div>
            )}
          </div>
        ))}
      </div>
      )} {/* tab !== 'history' */}
      {!autoScroll && tab !== 'history' && tab !== 'prayer' && (
        <button
          className={styles.scrollBtn}
          onClick={() => {
            setAutoScroll(true);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
        >
          {'\u2191'} 最新へ
        </button>
      )}
    </div>
  );
}
