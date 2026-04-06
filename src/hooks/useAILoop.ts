import { useEffect, useRef } from 'react';
import type { NPC, LogEntry, VillageHistory, CivilizationItem, Whisper, Prayer, Buff, ForceConversation, ConfessionUrge } from '../types';
import type { GameTime } from './useGameClock';
import { AI_INTERVAL_MS, MAX_CONCURRENT_REQUESTS, FACILITIES } from '../lib/constants';
import { promoteToLongTermMemory, shouldAutoRecord, addToHistory } from '../lib/historySystem';
import { callFrontAI, parseAIResponse, isRateLimited, shouldThrottle, isDailyLimitReached, getSavingMultiplier, isFallbackActive } from '../lib/groqApi';
import { buildMonologuePrompt, buildEncounterPrompt } from '../lib/promptBuilder';
import { checkPrayerFulfillment } from '../lib/batchEval';
import {
  ENCOUNTER_DIST, getDistance, rollEncounter, canShowPassing, getPassingLine,
  canShowSoloAction, getSoloAction,
} from '../lib/encounterSystem';

// AI応答の型
interface CivEvent {
  type: string;
  name: string;
  description: string;
}

interface MonologueResponse {
  think: string;
  action: string;
  mood: string;
  move_to?: string;
  new_belief?: string;
  whisper_reaction?: string;
  civilization_event?: CivEvent | null;
}

interface ConversationLine {
  who: string;
  say: string;
}

interface EncounterResponse {
  conversation: ConversationLine[];
  summary: string;
  a_mood: string;
  b_mood: string;
  a_move_to?: string;
  b_move_to?: string;
  rel_change: {
    a_to_b: { label: string; score_delta: number };
    b_to_a: { label: string; score_delta: number };
  };
  new_beliefs?: Record<string, string>;
  civilization_event?: CivEvent | null;
}

// 会話ラリーキューの型
interface ConversationQueueItem {
  npcId: string;
  say: string;
  delay: number; // ms後に表示
}

export function useAILoop(
  npcs: NPC[],
  setNPCs: React.Dispatch<React.SetStateAction<NPC[]>>,
  addLog: (entry: LogEntry) => void,
  apiKey: string,
  model: string,
  geminiKey: string | null,
  paused: boolean,
  speed: number,
  eventActive: boolean,
  gameTime?: GameTime,
  villageHistory?: VillageHistory,
  setVillageHistory?: React.Dispatch<React.SetStateAction<VillageHistory>>,
  civilizations?: CivilizationItem[],
  setCivilizations?: React.Dispatch<React.SetStateAction<CivilizationItem[]>>,
  whisper?: Whisper | null,
  consumeWhisper?: () => void,
  onBuildIntent?: (npcId: string, npcName: string, civEvent: { type: string; name: string; description: string }) => void,
  prayers?: Prayer[],
  fulfillPrayer?: (prayerId: string, day?: number) => void,
  buffs?: Buff[],
  forceConversations?: ForceConversation[],
  consumeForceConversation?: () => void,
  confessionUrges?: ConfessionUrge[],
  consumeConfessionUrge?: (npcId1: string, npcId2: string) => void,
) {
  const npcsRef = useRef(npcs);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const gameTimeRef = useRef(gameTime);
  const historyRef = useRef(villageHistory);
  const civsRef = useRef(civilizations);
  const whisperRef = useRef(whisper);
  const prayersRef = useRef(prayers);
  const buffsRef = useRef(buffs);
  const forceConvsRef = useRef(forceConversations);
  const confessionUrgesRef = useRef(confessionUrges);
  const activeRequests = useRef(0);
  // 処理中のNPC IDを追跡（重複リクエスト防止）
  const busyNPCs = useRef(new Set<string>());

  // 施設名 or NPC名 → 座標の変換
  const resolveMoveTo = (target: string, npc: NPC): { x: number; y: number } | null => {
    if (!target || target === '') return null;
    if (target === '自宅') return { x: npc.homeX, y: npc.homeY };

    // まずNPC名として検索（相手NPCの現在位置に向かう）
    const targetNpc = npcsRef.current.find((n) => n.id !== npc.id && (n.name === target || target.includes(n.name)));
    if (targetNpc) return { x: targetNpc.x, y: targetNpc.y };

    // 次に施設名として検索
    const f = FACILITIES.find((fac) => target.includes(fac.name) || fac.name.includes(target));
    if (!f) return null;
    return { x: f.x + f.width / 2, y: f.y + f.height / 2 };
  };

  useEffect(() => { npcsRef.current = npcs; }, [npcs]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { gameTimeRef.current = gameTime; }, [gameTime]);
  useEffect(() => { historyRef.current = villageHistory; }, [villageHistory]);
  useEffect(() => { civsRef.current = civilizations; }, [civilizations]);
  useEffect(() => { whisperRef.current = whisper; }, [whisper]);
  useEffect(() => { prayersRef.current = prayers; }, [prayers]);
  useEffect(() => { buffsRef.current = buffs; }, [buffs]);
  useEffect(() => { forceConvsRef.current = forceConversations; }, [forceConversations]);
  useEffect(() => { confessionUrgesRef.current = confessionUrges; }, [confessionUrges]);

  // 吹き出し表示ヘルパー
  const showBubble = (npcId: string, text: string, type: 'say' | 'think', durationMs: number) => {
    setNPCs((prev) => prev.map((n) =>
      n.id === npcId ? { ...n, bubble: text, bubbleType: type, bubbleTimer: durationMs } : n
    ));
  };

  // 祈り成就チェック（テキストに祈りのkeyword/messageが関連していればAI判定）
  const tryPrayerFulfillment = (text: string) => {
    if (!fulfillPrayer || !prayersRef.current) return;
    const lowerText = text.toLowerCase();
    const activePrayers = prayersRef.current.filter((p) => !p.fulfilled);
    for (const prayer of activePrayers) {
      // keyword部分一致
      const kwMatched = prayer.keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        if (lowerText.includes(kwLower)) return true;
        for (let i = 0; i < kwLower.length - 1; i++) {
          if (lowerText.includes(kwLower.slice(i, i + 2))) return true;
        }
        return false;
      });
      // message バイグラム一致
      const msgChars = prayer.message.replace(/[。、！？「」の が を で に は と]/g, '');
      const msgMatched = msgChars.length >= 2 && Array.from({ length: msgChars.length - 1 }, (_, i) => msgChars.slice(i, i + 2)).some((bg) => lowerText.includes(bg));

      if (kwMatched || msgMatched) {
        checkPrayerFulfillment(prayer, text, apiKey).then((isFulfilled) => {
          if (isFulfilled) {
            fulfillPrayer(prayer.id, gameTimeRef.current?.day);
            addLog({
              id: `${Date.now()}-prayer-fulfilled-${prayer.id}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: timestamp(),
              npcName: prayer.npcName,
              npcEmoji: prayer.npcEmoji,
              npcColor: '#c41e3a',
              think: `祈り成就！「${prayer.message}」が叶った`,
              isEvent: true,
              source: 'program',
            });
            console.log(`[PRAYER] 成就: ${prayer.npcName}「${prayer.message}」← ${text.slice(0, 50)}`);
          }
        });
        break; // 1テキストで1祈りだけ
      }
    }
  };

  // 会話ラリーを順番に表示
  const playConversationRally = (queue: ConversationQueueItem[]) => {
    queue.forEach((item) => {
      setTimeout(() => {
        showBubble(item.npcId, item.say, 'say', 1800);
      }, item.delay);
    });
  };

  // タイムスタンプ生成（ゲーム内時刻）
  const timestamp = (): string => {
    const gt = gameTimeRef.current;
    if (!gt) return 'Day? --:--';
    return `Day${gt.day} ${gt.displayTime}`;
  };

  // ループ検出: 直近の記憶とキーワードが被ってるかチェック
  const isLoopAction = (npc: NPC, action: string, think: string): boolean => {
    const recent = npc.memory.slice(-3);
    if (recent.length === 0) return false;

    // actionの主要キーワードを抽出（2文字以上のトークン）
    const newWords = (action + think).split(/[\s、。！？を・に]/g).filter((w) => w.length >= 2);

    let overlapCount = 0;
    for (const mem of recent) {
      for (const word of newWords) {
        if (mem.includes(word)) { overlapCount++; break; }
      }
    }
    // 直近3件中2件以上とキーワードが被ったらループ判定
    return overlapCount >= 2;
  };

  // 独白処理
  const processMonologue = async (npc: NPC) => {
    // ささやきチェック: 未消費のみ
    const npcWhisper = whisperRef.current?.targetNpcId === npc.id && !whisperRef.current?.consumed ? whisperRef.current : null;
    // ささやきはCerebras（神の言葉への反応）、通常独白はGroq（節約）
    const useGemini = npcWhisper ? geminiKey : null;
    const useFallbackPrompt = !useGemini && isFallbackActive();
    // 介入頻度: 全NPCの長期記憶中の「神の声」関連記録の割合
    const allLtm = npcsRef.current.flatMap((n) => n.longTermMemory);
    const whisperMemCount = allLtm.filter((m) => m.includes('神の声') || m.includes('不思議な声') || m.includes('お告げ')).length;
    const whisperIntensity = allLtm.length > 0 ? Math.min(1, whisperMemCount / Math.max(10, allLtm.length) * 3) : 0;
    const prompt = buildMonologuePrompt(npc, gameTimeRef.current, historyRef.current, civsRef.current ?? [], npcWhisper, useFallbackPrompt, whisperIntensity, buffsRef.current);
    const { text: raw, source: aiSource, modelTag } = await callFrontAI(apiKey, useGemini, prompt, 2048);
    console.log(`[AI] 独白: ${npc.name} (${modelTag}${npcWhisper ? '+whisper' : ''})`, raw?.slice(0, 100));
    const data = parseAIResponse<MonologueResponse>(raw);
    if (!data) { console.warn(`[AI] 独白パース失敗: ${npc.name}`); return; }

    // whisperTask実行中: AIの行動が指示と無関係なら強制上書き
    if (!npcWhisper && npc.whisperTask) {
      const task = npc.whisperTask;
      // タスクのキーワードがactionに含まれてるかチェック
      const taskWords = task.split(/[\s、。！？をにでとがのは]/g).filter((w) => w.length >= 2);
      const actionRelevant = taskWords.some((w) => data.action.includes(w) || data.think.includes(w));
      if (!actionRelevant) {
        console.warn(`[AI] whisperTask無視検出: ${npc.name}「${data.action}」← タスク「${task}」→ 上書き`);
        data.action = task.length > 12 ? task.slice(0, 12) : task;
        data.think = `神の声に従い${task.slice(0, 15)}を実行する`;
      }
    }

    // ループ検出: 被ってたらPG定型行動に差し替え（whisperTask実行中はスキップ）
    if (!npc.whisperTask && isLoopAction(npc, data.action, data.think)) {
      console.warn(`[AI] ループ検出: ${npc.name}「${data.action}」→ PG差し替え`);
      const solo = getSoloAction(npc, gameTimeRef.current?.period);
      showBubble(npc.id, solo.think, 'think', 2500);
      addLog({
        id: `${Date.now()}-${npc.id}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: timestamp(),
        npcName: npc.name,
        npcEmoji: npc.emoji,
        npcColor: npc.color,
        think: solo.think,
        action: solo.action,
        source: 'program',
      });
      setNPCs((prev) => prev.map((n) =>
        n.id === npc.id ? { ...n, isWaiting: false, lastAiCall: Date.now() } : n
      ));
      return;
    }

    // 吹き出し
    showBubble(npc.id, data.think, 'think', 3000);

    // NPC状態更新 + AI指定の移動先
    // ささやきでobey時、AIのmove_toが信用できない場合は指示文からキーワード抽出
    let finalMoveTo = data.move_to || '';
    if (npcWhisper && data.whisper_reaction === 'obey' && npcWhisper.message) {
      const msg = npcWhisper.message;
      // 施設名マッチ
      const facilityNames = FACILITIES.map((f) => f.name);
      const matchedFacility = facilityNames.find((name) => msg.includes(name));
      // NPC名マッチ
      const npcNames = npcsRef.current.filter((n) => n.id !== npc.id).map((n) => n.name);
      const matchedNpc = npcNames.find((name) => msg.includes(name));

      // キーワード→施設の推測マッピング（行動系を先、物品系を後に）
      const keywordToFacility: [string, string][] = [
        ['釣', '水源'], ['水汲', '水源'], ['泳', '水源'],
        ['掘', '鉱山'], ['採掘', '鉱山'], ['鍛冶', '鉱山'],
        ['耕', '畑'], ['種まき', '畑'], ['収穫', '畑'],
        ['説教', '教会'], ['布教', '教会'], ['祈', '教会'], ['礼拝', '教会'], ['掃除', '教会'],
        ['探検', '森'], ['冒険', '森'], ['狩', '森'],
        ['集会', '広場'], ['演説', '広場'], ['選挙', '広場'],
        ['魚', '水源'], ['鉱', '鉱山'], ['鉄', '鉱山'], ['石', '鉱山'], ['資源', '鉱山'],
        ['野菜', '畑'], ['作物', '畑'], ['農', '畑'], ['種', '畑'],
        ['木', '森'], ['薬草', '森'],
        ['商品', '市場'], ['売', '市場'], ['買', '市場'], ['取引', '市場'], ['試食', '市場'], ['値段', '市場'],
        ['信仰', '教会'], ['配る', '広場'], ['集まる', '広場'],
      ];
      let inferredFacility = '';
      for (const [kw, fac] of keywordToFacility) {
        if (msg.includes(kw)) { inferredFacility = fac; break; }
      }

      // 優先順位: NPC名 > 施設名直接 > キーワード推測
      if (matchedNpc) {
        finalMoveTo = matchedNpc;
      } else if (matchedFacility) {
        finalMoveTo = matchedFacility;
      } else if (inferredFacility) {
        finalMoveTo = inferredFacility;
      }
    }
    const moveDest = finalMoveTo ? resolveMoveTo(finalMoveTo, npc) : null;
    if (npcWhisper) console.log(`[WHISPER] move_to: AI="${data.move_to}" → final="${finalMoveTo}" → dest=${moveDest ? `(${moveDest.x},${moveDest.y})` : 'null'}`);
    setNPCs((prev) => prev.map((n) => {
      if (n.id !== npc.id) return n;
      const newMemory = [...n.memory, `${data.action}`].slice(-6);
      const newBeliefs = data.new_belief ? [...n.beliefs, data.new_belief].slice(-5) : n.beliefs;
      const moveUpdate = moveDest ? { targetX: moveDest.x, targetY: moveDest.y } : {};
      // ささやきでobey+移動先ありならフラグ+タスクを立てる
      const whisperFlag = (npcWhisper && data.whisper_reaction === 'obey' && moveDest)
        ? { whisperMoving: true, whisperTask: npcWhisper.message }
        : {};
      // whisperTask実行後はクリア（到着後のAI独白で使われた）
      const clearTask = (!npcWhisper && n.whisperTask) ? { whisperTask: undefined } : {};
      return { ...n, mood: data.mood, memory: newMemory, beliefs: newBeliefs, isWaiting: false, lastAiCall: Date.now(), ...moveUpdate, ...whisperFlag, ...clearTask };
    }));

    // ログ（ささやき時は反応ログに統合するので通常ログはスキップ）
    if (!npcWhisper) {
      addLog({
        id: `${Date.now()}-${npc.id}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: timestamp(),
        npcName: npc.name,
        npcEmoji: npc.emoji,
        npcColor: npc.color,
        think: data.think,
        action: data.action,
        source: 'ai',
        fallback: aiSource !== 'gemini' && isFallbackActive(),
        modelTag: modelTag,
      });
    }

    // 独白テキストで祈り成就チェック
    tryPrayerFulfillment(`${data.think} ${data.action}`);

    // 文明イベント検出
    if (data.civilization_event && data.civilization_event.name && setCivilizations) {
      const ce = data.civilization_event;
      const category = (ce.type === 'new_belief' ? 'belief' : ce.type) as CivilizationItem['category'];

      // discoveryの場合: 場所をdescriptionから推測
      const facilityNames = ['畑', '市場', '教会', '鉱山', '森', '水源', '広場'];
      const inferLocation = (): string => {
        // descriptionから場所を推測
        const desc = ce.description || '';
        const found = facilityNames.find((f) => desc.includes(f));
        if (found) return found;
        // NPCの現在地から最寄り施設を推測
        let nearest = '広場';
        let minDist = Infinity;
        for (const f of FACILITIES) {
          const dx = npc.x - (f.x + f.width / 2);
          const dy = npc.y - (f.y + f.height / 2);
          const d = dx * dx + dy * dy;
          if (d < minDist) { minDist = d; nearest = f.name; }
        }
        return nearest;
      };

      setCivilizations((prev) => {
        const existing = prev.find((c) => c.name === ce.name);

        // discoveryカテゴリ: 同名が既にあればlocationを追加するだけ
        if (existing && category === 'discovery') {
          const loc = inferLocation();
          if (existing.locations?.includes(loc)) {
            // 同じ場所の再報告は静かにスキップ
            return prev;
          }
          console.log(`[CIV] discovery場所追加: ${ce.name} +${loc} by ${npc.name}`);
          return prev.map((c) => c.id === existing.id ? {
            ...c,
            locations: [...(c.locations ?? []), loc],
            discoveredBy: [...new Set([...(c.discoveredBy ?? []), npc.name])],
          } : c);
        }

        // 同名アイテムが既にあればスキップ（discovery以外）
        if (existing) {
          console.log(`[CIV] 重複スキップ: ${ce.name}`);
          return prev;
        }

        // 新規登録
        const newItem: CivilizationItem = {
          id: `civ-${Date.now()}`,
          day: gameTimeRef.current?.day ?? 1,
          category,
          name: ce.name,
          description: ce.description,
          proposedBy: npc.name,
          status: 'proposed',
        };
        if (category === 'discovery') {
          newItem.locations = [inferLocation()];
          newItem.discoveredBy = [npc.name];
        }
        return [...prev, newItem];
      });
      console.log(`[CIV] ${category === 'discovery' ? '発見' : '新発見'}: ${ce.name} by ${npc.name}`);

      // 発見ログを会話ログに出す
      if (category === 'discovery') {
        addLog({
          id: `${Date.now()}-discovery-${npc.id}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: timestamp(),
          npcName: npc.name,
          npcEmoji: npc.emoji,
          npcColor: npc.color,
          think: `${ce.name}を発見した！ — ${ce.description}`,
          isEvent: true,
          source: 'ai',
          modelTag,
        });
      }

      // 建築・技術系なら建築プロジェクト生成、demolishなら取り壊し
      if (onBuildIntent) {
        onBuildIntent(npc.id, npc.name, ce);
      }

      // civilization_eventでも祈り成就チェック
      tryPrayerFulfillment(`${ce.name} ${ce.description}`);
    }

    // ささやき処理（1回で完結）
    if (npcWhisper && consumeWhisper) {
      console.log(`[WHISPER] 処理: ${npc.name} ← 「${npcWhisper.message}」 reaction=${data.whisper_reaction}`);
      // フォールバック（llama）時はAIのreaction無視して常にobey
      const forcedObey = isFallbackActive() && data.whisper_reaction !== 'obey';
      const obeyed = isFallbackActive() ? true : data.whisper_reaction === 'obey';
      const reactionText = obeyed ? '従うことにした' : '拒んだ';
      const refuseAction = '神の声を無視して自分のやりたいことをする';
      const day = gameTimeRef.current?.day ?? 1;

      // 拒否時はAIのactionが神の指示内容に引きずられるので上書き
      if (!obeyed) {
        data.action = refuseAction;
      }
      // フォールバックでobey強制した場合、AIのactionが指示と無関係なので上書き
      if (forcedObey) {
        data.action = `神の声に従い「${npcWhisper.message.slice(0, 20)}」を実行する`;
      }

      // 反応ログ（AIの思考も含めて1エントリに統合）
      addLog({
        id: `${Date.now()}-whisper-react-${npc.id}`,
        timestamp: timestamp(),
        npcName: npc.name,
        npcEmoji: npc.emoji,
        npcColor: npc.color,
        think: `神の声「${npcWhisper.message}」→ ${reactionText}\n${data.think}`,
        action: obeyed && finalMoveTo ? `${finalMoveTo}に向かう` : data.action,
        source: 'ai',
        isEvent: true,
        modelTag,
      });

      // 長期記憶に記録
      setNPCs((prev) => prev.map((n) => {
        if (n.id !== npc.id) return n;
        const ltm = [...n.longTermMemory, `(Day${day}) 神の声「${npcWhisper.message}」に${reactionText}`].slice(-20);
        return { ...n, longTermMemory: ltm };
      }));

      // move_toに人名が入っていれば、相手と会ったとき会話が発生する
      // （move_toは既に上のmoveDestで処理済み）

      // obey時に破壊系ささやきを検出 → demolish発火
      if (obeyed && onBuildIntent) {
        const msg = npcWhisper.message;
        const destroyKeywords = ['破壊', '壊して', '壊せ', '取り壊', '撤去', '潰して', '潰せ', '解体'];
        if (destroyKeywords.some((kw) => msg.includes(kw))) {
          // メッセージから対象名を抽出（「〇〇を壊して」「〇〇の家を破壊」等）
          // NPC名+の家、施設名、builtFacilities名でマッチ
          const npcNames = npcsRef.current.map((n) => n.name);
          let targetName = '';

          // 「〇〇の家」パターン
          for (const name of npcNames) {
            if (msg.includes(`${name}の家`) || msg.includes(`${name}の小屋`)) {
              targetName = msg.includes(`${name}の家`) ? `${name}の家` : `${name}の小屋`;
              break;
            }
          }

          // 施設名パターン（ささやき文中に含まれる施設名）
          if (!targetName) {
            const facilityNames = FACILITIES.map((f) => f.name);
            for (const fname of facilityNames) {
              if (msg.includes(fname)) { targetName = fname; break; }
            }
          }

          // メッセージから「〇〇を」パターンで抽出
          if (!targetName) {
            const match = msg.match(/(.+?)[をの](?:破壊|壊|取り壊|撤去|潰|解体)/);
            if (match) targetName = match[1].trim();
          }

          if (targetName) {
            console.log(`[WHISPER] 破壊指示検出: ${npc.name}が「${targetName}」を破壊`);
            onBuildIntent(npc.id, npc.name, { type: 'demolish', name: targetName, description: `神の声に従い破壊` });
          }
        }
      }

      // ささやき即消費（1回で完結）
      console.log(`[WHISPER] ${npc.name}: ${data.whisper_reaction} → 消費`);
      consumeWhisper();
    }
  };

  // 遭遇処理（会話ラリー）
  const processEncounter = async (a: NPC, b: NPC) => {
    // 告白ペアかどうかを会話開始時点でキャプチャ（setTimeout内でrefがズレる問題対策）
    // 告白ペアかどうかを会話開始時点でキャプチャ
    const isConfessionPair = (confessionUrgesRef.current ?? []).some(
      (u) => (u.npcId1 === a.id && u.npcId2 === b.id) || (u.npcId1 === b.id && u.npcId2 === a.id)
    );
    const prompt = buildEncounterPrompt(a, b, gameTimeRef.current, historyRef.current, civsRef.current ?? [], buffsRef.current, confessionUrgesRef.current);
    const { text: raw, source: encSource, modelTag: encTag } = await callFrontAI(apiKey, geminiKey, prompt, 2048);
    let data = parseAIResponse<EncounterResponse>(raw);

    // AIがarrayで返した場合のフォールバック
    if (!data && raw) {
      const arr = parseAIResponse<ConversationLine[]>(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        data = {
          conversation: arr,
          summary: arr[0]?.say?.slice(0, 15) ?? '会話',
          a_mood: '',
          b_mood: '',
          rel_change: {
            a_to_b: { label: '', score_delta: 0 },
            b_to_a: { label: '', score_delta: 0 },
          },
        };
      }
    }

    if (!data || !data.conversation || !Array.isArray(data.conversation) || data.conversation.length === 0) return;

    // 会話ラリーキューを構築
    const queue: ConversationQueueItem[] = data.conversation.map((line, i) => ({
      npcId: (line.who === a.name || line.who === 'A' || line.who === a.role) ? a.id : b.id,
      say: line.say,
      delay: i * 1500, // 1.5秒間隔
    }));

    playConversationRally(queue);

    // NPC状態更新（会話完了後）
    const updateDelay = queue.length * 1500;
    const day = gameTimeRef.current?.day ?? 1;
    // 好感度ボーナスバフ判定（累積: スタック数×2）
    const affectionStacks = buffsRef.current?.filter((b) => b.type === 'affection').length ?? 0;
    const affectionBonus = affectionStacks * 2;
    const hasRelChange = !!(data.rel_change?.a_to_b?.score_delta || data.rel_change?.b_to_a?.score_delta);
    const aBelief = data.new_beliefs?.[a.name] || '';
    const bBelief = data.new_beliefs?.[b.name] || '';
    const aMoveDest = data.a_move_to ? resolveMoveTo(data.a_move_to, a) : null;
    const bMoveDest = data.b_move_to ? resolveMoveTo(data.b_move_to, b) : null;

    // 恋愛系ラベル保護: 既に恋愛ラベルなら、AIが非恋愛ラベルを返しても上書きしない（好感度20未満で解消）
    const LOVE_LABEL_WORDS = ['好意', '恋', '愛', '想い', '惹かれ', '特別', '大切', '好き'];
    const MARRIAGE_LABEL_WORDS = ['夫婦', '伴侶', '妻', '夫', '連れ合い', '番'];
    const BREAKUP_THRESHOLD = 20;

    const resolveLabel = (existing: { label: string; score: number }, newLabel: string, newScore: number): string => {
      const existingIsLove = LOVE_LABEL_WORDS.some((w) => existing.label.includes(w));
      const existingIsMarriage = MARRIAGE_LABEL_WORDS.some((w) => existing.label.includes(w));
      const newIsLove = LOVE_LABEL_WORDS.some((w) => newLabel.includes(w));
      const newIsMarriage = MARRIAGE_LABEL_WORDS.some((w) => newLabel.includes(w));

      // 夫婦ラベルは最優先で保護（好感度20未満で破局）
      if (existingIsMarriage) {
        if (newScore < BREAKUP_THRESHOLD) return newLabel || '元伴侶';
        if (newIsMarriage) return newLabel;
        return existing.label; // 非婚姻ラベルで上書きしない
      }
      // 恋愛ラベルも保護（好感度20未満で破局）
      if (existingIsLove) {
        if (newScore < BREAKUP_THRESHOLD) return newLabel || '知り合い';
        if (newIsLove || newIsMarriage) return newLabel; // 恋愛→恋愛 or 恋愛→婚姻はOK
        return existing.label; // 非恋愛ラベルで上書きしない
      }
      // それ以外は普通に更新
      return newLabel || existing.label;
    };

    setTimeout(() => {
      setNPCs((prev) => prev.map((n) => {
        if (n.id === a.id) {
          const mem = [...n.memory, `${b.name}と会話「${data.summary || '会話'}」`].slice(-6);
          const rels = { ...n.relationships };
          let newScore = 0;
          if (data.rel_change?.a_to_b) {
            const existing = rels[b.id] || { label: '', score: 0 };
            newScore = Math.round(Math.max(-100, Math.min(100, existing.score + (data.rel_change.a_to_b.score_delta || 0) + affectionBonus)));
            const label = resolveLabel(existing, data.rel_change.a_to_b.label || '', newScore);
            rels[b.id] = { label, score: newScore };
          }
          const newBeliefs = aBelief ? [...n.beliefs, aBelief].slice(-5) : n.beliefs;
          const aMoveUpdate = aMoveDest ? { targetX: aMoveDest.x, targetY: aMoveDest.y } : {};
          let updated: NPC = { ...n, mood: data.a_mood || n.mood, memory: mem, relationships: rels, beliefs: newBeliefs, isWaiting: false, lastAiCall: Date.now(), ...aMoveUpdate };
          if (hasRelChange) updated = promoteToLongTermMemory(updated, `${b.name}と会話「${data.summary}」`, day);
          return updated;
        }
        if (n.id === b.id) {
          const mem = [...n.memory, `${a.name}と会話「${data.summary || '会話'}」`].slice(-6);
          const rels = { ...n.relationships };
          let newScore = 0;
          if (data.rel_change?.b_to_a) {
            const existing = rels[a.id] || { label: '', score: 0 };
            newScore = Math.round(Math.max(-100, Math.min(100, existing.score + (data.rel_change.b_to_a.score_delta || 0) + affectionBonus)));
            const label = resolveLabel(existing, data.rel_change.b_to_a.label || '', newScore);
            rels[a.id] = { label, score: newScore };
          }
          const newBeliefs = bBelief ? [...n.beliefs, bBelief].slice(-5) : n.beliefs;
          const bMoveUpdate = bMoveDest ? { targetX: bMoveDest.x, targetY: bMoveDest.y } : {};
          let updated: NPC = { ...n, mood: data.b_mood || n.mood, memory: mem, relationships: rels, beliefs: newBeliefs, isWaiting: false, lastAiCall: Date.now(), ...bMoveUpdate };
          if (hasRelChange) updated = promoteToLongTermMemory(updated, `${a.name}と会話「${data.summary}」`, day);
          return updated;
        }
        return n;
      }));

      // 村の歴史に自動記録
      if (setVillageHistory && shouldAutoRecord({
        hasNewBelief: !!(aBelief || bBelief),
        relScoreExceeded50: hasRelChange,
      })) {
        setVillageHistory((prev) => addToHistory(prev, day, `${a.name}と${b.name}が会話「${data.summary}」`));
      }

      // 文明イベント検出
      if (data.civilization_event && data.civilization_event.name && setCivilizations) {
        const ce = data.civilization_event;
        setCivilizations((prev) => {
          if (prev.some((c) => c.name === ce.name)) {
            console.log(`[CIV] 重複スキップ: ${ce.name}`);
            return prev;
          }
          return [...prev, {
            id: `civ-${Date.now()}`,
            day: gameTimeRef.current?.day ?? 1,
            category: (ce.type === 'new_belief' ? 'belief' : ce.type) as CivilizationItem['category'],
            name: ce.name,
            description: ce.description,
            proposedBy: `${a.name}と${b.name}`,
            status: 'proposed',
          }];
        });
        console.log(`[CIV] 新発見: ${ce.name} by ${a.name}&${b.name}`);

        if (onBuildIntent) {
          onBuildIntent(a.id, `${a.name}と${b.name}`, ce);
        }
      }

      // 告白促進消費（開始時点でキャプチャした値を使用）
      if (isConfessionPair) {
        if (consumeConfessionUrge) consumeConfessionUrge(a.id, b.id);
      }
    }, updateDelay);

    // 告白リザルト表示（setNPCsと分離して少し遅延させる）
    if (isConfessionPair) {
      setTimeout(() => {
        const LOVE_WORDS = ['好意', '恋', '愛', '想い', '惹かれ', '特別', '大切', '好き'];
        const labelA = data.rel_change?.a_to_b?.label ?? '';
        const labelB = data.rel_change?.b_to_a?.label ?? '';
        const deltaA = data.rel_change?.a_to_b?.score_delta ?? 0;
        const deltaB = data.rel_change?.b_to_a?.score_delta ?? 0;
        const isLoveA = LOVE_WORDS.some((w) => labelA.includes(w));
        const isLoveB = LOVE_WORDS.some((w) => labelB.includes(w));

        let resultEmoji = '💕';
        let resultMsg = '';
        if (isLoveA && isLoveB) {
          resultMsg = `${a.name}と${b.name}は恋人になった！`;
          resultEmoji = '💘';
        } else if (isLoveA || isLoveB) {
          const lover = isLoveA ? a.name : b.name;
          const other = isLoveA ? b.name : a.name;
          resultMsg = `${lover}の想いは伝わった。${other}はまだ戸惑っているようだ…`;
          resultEmoji = '💗';
        } else if (deltaA > 0 || deltaB > 0) {
          resultMsg = `${a.name}と${b.name}の間に良い雰囲気が流れた`;
          resultEmoji = '✨';
        } else if (deltaA < 0 || deltaB < 0) {
          resultMsg = `告白はうまくいかなかったようだ…`;
          resultEmoji = '💔';
        } else {
          resultMsg = `${a.name}と${b.name}の関係に大きな変化はなかった`;
          resultEmoji = '🌙';
        }

        addLog({
          id: `${Date.now()}-confession-result-${a.id}-${b.id}`,
          timestamp: `Day${gameTimeRef.current?.day ?? 1} ${gameTimeRef.current?.displayTime ?? ''}`,
          npcName: '告白の結果',
          npcEmoji: resultEmoji,
          npcColor: '#e91e63',
          think: resultMsg,
          isEvent: true,
          source: 'program',
        });
      }, updateDelay + 500);
    }

    // ログ（会話を1行ずつ分けて記録）
    const convLines = data.conversation.map((l) => {
      // AIが"A"/"B"で返す場合もあるので補正
      const isA = l.who === a.name || l.who === 'A' || l.who === a.role;
      const who = isA ? a.name : b.name;
      return {
        who,
        emoji: isA ? a.emoji : b.emoji,
        color: isA ? a.color : b.color,
        say: l.say,
      };
    });
    addLog({
      id: `${Date.now()}-${a.id}-${b.id}`,
      timestamp: timestamp(),
      npcName: a.name,
      npcEmoji: a.emoji,
      npcColor: a.color,
      targetName: b.name,
      targetEmoji: b.emoji,
      conversation: convLines,
      think: data.summary,
      source: 'ai',
      fallback: encSource !== 'gemini' && isFallbackActive(),
      modelTag: encTag,
    });

    // 会話内容で祈り成就チェック
    const convText = data.conversation.map((l: { say: string }) => l.say).join(' ') + ' ' + (data.summary ?? '');
    tryPrayerFulfillment(convText);
  };

  // すれ違い演出（API不使用）
  const processPassingBy = (a: NPC, b: NPC) => {
    if (!canShowPassing(a, b)) return;

    const lineA = getPassingLine(a, b);
    showBubble(a.id, lineA, 'say', 1500);

    // ログ（薄いグレー表示用にisEvent的なフラグ）
    addLog({
      id: `${Date.now()}-pass-${a.id}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: timestamp(),
      npcName: a.name,
      npcEmoji: a.emoji,
      npcColor: '#555',
      targetName: b.name,
      targetEmoji: b.emoji,
      say: lineA,
      source: 'program',
      modelTag: 'passing',
    });
  };

  // ラウンドロビン用のインデックス（毎tickで1つずつ処理するため）
  const roundRobinIdx = useRef(0);

  // メインループ — 毎tick 1タスクだけ処理して均等なテンポにする
  useEffect(() => {
    const interval = setInterval(async () => {
      if (pausedRef.current) return;
      // OpenRouterキーがあればGroqのレート制限を無視（OpenRouterで処理できるため）
      if (!geminiKey && isRateLimited()) return;
      if (!geminiKey && isDailyLimitReached()) return;
      if (activeRequests.current >= MAX_CONCURRENT_REQUESTS) return;
      if (!geminiKey && shouldThrottle()) return;

      const currentNPCs = npcsRef.current;
      const now = Date.now();
      const gt = gameTimeRef.current;
      const isMidnight = gt?.period === 'midnight';

      // ささやき待ちがある場合、ささやき対象以外のAI呼び出しをスキップ
      // ささやき待ち: 未消費の場合のみ優先モード（consumed=trueは通常運転で処理）
      const wCur = whisperRef.current;
      const pendingWhisper = wCur && !wCur.consumed;
      const whisperTargetId = pendingWhisper ? wCur.targetNpcId : null;

      // 深夜はAI間隔2倍
      const effectiveInterval = (AI_INTERVAL_MS / speedRef.current) * (isMidnight ? 2 : 1) * getSavingMultiplier();
      let dispatched = false;

      // 深夜はほぼ活動停止（90%スキップ）
      if (isMidnight && Math.random() < 0.9) return;

      // --- 強制会話キュー処理（最優先） ---
      const forcePair = forceConvsRef.current?.[0];
      if (forcePair && !dispatched) {
        const fa = currentNPCs.find((nn) => nn.id === forcePair.npcId1);
        const fb = currentNPCs.find((nn) => nn.id === forcePair.npcId2);
        if (fa && fb && !busyNPCs.current.has(fa.id) && !busyNPCs.current.has(fb.id)) {
          if (!shouldThrottle() && activeRequests.current < MAX_CONCURRENT_REQUESTS) {
            busyNPCs.current.add(fa.id);
            busyNPCs.current.add(fb.id);
            activeRequests.current++;
            setNPCs((prev) => prev.map((np) =>
              np.id === fa.id || np.id === fb.id ? { ...np, isWaiting: true } : np
            ));
            processEncounter(fa, fb).finally(() => {
              activeRequests.current--;
              busyNPCs.current.delete(fa.id);
              busyNPCs.current.delete(fb.id);
            });
            dispatched = true;
            if (consumeForceConversation) consumeForceConversation();
          }
        }
      }

      // --- 遭遇ペアを1つだけ探す（ささやき待ち時はスキップ） ---
      const n = currentNPCs.length;
      if (!pendingWhisper && !dispatched) {
      for (let offset = 0; offset < n * n && !dispatched; offset++) {
        const i = (roundRobinIdx.current + Math.floor(offset / n)) % n;
        const j = (i + 1 + (offset % (n - 1))) % n;
        if (i === j) continue;

        const a = currentNPCs[i];
        const b = currentNPCs[j];

        if (busyNPCs.current.has(a.id) || busyNPCs.current.has(b.id)) continue;
        if (getDistance(a, b) > ENCOUNTER_DIST) continue;
        if (now - a.lastAiCall < effectiveInterval && now - b.lastAiCall < effectiveInterval) continue;

        // whisperMoving中のNPCは、移動先のNPC以外との遭遇をスキップ
        // 例: アヤメがゲンジに向かってる途中、リンと遭遇しない
        if (a.whisperMoving && a.whisperTask) {
          const targetName = currentNPCs.find((nn) => nn.name && a.whisperTask?.includes(nn.name));
          if (targetName && targetName.id !== b.id) continue;
        }
        if (b.whisperMoving && b.whisperTask) {
          const targetName = currentNPCs.find((nn) => nn.name && b.whisperTask?.includes(nn.name));
          if (targetName && targetName.id !== a.id) continue;
        }

        if (rollEncounter(a, b, eventActive)) {
          // 当選 → 会話ラリー（1つだけ）
          busyNPCs.current.add(a.id);
          busyNPCs.current.add(b.id);
          activeRequests.current++;

          setNPCs((prev) => prev.map((np) =>
            np.id === a.id || np.id === b.id ? { ...np, isWaiting: true } : np
          ));

          processEncounter(a, b).finally(() => {
            activeRequests.current--;
            busyNPCs.current.delete(a.id);
            busyNPCs.current.delete(b.id);
          });

          dispatched = true;
        } else {
          processPassingBy(a, b);
        }
      }
      roundRobinIdx.current = (roundRobinIdx.current + 1) % Math.max(1, n);
      } // if (!pendingWhisper)

      // --- 遭遇がなければ独白（PG優先、たまにAI） ---
      if (!dispatched) {
        // ささやき未消費NPCを最優先、なければランダム
        const startIdx = whisperTargetId
          ? currentNPCs.findIndex((nn) => nn.id === whisperTargetId)
          : Math.floor(Math.random() * currentNPCs.length);
        for (let offset = 0; offset < currentNPCs.length; offset++) {
          const npc = currentNPCs[(Math.max(0, startIdx) + offset) % currentNPCs.length];
          if (busyNPCs.current.has(npc.id)) continue;
          // ささやき優先モード: 対象NPC以外はスキップ
          if (pendingWhisper && npc.id !== whisperTargetId) continue;

          const isWhisperTarget = pendingWhisper && npc.id === whisperTargetId;

          // ささやき対象以外は近くに人がいたらスキップ（遭遇で処理されるため）
          if (!isWhisperTarget) {
            const hasNearby = currentNPCs.some(
              (other) => other.id !== npc.id && getDistance(npc, other) <= ENCOUNTER_DIST
            );
            if (hasNearby) continue;
          }

          // ささやき対象 → AI強制（ただしスロットルは守る）、それ以外 → 通常判定
          if (shouldThrottle() || activeRequests.current >= MAX_CONCURRENT_REQUESTS) break;
          const aiReady = now - npc.lastAiCall >= effectiveInterval;
          const useAI = isWhisperTarget || (aiReady && Math.random() < 0.5);

          if (useAI) {
            busyNPCs.current.add(npc.id);
            activeRequests.current++;

            setNPCs((prev) => prev.map((np) =>
              np.id === npc.id ? { ...np, isWaiting: true } : np
            ));

            processMonologue(npc).finally(() => {
              activeRequests.current--;
              busyNPCs.current.delete(npc.id);
            });
          } else if (canShowSoloAction(npc.id)) {
            // PG独白（定型行動）
            const solo = getSoloAction(npc, gameTimeRef.current?.period);
            showBubble(npc.id, solo.think, 'think', 2500);
            addLog({
              id: `${Date.now()}-solo-${npc.id}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: timestamp(),
              npcName: npc.name,
              npcEmoji: npc.emoji,
              npcColor: npc.color,
              think: solo.think,
              action: solo.action,
              source: 'program',
              modelTag: 'passing',
            });
          }

          break; // 1つだけ
        }
      }
    }, 20000); // 20秒ごとにチェック（API節約）

    return () => clearInterval(interval);
  }, [apiKey, model, eventActive]);

  // ささやき即時実行: 送信直後に対象NPCのAI独白を発火
  const triggerWhisperNow = (npcId: string) => {
    // OpenRouterキーがあればGroqのレート制限を無視してささやき処理
    if (!geminiKey && (isRateLimited() || shouldThrottle())) {
      console.log('[WHISPER] レート制限中（OpenRouterなし）、次のtickで処理');
      return;
    }
    const npc = npcsRef.current.find((n) => n.id === npcId);
    if (!npc || busyNPCs.current.has(npcId)) return;

    busyNPCs.current.add(npcId);
    activeRequests.current++;
    setNPCs((prev) => prev.map((n) => n.id === npcId ? { ...n, isWaiting: true } : n));

    processMonologue(npc).finally(() => {
      activeRequests.current--;
      busyNPCs.current.delete(npcId);
    });
  };

  return { isRateLimited, triggerWhisperNow };
}
