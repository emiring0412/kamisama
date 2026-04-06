import { useEffect, useRef } from 'react';
import type { NPC, LogEntry, VillageHistory, Prayer } from '../types';
import type { GameTime } from './useGameClock';
import { applyParamChanges } from '../lib/dynamicPersonality';
import { addToHistory } from '../lib/historySystem';
import { batchDailyEval, regeneratePersonalityFront, generatePrayers } from '../lib/batchEval';
import { isDead, canHaveChild, createChild, checkMarriage } from '../lib/lifespanSystem';
import { isRRole } from '../lib/gachaData';

// ゲーム内1日ごと・7日ごとの定期評価
export function useDailyEval(
  npcs: NPC[],
  setNPCs: React.Dispatch<React.SetStateAction<NPC[]>>,
  addLog: (entry: LogEntry) => void,
  gameTime: GameTime,
  apiKey: string,
  paused: boolean,
  setVillageHistory: React.Dispatch<React.SetStateAction<VillageHistory>>,
  _demolishFacility?: (name: string, reason: string) => void,
  prayers?: Prayer[],
  setPrayers?: React.Dispatch<React.SetStateAction<Prayer[]>>,
  onDepartureCandidate?: (npc: NPC, reason: string) => void,
) {
  const lastEvalDay = useRef(gameTime.day);
  const lastJobEvalDay = useRef(gameTime.day);
  const npcsRef = useRef(npcs);
  useEffect(() => { npcsRef.current = npcs; }, [npcs]);
  const prayersRef = useRef(prayers);
  useEffect(() => { prayersRef.current = prayers; }, [prayers]);

  const timestamp = (): string => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  // ゲーム内1日ごとにバッチ評価（裏方1回 + 必要なら表舞台で性格清書）
  useEffect(() => {
    if (paused) return;
    if (gameTime.day <= lastEvalDay.current) return;
    lastEvalDay.current = gameTime.day;
    lastJobEvalDay.current = gameTime.day; // 職業判定もバッチに含む

    const evalBatch = async () => {
      const currentNPCs = npcsRef.current;

      // 職業とpersonalityの不一致チェック（前回の再生成失敗を拾う）
      const knownRoles = ['農民', '商人', '聖職者', '職人', '探検家', '漁師', '猟師', '薬師', '楽師', '語り部', '鍛冶師', '僧侶', '子ども'];
      const roleMismatchNames: string[] = [];
      for (const npc of currentNPCs) {
        const otherRoles = knownRoles.filter((r) => r !== npc.role);
        if (otherRoles.some((r) => npc.personality.includes(r))) {
          console.log(`[EVAL] role/personality不一致検出: ${npc.name}(${npc.role}) personality="${npc.personality}"`);
          roleMismatchNames.push(npc.name);
        }
      }

      const result = await batchDailyEval(currentNPCs, apiKey);
      if (!result) return;

      const paramLabels: Record<string, string> = {
        L: '論理', C: '創造', M: '道徳', E: '共感', A: '野心', S: '社交',
        logic: '論理', creativity: '創造', morality: '道徳', empathy: '共感', ambition: '野心', sociability: '社交',
      };

      // パラメータ変動を適用
      if (result.param_changes) {
        for (const [npcName, changes] of Object.entries(result.param_changes)) {
          if (!changes || Object.keys(changes).length === 0) continue;
          const npc = currentNPCs.find((n) => n.name === npcName);
          if (!npc) continue;

          // 短縮キー(L,C,M,E,A,S)をフルキーに変換
          const fullChanges: Record<string, number> = {};
          const keyMap: Record<string, string> = { L: 'logic', C: 'creativity', M: 'morality', E: 'empathy', A: 'ambition', S: 'sociability' };
          for (const [k, v] of Object.entries(changes)) {
            fullChanges[keyMap[k] ?? k] = v;
          }

          const changeText = Object.entries(fullChanges)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${paramLabels[k] ?? k}${v > 0 ? '+' : ''}${v}`)
            .join(', ');

          if (changeText) {
            setNPCs((prev) => prev.map((n) => {
              if (n.id !== npc.id) return n;
              const updated = applyParamChanges(n, fullChanges);
              const totalDelta = Object.values(fullChanges).reduce((s, v) => s + Math.abs(v), 0);
              return { ...updated, paramChangeAccum: (n.paramChangeAccum ?? 0) + totalDelta };
            }));

            addLog({
              id: `${Date.now()}-param-${npc.id}`,
              timestamp: timestamp(),
              npcName: npc.name,
              npcEmoji: npc.emoji,
              npcColor: npc.color,
              think: `パラメータ変動: ${changeText}`,
              source: 'program',
              isEvent: true,
            });
          }
        }
      }

      // 職業変化を適用
      const jobChangedNames: string[] = [];
      if (result.job_changes) {
        for (const [npcName, change] of Object.entries(result.job_changes)) {
          if (!change) continue;
          const npc = currentNPCs.find((n) => n.name === npcName);
          if (!npc) continue;
          // R/SR職業は転職しない
          if (isRRole(npc.role)) continue;
          // 転職確率ゲート: 20%の確率でのみ実際に転職（AIが提案しても大半はスキップ）
          if (Math.random() > 0.2) {
            console.log(`[EVAL] 転職スキップ(確率ゲート): ${npcName} ${npc.role}→${change.to}`);
            continue;
          }

          jobChangedNames.push(npcName);
          setNPCs((prev) => prev.map((n) =>
            n.id === npc.id ? { ...n, role: change.to } : n
          ));
          // 性格文を新しい職業に合わせて再生成（バックグラウンド）
          const updatedNpc = { ...npc, role: change.to };
          regeneratePersonalityFront(updatedNpc, 'llama-3.1-8b-instant', apiKey).then((newP) => {
            if (newP) {
              setNPCs((prev) => prev.map((n) =>
                n.id === npc.id ? { ...n, personality: newP } : n
              ));
              addLog({
                id: `${Date.now()}-personality-${npc.id}`,
                timestamp: timestamp(),
                npcName: npc.name,
                npcEmoji: npc.emoji,
                npcColor: npc.color,
                think: `性格が変化: 「${newP}」`,
                source: 'ai',
                isEvent: true,
                modelTag: 'Ll8B',
              });
            }
          });
          addLog({
            id: `${Date.now()}-job-${npc.id}`,
            timestamp: timestamp(),
            npcName: npc.name,
            npcEmoji: npc.emoji,
            npcColor: npc.color,
            think: `職業変化: ${npc.role} → ${change.to}「${change.reason}」`,
            source: 'program',
            isEvent: true,
          });
          setVillageHistory((prev) => addToHistory(prev, gameTime.day,
            `${npc.name}の職業が${npc.role}から${change.to}に変わった`));
        }
      }

      // 性格文再生成（表舞台で日本語清書）
      // 職業変更したNPCも性格文を再生成対象に追加
      const personalityUpdateNames = new Set(result.needs_personality_update ?? []);
      for (const name of jobChangedNames) {
        personalityUpdateNames.add(name);
      }
      for (const name of roleMismatchNames) {
        personalityUpdateNames.add(name);
      }

      if (personalityUpdateNames.size > 0) {
        for (const npcName of personalityUpdateNames) {
          const npc = currentNPCs.find((n) => n.name === npcName);
          if (!npc) continue;

          // R/SR職業は性格再生成しない（accumだけリセット）
          if (isRRole(npc.role)) {
            setNPCs((prev) => prev.map((n) =>
              n.id === npc.id ? { ...n, paramChangeAccum: 0 } : n
            ));
            continue;
          }

          // 職業変更があった場合は新しいroleを反映してから性格文を生成
          const jobChange = result.job_changes?.[npcName];
          const currentRole = (jobChange?.to) ? jobChange.to : npc.role;
          const npcForRegen = (jobChange?.to) ? { ...npc, role: currentRole } : npc;
          let newPersonality = await regeneratePersonalityFront(npcForRegen, 'qwen/qwen3-32b', apiKey);
          // 失敗時フォールバック: 最低限roleと矛盾しない暫定テキストにする
          if (!newPersonality) {
            newPersonality = npc.personality; // 失敗時は現在の性格文を維持
          }
          if (newPersonality) {
            setNPCs((prev) => prev.map((n) =>
              n.id === npc.id ? { ...n, personality: newPersonality!, paramChangeAccum: 0 } : n
            ));
            addLog({
              id: `${Date.now()}-personality-${npc.id}`,
              timestamp: timestamp(),
              npcName: npc.name,
              npcEmoji: npc.emoji,
              npcColor: npc.color,
              think: `性格が変化: 「${newPersonality}」`,
              source: 'program',
              isEvent: true,
            });
            setVillageHistory((prev) => addToHistory(prev, gameTime.day, `${npc.name}の性格が変化した`));
          }
        }
      }

    };

    evalBatch();
  }, [gameTime.day, paused]);

  // 祈り生成（2日に1回、1件のみ、上限3件）
  const lastPrayerDay = useRef(
    parseInt(localStorage.getItem('kamisama_last_prayer_day') ?? '0', 10)
  );
  useEffect(() => {
    if (paused || !setPrayers || !apiKey) return;
    if (gameTime.day <= lastPrayerDay.current) return;
    if ((gameTime.day - lastPrayerDay.current) < 2) return;
    lastPrayerDay.current = gameTime.day;
    localStorage.setItem('kamisama_last_prayer_day', String(gameTime.day));

    const currentNPCs = npcsRef.current;
    const currentPrayers = prayersRef.current ?? [];
    const activeCount = currentPrayers.filter((p) => !p.fulfilled).length;
    if (activeCount >= 3) return;

    generatePrayers(currentNPCs, currentPrayers, apiKey).then((result) => {
      if (!result?.prayers?.length) return;
      // 1件だけ
      const p = result.prayers[0];
      const npc = currentNPCs.find((n) => n.name === p.npc_name);
      const newPrayer: Prayer = {
        id: `prayer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        npcId: npc?.id ?? '',
        npcName: p.npc_name,
        npcEmoji: npc?.emoji ?? '',
        message: p.message,
        keywords: p.keywords,
        day: gameTime.day,
        fulfilled: false,
      };
      setPrayers((prev) => [...prev, newPrayer]);
      addLog({
        id: `${Date.now()}-prayer-${newPrayer.npcId}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: timestamp(),
        npcName: newPrayer.npcName,
        npcEmoji: newPrayer.npcEmoji,
        npcColor: '#c41e3a',
        think: `祈り:「${newPrayer.message}」`,
        isEvent: true,
        source: 'program',
      });
    });
  }, [gameTime.day, paused]);

  // ゲーム内1年（12日）ごとに加齢
  const lastAgeDay = useRef(
    parseInt(localStorage.getItem('kamisama_last_age_day') ?? '0', 10)
  );
  useEffect(() => {
    if (paused) return;
    if (gameTime.day - lastAgeDay.current < 12) return;
    lastAgeDay.current = gameTime.day;
    localStorage.setItem('kamisama_last_age_day', String(gameTime.day));

    const deadNPCs: NPC[] = [];
    const births: NPC[] = [];

    // 加齢 + 死亡判定
    setNPCs((prev) => {
      const aged = prev.map((npc) => {
        const newAge = (npc.age ?? 20) + 1;
        return { ...npc, age: newAge };
      });

      // 死亡判定
      const alive = aged.filter((npc) => {
        if (isDead(npc)) {
          deadNPCs.push(npc);
          return false;
        }
        return true;
      });

      // 死亡ログ
      for (const dead of deadNPCs) {
        addLog({
          id: `${Date.now()}-death-${dead.id}`,
          timestamp: timestamp(),
          npcName: dead.name,
          npcEmoji: dead.emoji,
          npcColor: dead.color,
          think: `${dead.name}が天に召された（享年${dead.age}歳）`,
          isEvent: true,
          source: 'program',
        });
        setVillageHistory((prev) => addToHistory(prev, gameTime.day, `${dead.name}が亡くなった（享年${dead.age}歳）`));

        // 全NPCの記憶に追加
        for (const n of alive) {
          n.memory = [...n.memory, `${dead.name}が亡くなった`].slice(-6);
        }
      }

      // 結婚判定（恋人同士が好感度30以上で夫婦にランクアップ）
      const marriageResult = checkMarriage(alive);
      if (marriageResult.marriages.length > 0) {
        for (let k = 0; k < alive.length; k++) {
          const mu = marriageResult.updated.find((u) => u.id === alive[k].id);
          if (mu) alive[k] = { ...alive[k], relationships: mu.relationships };
        }
        for (const m of marriageResult.marriages) {
          addLog({
            id: `${Date.now()}-marriage-${m.a}-${m.b}`,
            timestamp: timestamp(),
            npcName: m.a,
            npcEmoji: '\uD83D\uDC92',
            npcColor: '#c41e3a',
            think: `${m.a}と${m.b}が伴侶となった！`,
            isEvent: true,
            source: 'program',
          });
          setVillageHistory((prev) => addToHistory(prev, gameTime.day, `${m.a}と${m.b}が伴侶となった`));
        }
      }

      // 出生判定（双方が夫婦ラベルのペア）
      const existingNames = alive.map((n) => n.name);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          if (canHaveChild(alive[i], alive[j], alive) && Math.random() < 0.25) {
            const child = createChild(alive[i], alive[j], existingNames);
            births.push(child);
            existingNames.push(child.name);

            addLog({
              id: `${Date.now()}-birth-${child.id}`,
              timestamp: timestamp(),
              npcName: child.name,
              npcEmoji: child.emoji,
              npcColor: child.color,
              think: `${alive[i].name}と${alive[j].name}の子、${child.name}が生まれた！`,
              isEvent: true,
              source: 'program',
            });
            setVillageHistory((prev) => addToHistory(prev, gameTime.day,
              `${alive[i].name}と${alive[j].name}の子、${child.name}が誕生`));
          }
        }
      }

      return [...alive, ...births];
    });
  }, [gameTime.day, paused]);

  // 引っ越し判定（12日=1年ごと、加齢と同タイミング）
  const lastDepartureCheck = useRef(
    parseInt(localStorage.getItem('kamisama_last_departure_day') ?? '0', 10)
  );
  useEffect(() => {
    if (paused || !onDepartureCandidate) return;
    if (gameTime.day - lastDepartureCheck.current < 12) return;
    lastDepartureCheck.current = gameTime.day;
    localStorage.setItem('kamisama_last_departure_day', String(gameTime.day));

    const currentNPCs = npcsRef.current;
    if (currentNPCs.length <= 3) return; // 3人以下なら引っ越ししない

    for (const npc of currentNPCs) {
      // 子どもは引っ越ししない
      if ((npc.age ?? 20) < 15) continue;
      // 初期メンバーは引っ越ししない
      if (['takeshi', 'ayame', 'genji', 'rin', 'sora'].includes(npc.id)) continue;

      // 孤立度: 関係者が少ない or 好感度が全体的に低い
      const rels = Object.values(npc.relationships);
      const friendCount = rels.filter((r) => r.score >= 20).length;
      const avgScore = rels.length > 0 ? rels.reduce((s, r) => s + r.score, 0) / rels.length : 0;
      const sociability = npc.params.sociability;

      // 引っ越し確率を計算
      let chance = 0;
      if (friendCount === 0) chance += 0.15;        // 友達ゼロ
      if (avgScore < -10) chance += 0.10;            // 平均好感度がマイナス
      if (sociability < 10) chance += 0.05;          // 社交性が極端に低い
      if (rels.length === 0) chance += 0.10;         // 誰とも関係がない

      // 社交性が高いと引っ越ししにくい
      if (sociability > 25) chance *= 0.5;

      if (chance > 0 && Math.random() < chance) {
        // 理由を決定
        let reason = 'この村に居場所がない気がする…';
        if (friendCount === 0 && rels.length > 0) reason = '誰とも打ち解けられなかった…';
        else if (avgScore < -10) reason = '村の皆に嫌われている気がする…';
        else if (rels.length === 0) reason = 'まだ誰のことも知らない…新しい場所を探したい';

        onDepartureCandidate(npc, reason);
        break; // 1サイクル1人まで
      }
    }
  }, [gameTime.day, paused]);
}
