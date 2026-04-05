import type { NPC } from '../types';
import { callBackendAI, parseAIResponse } from './groqApi';

// パラメータ変動レスポンス
interface ParamChangeResponse {
  param_changes: Record<string, number>; // {"sociability": 2, "ambition": -2}
}

// 職業変化レスポンス
interface JobChangeResponse {
  job_change: {
    from: string;
    to: string;
    reason: string;
  } | null;
}

// 性格文再生成レスポンス
interface PersonalityResponse {
  personality: string;
}

// ゲーム内1日ごとにパラメータ変動を判定
export async function evaluateParamChanges(
  npc: NPC,
  apiKey: string,
): Promise<Record<string, number> | null> {
  const recentMemory = npc.memory.concat(npc.longTermMemory.slice(-5)).join('\n- ');

  const prompt = [
    '/no_think',
    'JSONのみ返せ。思考不要。',
    `住民: ${npc.name}(${npc.role}/${npc.gender === 'female' ? '女' : '男'})`,
    `現在パラメータ: 論理${npc.params.logic} 創造${npc.params.creativity} 道徳${npc.params.morality} 共感${npc.params.empathy} 野心${npc.params.ambition} 社交${npc.params.sociability} (合計100)`,
    `最近の経験:`,
    `- ${recentMemory}`,
    '',
    'この住民の今日の経験に基づき、パラメータの変動を判定せよ。',
    '変動がなければ空のparam_changesを返せ。変動は±1〜3の小さな値にすること。',
    'トータル100を維持すること（上がった分だけ別のパラメータが下がる）。',
    '{"param_changes":{"パラメータ名":数値}}',
  ].join('\n');

  const raw = await callBackendAI(apiKey, prompt, 512);
  const data = parseAIResponse<ParamChangeResponse>(raw);
  if (!data || !data.param_changes || Object.keys(data.param_changes).length === 0) return null;
  return data.param_changes;
}

// パラメータ変動を適用（トータル100を維持）
export function applyParamChanges(npc: NPC, changes: Record<string, number>): NPC {
  const paramKeys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
  const newParams = { ...npc.params };

  for (const [key, delta] of Object.entries(changes)) {
    if (key in newParams) {
      (newParams as Record<string, number>)[key] = Math.max(0, Math.min(100, (newParams as Record<string, number>)[key] + delta));
    }
  }

  // トータル100に正規化
  const total = paramKeys.reduce((sum, k) => sum + newParams[k], 0);
  if (total !== 100 && total > 0) {
    const ratio = 100 / total;
    for (const k of paramKeys) {
      newParams[k] = Math.round(newParams[k] * ratio);
    }
    // 丸め誤差の補正
    const newTotal = paramKeys.reduce((sum, k) => sum + newParams[k], 0);
    if (newTotal !== 100) {
      newParams.logic += (100 - newTotal);
    }
  }

  return { ...npc, params: newParams };
}

// ゲーム内7日ごとに職業変化を判定
export async function evaluateJobChange(
  npc: NPC,
  apiKey: string,
): Promise<{ from: string; to: string; reason: string } | null> {
  const recentMemory = npc.longTermMemory.slice(-10).join('\n- ');

  const prompt = [
    '/no_think',
    'JSONのみ返せ。思考不要。',
    `住民: ${npc.name}(現職業:${npc.role})`,
    `性格: ${npc.personality}`,
    `最近の行動記録:`,
    `- ${recentMemory}`,
    '',
    'この住民の直近の行動を見て、職業の変化が自然かどうか判定せよ。',
    '変化なしならnullを返せ。',
    '{"job_change":{"from":"現職業","to":"新職業","reason":"理由20字以内"}}',
  ].join('\n');

  const raw = await callBackendAI(apiKey, prompt, 512);
  const data = parseAIResponse<JobChangeResponse>(raw);
  if (!data || !data.job_change) return null;
  return data.job_change;
}

// 性格文の再生成（パラメータが大きく変わった場合）
export async function regeneratePersonality(
  npc: NPC,
  apiKey: string,
): Promise<string | null> {
  const prompt = [
    '/no_think',
    'JSONのみ返せ。思考不要。',
    `以下のパラメータを持つNPCの性格文を生成せよ（50字以内）。`,
    `名前: ${npc.name} / 職業: ${npc.role} / 性別: ${npc.gender === 'female' ? '女' : '男'}`,
    `論理:${npc.params.logic} 創造:${npc.params.creativity} 道徳:${npc.params.morality} 共感:${npc.params.empathy} 野心:${npc.params.ambition} 社交:${npc.params.sociability}`,
    `過去の性格: 「${npc.personality}」`,
    '{"personality":"新しい性格文50字以内"}',
  ].join('\n');

  const raw = await callBackendAI(apiKey, prompt, 256);
  const data = parseAIResponse<PersonalityResponse>(raw);
  if (!data || !data.personality) return null;
  return data.personality;
}
