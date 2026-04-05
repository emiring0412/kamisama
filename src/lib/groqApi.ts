const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DAILY_LIMIT = 1000; // RPD上限

// 表舞台AI（会話・独白・ささやき）: 日本語品質重視
const FRONT_MODEL_CHAIN = [
  { id: 'qwen/qwen3-32b',      label: 'Qwen3',  rpd: 1000  },
  { id: 'llama-3.3-70b-versatile', label: 'Llama70B', rpd: 1000 },
  { id: 'llama-3.1-8b-instant', label: 'Llama',  rpd: 14400 },
];

// 裏方AI（パラメータ・歴史圧縮・職業判定等）: JSON精度重視、RPD温存
const BACKEND_MODEL = 'llama-3.1-8b-instant';

// 後方互換のためMODEL_CHAINはFRONT_MODEL_CHAINを参照
const MODEL_CHAIN = FRONT_MODEL_CHAIN;

// 各モデルの429回数と解禁時刻
const modelState: Record<string, { blockedUntil: number; hitCount: number }> = {};
for (const m of MODEL_CHAIN) {
  modelState[m.id] = { blockedUntil: 0, hitCount: 0 };
}

// 現在使えるモデルを選ぶ（チェーン上位から順に試す）
export function getCurrentModel(_requestedModel?: string): string {
  const now = Date.now();
  for (const m of MODEL_CHAIN) {
    if (now >= modelState[m.id].blockedUntil) return m.id;
  }
  // 全部ブロック中なら最終フォールバック（一番解禁が早いもの）
  return MODEL_CHAIN[MODEL_CHAIN.length - 1].id;
}

// フォールバック中か（メインモデル以外を使用中）
export function isFallbackActive(): boolean {
  return getCurrentModel('') !== MODEL_CHAIN[0].id;
}

// 現在のモデルラベル
export function getCurrentModelLabel(): string {
  const current = getCurrentModel('');
  const m = MODEL_CHAIN.find((mc) => mc.id === current);
  return m?.label ?? 'AI';
}

// 特定モデルを一定時間ブロック
function blockModel(modelId: string, durationMs: number) {
  if (modelState[modelId]) {
    modelState[modelId].blockedUntil = Date.now() + durationMs;
    modelState[modelId].hitCount++;
  }
}

// レート制限管理
let requestTimestamps: number[] = [];    // 直近1分
let hourlyTimestamps: number[] = [];     // 直近1時間
let rateLimitedUntil = 0;

// トータルカウント（セッション + 永続）
let sessionTotal = 0;
let dailyTotal = (() => {
  const saved = localStorage.getItem('kamisama_api_daily');
  if (saved) {
    const data = JSON.parse(saved);
    if (data.date === new Date().toDateString()) return data.count as number;
  }
  return 0;
})();

// Groqヘッダーから取得した残量（より正確）
let serverRemaining: number | null = null;

function saveDailyCount() {
  localStorage.setItem('kamisama_api_daily', JSON.stringify({ date: new Date().toDateString(), count: dailyTotal }));
}

export function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function getRateLimitRemaining(): number {
  return Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
}

let lastRequestTime = 0;
const MIN_REQUEST_GAP = 5000; // 最低5秒間隔

function trackRequest() {
  const now = Date.now();
  lastRequestTime = now;
  requestTimestamps.push(now);
  requestTimestamps = requestTimestamps.filter((t) => now - t < 60000);
  hourlyTimestamps.push(now);
  hourlyTimestamps = hourlyTimestamps.filter((t) => now - t < 3600000);
  sessionTotal++;
  dailyTotal++;
  saveDailyCount();
}

export function getRequestsInLastMinute(): number {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t < 60000);
  return requestTimestamps.length;
}

export function shouldThrottle(): boolean {
  return getRequestsInLastMinute() >= 15;
}

export function getSessionTotal(): number { return sessionTotal; }
export function getDailyTotal(): number { return dailyTotal; }
export function getRequestsInLastHour(): number {
  const now = Date.now();
  hourlyTimestamps = hourlyTimestamps.filter((t) => now - t < 3600000);
  return hourlyTimestamps.length;
}

// --- API残量管理 ---

export function getDailyRemaining(): number {
  if (serverRemaining !== null) return serverRemaining;
  return Math.max(0, DAILY_LIMIT - dailyTotal);
}

export function getDailyLimit(): number { return DAILY_LIMIT; }

export function getRemainingPercent(): number {
  return Math.round((getDailyRemaining() / DAILY_LIMIT) * 100);
}

// 残り時間の推定（直近10分の消費ペースから）
export function getEstimatedHoursLeft(): number {
  const now = Date.now();
  const recent = hourlyTimestamps.filter((t) => now - t < 600000); // 直近10分
  if (recent.length < 2) return 99; // データ不足
  const ratePerHour = (recent.length / 10) * 60; // 10分→1時間あたりに換算
  if (ratePerHour === 0) return 99;
  return Math.round(getDailyRemaining() / ratePerHour * 10) / 10;
}

// フォールバック: 節約モードの倍率を返す
export function getSavingMultiplier(): number {
  const pct = getRemainingPercent();
  if (pct <= 5) return 2.0;   // 残量5%以下: 間隔2倍
  if (pct <= 20) return 1.5;  // 残量20%以下: 間隔1.5倍
  return 1.0;
}

// AI呼び出し完全停止かどうか
export function isDailyLimitReached(): boolean {
  return getDailyRemaining() <= 0;
}

// プログレスバーの色
export function getUsageColor(): string {
  const pct = getRemainingPercent();
  if (pct > 80) return '#4CAF50';  // 緑
  if (pct > 50) return '#e8d44d';  // 黄
  if (pct > 20) return '#FF9800';  // オレンジ
  return '#ff6b6b';                // 赤
}

// ===== Gemini統合: 表舞台の統合呼び出し =====
import { callGeminiAPI, isGeminiAvailable } from './geminiApi';

// 表舞台AI統合呼び出し: Cerebras(Qwen3-235B) → Groq(Qwen3→L70B→L8B)
export async function callFrontAI(
  groqApiKey: string,
  geminiApiKey: string | null,
  prompt: string,
  maxTokens: number = 1024,
): Promise<{ text: string | null; source: 'gemini' | 'groq'; modelTag: string }> {
  // xAIキーがあって利用可能なら最優先
  if (geminiApiKey && isGeminiAvailable()) {
    const { text, tag } = await callGeminiAPI(geminiApiKey, prompt);
    if (text) {
      return { text, source: 'gemini', modelTag: tag };
    }
    console.warn(`[Front] Cerebras(${tag})失敗 → Groqにフォールバック`);
  }

  // Groqフォールバック
  const actualModel = getCurrentModel();
  const tag = actualModel.includes('qwen') ? 'Qwen'
    : actualModel.includes('70b') ? 'L70B'
    : actualModel.includes('8b') ? 'Ll8B'
    : 'Groq';
  const result = await callGroqAPI(groqApiKey, prompt, MODEL_CHAIN[0].id, maxTokens);
  return { text: result, source: 'groq', modelTag: tag };
}

export function isGeminiActive(geminiKey: string | null): boolean {
  return !!(geminiKey && isGeminiAvailable());
}

export async function callGroqAPI(
  apiKey: string,
  prompt: string,
  model: string = MODEL_CHAIN[0].id,
  maxTokens: number = 1024,
): Promise<string | null> {
  if (isRateLimited()) return null;
  if (shouldThrottle()) return null;
  if (isDailyLimitReached()) return null;
  if (Date.now() - lastRequestTime < MIN_REQUEST_GAP) return null;

  // モデル自動切替
  const actualModel = getCurrentModel(model);
  if (actualModel !== model) {
    console.log(`[Groq] フォールバック中: ${model} → ${actualModel}`);
  }

  trackRequest();

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: actualModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.9,
      }),
    });

    // Groqのレスポンスヘッダーから残量を取得（Safariでエラーになる場合あり）
    try {
      const remaining = response.headers.get('x-ratelimit-remaining-requests');
      if (remaining !== null) {
        serverRemaining = parseInt(remaining, 10);
      }
    } catch { /* Safari CORS制限でヘッダー読めない場合は無視 */ }

    if (response.status === 429) {
      // このモデルを10分間ブロック → 次のモデルにフォールバック
      blockModel(actualModel, 600000);
      const nextModel = getCurrentModel('');
      // グローバルレート制限も30秒だけ（モデル切替のため）
      rateLimitedUntil = Date.now() + 30000;
      console.warn(`[Groq] 429 on ${actualModel} — 10分ブロック → 次: ${nextModel}`);
      return null;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[Groq] API error ${response.status} on ${actualModel}: ${errText.slice(0, 200)}`);
      // 404(モデル不存在)や他のエラーでもそのモデルを長時間ブロック
      if (response.status === 404 || response.status === 400) {
        blockModel(actualModel, 3600000); // 1時間ブロック
        console.warn(`[Groq] ${actualModel}を1時間ブロック（${response.status}）`);
      }
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('[Groq] ネットワークエラー:', e);
    console.warn('[Groq] ネットワークエラー:', e);
    return null;
  }
}

// 裏方AI呼び出し（Llama 8B直接、フォールバックチェーンを通さない）
let lastBackendRequest = 0;

export async function callBackendAI(
  apiKey: string,
  prompt: string,
  maxTokens: number = 512,
): Promise<string | null> {
  // 表舞台と合わせて全体RPMを守るため10秒間隔
  const now = Date.now();
  if (now - lastBackendRequest < 10000) return null;
  if (now - lastRequestTime < 3000) return null; // 表舞台との間も3秒空ける
  lastBackendRequest = now;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: BACKEND_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7, // 裏方は安定重視で低め
      }),
    });

    if (response.status === 429) {
      console.warn('[Backend] 429 — スキップ');
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export function getBackendModel(): string { return BACKEND_MODEL; }

// JSONレスポンスのパース（<think>タグ・```json```フェンス除去対応）
export function parseAIResponse<T>(raw: string | null): T | null {
  if (!raw) return null;

  let cleaned = raw.trim();

  // qwen3系の <think>...</think> タグを除去
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // ```json ... ``` のフェンスを除去
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  // JSONっぽい部分を抽出
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 不完全なJSONを修復
    let repaired = cleaned;
    const opens = (repaired.match(/\{/g) || []).length;
    const closes = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
    for (let i = 0; i < opens - closes; i++) repaired += '}';

    try {
      return JSON.parse(repaired) as T;
    } catch {
      // 最終手段: conversation配列だけでも抽出
      const convMatch = cleaned.match(/"conversation"\s*:\s*(\[[\s\S]*?\])/);
      if (convMatch) {
        const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)"/);
        const aMoodMatch = cleaned.match(/"a_mood"\s*:\s*"([^"]*)"/);
        const bMoodMatch = cleaned.match(/"b_mood"\s*:\s*"([^"]*)"/);
        try {
          const partial = JSON.stringify({
            conversation: JSON.parse(convMatch[1]),
            summary: summaryMatch?.[1] ?? '会話',
            a_mood: aMoodMatch?.[1] ?? '',
            b_mood: bMoodMatch?.[1] ?? '',
            rel_change: { a_to_b: { label: '', score_delta: 0 }, b_to_a: { label: '', score_delta: 0 } },
          });
          console.warn('[Parse] 部分修復で会話を救出');
          return JSON.parse(partial) as T;
        } catch { /* fall through */ }
      }
      console.warn('[Parse] JSONパース失敗（修復不可）:', cleaned.slice(0, 200));
      return null;
    }
  }
}
