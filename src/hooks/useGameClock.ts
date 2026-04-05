import { useState, useEffect, useRef } from 'react';
import type { Season } from '../types';

// 時間帯の定義
export type TimePeriod = 'earlyMorning' | 'morning' | 'daytime' | 'evening' | 'night' | 'midnight';

// 季節: 3日で1シーズン、12日で1年
const DAYS_PER_SEASON = 3;

function getSeason(day: number): Season {
  const seasonIndex = Math.floor(((day - 1) % 12) / DAYS_PER_SEASON);
  return (['spring', 'summer', 'autumn', 'winter'] as Season[])[seasonIndex];
}

export function getSeasonLabel(season: Season): string {
  switch (season) {
    case 'spring': return '春';
    case 'summer': return '夏';
    case 'autumn': return '秋';
    case 'winter': return '冬';
  }
}

export function getSeasonEmoji(season: Season): string {
  switch (season) {
    case 'spring': return '\uD83C\uDF38';
    case 'summer': return '\u2600\uFE0F';
    case 'autumn': return '\uD83C\uDF41';
    case 'winter': return '\u2744\uFE0F';
  }
}

export interface GameTime {
  day: number;         // Day 1, 2, 3...
  hour: number;        // 0-23
  minute: number;      // 0-59
  period: TimePeriod;
  season: Season;
  displayTime: string; // "14:32"
  displayFull: string; // "Day 3 / 14:32"
}

// 現実1分 = ゲーム内1時間（x1速度）
const REAL_MS_PER_GAME_MINUTE = 1000; // 1秒 = ゲーム1分（60秒で1時間）

function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour < 7) return 'earlyMorning';
  if (hour >= 7 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 17) return 'daytime';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 23) return 'night';
  return 'midnight';
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 時間帯×季節の背景グラデーション
export function getBackgroundForPeriod(period: TimePeriod, season: Season = 'spring'): string {
  // 季節による色味の調整
  const seasonTint: Record<Season, { r: number; g: number; b: number }> = {
    spring: { r: 0, g: 5, b: 0 },    // 緑がかる
    summer: { r: 5, g: 3, b: -3 },    // 暖色系
    autumn: { r: 8, g: 2, b: -5 },    // オレンジがかる
    winter: { r: -3, g: -3, b: 5 },   // 青みがかる
  };
  const t = seasonTint[season];

  switch (period) {
    case 'earlyMorning': return `linear-gradient(145deg, rgb(${200+t.r},${190+t.g},${210+t.b}), rgb(${220+t.r},${210+t.g},${230+t.b}))`;
    case 'morning':      return `linear-gradient(145deg, rgb(${210+t.r},${225+t.g},${200+t.b}), rgb(${225+t.r},${235+t.g},${215+t.b}))`;
    case 'daytime':      return `linear-gradient(145deg, rgb(${200+t.r},${220+t.g},${195+t.b}), rgb(${210+t.r},${230+t.g},${205+t.b}))`;
    case 'evening':      return `linear-gradient(145deg, rgb(${230+t.r},${210+t.g},${190+t.b}), rgb(${240+t.r},${215+t.g},${195+t.b}))`;
    case 'night':        return `linear-gradient(145deg, rgb(${140+t.r},${145+t.g},${170+t.b}), rgb(${120+t.r},${125+t.g},${155+t.b}))`;
    case 'midnight':     return `linear-gradient(145deg, rgb(${90+Math.max(0,t.r)},${90+Math.max(0,t.g)},${110+Math.max(0,t.b)}), rgb(${70+Math.max(0,t.r)},${70+Math.max(0,t.g)},${95+Math.max(0,t.b)}))`;
  }
}

// 時間帯の日本語名
export function getPeriodLabel(period: TimePeriod): string {
  switch (period) {
    case 'earlyMorning': return '早朝';
    case 'morning':      return '朝';
    case 'daytime':      return '昼';
    case 'evening':      return '夕方';
    case 'night':        return '夜';
    case 'midnight':     return '深夜';
  }
}

export function useGameClock(paused: boolean, speed: number) {
  // ゲーム内時刻（分単位で管理）: Day1 9:00スタート
  // 起動時に閉じてた分の時間を加算（現実1分=ゲーム内1時間）
  const [totalMinutes, setTotalMinutes] = useState(() => {
    const saved = localStorage.getItem('kamisama_game_time');
    const base = saved ? parseInt(saved, 10) : (1 * 24 * 60 + 9 * 60);

    const lastAccess = localStorage.getItem('kamisama_last_access');
    if (lastAccess) {
      const elapsedRealMs = Date.now() - parseInt(lastAccess, 10);
      const elapsedRealMinutes = elapsedRealMs / 60000;
      // 現実1分 = ゲーム内60分（1時間）
      const elapsedGameMinutes = Math.floor(elapsedRealMinutes * 60);
      // 最大24時間分（1440ゲーム内分 = 現実24分相当 → ゲーム内1日）まで
      const capped = Math.min(elapsedGameMinutes, 24 * 60 * 7); // 最大7日分
      if (capped > 5 * 60) { // 5ゲーム内時間以上経過してたら加算
        console.log(`[CLOCK] 不在中のゲーム内時間を加算: ${Math.floor(capped / 60)}時間 (${Math.floor(capped / (24*60))}日)`);
        return base + capped;
      }
    }
    return base;
  });

  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ゲーム時計を進める
  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current) return;
      setTotalMinutes((prev) => {
        const next = prev + speedRef.current; // speed倍速で進む
        return next;
      });
    }, REAL_MS_PER_GAME_MINUTE);

    return () => clearInterval(interval);
  }, []);

  // 定期的にlocalStorageに保存
  useEffect(() => {
    if ((window as unknown as Record<string, boolean>).__kamisama_resetting) return;
    localStorage.setItem('kamisama_game_time', String(totalMinutes));
  }, [totalMinutes]);

  const day = Math.floor(totalMinutes / (24 * 60));
  const minuteOfDay = totalMinutes % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const period = getTimePeriod(hour);
  const season = getSeason(day);

  const gameTime: GameTime = {
    day,
    hour,
    minute,
    period,
    season,
    displayTime: formatTime(hour, minute),
    displayFull: `Day ${day} / ${formatTime(hour, minute)}`,
  };

  // 前のdayを記憶して日付変更を検知
  const prevDayRef = useRef(day);
  const [dayChanged, setDayChanged] = useState(false);

  useEffect(() => {
    if (day !== prevDayRef.current) {
      prevDayRef.current = day;
      setDayChanged(true);
      setTimeout(() => setDayChanged(false), 5000);
    }
  }, [day]);

  return { gameTime, dayChanged };
}
