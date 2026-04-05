// Cerebras API — Qwen3-235B（無料・100万トークン/日）
const CB_ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const CB_MODEL = 'qwen-3-235b-a22b-instruct-2507';
const CB_TAG = 'Qwen235B';

let lastCbRequest = 0;
let cbBlockedUntil = 0;
const CB_MIN_GAP = 5000; // 30RPMなので2秒で足りるが余裕持って5秒

export async function callGeminiAPI(
  apiKey: string,
  prompt: string,
): Promise<{ text: string | null; tag: string }> {
  const now = Date.now();
  if (now < cbBlockedUntil) return { text: null, tag: '' };
  if (now - lastCbRequest < CB_MIN_GAP) return { text: null, tag: '' };
  lastCbRequest = now;

  try {
    const response = await fetch(CB_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CB_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[Cerebras] ${response.status}: ${errText.slice(0, 200)}`);
      // 429なら1分、それ以外は5分ブロック
      cbBlockedUntil = Date.now() + (response.status === 429 ? 60000 : 300000);
      return { text: null, tag: CB_TAG };
    }

    const data = await response.json();
    let text = data?.choices?.[0]?.message?.content ?? null;

    // <think>タグ除去（Qwen3系対応）
    if (text) {
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    return { text, tag: CB_TAG };
  } catch (e) {
    console.warn('[Cerebras] ネットワークエラー:', e);
    return { text: null, tag: '' };
  }
}

export function isGeminiAvailable(): boolean {
  return Date.now() >= cbBlockedUntil;
}
