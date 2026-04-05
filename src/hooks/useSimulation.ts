import { useEffect, useRef } from 'react';
import type { NPC } from '../types';
import type { GameTime, TimePeriod } from './useGameClock';
import { FACILITIES, MAP_WIDTH, MAP_HEIGHT, NPC_SPEED, MOVE_INTERVAL } from '../lib/constants';

// NPCが夜型かどうか判定（性格ベース）
// creativity非常に高い or sociability極端に低い → 夜更かし傾向
function isNightOwl(npc: NPC): boolean {
  return npc.params.creativity >= 35 || npc.params.sociability <= 5;
}

// NPCが朝弱いタイプか（昼に寝やすい）
// ambition非常に高い & sociability極端に低い → 夜に策謀、昼に寝る
function isDaySlacker(npc: NPC): boolean {
  return npc.params.ambition >= 35 && npc.params.sociability <= 5;
}

// NPCがこの時間帯に「家に向かう」か判定（到着のたびに呼ばれるので確率は控えめに）
function shouldBeHome(npc: NPC, period: TimePeriod): boolean {
  if (period === 'midnight') {
    // 深夜: 夜型以外は50%で家（毎回判定なので実質的にほぼ家付近にいる）
    return isNightOwl(npc) ? Math.random() < 0.15 : Math.random() < 0.5;
  }
  if (period === 'night') {
    // 夜: 30%で家（たまに出歩く日もある）
    return isNightOwl(npc) ? Math.random() < 0.1 : Math.random() < 0.3;
  }
  if (period === 'earlyMorning') {
    return isDaySlacker(npc) ? Math.random() < 0.3 : false;
  }
  return false;
}

// NPCの次の目的地を決定（時間帯考慮）
function pickNextTarget(npc: NPC, period: TimePeriod): { x: number; y: number } {
  // 家に帰るべきか
  if (shouldBeHome(npc, period)) {
    return { x: npc.homeX + (Math.random() - 0.5) * 10, y: npc.homeY + (Math.random() - 0.5) * 10 };
  }

  if (Math.random() < 0.6) {
    // 施設に向かう
    const f = FACILITIES[Math.floor(Math.random() * FACILITIES.length)];
    return {
      x: f.x + Math.random() * f.width,
      y: f.y + Math.random() * f.height,
    };
  }
  // ランダムな位置
  return {
    x: Math.random() * (MAP_WIDTH - 40) + 20,
    y: Math.random() * (MAP_HEIGHT - 40) + 20,
  };
}

export function useSimulation(
  _npcs: NPC[],
  setNPCs: React.Dispatch<React.SetStateAction<NPC[]>>,
  paused: boolean,
  speed: number,
  gameTime?: GameTime,
  onWhisperArrival?: (npcId: string) => void,
) {
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const gameTimeRef = useRef(gameTime);
  const onWhisperArrivalRef = useRef(onWhisperArrival);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { gameTimeRef.current = gameTime; }, [gameTime]);
  useEffect(() => { onWhisperArrivalRef.current = onWhisperArrival; }, [onWhisperArrival]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current) return;

      const period = gameTimeRef.current?.period ?? 'daytime';

      setNPCs((prev) =>
        prev.map((npc) => {
          const dx = npc.targetX - npc.x;
          const dy = npc.targetY - npc.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const moveSpeed = NPC_SPEED * speedRef.current;

          // 到着判定
          if (dist < moveSpeed + 1) {
            if (npc.whisperMoving) {
              // ささやき移動で到着 → その場に留まる + AI独白を即発火
              console.log(`[SIM] ${npc.name}: ささやき目的地に到着 → 6秒後に発火`);
              const npcId = npc.id;
              setTimeout(() => onWhisperArrivalRef.current?.(npcId), 6000);
              return {
                ...npc,
                x: npc.targetX, y: npc.targetY,
                targetX: npc.targetX, targetY: npc.targetY,
                whisperMoving: false,
              };
            }
            const next = pickNextTarget(npc, period);
            return { ...npc, x: npc.targetX, y: npc.targetY, targetX: next.x, targetY: next.y };
          }

          // 移動
          const ratio = moveSpeed / dist;
          return {
            ...npc,
            x: npc.x + dx * ratio,
            y: npc.y + dy * ratio,
          };
        })
      );
    }, MOVE_INTERVAL);

    return () => clearInterval(interval);
  }, [setNPCs]);

  // 吹き出しタイマー
  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current) return;

      setNPCs((prev) =>
        prev.map((npc) => {
          if (!npc.bubble) return npc;
          const remaining = npc.bubbleTimer - 100;
          if (remaining <= 0) {
            return { ...npc, bubble: null, bubbleType: null, bubbleTimer: 0 };
          }
          return { ...npc, bubbleTimer: remaining };
        })
      );
    }, 100);

    return () => clearInterval(interval);
  }, [setNPCs]);
}
