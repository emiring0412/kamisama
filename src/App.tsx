import { useState, useCallback, useEffect, useRef } from 'react';
import type { NPC, LogEntry, VillageHistory, CivilizationItem, Whisper, Prayer, ItemDef, Buff, ForceConversation, ConfessionUrge } from './types';
import { INITIAL_NPCS, createInitialNPC, FACILITIES, NPC_HOMES, MAP_WIDTH, MAP_HEIGHT } from './lib/constants';
import {
  isRateLimited, isDailyLimitReached, isFallbackActive, getCurrentModelLabel, isGeminiActive,
} from './lib/groqApi';
import { useSimulation } from './hooks/useSimulation';
import { useAILoop } from './hooks/useAILoop';
import { useGameClock, getBackgroundForPeriod, getPeriodLabel, getSeasonLabel, getSeasonEmoji } from './hooks/useGameClock';
import { generateOfflineSkeleton, polishOfflineEntries, applyOfflineSkeleton } from './lib/offlineLog';
import type { OfflineSkeleton } from './lib/offlineLog';
import { analyzeEraSkeleton, polishEraJapanese } from './lib/batchEval';
import { useDailyEval } from './hooks/useDailyEval';
import type { BuildProject } from './lib/buildingSystem';
import { advanceBuild, isBuildComplete, createBuildProject } from './lib/buildingSystem';

import ApiKeyScreen from './components/ApiKeyScreen';
import WelcomeBack from './components/WelcomeBack';
import WhisperModal from './components/WhisperModal';
import AddNPCModal from './components/AddNPCModal';
import GachaModal from './components/GachaModal';
import ItemGachaModal from './components/ItemGachaModal';
import InventoryModal from './components/InventoryModal';
import DepartureModal from './components/DepartureModal';
import SettingsModal from './components/SettingsModal';
import AboutModal from './components/AboutModal';
import InfoModal from './components/InfoModal';
import CharacterSprite from './components/CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './components/NPCSprite';
import WorldMap from './components/WorldMap';
import { isRRole } from './lib/gachaData';
import { getItemDef } from './lib/itemGachaData';
import LogPanel from './components/LogPanel';
import styles from './App.module.css';

const STORAGE_KEY = 'kamisama_api_key';
const MAX_LOGS = 500;

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });
  const [geminiKey, setGeminiKey] = useState<string | null>(() => {
    return localStorage.getItem('kamisama_gemini_key');
  });
  const [npcs, setNPCs] = useState<NPC[]>(() => {
    const saved = localStorage.getItem('kamisama_npcs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as NPC[];
        // 古いデータに新フィールドがない場合のデフォルト補完
        return parsed.map((npc) => ({
          ...npc,
          gender: npc.gender ?? 'male',
          homeX: npc.homeX ?? npc.x,
          homeY: npc.homeY ?? npc.y,
          longTermMemory: npc.longTermMemory ?? [],
          beliefs: npc.beliefs ?? [],
          proposals: npc.proposals ?? [],
          paramChangeAccum: npc.paramChangeAccum ?? 0,
          personality: (npc.personality && !npc.personality.includes('null') && !npc.personality.includes('として村で暮らしている')) ? npc.personality : '穏やかに村で暮らしている。',
          age: npc.age ?? (20 + Math.floor(Math.random() * 11)),
          lifespan: npc.lifespan ?? (60 + Math.floor(Math.random() * 21)),
        }));
      } catch { /* fall through */ }
    }
    return INITIAL_NPCS.map(createInitialNPC);
  });
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    const saved = localStorage.getItem('kamisama_logs');
    if (saved) {
      try {
        const parsed: LogEntry[] = JSON.parse(saved);
        // ID重複を除去（古いバグで重複IDが生まれていた対策）
        const seen = new Set<string>();
        return parsed.filter((l) => {
          if (seen.has(l.id)) return false;
          seen.add(l.id);
          return true;
        });
      } catch { /* fall through */ }
    }
    return [];
  });
  const [selectedNPCId, setSelectedNPCId] = useState<string | null>(null);
  const [paused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [model] = useState('qwen/qwen3-32b');

  // 文明トラッキング
  const [civilizations, setCivilizations] = useState<CivilizationItem[]>(() => {
    const saved = localStorage.getItem('kamisama_civilizations');
    if (!saved) return [];
    // 既存データのカテゴリ正規化（new_belief → belief 等）
    const categoryNormalize: Record<string, string> = { new_belief: 'belief' };
    return (JSON.parse(saved) as CivilizationItem[]).map((c) => ({
      ...c,
      category: (categoryNormalize[c.category] ?? c.category) as CivilizationItem['category'],
    }));
  });

  // 建築プロジェクト + 完成施設
  const [buildProjects, setBuildProjects] = useState<BuildProject[]>(() => {
    const saved = localStorage.getItem('kamisama_builds');
    if (!saved) return [];
    const projects: BuildProject[] = JSON.parse(saved);
    // 起動時にstartDayから経過日数を計算して進捗を反映
    const savedTime = localStorage.getItem('kamisama_game_time');
    const currentDay = savedTime ? Math.floor(parseInt(savedTime, 10) / (24 * 60)) : 1;
    return projects.map((p) => {
      const elapsed = Math.max(0, currentDay - p.startDay);
      return { ...p, daysWorked: Math.min(elapsed, p.daysRequired) };
    });
  });
  const [builtFacilities, setBuiltFacilities] = useState<Array<{ id: string; name: string; emoji: string; x: number; y: number; width: number; height: number; builderId?: string; builderName?: string }>>(() => {
    const saved = localStorage.getItem('kamisama_built');
    if (!saved) return [];
    return (JSON.parse(saved) as Array<Record<string, unknown>>).map((f, i) => ({
      ...f,
      id: (f.id as string) ?? `built-legacy-${i}`,
    })) as Array<{ id: string; name: string; emoji: string; x: number; y: number; width: number; height: number; builderId?: string; builderName?: string }>;
  });

  // ささやきシステム（キュー方式）
  const [whisperQueue, setWhisperQueue] = useState<Whisper[]>([]);
  const [whisperCooldown, setWhisperCooldown] = useState(0);
  const [showWhisperModal, setShowWhisperModal] = useState(false);
  const [showAddNPC, setShowAddNPC] = useState(false);
  const [showGacha, setShowGacha] = useState(false);
  const [showItemGacha, setShowItemGacha] = useState(false);

  // アイテムインベントリ
  const [inventory, setInventory] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('kamisama_items');
    return saved ? JSON.parse(saved) : {};
  });
  const [showInventory, setShowInventory] = useState(false);

  // バフシステム
  const [buffs, setBuffs] = useState<Buff[]>(() => {
    const saved = localStorage.getItem('kamisama_buffs');
    return saved ? JSON.parse(saved) : [];
  });

  // 強制会話キュー
  const [forceConversations, setForceConversations] = useState<ForceConversation[]>([]);

  // 告白促進キュー
  const [confessionUrges, setConfessionUrges] = useState<ConfessionUrge[]>([]);

  const [departureCandidate, setDepartureCandidate] = useState<{ npc: NPC; reason: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showOfuse, setShowOfuse] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [hasNewInfo, setHasNewInfo] = useState(false);
  useEffect(() => {
    fetch('./info.json?t=' + Date.now())
      .then((r) => r.json())
      .then((data: Array<{ date: string }>) => {
        if (!data?.length) return;
        const latest = data[0].date;
        const lastSeen = localStorage.getItem('kamisama_info_seen');
        if (latest !== lastSeen) setHasNewInfo(true);
      })
      .catch(() => {});
  }, []);
  const [layoutMode, setLayoutMode] = useState<'auto' | 'mobile' | 'desktop'>(() => {
    return (localStorage.getItem('kamisama_layout') as 'auto' | 'mobile' | 'desktop') || 'auto';
  });
  const [mapExpanded, setMapExpanded] = useState(false);

  // 図鑑Pシステム
  const [harvestedIds, setHarvestedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('kamisama_harvested');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [civilizationPoints, setCivilizationPoints] = useState<{ physical: number; conceptual: number }>(() => {
    const saved = localStorage.getItem('kamisama_civ_points');
    return saved ? JSON.parse(saved) : { physical: 0, conceptual: 0 };
  });

  // 物理系の分類
  const PHYSICAL_CATEGORIES = new Set(['building', 'tool', 'technology', 'discovery']);

  const harvestItem = useCallback((civId: string, category: string) => {
    if (harvestedIds.has(civId)) return;
    setHarvestedIds((prev) => {
      const next = new Set(prev);
      next.add(civId);
      localStorage.setItem('kamisama_harvested', JSON.stringify([...next]));
      return next;
    });
    setCivilizationPoints((prev) => {
      const isPhysical = PHYSICAL_CATEGORIES.has(category);
      const next = {
        physical: prev.physical + (isPhysical ? 1 : 0),
        conceptual: prev.conceptual + (isPhysical ? 0 : 1),
      };
      localStorage.setItem('kamisama_civ_points', JSON.stringify(next));
      return next;
    });
  }, [harvestedIds]);

  const harvestAll = useCallback(() => {
    const unharvested = civilizations.filter((c) => !harvestedIds.has(c.id) && c.category !== 'demolish');
    if (unharvested.length === 0) return;
    setHarvestedIds((prev) => {
      const next = new Set(prev);
      unharvested.forEach((c) => next.add(c.id));
      localStorage.setItem('kamisama_harvested', JSON.stringify([...next]));
      return next;
    });
    setCivilizationPoints((prev) => {
      let phys = 0, conc = 0;
      unharvested.forEach((c) => {
        if (PHYSICAL_CATEGORIES.has(c.category)) phys++;
        else conc++;
      });
      const next = { physical: prev.physical + phys, conceptual: prev.conceptual + conc };
      localStorage.setItem('kamisama_civ_points', JSON.stringify(next));
      return next;
    });
  }, [civilizations, harvestedIds]);

  // 祈りシステム
  const [prayers, setPrayers] = useState<Prayer[]>(() => {
    const saved = localStorage.getItem('kamisama_prayers');
    if (saved) {
      try {
        const parsed: Prayer[] = JSON.parse(saved);
        const seen = new Set<string>();
        return parsed.filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
      } catch { /* fall through */ }
    }
    return [];
  });
  const [faithPoints, setFaithPoints] = useState<number>(() => {
    const saved = localStorage.getItem('kamisama_faith_points');
    return saved ? parseInt(saved, 10) : 0;
  });

  // 祈りの永続化
  useEffect(() => {
    localStorage.setItem('kamisama_prayers', JSON.stringify(prayers));
  }, [prayers]);
  useEffect(() => {
    localStorage.setItem('kamisama_faith_points', String(faithPoints));
  }, [faithPoints]);

  // 祈り成就（dayは呼び出し元から渡す）
  const fulfillPrayer = useCallback((prayerId: string, day?: number) => {
    setPrayers((prev) => prev.map((p) =>
      p.id === prayerId ? { ...p, fulfilled: true, fulfilledDay: day ?? 0 } : p
    ));
    setFaithPoints((prev) => {
      const next = prev + 10;
      localStorage.setItem('kamisama_faith_points', String(next));
      return next;
    });
  }, []);

  // ��りを無視して削除
  const dismissPrayer = useCallback((prayerId: string) => {
    setPrayers((prev) => prev.filter((p) => p.id !== prayerId));
  }, []);

  // ガチャ用ポイント消費
  const spendPhysicalPoints = useCallback((amount: number) => {
    setCivilizationPoints((prev) => {
      const next = { ...prev, physical: Math.max(0, prev.physical - amount) };
      localStorage.setItem('kamisama_civ_points', JSON.stringify(next));
      return next;
    });
  }, []);

  // 概念ガチャ用ポイント消費
  const spendConceptualPoints = useCallback((amount: number) => {
    setCivilizationPoints((prev) => {
      const next = { ...prev, conceptual: Math.max(0, prev.conceptual - amount) };
      localStorage.setItem('kamisama_civ_points', JSON.stringify(next));
      return next;
    });
  }, []);

  // アイテムインベントリに追加
  const addItemsToInventory = useCallback((items: ItemDef[]) => {
    setInventory((prev) => {
      const next = { ...prev };
      for (const item of items) {
        next[item.id] = (next[item.id] || 0) + 1;
      }
      localStorage.setItem('kamisama_items', JSON.stringify(next));
      return next;
    });
  }, []);

  // アイテム1個消費
  const consumeItem = useCallback((itemId: string) => {
    setInventory((prev) => {
      const next = { ...prev };
      if ((next[itemId] || 0) > 0) {
        next[itemId]--;
        if (next[itemId] <= 0) delete next[itemId];
      }
      localStorage.setItem('kamisama_items', JSON.stringify(next));
      return next;
    });
  }, []);

  // 強制会話追加
  const addForceConversation = useCallback((npcId1: string, npcId2: string) => {
    setForceConversations((prev) => [...prev, { npcId1, npcId2 }]);
  }, []);

  // 強制会話消費（useAILoopから呼ばれる）
  const consumeForceConversation = useCallback(() => {
    setForceConversations((prev) => prev.slice(1));
  }, []);

  // 告白促進追加
  const addConfessionUrge = useCallback((npcId1: string, npcId2: string) => {
    setConfessionUrges((prev) => [...prev, { npcId1, npcId2 }]);
  }, []);

  // 告白促進消費
  const consumeConfessionUrge = useCallback((npcId1: string, npcId2: string) => {
    setConfessionUrges((prev) => prev.filter((u) => !(u.npcId1 === npcId1 && u.npcId2 === npcId2) && !(u.npcId1 === npcId2 && u.npcId2 === npcId1)));
  }, []);

  // 未収穫アイテム数（豊作祈願用）
  const unharvestedCount = civilizations.filter((c) => !harvestedIds.has(c.id) && c.category !== 'demolish').length;

  const [mapScale, setMapScale] = useState(1);

  // マップポップアップ: 画面サイズに合わせてスケール計算
  useEffect(() => {
    if (!mapExpanded) return;
    const calc = () => {
      const padding = 40; // 閉じるボタン等の余白
      const s = Math.min(
        (window.innerWidth - padding) / 600,
        (window.innerHeight - padding) / 480,
        1
      );
      setMapScale(s);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [mapExpanded]);

  // 現在処理中のささやき（キューの先頭）
  const currentWhisper = whisperQueue.length > 0 ? whisperQueue[0] : null;

  // ささやき完了時にキューから除去
  const consumeWhisper = () => {
    setWhisperQueue((prev) => {
      const next = prev.slice(1);
      // 次のささやきがあれば即トリガー
      if (next.length > 0) {
        setTimeout(() => triggerWhisperNow(next[0].targetNpcId), 500);
      }
      return next;
    });
  };

  // ささやきクールダウンタイマー
  useEffect(() => {
    if (whisperCooldown <= 0) return;
    const timer = setInterval(() => {
      setWhisperCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [whisperCooldown]);

  const handleWhisperSend = (w: Whisper) => {
    const isFirst = whisperQueue.length === 0;
    setWhisperQueue((prev) => [...prev, w]);
    setWhisperCooldown(5); // デバッグ中: 5秒（本番は600）
    setShowWhisperModal(false);
    // 先頭なら即座にAI呼び出し、キューに既にあるなら順番待ち
    if (isFirst) {
      setTimeout(() => triggerWhisperNow(w.targetNpcId), 500);
    }
    const target = npcs.find((n) => n.id === w.targetNpcId);
    addLog({
      id: `${Date.now()}-whisper-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
      npcName: '神',
      npcEmoji: '\uD83D\uDD2E',
      npcColor: '#c41e3a',
      targetName: target?.name,
      targetEmoji: target?.emoji,
      say: `[${whisperQueue.length + 1}] ${w.message}`,
      isEvent: true,
    });
  };

  // 村の歴史
  const [villageHistory, setVillageHistory] = useState<VillageHistory>(() => {
    const saved = localStorage.getItem('kamisama_village_history');
    if (saved) {
      const parsed = JSON.parse(saved);
      const h = { ancientLog: [], ...parsed };
      // 肥大化したrecentHistoryを切り詰め（溢れた分は15件ずつ圧縮してancientLogに退避）
      if (h.recentHistory && h.recentHistory.length > 30) {
        const overflow = h.recentHistory.slice(0, -30);
        const compressed: string[] = [];
        for (let i = 0; i < overflow.length; i += 15) {
          const chunk = overflow.slice(i, i + 15);
          // 各エントリを文字列に正規化
          const lines = chunk.map((e: unknown) => typeof e === 'string' ? e : `Day${(e as {Day:number}).Day}: ${(e as {entry:string}).entry}`);
          // Day番号の範囲を取得
          const days = lines.map((l: string) => { const m = l.match(/Day(\d+)/); return m ? parseInt(m[1], 10) : 0; }).filter((d: number) => d > 0);
          const dayRange = days.length > 0 ? `Day${Math.min(...days)}-${Math.max(...days)}` : '';
          // 要約を名前と出来事のキーワードから生成
          const names = new Set<string>();
          const topics = new Set<string>();
          for (const l of lines) {
            const nameMatch = l.match(/[:：]\s*(.+?)(?:と|が|の)/);
            if (nameMatch) names.add(nameMatch[1]);
            const topicMatch = l.match(/「(.+?)」/);
            if (topicMatch) topics.add(topicMatch[1]);
          }
          const nameStr = [...names].slice(0, 4).join('・');
          const topicStr = [...topics].slice(0, 3).join('、');
          compressed.push(`${dayRange} ${nameStr ? nameStr + 'らの時代' : '過去の記録'}: ${topicStr || lines.slice(0, 3).map((l: string) => l.replace(/Day\d+:\s*/, '')).join('、')}`);
        }
        h.ancientLog = [...(h.ancientLog ?? []), ...compressed];
        h.recentHistory = h.recentHistory.slice(-30);
      }
      return h;
    }
    return { ancientLog: [], pastEras: [], recentHistory: [] };
  });

  // おかえりシステム
  const [welcomeBack, setWelcomeBack] = useState<{
    show: boolean;
    loading: boolean;
    elapsedMinutes: number;
    displayLines: string[];    // おかえり画面用（清書済み）
    historyLines: string[];    // 歴史記録用
    skeleton: OfflineSkeleton | null;
  }>(() => {
    const lastAccess = localStorage.getItem('kamisama_last_access');
    if (!lastAccess || !apiKey) return { show: false, loading: false, elapsedMinutes: 0, displayLines: [], historyLines: [], skeleton: null };
    const elapsed = Math.floor((Date.now() - parseInt(lastAccess, 10)) / 60000);
    if (elapsed < 5) return { show: false, loading: false, elapsedMinutes: 0, displayLines: [], historyLines: [], skeleton: null };
    return { show: true, loading: true, elapsedMinutes: Math.min(elapsed, 1440), displayLines: [], historyLines: [], skeleton: null };
  });
  const welcomeInitRef = useRef(false);

  // おかえり: Step1 Groq骨格 → Step2 第一AI清書
  useEffect(() => {
    if (!welcomeBack.show || !welcomeBack.loading || welcomeInitRef.current) return;
    if (!apiKey) return;
    welcomeInitRef.current = true;

    const startDay = Math.max(1, gameTime.day - Math.floor(welcomeBack.elapsedMinutes / 24));

    (async () => {
      try {
        // Step 1: Groqで骨格生成
        console.log('[おかえり] Step1: 骨格生成...');
        const skeleton = await generateOfflineSkeleton(
          npcs, villageHistory, welcomeBack.elapsedMinutes, startDay, gameTime.day, apiKey,
        );
        if (!skeleton || !skeleton.history_entries?.length) {
          console.warn('[おかえり] 骨格生成失敗');
          setWelcomeBack((prev) => ({ ...prev, loading: false }));
          return;
        }
        console.log(`[おかえり] 骨格: ${skeleton.history_entries.length}件`);

        // Step 2: 第一AIで清書
        console.log('[おかえり] Step2: 日本語清書...');
        const polished = await polishOfflineEntries(skeleton, npcs, apiKey, geminiKey ?? null);

        if (polished?.entries?.length) {
          setWelcomeBack((prev) => ({
            ...prev,
            loading: false,
            displayLines: polished.entries.map((e) => e.display),
            historyLines: polished.entries.map((e) => e.summary),
            skeleton,
          }));
        } else {
          // 清書失敗時は骨格をそのまま表示
          console.warn('[おかえり] 清書失敗、骨格をそのまま使用');
          setWelcomeBack((prev) => ({
            ...prev,
            loading: false,
            displayLines: skeleton.history_entries,
            historyLines: skeleton.history_entries,
            skeleton,
          }));
        }
      } catch (e) {
        console.warn('[おかえり] エラー:', e);
        setWelcomeBack((prev) => ({ ...prev, loading: false }));
      }
    })();
  }, [welcomeBack.show, welcomeBack.loading]);

  const handleWelcomeEnter = () => {
    // 歴史に記録
    if (welcomeBack.historyLines.length > 0) {
      setVillageHistory((prev) => ({
        ...prev,
        recentHistory: [...(prev.recentHistory ?? []), ...welcomeBack.historyLines],
      }));
    }
    // パラメータ・関係性変動を反映
    if (welcomeBack.skeleton) {
      setNPCs((prev) => applyOfflineSkeleton(prev, welcomeBack.skeleton!));
    }
    setWelcomeBack({ show: false, loading: false, elapsedMinutes: 0, displayLines: [], historyLines: [], skeleton: null });
  };

  const offlineRetrying = false; // リトライ廃止（歴史生成のみのシンプルなフローに変更）

  // 最終アクセス時刻を定期更新
  useEffect(() => {
    const update = () => {
      if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
      localStorage.setItem('kamisama_last_access', String(Date.now()));
    };
    update();
    const interval = setInterval(update, 10000);
    window.addEventListener('beforeunload', update);
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', update); };
  }, []);

  // ゲーム内時計
  const { gameTime, dayChanged: _dayChanged } = useGameClock((paused && !welcomeBack.show) || offlineRetrying, speed);

  // バフ期限切れ自動削除
  useEffect(() => {
    if (!gameTime) return;
    setBuffs((prev) => {
      const active = prev.filter((b) => b.expiresDay > gameTime.day);
      if (active.length !== prev.length) {
        localStorage.setItem('kamisama_buffs', JSON.stringify(active));
      }
      return active;
    });
  }, [gameTime?.day]);

  // バフ追加（好感度ボーナスは累積、それ以外は上書き）
  const addBuff = useCallback((type: Buff['type'], days: number) => {
    setBuffs((prev) => {
      const day = gameTime?.day ?? 1;
      let next: Buff[];
      if (type === 'affection') {
        // 好感度ボーナスは累積（複数スタック可）
        next = [...prev, { type, expiresDay: day + days }];
      } else {
        // それ以外は上書き
        const filtered = prev.filter((b) => b.type !== type);
        next = [...filtered, { type, expiresDay: day + days }];
      }
      localStorage.setItem('kamisama_buffs', JSON.stringify(next));
      return next;
    });
  }, [gameTime?.day]);

  // ログ追加関数
  const addLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev.slice(-(MAX_LOGS - 1)), entry];
      // iOS Safari対策: タブ切り替え時にログが消えないよう即保存
      if (!(window as unknown as Record<string, boolean>).__kamisama_resetting) {
        try { localStorage.setItem('kamisama_logs', JSON.stringify(next)); } catch { /* quota exceeded */ }
      }
      return next;
    });
  }, []);

  // COLORS（髪色変更用）
  const HAIR_COLORS = [
    '#F44336', '#E53935', '#C62828', '#D32F2F', '#FF5252',
    '#FF9800', '#FB8C00', '#F57C00', '#EF6C00', '#E65100',
    '#795548', '#6D4C41', '#5D4037', '#4E342E', '#A1887F',
    '#4CAF50', '#43A047', '#388E3C', '#2E7D32', '#1B5E20',
    '#2196F3', '#1E88E5', '#1976D2', '#1565C0', '#0D47A1',
    '#9C27B0', '#8E24AA', '#7B1FA2', '#6A1B9A', '#AB47BC',
    '#BF8A30', '#D4AF37', '#C5A030', '#DAA520', '#B8860B',
  ];

  const CATACLYSM_EVENTS = [
    { name: '大嵐', desc: '激しい嵐が村を襲った。屋根が飛び、畑が荒れた。' },
    { name: '豊作', desc: '畑に驚くほどの実りがあった。食料に困ることはなさそうだ。' },
    { name: '金脈発見', desc: '鉱山の奥で光る鉱脈が見つかった。村に富をもたらすかもしれない。' },
    { name: '謎の旅人', desc: '見知らぬ旅人が村を訪れた。遠い土地の話を聞かせてくれた。' },
    { name: '火事', desc: '村の一角で火が出た。皆で消し止めたが、焦げ跡が残った。' },
    { name: '疫病', desc: '村人の間で体調を崩す者が増えている。原因はまだわからない。' },
  ];

  // アイテム使用ハンドラ
  const handleUseItem = useCallback((itemId: string, targets: string[], extra?: string) => {
    consumeItem(itemId);
    const day = gameTime?.day ?? 1;

    switch (itemId) {
      case 'force_talk': {
        addForceConversation(targets[0], targets[1]);
        break;
      }
      case 'discovery_up': {
        addBuff('discovery_up', 3);
        break;
      }
      case 'hair_change': {
        setNPCs((prev) => prev.map((n) => {
          if (n.id !== targets[0]) return n;
          const available = HAIR_COLORS.filter((c) => c !== n.color);
          const newColor = available[Math.floor(Math.random() * available.length)];
          return { ...n, color: newColor };
        }));
        break;
      }
      case 'name_change': {
        const newName = extra || '';
        setNPCs((prev) => prev.map((n) => n.id === targets[0] ? { ...n, name: newName } : n));
        break;
      }
      case 'reconcile': {
        setNPCs((prev) => prev.map((n) => {
          if (n.id === targets[0]) {
            const rels = { ...n.relationships };
            const existing = rels[targets[1]] || { label: '知り合い', score: 0 };
            rels[targets[1]] = { ...existing, score: Math.min(100, existing.score + 3) };
            return { ...n, relationships: rels };
          }
          if (n.id === targets[1]) {
            const rels = { ...n.relationships };
            const existing = rels[targets[0]] || { label: '知り合い', score: 0 };
            rels[targets[0]] = { ...existing, score: Math.min(100, existing.score + 3) };
            return { ...n, relationships: rels };
          }
          return n;
        }));
        break;
      }
      case 'gender_change': {
        setNPCs((prev) => prev.map((n) => {
          if (n.id !== targets[0]) return n;
          return { ...n, gender: n.gender === 'male' ? 'female' : 'male' };
        }));
        break;
      }
      case 'confession': {
        addConfessionUrge(targets[0], targets[1]);
        break;
      }
      case 'positive_buff': {
        addBuff('positive', 7);
        break;
      }
      case 'affection_bonus': {
        addBuff('affection', 7);
        break;
      }
      case 'cataclysm': {
        const event = CATACLYSM_EVENTS[Math.floor(Math.random() * CATACLYSM_EVENTS.length)];
        // 全NPCのメモリに追加
        setNPCs((prev) => prev.map((n) => ({
          ...n,
          memory: [...n.memory, `天変地異「${event.name}」が起きた: ${event.desc}`].slice(-6),
        })));
        // 3日間プロンプト注入バフとして登録（AIが文脈を汲む）
        setBuffs((prev) => {
          const filtered = prev.filter((b) => b.type !== 'cataclysm');
          const next = [...filtered, { type: 'cataclysm' as const, expiresDay: day + 3, description: `${event.name}: ${event.desc}` }];
          localStorage.setItem('kamisama_buffs', JSON.stringify(next));
          return next;
        });
        addLog({
          id: `${Date.now()}-cataclysm`,
          timestamp: `Day${day} ${gameTime?.displayTime ?? ''}`,
          npcName: '天変地異',
          npcEmoji: '🌪️',
          npcColor: '#f44336',
          think: `${event.name}: ${event.desc}（3日間影響）`,
          isEvent: true,
          source: 'program',
        });
        break;
      }
      case 'harvest_prayer': {
        // 図鑑収録アイテム数（demolish除く）× 1P を物理Pに加算
        const totalCivCount = civilizations.filter((c) => c.category !== 'demolish').length;
        if (totalCivCount > 0) {
          setCivilizationPoints((prev) => {
            const next = { ...prev, physical: prev.physical + totalCivCount };
            localStorage.setItem('kamisama_civ_points', JSON.stringify(next));
            return next;
          });
        }
        break;
      }
    }

    // アイテム使用ログ（天変地異は上で独自ログを出しているのでスキップ）
    if (itemId !== 'cataclysm') {
      const def = getItemDef(itemId);
      if (def) {
        const names = targets.map((id) => npcs.find((n) => n.id === id)?.name || '?');
        let msg = `${def.emoji} ${def.name}を使用`;
        if (itemId === 'force_talk') {
          // 告白促進が同じペアにあるか判定
          const pairHasConfession = confessionUrges.some(
            (u) => (u.npcId1 === targets[0] && u.npcId2 === targets[1]) ||
                   (u.npcId1 === targets[1] && u.npcId2 === targets[0])
          );
          msg = pairHasConfession
            ? `💘 ${names[0]}と${names[1]}の告白イベントを発動！`
            : `${def.emoji} ${names[0]}と${names[1]}に強制会話を仕掛けた`;
        }
        else if (itemId === 'hair_change') msg = `${def.emoji} ${names[0]}の髪色を変えた`;
        else if (itemId === 'name_change') msg = `${def.emoji} ${names[0]}の名前を「${extra}」に変えた`;
        else if (itemId === 'reconcile') msg = `${def.emoji} ${names[0]}と${names[1]}の仲を取り持った（好感度+3）`;
        else if (itemId === 'gender_change') msg = `${def.emoji} ${names[0]}の性別を変えた`;
        else if (itemId === 'confession') {
          // 強制会話が同じペアにあるか判定
          const pairHasForce = forceConversations.some(
            (f) => (f.npcId1 === targets[0] && f.npcId2 === targets[1]) ||
                   (f.npcId1 === targets[1] && f.npcId2 === targets[0])
          );
          msg = pairHasForce
            ? `💘 ${names[0]}と${names[1]}の告白イベントを発動！`
            : `${def.emoji} ${names[0]}と${names[1]}に告白の衝動を注入した`;
        }
        else if (itemId === 'discovery_up') msg = `${def.emoji} 発見率UPバフを発動（3日間）`;
        else if (itemId === 'positive_buff') msg = `${def.emoji} ポジティブバフを発動（7日間）`;
        else if (itemId === 'affection_bonus') msg = `${def.emoji} 好感度ボーナスを発動（7日間）`;
        else if (itemId === 'harvest_prayer') {
          const totalCivCount = civilizations.filter((c) => c.category !== 'demolish').length;
          msg = `${def.emoji} 豊作祈願で${totalCivCount}Pの物理Pを獲得`;
        }

        addLog({
          id: `${Date.now()}-item-${itemId}`,
          timestamp: `Day${day} ${gameTime?.displayTime ?? ''}`,
          npcName: '神の手',
          npcEmoji: '🎒',
          npcColor: '#5d4037',
          think: msg,
          isEvent: true,
          source: 'program',
        });
      }
    }
  }, [consumeItem, addBuff, addForceConversation, addConfessionUrge, setNPCs, addLog, gameTime, unharvestedCount, npcs]);

  // NPC状態・ログの定期保存 + ブラウザ閉じ時 + タブ非表示時（iOS Safari対策）
  // refで最新値を保持し、intervalがリセットされないようにする
  const npcsRef = useRef(npcs);
  const logsRef = useRef(logs);
  useEffect(() => { npcsRef.current = npcs; }, [npcs]);
  useEffect(() => { logsRef.current = logs; }, [logs]);

  useEffect(() => {
    const save = () => {
      if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
      localStorage.setItem('kamisama_npcs', JSON.stringify(npcsRef.current));
      localStorage.setItem('kamisama_logs', JSON.stringify(logsRef.current));
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    const interval = setInterval(save, 10000);
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', handleVisibility);
    // iOS Safari: pagehideはbeforeunloadより確実に発火する
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', save);
    };
  }, []); // 依存配列空 → intervalがリセットされない

  // 建物の取り壊し（部分一致で誤破壊→もめごとの種になる）
  const demolishFacility = useCallback((facilityName: string, reason: string) => {
    // 「〇〇の家」「〇〇の小屋」→ NPCの自宅を撤去（homeを初期位置にリセット）
    const homeKeywords = ['の家', 'の小屋', 'の住居', 'の宿', 'の寝床'];
    const homeMatch = homeKeywords.find((kw) => facilityName.includes(kw));
    if (homeMatch) {
      const ownerName = facilityName.split(homeMatch)[0];
      setNPCs((prevNpcs) => {
        const owner = prevNpcs.find((n) => n.name === ownerName);
        if (!owner) {
          console.warn(`[DEMOLISH] 家の持ち主「${ownerName}」が見つかりません`);
          return prevNpcs;
        }
        const defaultHome = NPC_HOMES[owner.id] ?? { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
        addLog({
          id: `${Date.now()}-demolish-home-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
          npcName: '村',
          npcEmoji: '\uD83D\uDEA7',
          npcColor: '#ff6b6b',
          think: `\uD83C\uDFE0 ${facilityName}が取り壊された: ${reason}`,
          isEvent: true,
          source: 'program',
        });
        setVillageHistory((h) => ({
          ...h,
          recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${facilityName}が取り壊された（${reason}）`],
        }));
        return prevNpcs.map((n) => {
          if (n.id === owner.id) {
            return { ...n, homeX: defaultHome.x, homeY: defaultHome.y, memory: [...n.memory, `自分の家が壊された`].slice(-6) };
          }
          return n;
        });
      });
      // builtFacilitiesにも家があれば消す
      setBuiltFacilities((prev) => prev.filter((f) => f.name !== facilityName));
      return;
    }

    setBuiltFacilities((prev) => {
      // 完全一致 → 部分一致（含む）の順で検索
      let idx = prev.findIndex((f) => f.name === facilityName);
      const wasExactMatch = idx !== -1;
      if (idx === -1) {
        idx = prev.findIndex((f) => facilityName.includes(f.name) || f.name.includes(facilityName));
      }
      if (idx === -1) {
        console.warn(`[DEMOLISH] 施設「${facilityName}」が見つかりません（建物一覧: ${prev.map((f) => f.name).join(', ')}）`);
        return prev;
      }
      const removed = prev[idx];
      const isMistake = !wasExactMatch && removed.name !== facilityName;

      addLog({
        id: `${Date.now()}-demolish-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
        npcName: '村',
        npcEmoji: isMistake ? '\u26A0\uFE0F' : '\uD83D\uDEA7',
        npcColor: '#ff6b6b',
        think: isMistake
          ? `${removed.emoji} ${removed.name}が誤って取り壊された！（「${facilityName}」を壊すつもりだった） ${reason}`
          : `${removed.emoji} ${removed.name}が取り壊された: ${reason}`,
        isEvent: true,
        source: 'program',
      });

      const historyText = isMistake
        ? `${removed.name}が誤って取り壊された（本来は${facilityName}を壊す予定だった）`
        : `${removed.name}が取り壊された（${reason}）`;
      setVillageHistory((h) => ({
        ...h,
        recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${historyText}`],
      }));

      // 誤破壊の場合、関係者の記憶に追加（もめごとの種）
      if (isMistake) {
        const destroyerName = reason.split(':')[0]?.trim(); // "ゲンジ: 理由" → "ゲンジ"
        const ownerName = removed.builderName;
        setNPCs((prevNpcs) => prevNpcs.map((n) => {
          // 壊した本人 → 自覚
          if (destroyerName && n.name === destroyerName) {
            return { ...n, memory: [...n.memory, `${facilityName}を壊そうとして間違えて${removed.name}を壊してしまった`].slice(-6) };
          }
          // 持ち主 → 怒りの種
          if (ownerName && n.name === ownerName) {
            return { ...n, memory: [...n.memory, `自分が建てた${removed.name}が${destroyerName ?? '誰か'}に壊された`].slice(-6) };
          }
          // その他の村人 → 目撃
          return { ...n, memory: [...n.memory, `${removed.name}が間違って壊された`].slice(-6) };
        }));
      }

      return prev.filter((_, i) => i !== idx);
    });
  }, [addLog, gameTime.day, setVillageHistory, setNPCs]);

  // AIループ（gameTime + 歴史 + 文明 + ささやき）
  const { triggerWhisperNow } = useAILoop(
    npcs, setNPCs, addLog,
    apiKey ?? '', model, geminiKey,
    paused || offlineRetrying, speed, false, gameTime,
    villageHistory, setVillageHistory,
    civilizations, setCivilizations,
    currentWhisper, consumeWhisper,
    // 建築・取り壊しハンドラ
    (npcId: string, npcName: string, civEvent: { type: string; name: string; description: string }) => {
      if (civEvent.type === 'demolish') {
        demolishFacility(civEvent.name, `${npcName}: ${civEvent.description}`);
        return;
      }
      // building以外（道具・概念・制度・信仰など）はマップに建てない → 文明図鑑に記録のみ
      if (civEvent.type !== 'building') {
        console.log(`[CIV] 図鑑記録のみ(${civEvent.type}): ${civEvent.name} by ${npcName}`);
        return;
      }
      // 建築（初期施設 + 建設済み + 全NPCの自宅を衝突判定に含める）
      const npcHomes = npcs.map((n) => ({ x: n.homeX - 15, y: n.homeY - 15, width: 30, height: 30 }));
      const allFacilities = [
        ...FACILITIES.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
        ...builtFacilities,
        ...npcHomes,
      ];
      const project = createBuildProject(
        { building: civEvent.name, reason: civEvent.description },
        npcId, npcName, gameTime.day, 580, 420, allFacilities,
      );
      setBuildProjects((prev) => [...prev, project]);
      addLog({
        id: `${Date.now()}-build-start-${npcId}`,
        timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
        npcName: npcName,
        npcEmoji: project.facility.emoji,
        npcColor: '#c41e3a',
        think: `${civEvent.name}の${project.facility.width > 0 ? '建設' : '製作'}を開始！（${project.daysRequired}日）`,
        action: civEvent.description,
        isEvent: true,
        source: 'ai',
        modelTag: 'CIV',
      });
    },
    prayers, fulfillPrayer,
    buffs, forceConversations, consumeForceConversation,
    confessionUrges, consumeConfessionUrge,
  );

  // 移動シミュレーション（深夜は速度半減）
  const moveSpeed = gameTime.period === 'midnight' ? speed * 0.5 : speed;
  useSimulation(npcs, setNPCs, paused, moveSpeed, gameTime, triggerWhisperNow);

  // 定期評価（パラメータ変動・職業変化）
  useDailyEval(npcs, setNPCs, addLog, gameTime, apiKey ?? '', paused, setVillageHistory, demolishFacility, prayers, setPrayers,
    (npc, reason) => setDepartureCandidate({ npc, reason }));

  // 建築進捗（日次 — 経過日数に基づいて一括進捗）
  const buildDayRef = useRef(gameTime.day);
  useEffect(() => {
    if (gameTime.day <= buildDayRef.current) return;
    const daysPassed = gameTime.day - buildDayRef.current;
    buildDayRef.current = gameTime.day;

    setBuildProjects((prev) => {
      // 経過日数分だけ進捗させる
      let updated = prev;
      for (let d = 0; d < daysPassed; d++) {
        updated = updated.map(advanceBuild);
      }
      const completed = updated.filter(isBuildComplete);
      const ongoing = updated.filter((p) => !isBuildComplete(p));

      // 完成した建物をログと歴史に記録
      for (const p of completed) {
        addLog({
          id: `${Date.now()}-build-${p.id}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
          npcName: p.builderName,
          npcEmoji: p.facility.emoji,
          npcColor: '#c41e3a',
          think: `${p.facility.name}が完成した！`,
          isEvent: true,
          source: 'program',
        });
        setVillageHistory((h) => ({
          ...h,
          recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${p.builderName}が${p.facility.name}を完成させた`],
        }));

        // 住居系（小屋・家・住居）→ 建てたNPCの家として登録
        const isHome = ['小屋', '家', '住居', '宿', '寝床'].some((kw) => p.facility.name.includes(kw));
        if (isHome) {
          setNPCs((prev) => prev.map((n) =>
            n.id === p.builderId
              ? { ...n, homeX: p.facility.x + p.facility.width / 2, homeY: p.facility.y + p.facility.height / 2 }
              : n
          ));
        }
        // マップに施設として追加（住居含む）
        if (p.facility.width > 0) {
          setBuiltFacilities((prev) => [...prev, {
            id: p.id,
            name: p.facility.name,
            emoji: p.facility.emoji,
            x: p.facility.x,
            y: p.facility.y,
            width: p.facility.width,
            height: p.facility.height,
            builderId: p.builderId,
            builderName: p.builderName,
          }]);
        }
      }

      return ongoing;
    });
  }, [gameTime.day]);

  // 建物の取り壊し
  // 歴史・文明をlocalStorageに保存
  useEffect(() => {
    if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
    localStorage.setItem('kamisama_village_history', JSON.stringify(villageHistory));
  }, [villageHistory]);

  // 歴史が15件超えたらAIで時代圧縮
  const compressingRef = useRef(false);
  useEffect(() => {
    if (villageHistory.recentHistory.length < 15) return;
    if (compressingRef.current) return;
    if (!apiKey) return;
    compressingRef.current = true;

    console.log(`[HISTORY] 2段階圧縮開始（${villageHistory.recentHistory.length}件）`);

    // Step 1: 裏方が英語で骨格分析
    analyzeEraSkeleton(villageHistory.recentHistory, apiKey, gameTime.day).then(async (skeleton) => {
      if (!skeleton) { compressingRef.current = false; return; }
      console.log(`[HISTORY] Step1完了: ${skeleton.era_name_en} (${skeleton.period})`);

      // Step 2: 表舞台が日本語で清書
      const era = await polishEraJapanese(skeleton, villageHistory.recentHistory, model, apiKey);
      compressingRef.current = false;
      if (era) {
        setVillageHistory((prev) => {
          const allEras = [...prev.pastEras, era];
          const overflow = allEras.slice(0, Math.max(0, allEras.length - 5));
          const newAncient = overflow.map((e) => `${e.period} ${e.eraName}: ${e.summary.split('。')[0]}`);
          return {
            ancientLog: [...(prev.ancientLog ?? []), ...newAncient],
            pastEras: allEras.slice(-5),
            recentHistory: [],
          };
        });
        addLog({
          id: `${Date.now()}-era-compress`,
          timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
          npcName: '歴史',
          npcEmoji: '\uD83D\uDCDC',
          npcColor: '#9C27B0',
          think: `新たな時代「${era.eraName}」が記録された`,
          isEvent: true,
          source: 'ai',
          modelTag: 'Ll8B+Qwen',
        });
        console.log(`[HISTORY] 圧縮完了: ${era.eraName}`);
      }
    }).catch(() => { compressingRef.current = false; });
  }, [villageHistory.recentHistory.length]);
  useEffect(() => {
    if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
    localStorage.setItem('kamisama_civilizations', JSON.stringify(civilizations));
  }, [civilizations]);
  useEffect(() => {
    if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
    localStorage.setItem('kamisama_builds', JSON.stringify(buildProjects));
  }, [buildProjects]);
  useEffect(() => {
    if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
    localStorage.setItem('kamisama_built', JSON.stringify(builtFacilities));
  }, [builtFacilities]);

  const handleApiKeySubmit = (groqKey: string, gemKey: string | null) => {
    localStorage.setItem(STORAGE_KEY, groqKey);
    setApiKey(groqKey);
    if (gemKey) {
      localStorage.setItem('kamisama_gemini_key', gemKey);
      setGeminiKey(gemKey);
    }
  };

  // APIキー未設定時は入力画面
  if (!apiKey) {
    return <ApiKeyScreen onSubmit={handleApiKeySubmit} />;
  }

  // おかえり画面
  if (welcomeBack.show) {
    return (
      <WelcomeBack
        elapsedMinutes={welcomeBack.elapsedMinutes}
        historyLines={welcomeBack.displayLines}
        loading={welcomeBack.loading}
        onEnter={handleWelcomeEnter}
      />
    );
  }

  const selectedNPC = npcs.find((n) => n.id === selectedNPCId) ?? null;
  const rateLimited = isRateLimited();

  // AI思考状態（モデル→状態ラベル）
  const getThinkingStatus = (): { label: string; emoji: string; color: string } => {
    if (isDailyLimitReached()) return { label: '休憩中…', emoji: '\uD83D\uDCA4', color: '#9a8a70' };
    if (rateLimited) return { label: '休憩中…', emoji: '\u2615', color: '#8b7355' };
    if (isGeminiActive(geminiKey)) return { label: '思考明晰', emoji: '\uD83E\uDDE0', color: '#4CAF50' };
    if (!isFallbackActive()) return { label: '思考平凡', emoji: '\uD83E\uDDE0', color: '#c41e3a' };
    const model = getCurrentModelLabel();
    if (model.includes('70')) return { label: '思考疲弊', emoji: '\uD83E\uDDE0', color: '#FF9800' };
    return { label: '思考困難', emoji: '\uD83E\uDDE0', color: '#ff6b6b' };
  };
  const thinkStatus = getThinkingStatus();

  return (
    <div className={`${styles.app} ${layoutMode === 'mobile' ? styles.forceMobile : layoutMode === 'desktop' ? styles.forceDesktop : ''}`}>
      {/* おかえりログ再試行中のオーバーレイ */}
      {offlineRetrying && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '1.1rem', gap: '12px',
        }}>
          <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>{'\u23F3'}</div>
          <div>履歴を呼び出しています...</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {/* ヘッダー */}
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}><img src={`${import.meta.env.BASE_URL}title.png`} alt="高天原より常世のくにへ" style={{ height: '55px', verticalAlign: 'middle' }} /></h1>
          <button
            onClick={() => setShowAbout(true)}
            className={styles.btn}
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >このゲームについて</button>
          <span className={styles.gameClock}>{getSeasonEmoji(gameTime.season)} {gameTime.displayFull} ({getSeasonLabel(gameTime.season)}・{getPeriodLabel(gameTime.period)})</span>
        </div>
        <div className={styles.controls}>
          <span className={styles.thinkStatus} style={{ color: thinkStatus.color }}>
            {thinkStatus.emoji} {thinkStatus.label}
          </span>
          <button className={styles.btn} onClick={() => setSpeed(speed >= 3 ? 1 : speed + 1)}>
            <span className={styles.btnIcon}>&#x26A1;</span>x{speed}
          </button>
          <button className={styles.btn} onClick={() => setShowWhisperModal(true)} title={whisperCooldown > 0 ? `クールダウン中 ${whisperCooldown}s` : 'NPCにささやく'}>
            <span className={styles.btnIcon}>{'\uD83D\uDD2E'}</span>ささやき{whisperCooldown > 0 ? `(${Math.ceil(whisperCooldown / 60)}m)` : ''}
          </button>
          <button className={styles.btn} onClick={() => setShowAddNPC(true)}>
            <span className={styles.btnIcon}>{'\uD83D\uDC64'}</span>住民追加
          </button>
          <button className={styles.btn} onClick={() => setShowGacha(true)}>
            <span className={styles.btnIcon}>{'\uD83C\uDFB0'}</span>召喚
          </button>
          <button className={styles.btn} onClick={() => setShowItemGacha(true)}>
            <span className={styles.btnIcon}>{'\uD83C\uDF00'}</span>概念
          </button>
          <button className={styles.btn} onClick={() => setShowInventory(true)} style={{ position: 'relative' }}>
            <span className={styles.btnIcon}>{'\uD83C\uDF92'}</span>持ち物
            {Object.values(inventory).reduce((a, b) => a + b, 0) > 0 && (
              <span className={styles.badge} />
            )}
          </button>
          <button className={styles.btn} onClick={() => { setShowInfo(true); setHasNewInfo(false); }} style={{ position: 'relative' }}>
            <span className={styles.btnIcon}>{'\uD83D\uDCE2'}</span>お知らせ
            {hasNewInfo && <span className={styles.badge} />}
          </button>
          <a className={styles.btn} href="https://laf-create.jp/laf/forums/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <span className={styles.btnIcon}>{'\uD83E\uDE9E'}</span>八咫鏡
          </a>
          <button className={styles.btn} onClick={() => setShowSettings(true)}>
            <span className={styles.btnIcon}>{'\u2699\uFE0F'}</span>設定
          </button>
          <button className={styles.btn} style={{ color: '#c41e3a' }} onClick={() => setShowOfuse(true)}>
            <span className={styles.btnIcon}>{'\u2615'}</span>お布施
          </button>
          <button className={styles.btn} onClick={() => {
            const next = layoutMode === 'auto' ? 'mobile' : layoutMode === 'mobile' ? 'desktop' : 'auto';
            setLayoutMode(next);
            localStorage.setItem('kamisama_layout', next);
          }}>
            <span className={styles.btnIcon}>{layoutMode === 'auto' ? '\uD83D\uDCF1' : layoutMode === 'mobile' ? '\uD83D\uDCF1' : '\uD83D\uDDA5\uFE0F'}</span>{layoutMode === 'auto' ? '自動' : layoutMode === 'mobile' ? 'モバイル' : 'PC'}
          </button>
        </div>
      </header>

      {/* マップ全画面ポップアップ（モバイル用・横持ち推奨） */}
      {mapExpanded && (
        <div className={styles.mapOverlay} onClick={() => setMapExpanded(false)}>
          <div className={styles.mapOverlayContent} onClick={(e) => e.stopPropagation()}
            style={{ transform: `scale(${mapScale})` }}>
            <WorldMap
              npcs={npcs}
              onSelectNPC={(id) => setSelectedNPCId(id === selectedNPCId ? null : id)}
              selectedNPCId={selectedNPCId}
              background={getBackgroundForPeriod(gameTime.period, gameTime.season)}
              extraFacilities={builtFacilities}
            />
          </div>
          <button className={styles.mapCloseBtn} onClick={() => setMapExpanded(false)}>{'\u2715'} 閉じる</button>
          <span className={styles.mapRotateHint}>{'\uD83D\uDD04'} 横持ちで大きく表示</span>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className={styles.main}>
        <div className={styles.left}>
          {/* モバイル: ミニマップ小窓 / デスクトップ: 通常マップ */}
          <div className={styles.mapFull}>
            <WorldMap
              npcs={npcs}
              onSelectNPC={(id) => setSelectedNPCId(id === selectedNPCId ? null : id)}
              selectedNPCId={selectedNPCId}
              background={getBackgroundForPeriod(gameTime.period, gameTime.season)}
              extraFacilities={builtFacilities}
            />
          </div>
          {/* ミニマップ + NPCバー横並び */}
          <div className={styles.mapAndNpcs}>
            <div className={styles.miniMap} onClick={() => setMapExpanded(true)}>
              <div className={styles.miniMapInner}>
                {npcs.map((npc) => (
                  <div
                    key={npc.id}
                    className={styles.miniMapDot}
                    style={{
                      left: `${(npc.x / MAP_WIDTH) * 100}%`,
                      top: `${(npc.y / MAP_HEIGHT) * 100}%`,
                      background: npc.gender === 'female' ? '#ff6b8a' : '#6b9fff',
                    }}
                  />
                ))}
              </div>
              <div className={styles.mapTapHint}>{'\uD83D\uDD0D'}</div>
            </div>

            {/* NPCバー */}
            <div className={styles.npcBar}>
            {npcs.map((npc) => (
              <button
                key={npc.id}
                className={`${styles.npcBtn} ${npc.id === selectedNPCId ? styles.npcBtnActive : ''} ${npc.rarity === 'SR' ? styles.npcBtnSR : isRRole(npc.role) ? styles.npcBtnR : ''}`}
                onClick={() => setSelectedNPCId(npc.id === selectedNPCId ? null : npc.id)}
                style={{ borderColor: npc.rarity === 'SR' ? '#9c27b0' : isRRole(npc.role) ? '#4a6cf7' : npc.color }}
                title={`${npc.name}（${npc.role}）${npc.age ? ` ${npc.age}歳` : ''}`}
              >
                <CharacterSprite gender={npc.gender} hairColor={npc.color} clothColor={idToClothHex(npc.id)} skinColor={idToSkinHex(npc.id)} eyeColor={idToEyeHex(npc.id)} mouthColor={idToMouthHex(npc.id)} hairFrontVariant={idToHairFront(npc.id, npc.gender)} hairBackVariant={idToHairBack(npc.id)} hasBeard={npc.gender === 'male' ? idToHasBeard(npc.id) : false} role={npc.role} rarity={npc.rarity} size={22} />
                {npc.id === selectedNPCId && <span className={styles.npcBtnName}>{npc.name}</span>}
              </button>
            ))}
          </div>
          </div>{/* mapAndNpcs閉じ */}

          {/* 村ステータス */}
          {(() => {
            const pop = npcs.length;
            const civCount = civilizations.length + builtFacilities.length;
            const allScores = npcs.flatMap((n) => Object.values(n.relationships).map((r) => r.score));
            const bondAvg = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
            const historyCount = (villageHistory.pastEras?.length ?? 0) + (villageHistory.recentHistory?.length ?? 0) + (villageHistory.ancientLog?.length ?? 0);
            return (
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#8b7355', padding: '2px 4px', flexWrap: 'wrap' }}>
                <span>{'\uD83C\uDFD8\uFE0F'} 人口 <span style={{ color: '#c41e3a' }}>{pop}</span></span>
                <span>{'\uD83D\uDEE0\uFE0F'} 文明 <span style={{ color: '#4CAF50' }}>{civCount}</span></span>
                <span>{'\uD83E\uDD1D'} 絆 <span style={{ color: bondAvg >= 10 ? '#4CAF50' : bondAvg >= 0 ? '#c41e3a' : '#ff6b6b' }}>{bondAvg > 0 ? '+' : ''}{bondAvg}</span></span>
                <span>{'\uD83D\uDCDC'} 歴史 <span style={{ color: '#9C27B0' }}>{historyCount}</span></span>
                <span>{'\uD83D\uDE4F'} 信仰 <span style={{ color: '#c41e3a' }}>{faithPoints}</span></span>
                <span>{'\uD83D\uDCC5'} Day <span style={{ color: '#8b7355' }}>{gameTime.day}</span></span>
              </div>
            );
          })()}

          {/* 選択NPC詳細（モバイル: モーダル / デスクトップ: インライン） */}
          {selectedNPC && (
            <div className={styles.detailWrapper} onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedNPCId(null);
            }}>
            <div className={`${styles.detail} ${selectedNPC.rarity === 'SR' ? styles.detailSR : isRRole(selectedNPC.role) ? styles.detailR : ''}`} style={{ borderLeftColor: selectedNPC.rarity === 'SR' ? '#9c27b0' : isRRole(selectedNPC.role) ? '#4a6cf7' : selectedNPC.color }}>
              <button className={styles.detailCloseBtn} onClick={() => setSelectedNPCId(null)}>{'\u2715'}</button>
              <div className={styles.detailHeader}>
                <CharacterSprite
                  gender={selectedNPC.gender}
                  hairColor={selectedNPC.color}
                  clothColor={idToClothHex(selectedNPC.id)}
                  skinColor={idToSkinHex(selectedNPC.id)}
                  eyeColor={idToEyeHex(selectedNPC.id)}
                  mouthColor={idToMouthHex(selectedNPC.id)}
                  hairFrontVariant={idToHairFront(selectedNPC.id, selectedNPC.gender)}
                  hairBackVariant={idToHairBack(selectedNPC.id)}
                  hasBeard={selectedNPC.gender === 'male' ? idToHasBeard(selectedNPC.id) : false}
                  role={selectedNPC.role}
                  rarity={selectedNPC.rarity}
                  size={96}
                  profile
                />
                <div>
                  <div className={styles.detailName} style={{ color: selectedNPC.color }}>
                    {selectedNPC.name}
                  </div>
                  <div className={styles.detailRole}>{selectedNPC.role} / {selectedNPC.gender === 'female' ? '♀' : '♂'}{selectedNPC.age ? ` / ${selectedNPC.age}歳` : ''}</div>
                </div>
                <span className={styles.detailMood}>{selectedNPC.mood}</span>
              </div>
              <p className={styles.detailPersonality}>{selectedNPC.personality}</p>
              <div className={styles.detailParams}>
                {Object.entries(selectedNPC.params).map(([key, val]) => (
                  <div key={key} className={styles.paramRow}>
                    <span className={styles.paramLabel}>
                      {key === 'logic' ? '論理' : key === 'creativity' ? '創造' : key === 'morality' ? '道徳' : key === 'empathy' ? '共感' : key === 'ambition' ? '野心' : '社交'}
                    </span>
                    <div className={styles.paramBar}>
                      <div className={styles.paramFill} style={{ width: `${val}%`, background: selectedNPC.color }} />
                    </div>
                    <span className={styles.paramVal}>{val}</span>
                  </div>
                ))}
              </div>

              {/* 記憶一覧 */}
              {selectedNPC.memory.length > 0 && (
                <div className={styles.memorySection}>
                  <div className={styles.memoryTitle}>{'\uD83D\uDCDD'} 記憶</div>
                  {selectedNPC.memory.map((m, i) => (
                    <div key={i} className={styles.memoryItem}>{m}</div>
                  ))}
                </div>
              )}

              {/* 関係性一覧（村にいるNPCのみ表示） */}
              {Object.entries(selectedNPC.relationships).filter(([id]) => npcs.some((n) => n.id === id)).length > 0 && (
                <div className={styles.memorySection}>
                  <div className={styles.memoryTitle}>{'\uD83E\uDD1D'} 関係性</div>
                  {Object.entries(selectedNPC.relationships).map(([otherId, rel]) => {
                    const other = npcs.find((n) => n.id === otherId);
                    if (!other) return null;
                    return (
                      <div key={otherId} className={styles.relItem}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <CharacterSprite gender={other.gender} hairColor={other.color} clothColor={idToClothHex(other.id)} skinColor={idToSkinHex(other.id)} eyeColor={idToEyeHex(other.id)} mouthColor={idToMouthHex(other.id)} hairFrontVariant={idToHairFront(other.id, other.gender)} hairBackVariant={idToHairBack(other.id)} hasBeard={other.gender === 'male' ? idToHasBeard(other.id) : false} role={other.role} rarity={other.rarity} size={16} />
                          {other.name}
                        </span>
                        <span className={styles.relLabel}>{rel.label}</span>
                        <span style={{ color: rel.score >= 0 ? '#4CAF50' : '#ff6b6b' }}>
                          {rel.score > 0 ? '+' : ''}{rel.score}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 信念一覧 */}
              {selectedNPC.beliefs.length > 0 && (
                <div className={styles.memorySection}>
                  <div className={styles.memoryTitle}>{'\uD83D\uDCA1'} 信念</div>
                  {selectedNPC.beliefs.map((b, i) => (
                    <div key={i} className={styles.memoryItem}>{b}</div>
                  ))}
                </div>
              )}

              {/* 追放ボタン */}
              <button
                className={styles.banishBtn}
                onClick={() => {
                  if (!confirm(`本当に${selectedNPC.name}を村から追い出しますか？`)) return;
                  const npc = selectedNPC;
                  addLog({
                    id: `${Date.now()}-banish-${npc.id}`,
                    timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
                    npcName: npc.name, npcEmoji: npc.emoji, npcColor: npc.color,
                    think: `神の怒りにより${npc.name}は村を追放された…`,
                    isEvent: true, source: 'program',
                  });
                  setNPCs((prev) => prev.filter((n) => n.id !== npc.id));
                  setVillageHistory((h) => ({
                    ...h, recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${npc.name}が村を追放された`],
                  }));
                  setSelectedNPCId(null);
                }}
              >
                {'\uD83D\uDEAB'} 村から追い出す
              </button>
            </div>
            </div>
          )}
        </div>

        {/* ログパネル */}
        <div className={styles.right}>
          <LogPanel
            logs={logs} villageHistory={villageHistory} civilizations={civilizations} npcs={npcs} currentDay={gameTime.day}
            harvestedIds={harvestedIds} civilizationPoints={civilizationPoints}
            onHarvest={harvestItem} onHarvestAll={harvestAll}
            prayers={prayers} faithPoints={faithPoints} onDismissPrayer={dismissPrayer}
            onWhisperForPrayer={(npcId) => { setSelectedNPCId(npcId); setShowWhisperModal(true); }}
          />
        </div>
      </div>

      {/* 住民追加モーダル */}
      {showAddNPC && (
        <AddNPCModal
          existingNames={npcs.map((n) => n.name)}
          occupiedAreas={[
            ...FACILITIES.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...builtFacilities.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...npcs.map((n) => ({ x: n.homeX - 15, y: n.homeY - 15, width: 30, height: 30 })),
          ]}
          onAdd={(npc) => {
            setNPCs((prev) => [...prev, npc]);
            addLog({
              id: `${Date.now()}-newcomer`,
              timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
              npcName: npc.name,
              npcEmoji: npc.emoji,
              npcColor: npc.color,
              think: `${npc.name}が村にやってきた！（${npc.role}・${npc.personality.slice(0, 20)}...）`,
              isEvent: true,
              source: 'program',
            });
            setVillageHistory((h) => ({
              ...h,
              recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${npc.name}（${npc.role}）が村に来た`],
            }));
          }}
          onClose={() => setShowAddNPC(false)}
        />
      )}

      {/* ガチャモーダル */}
      {showGacha && (
        <GachaModal
          existingNames={npcs.map((n) => n.name)}
          physicalPoints={civilizationPoints.physical}
          onAdd={(npc) => {
            setNPCs((prev) => [...prev, npc]);
            addLog({
              id: `${Date.now()}-gacha`,
              timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
              npcName: npc.name,
              npcEmoji: npc.emoji,
              npcColor: npc.color,
              think: `${npc.name}が召喚された！（${npc.role}・${npc.personality.slice(0, 20)}...）`,
              isEvent: true,
              source: 'program',
            });
            setVillageHistory((h) => ({
              ...h,
              recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${npc.name}（${npc.role}）が召喚された`],
            }));
          }}
          onSpendPoints={spendPhysicalPoints}
          onClose={() => setShowGacha(false)}
        />
      )}

      {/* 概念ガチャモーダル */}
      {showItemGacha && (
        <ItemGachaModal
          conceptualPoints={civilizationPoints.conceptual}
          onSpendPoints={spendConceptualPoints}
          onAddItems={addItemsToInventory}
          onClose={() => setShowItemGacha(false)}
        />
      )}

      {/* インベントリモーダル */}
      {showInventory && (
        <InventoryModal
          inventory={inventory}
          npcs={npcs}
          buffs={buffs}
          currentDay={gameTime?.day ?? 1}
          unharvestedCount={unharvestedCount}
          totalCivCount={civilizations.filter((c) => c.category !== 'demolish').length}
          forceConversations={forceConversations}
          confessionUrges={confessionUrges}
          onUseItem={handleUseItem}
          onClose={() => setShowInventory(false)}
        />
      )}

      {/* 引っ越しモーダル */}
      {departureCandidate && (
        <DepartureModal
          npc={departureCandidate.npc}
          reason={departureCandidate.reason}
          onRetain={() => {
            const npc = departureCandidate.npc;
            // 引き留め: 50%の確率で残る
            const stays = Math.random() < 0.5;
            if (stays) {
              addLog({
                id: `${Date.now()}-stay-${npc.id}`,
                timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
                npcName: npc.name, npcEmoji: npc.emoji, npcColor: npc.color,
                think: `${npc.name}は引き留めに応じ、村に残ることにした`,
                isEvent: true, source: 'program',
              });
            } else {
              addLog({
                id: `${Date.now()}-leave-${npc.id}`,
                timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
                npcName: npc.name, npcEmoji: npc.emoji, npcColor: npc.color,
                think: `${npc.name}は引き留めを断り、村を去った…`,
                isEvent: true, source: 'program',
              });
              setNPCs((prev) => prev.filter((n) => n.id !== npc.id));
              setVillageHistory((h) => ({
                ...h, recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${npc.name}が村を去った`],
              }));
            }
            setDepartureCandidate(null);
          }}
          onLetGo={() => {
            const npc = departureCandidate.npc;
            addLog({
              id: `${Date.now()}-leave-${npc.id}`,
              timestamp: `Day${gameTime.day} ${gameTime.displayTime}`,
              npcName: npc.name, npcEmoji: npc.emoji, npcColor: npc.color,
              think: `${npc.name}は旅立ちの準備を済ませ、村を去った…`,
              isEvent: true, source: 'program',
            });
            setNPCs((prev) => prev.filter((n) => n.id !== npc.id));
            setVillageHistory((h) => ({
              ...h, recentHistory: [...h.recentHistory, `Day${gameTime.day}: ${npc.name}が村を去った`],
            }));
            setDepartureCandidate(null);
          }}
        />
      )}

      {/* ささやきモーダル（iOS Safari対策: アンマウントせずdisplayで切替） */}
      <div style={{ display: showWhisperModal ? 'contents' : 'none' }}>
        <WhisperModal
          npcs={npcs}
          onSend={handleWhisperSend}
          onClose={() => setShowWhisperModal(false)}
          cooldownRemaining={whisperCooldown}
          preselectedNpcId={selectedNPCId}
        />
      </div>

      {/* 設定モーダル */}
      {showSettings && (
        <SettingsModal
          groqKey={apiKey}
          geminiKey={geminiKey}
          onSave={(newGroq, newGemini) => {
            localStorage.setItem(STORAGE_KEY, newGroq);
            setApiKey(newGroq);
            if (newGemini) {
              localStorage.setItem('kamisama_gemini_key', newGemini);
            } else {
              localStorage.removeItem('kamisama_gemini_key');
            }
            setGeminiKey(newGemini);
          }}
          onLogout={() => {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem('kamisama_gemini_key');
            setApiKey(null);
            setGeminiKey(null);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* このゲームについてモーダル */}
      {showInfo && <InfoModal onClose={() => {
        setShowInfo(false);
        fetch('./info.json?t=' + Date.now())
          .then((r) => r.json())
          .then((data: Array<{ date: string }>) => {
            if (data?.length) localStorage.setItem('kamisama_info_seen', data[0].date);
          }).catch(() => {});
      }} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* お布施モーダル */}
      {showOfuse && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setShowOfuse(false)}
        >
          <div
            style={{
              background: '#fff', border: '1px solid #e0d4c4', borderRadius: '16px',
              maxWidth: '480px', width: '100%', padding: '28px 24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)', textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>{'\u26E9\uFE0F'}</div>
            <h3 style={{ color: '#c41e3a', fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>
              天地開闢のその先へ — 創造主への献上
            </h3>
            <div style={{ color: '#7a6a55', fontSize: '13px', lineHeight: 1.9, textAlign: 'left', marginBottom: '20px' }}>
              <p style={{ marginBottom: '10px' }}>
                この世界「高天原より常世のくにへ」は、一柱の創造主の手によって生み出されました。
              </p>
              <p style={{ marginBottom: '10px' }}>
                高天原の神殿を整え、常世のくにをより豊かにするため、創造主は日夜、天地の仕組みを磨き続けています。
              </p>
              <p style={{ marginBottom: '10px' }}>
                もしこの世界を気に入ってくださったなら、創造主へのお布施という形で天地開闢の営みを支えていただけると幸いです。
              </p>
              <p style={{ marginBottom: '10px', color: '#8b7a66', fontSize: '12px' }}>
                いただいた献上は、高天原の環境整備 ── 新たな住民の創出、世界の安定、より深い物語の実現 ── に充てられます。
              </p>
              <p style={{ color: '#c41e3a', fontSize: '12px' }}>
                神々の遊びを、ともに紡いでいきましょう。
              </p>
            </div>
            <a
              href="https://ofuse.me/lafcreate"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                fontSize: '15px', fontWeight: 700, padding: '12px 32px',
                borderRadius: '28px', textDecoration: 'none',
                background: 'linear-gradient(135deg, #c41e3a, #9a1630)',
                color: '#fff', border: 'none',
                boxShadow: '0 4px 16px rgba(196,30,58,0.3)',
                transition: 'all 0.25s',
              }}
            >
              {'\u2615'} 創造主へ献上する（OFUSE）
            </a>
            <div style={{ fontSize: '11px', color: '#a09080', marginTop: '10px' }}>
              メッセージなしでもOK！50円から・登録不要で送れます
            </div>
            <button
              onClick={() => setShowOfuse(false)}
              style={{
                marginTop: '16px', background: 'none', border: '1px solid #d4c4b0',
                borderRadius: '8px', color: '#9a8a70', padding: '6px 20px',
                fontSize: '12px', cursor: 'pointer',
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
