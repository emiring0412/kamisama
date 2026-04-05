import type { NPC, PastEra, Prayer } from '../types';
import { callBackendAI, callGroqAPI, parseAIResponse } from './groqApi';

// ===== 日次バッチ評価（裏方1回で全NPC処理） =====

interface BatchEvalResult {
  param_changes: Record<string, Record<string, number>>;
  job_changes: Record<string, { to: string; reason: string }>;
  needs_personality_update: string[]; // accum>=10のNPC名リスト
}

export async function batchDailyEval(
  npcs: NPC[],
  apiKey: string,
): Promise<BatchEvalResult | null> {
  const npcSummaries = npcs.map((npc) => {
    const mem = npc.memory.slice(-3).join('; ');
    const lt = npc.longTermMemory.slice(-3).join('; ');
    return `${npc.name}(${npc.role},${npc.gender === 'female' ? 'F' : 'M'}): L${npc.params.logic} C${npc.params.creativity} M${npc.params.morality} E${npc.params.empathy} A${npc.params.ambition} S${npc.params.sociability} accum:${npc.paramChangeAccum ?? 0} | ${mem} | ${lt}`;
  }).join('\n');

  const prompt = `Backend eval. JSON only. No text.

NPCs (params total=100, L=logic C=creativity M=morality E=empathy A=ambition S=sociability):
${npcSummaries}

1. param_changes: ±1~3 per NPC based on memories. Keep total=100. {} if none.
2. job_changes: RARELY change jobs. Only if behavior STRONGLY and CONSISTENTLY contradicts role over many days. Most NPCs should keep their role. null if no change needed (default to null).
3. needs_personality_update: List NPC names where accum>=10.

{"param_changes":{"Name":{"S":2,"A":-2}},"job_changes":{"Name":{"to":"role","reason":"why"}},"needs_personality_update":["Name"]}`;

  const raw = await callBackendAI(apiKey, prompt, 1024);
  return parseAIResponse<BatchEvalResult>(raw);
}

// 表舞台で性格文を日本語で再生成（1NPC1回、でもaccum>=10のNPCのみ）
export async function regeneratePersonalityFront(
  npc: NPC,
  model: string,
  apiKey: string,
): Promise<string | null> {
  const prompt = `/no_think
このNPCの性格文を50字以内の日本語で生成せよ。JSONのみ返せ。
名前: ${npc.name} / 職業: ${npc.role} / ${npc.gender === 'female' ? '女' : '男'}
論理:${npc.params.logic} 創造:${npc.params.creativity} 道徳:${npc.params.morality} 共感:${npc.params.empathy} 野心:${npc.params.ambition} 社交:${npc.params.sociability}
過去の性格: 「${npc.personality}」
{"personality":"新しい性格文"}`;

  const raw = await callGroqAPI(apiKey, prompt, model, 256);
  const data = parseAIResponse<{ personality: string }>(raw);
  return data?.personality ?? null;
}

// ===== 祈り生成（住民→神への願い） =====

interface PrayerGenResult {
  prayers: Array<{
    npc_name: string;
    message: string;
    keywords: string[];
  }>;
}

export async function generatePrayers(
  npcs: NPC[],
  existingPrayers: Prayer[],
  apiKey: string,
): Promise<PrayerGenResult | null> {
  // 未成就の祈りが3件以上あれば生成しない
  const activePrayers = existingPrayers.filter((p) => !p.fulfilled);
  if (activePrayers.length >= 3) return null;

  const npcList = npcs.map((n) =>
    `${n.name}(${n.role}) 気分:${n.mood} 信念:${n.beliefs.slice(-2).join('/')}`
  ).join('\n');

  const existing = activePrayers.length > 0
    ? `\n現在の祈り: ${activePrayers.map((p) => `${p.npcName}「${p.message}」`).join('、')}\n※これらと重複しない祈りを生成せよ`
    : '';

  const prompt = `/no_think
村シムの祈り生成。JSONのみ返せ。
住民が神に願い事をする。生活に根差した素朴な願い。

【住民】
${npcList}
${existing}

必ず1件だけ生成せよ（2件以上禁止）。祈りに検索用keywordsを付けよ。
keywordsは場所名（畑,市場,教会,鉱山,森,水源,広場）や具体的な物の名前を含めよ。
祈りは15字以内の短文（例:「畑が豊作になれ」「森に実がなれ」）。

{"prayers":[{"npc_name":"名前","message":"短い祈り","keywords":["場所"]}]}`;

  const raw = await callBackendAI(apiKey, prompt, 256);
  return parseAIResponse<PrayerGenResult>(raw);
}

// ===== 祈り成就判定 =====

export async function checkPrayerFulfillment(
  prayer: Prayer,
  eventDescription: string,
  apiKey: string,
): Promise<boolean> {
  const prompt = `/no_think
JSONのみ返せ。
住民の祈り:「${prayer.message}」
起きた出来事:「${eventDescription}」

この出来事は祈りに少しでも関連するか？厳密に一致しなくてよい。
場所が同じ、テーマが近い、間接的に願いに近づいた、など緩く判定せよ。
迷ったらtrueにせよ。素朴な祈りは叶いやすいものだ。
{"fulfilled":true}か{"fulfilled":false}`;

  const raw = await callBackendAI(apiKey, prompt, 64);
  const data = parseAIResponse<{ fulfilled: boolean }>(raw);
  return data?.fulfilled ?? false;
}

// ===== 歴史圧縮の2段階方式 =====

interface EraSkeletonResult {
  era_name_en: string;    // "Foundation Era"
  period: string;         // "Day1-15"
  key_events: string[];   // ["stone axe invented", "farming expanded"]
}

// Step 1: 裏方が英語で時代の骨格を分析
export async function analyzeEraSkeleton(
  recentHistory: string[],
  apiKey: string,
  currentDay?: number,
): Promise<EraSkeletonResult | null> {
  const events = recentHistory.map((e) => `- ${e}`).join('\n');

  // イベントからDay番号を抽出して実際の範囲を特定
  const dayNumbers = recentHistory.map((e) => {
    const m = e.match(/Day(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }).filter((d): d is number => d !== null);
  const minDay = dayNumbers.length > 0 ? Math.min(...dayNumbers) : 1;
  const maxDay = currentDay ?? (dayNumbers.length > 0 ? Math.max(...dayNumbers) : minDay);

  const prompt = `Analyze these village events and create an era summary skeleton. JSON only.

Events:
${events}

The period MUST be exactly "Day${minDay}-${maxDay}". Do NOT round or extend the range.
Extract: era name (English), period range, and 3-5 key events (English keywords).
{"era_name_en":"Foundation Era","period":"Day${minDay}-${maxDay}","key_events":["stone axe invented","farming expanded","water shortage"]}`;

  const raw = await callBackendAI(apiKey, prompt, 512);
  return parseAIResponse<EraSkeletonResult>(raw);
}

// Step 2: 表舞台が日本語で清書
export async function polishEraJapanese(
  skeleton: EraSkeletonResult,
  recentHistory: string[],
  model: string,
  apiKey: string,
): Promise<PastEra | null> {
  const events = recentHistory.slice(0, 5).join('\n');

  const prompt = `/no_think
村シムの歴史圧縮。JSONのみ返せ。
以下の骨格を元に、日本語で時代名と2〜3行の要約を生成せよ。

時代の骨格:
- 英語名: ${skeleton.era_name_en}
- 期間: ${skeleton.period}
- 重要な出来事: ${skeleton.key_events.join(', ')}

参考（実際の出来事）:
${events}

{"era_name":"日本語の時代名","period":"${skeleton.period}","summary":"2〜3行の日本語要約"}`;

  const raw = await callGroqAPI(apiKey, prompt, model, 512);
  const data = parseAIResponse<{ era_name: string; period: string; summary: string }>(raw);
  if (!data) return null;

  return {
    eraName: data.era_name,
    period: data.period,
    summary: data.summary,
  };
}
