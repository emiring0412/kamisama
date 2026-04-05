import type { NPC, VillageHistory, PastEra } from '../types';
import { callBackendAI, parseAIResponse } from './groqApi';

// 短期記憶 → 長期記憶への昇格判定
// 関係性が変化した出来事を長期記憶に昇格させる
export function promoteToLongTermMemory(
  npc: NPC,
  event: string,
  day: number,
): NPC {
  const entry = `(Day${day}) ${event}`;
  const ltm = [...npc.longTermMemory, entry].slice(-20);
  return { ...npc, longTermMemory: ltm };
}

// 村の歴史に自動記録すべきか判定
export function shouldAutoRecord(context: {
  isEvent?: boolean;
  hasNewBelief?: boolean;
  hasNewProposal?: boolean;
  relScoreExceeded50?: boolean;
}): boolean {
  return !!(context.isEvent || context.hasNewBelief || context.hasNewProposal || context.relScoreExceeded50);
}

// 村の歴史に記録を追加
export function addToHistory(
  history: VillageHistory,
  day: number,
  summary: string,
): VillageHistory {
  const entry = `Day${day}: ${summary}`;
  const recent = [...history.recentHistory, entry];
  return { ...history, recentHistory: recent };
}

// 時代の圧縮（最近の歴史が15件に達したら実行）
export async function compressEra(
  history: VillageHistory,
  apiKey: string,
): Promise<VillageHistory | null> {
  if (history.recentHistory.length < 15) return null;

  const eventsText = history.recentHistory.map((e) => `- ${e}`).join('\n');

  const prompt = [
    '/no_think',
    '村シムの歴史圧縮。JSONのみ返せ。思考不要。',
    '',
    '以下の出来事群を1つの「時代」として要約せよ。',
    '時代名と、2〜3行の要約を生成すること。',
    '重要な転換点、人間関係の変化、社会の発展を中心にまとめよ。',
    '',
    '【出来事】',
    eventsText,
    '',
    '{"era_name":"時代名（例:黎明期）","period":"DayX-Y","summary":"2〜3行の要約"}',
  ].join('\n');

  const raw = await callBackendAI(apiKey, prompt, 1024);
  const data = parseAIResponse<{ era_name: string; period: string; summary: string }>(raw);

  if (!data) return null;

  const newEra: PastEra = {
    eraName: data.era_name,
    period: data.period,
    summary: data.summary,
  };

  const allEras = [...history.pastEras, newEra];
  // 5件超えた分を1行に圧縮してancientLogへ
  const overflow = allEras.slice(0, Math.max(0, allEras.length - 5));
  const newAncient = overflow.map((era) => `${era.period} ${era.eraName}: ${era.summary.split('。')[0]}`);

  return {
    ancientLog: [...(history.ancientLog ?? []), ...newAncient],
    pastEras: allEras.slice(-5),
    recentHistory: [],
  };
}

// 歴史をプロンプト用テキストに変換
export function buildHistoryPromptText(history: VillageHistory): string {
  const ancient = history.ancientLog ?? [];
  if (history.pastEras.length === 0 && history.recentHistory.length === 0 && ancient.length === 0) return '';

  const parts: string[] = ['【村の歴史】'];

  if (ancient.length > 0) {
    parts.push('〈古代の記録〉');
    for (const line of ancient) {
      parts.push(`- ${line}`);
    }
  }

  if (history.pastEras.length > 0) {
    parts.push('〈過去の時代〉');
    for (const era of history.pastEras) {
      parts.push(`- 【${era.eraName} ${era.period}】${era.summary}`);
    }
  }

  if (history.recentHistory.length > 0) {
    parts.push('〈最近の出来事〉');
    for (const entry of history.recentHistory.slice(-10)) {
      parts.push(`- ${entry}`);
    }
  }

  return parts.join('\n');
}

// 長期記憶をプロンプト用テキストに変換
export function buildLongTermMemoryText(npc: NPC): string {
  if (npc.longTermMemory.length === 0) return '';
  return '〈重要な記憶〉\n' + npc.longTermMemory.map((m) => `- ${m}`).join('\n');
}
