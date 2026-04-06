import type { NPC, VillageHistory } from '../types';
import { callFrontAI, callBackendAI, parseAIResponse } from './groqApi';

// 経過時間をフォーマット
function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

// ===== Step 1: Groqで骨格生成 =====

export interface OfflineSkeleton {
  history_entries: string[];  // "Day5: タケシとリンが宗教について対立"
  param_changes: Record<string, Record<string, number>>;
  rel_changes: Record<string, { label: string; score_delta: number }>; // "タケシ→リン": {...}
}

export async function generateOfflineSkeleton(
  npcs: NPC[],
  _history: VillageHistory,
  elapsedMinutes: number,
  startDay: number,
  endDay: number,
  apiKey: string,
): Promise<OfflineSkeleton | null> {
  const historyCount = Math.min(8, Math.max(2, Math.floor(elapsedMinutes / 30)));
  const npcShort = npcs.map((n) => n.name + '(' + n.role + ')').join(',');

  const prompt = `/no_think
Return exactly ONE JSON object. No extra text.
Village offline. Day${startDay}-${endDay}(${formatElapsed(elapsedMinutes)}).
NPCs: ${npcShort}
Generate ${historyCount} history_entries. param_changes=DELTA(±1~3, skip unchanged). rel max 3.
{"history_entries":["Day${startDay}: 要約","Day${startDay+1}: 要約"],"param_changes":{"Name":{"S":2}},"rel_changes":{"A→B":{"label":"関係","score_delta":-5}}}`;

  const raw = await callBackendAI(apiKey, prompt, 2048);
  const data = parseAIResponse<OfflineSkeleton>(raw);
  if (!data) return null;

  // Day番号を強制的に正しい範囲にクランプ
  data.history_entries = (data.history_entries ?? []).map((entry) => {
    return entry.replace(/Day(\d+)/, (_, num) => {
      const d = Math.max(startDay, Math.min(endDay, parseInt(num, 10)));
      return `Day${d}`;
    });
  });

  return data;
}

// ===== Step 2: 第一AIで日本語清書 =====

interface PolishedEntry {
  summary: string;  // 歴史用短文 "Day5: リンとタケシが光るキノコについて論争"
  display: string;  // おかえり画面用リッチテキスト（セリフ含む）
}

interface PolishResponse {
  entries: PolishedEntry[];
}

export async function polishOfflineEntries(
  skeleton: OfflineSkeleton,
  npcs: NPC[],
  apiKey: string,
  cerebrasKey: string | null,
): Promise<PolishResponse | null> {
  const npcNames = npcs.map((n) => `${n.name}(${n.role})`).join('、');
  const rawEntries = skeleton.history_entries.join('\n');

  const prompt = `/no_think
村シムの不在中ログ清書。JSONのみ返せ。

【住民】${npcNames}

【骨格（英語混じりの要約）】
${rawEntries}

上記の各エントリを以下の2形式で日本語に清書せよ。
- summary: 歴史記録用の短い1行（「Day○: ○○が○○した」形式）
- display: おかえり画面用の描写文。2〜3文。住民のセリフを「」で1つ含めよ。情景が浮かぶ表現で。

{"entries":[{"summary":"Day5: リンとタケシが光るキノコについて論争","display":"リンは光るキノコを邪魔だと言い放った。タケシは「あれは神の導きだ」と反論し、二人の間に緊張が走った。"}]}`;

  const { text: raw } = await callFrontAI(apiKey, cerebrasKey, prompt, 2048);
  return parseAIResponse<PolishResponse>(raw);
}

// ===== パラメータ・関係性の反映 =====

export function applyOfflineSkeleton(
  npcs: NPC[],
  skeleton: OfflineSkeleton,
): NPC[] {
  let updated = [...npcs];

  // パラメータ変動
  if (skeleton.param_changes) {
    const keyMap: Record<string, string> = { L: 'logic', C: 'creativity', M: 'morality', E: 'empathy', A: 'ambition', S: 'sociability' };
    updated = updated.map((npc) => {
      const changes = skeleton.param_changes[npc.name];
      if (!changes) return npc;
      const paramKeys = ['logic', 'creativity', 'morality', 'empathy', 'ambition', 'sociability'] as const;
      const newParams = { ...npc.params };
      for (const [key, delta] of Object.entries(changes)) {
        const fullKey = keyMap[key] ?? key;
        if (fullKey in newParams) {
          (newParams as Record<string, number>)[fullKey] = Math.max(0, (newParams as Record<string, number>)[fullKey] + delta);
        }
      }
      const total = paramKeys.reduce((s, k) => s + newParams[k], 0);
      if (total > 0 && total !== 100) {
        const ratio = 100 / total;
        for (const k of paramKeys) newParams[k] = Math.round(newParams[k] * ratio);
        const nt = paramKeys.reduce((s, k) => s + newParams[k], 0);
        if (nt !== 100) newParams.logic += (100 - nt);
      }
      return { ...npc, params: newParams };
    });
  }

  // 関係性変動
  if (skeleton.rel_changes) {
    updated = updated.map((npc) => {
      let n = { ...npc, relationships: { ...npc.relationships } };
      for (const [key, change] of Object.entries(skeleton.rel_changes)) {
        const [fromName, toName] = key.split('→');
        if (fromName !== npc.name) continue;
        const target = updated.find((t) => t.name === toName);
        if (!target) continue;
        const existing = n.relationships[target.id] || { label: '', score: 0 };
        n.relationships[target.id] = {
          label: change.label || existing.label,
          score: Math.max(-100, Math.min(100, existing.score + (change.score_delta || 0))),
        };
      }
      return n;
    });
  }

  return updated;
}
