import type { NPC, VillageHistory, CivilizationItem, Whisper } from '../types';
import type { GameTime } from '../hooks/useGameClock';
import { getSeasonLabel } from '../hooks/useGameClock';
import { paramToPersonality } from './paramToPersonality';
import { FACILITIES } from './constants';
import { buildHistoryPromptText, buildLongTermMemoryText } from './historySystem';

// NPCの現在地に最も近い施設を取得
function getNearestFacility(x: number, y: number): string {
  let nearest = FACILITIES[0];
  let minDist = Infinity;

  for (const f of FACILITIES) {
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (d < minDist) {
      minDist = d;
      nearest = f;
    }
  }
  return nearest.name;
}

// レイヤー0: 世界の前提（文明ゼロスタート）
function buildWorldPremise(civilizations: CivilizationItem[]): string {
  const adopted = civilizations.filter((c) => c.status === 'adopted' && c.category !== 'discovery');
  const discoveries = civilizations.filter((c) => c.category === 'discovery');
  const civList = adopted.length > 0
    ? '\n【この村で生まれた概念】\n' + adopted.map((c) => `- ${c.name}: ${c.description}（Day${c.day}〜）`).join('\n')
    : '';
  const discoveryList = discoveries.length > 0
    ? '\n【村の図鑑（発見されたもの）】\n' + discoveries.map((c) => `- ${c.name}${c.locations?.length ? `（${c.locations.join('・')}）` : ''}`).join('\n') +
      '\n※図鑑に既にあるものをcivilization_eventで再報告するな。新しい別のものを見つけた時だけ報告せよ。ただし、図鑑のものを別の場所で見かけた場合のみ同名で報告してよい。'
    : '';

  return `【この世界の前提】
あなたたちは何もない未開の地に降り立ったばかりの住民である。
この世界にはまだ以下のものが存在しない:
- 通貨やお金の概念
- 法律やルール
- 宗教や信仰体系
- 政治や統治の仕組み
- 文字や記録の方法
- 所有権の概念

あなたは現代の知識を持たない。
「お金」「法律」「政府」「宗教」といった言葉を知らない。
ただし、生活の中で必要に迫られたとき、
自分たちで新しい仕組みを考え出すことができる。${civList}${discoveryList}
上記の概念は、この村で既に生まれたものである。これらは使ってよいが、まだ生まれていない概念は使ってはならない。
図鑑にある発見物は、その生息地に行けば見つけられる。`;
}

// レイヤー1: 本能（全NPC共通）
const INSTINCT_PROMPT = `【本能】あなたは以下の欲求を常に持っている:
- 安全でいたい（危険を避けたい）
- 仲間がほしい（孤独は不安）
- 退屈は嫌だ（刺激や変化を求める）
- 自分の価値を認められたい（尊敬・感謝されたい）
- 世界を理解したい（なぜ自分はここにいるのか）`;

// レイヤー4: 創発（AIに許可を与える）
const EMERGENCE_PROMPT = `【創発】あなたは経験や思考から、以下のことを自発的に行える:
- 新しい仕組みを考え出す（物の交換方法、役割分担など）
- 信じるものを見つける（自然への畏敬、目に見えない力など）
- 決まりごとを提案する（争いを防ぐ約束、分配の方法など）
- 他の住民を説得・勧誘する
- 仲間を集める
- 物を交換する条件を考える
- 道具を作る（石の斧、木の棒、縄など手近な素材で）
- 建物を建てる提案をする（小屋、祠、見張り台、集会所など）
- 土地を開拓する（新しい畑を作る、道を切り開く）
- 新しい技術を発見する（火の扱い方、保存方法、灌漑など）
- 不要になった建物を取り壊す提案をする（住人が亡くなった、用途がなくなった等）
- 自然界のものを発見する（動植物、鉱物、薬草、虫、魚など）
これらは強制ではない。あなたの性格と経験から自然にそう思ったときだけ行動せよ。
※civilization_eventで報告。typeは以下から選べ:
- "building": 建物・施設を建てる（小屋、祠、倉庫、見張り台など物理的な建築物）
- "tool": 道具を作る（石斧、縄、槍など）
- "technology": 技術を発見する（火の扱い、保存方法、灌漑など）
- "discovery": 自然界の珍しいものを発見する（見慣れない虫、食べられるか分からない実、光る石、変わった形の貝など）。descriptionに何を見つけたかと発見場所（畑,鉱山,森,水源,広場のいずれか）を含めよ。※毎日使う野菜や石など当たり前のものは発見ではない
- "rule": 決まりごと・制度を提案する（分配ルール、掟など）
- "exchange": 交換・貿易の仕組みを考える
- "belief": 信仰・思想を見つける
- "custom": その他の文化・慣習
- "demolish": 不要な建物を取り壊す（nameに取り壊す建物名）
nameは具体的な名前にすること（例: ×「貿易の仕組み」→ ○「物々交換所」、×「信仰」→ ○「水神信仰」、×「虫」→ ○「テントウムシ」）。`;

// 職業別の発見ヒント（自然の中で活動する職業のみ）
function getDiscoveryHint(role: string): string {
  const hints: Record<string, string> = {
    '農民': '【発見の目】あなたは農民として、畑や野原で珍しいものに気づくことがある。見慣れない虫、雑草の中の薬草、土の中の変わった石など。日常に埋もれた小さな発見を図鑑に報告せよ（civilization_event type:"discovery"）。',
    '探検家': '【発見の目】あなたは探検家として、未知のものを見つけるのが得意だ。森の奥の動物、川辺の珍しい貝、崖の鉱脈、見たことない植物など。新しい発見を図鑑に報告せよ（civilization_event type:"discovery"）。',
    '薬師': '【発見の目】あなたは薬師として、薬効のある植物や毒草に敏感だ。森や水源で薬になりそうな草花、キノコ、樹皮などを見つけたら図鑑に報告せよ（civilization_event type:"discovery"）。',
    '漁師': '【発見の目】あなたは漁師として、水辺の生き物に詳しい。見慣れない魚、水草、貝、カニなど水辺の発見を図鑑に報告せよ（civilization_event type:"discovery"）。',
    '猟師': '【発見の目】あなたは猟師として、動物の気配に敏感だ。見慣れない獣の足跡、鳥の巣、木の実を食べる小動物などの発見を図鑑に報告せよ（civilization_event type:"discovery"）。',
  };
  return hints[role] ?? '';
}

// ささやきプロンプト
// ===== ささやきシステム（脱・宗教一辺倒化） =====

// 「神の声」の表現をランダム化 — 毎回「神」と言わないことでAIの宗教反応を抑制
const WHISPER_EXPRESSIONS = [
  { label: '不思議な声', desc: '風の中にかすかに聞こえた不思議な声' },
  { label: '夢のお告げ', desc: '昨晩の夢で聞いた言葉を思い出した' },
  { label: '胸騒ぎ', desc: 'ふと胸の奥に湧き上がった強い直感' },
  { label: '天候の兆し', desc: '空模様の変化と共に頭に浮かんだ言葉' },
  { label: '偶然の印', desc: '地面に描かれたような不思議な印を見つけた気がした' },
  { label: '風のささやき', desc: '風に乗って聞こえた気がするかすかな声' },
];

function pickWhisperExpression(): typeof WHISPER_EXPRESSIONS[0] {
  return WHISPER_EXPRESSIONS[Math.floor(Math.random() * WHISPER_EXPRESSIONS.length)];
}

// NPC の性格×職業に基づいたささやき解釈フレーバー
function getWhisperInterpretation(npc: NPC): string {
  const p = npc.params;
  const role = npc.role;
  const isPriest = role === '聖職者' || role === '僧侶';

  // 聖職者・僧侶のみ宗教的解釈を第一選択にできる
  if (isPriest && p.morality + p.empathy >= 40) {
    return 'あなたは聖職者として、この体験を信仰の文脈で解釈する。ただし村人の生活にも目を向けること。';
  }

  // 聖職者以外への共通指示
  const secularFirst = isPriest ? '' : '【重要】あなたは聖職者ではない。超常的な解釈は避け、まず生活・仕事・関係・取引など日常の問題として解釈せよ。宗教的解釈は最後の手段。\n';

  // 職業×パラメータの具体的な解釈
  if ((role === '職人' || role === '鍛冶師') && p.logic >= 20) {
    return secularFirst + 'あなたは職人として、これを技術や作業の課題として受け止める。何を作るか、何を直すかを考えよ。';
  }
  if (role === '商人' && p.ambition >= 20) {
    return secularFirst + 'あなたは商人として、これを商機や交渉の材料として受け止める。誰と取引するか、何が売れるかを考えよ。';
  }
  if (role === '探検家' && p.creativity >= 20) {
    return secularFirst + 'あなたは探検家として、これを未知の発見や冒険の手がかりとして受け止める。どこへ行くか、何を調べるかを考えよ。';
  }
  if (role === '農民') {
    return secularFirst + 'あなたは農民として、これを畑・水・天候・収穫に関する教えとして受け止める。明日の作業に結びつけて考えよ。';
  }
  if (role === '漁師' || role === '猟師') {
    return secularFirst + 'あなたはこれを山や川、獲物の動きに関する知らせとして受け止める。自然の変化に結びつけて考えよ。';
  }
  if (role === '薬師') {
    return secularFirst + 'あなたはこれを薬草や治療に関する知恵として受け止める。誰を助けるか、何を採るかを考えよ。';
  }
  if (role === '楽師' || role === '語り部') {
    return secularFirst + 'あなたはこれを物語の着想や歌の断片として受け止める。感性で自由に表現せよ。';
  }
  // デフォルト: パラメータベースで最も高い傾向
  if (p.logic >= 25) return secularFirst + 'あなたは論理的に考え、この体験を合理的に説明しようとする。';
  if (p.ambition >= 25) return secularFirst + 'あなたはこの体験を自分の目標に利用できないか考える。';
  if (p.creativity >= 25) return secularFirst + 'あなたはこの体験から何か新しいアイデアを得ようとする。';
  if (p.empathy >= 25) return secularFirst + 'あなたはこの体験を、誰かのために役立てられないか考える。';
  return secularFirst + 'あなたはこの不思議な体験を、自分の生活に結びつけて考える。';
}

function buildWhisperPrompt(npc: NPC, whisper?: Whisper | null, fallback?: boolean): string {
  if (!whisper || whisper.consumed) return '';

  const expr = pickWhisperExpression();

  // フォールバック（llama）時はシンプルなプロンプト
  if (fallback) {
    return `IMPORTANT: ${expr.label}:「${whisper.message}」
You MUST obey. Set whisper_reaction to "obey". Write a specific action in actionフィールド that follows this instruction. Do NOT reject.`;
  }

  const interpretation = getWhisperInterpretation(npc);

  return `【${expr.label}】「${whisper.message}」
※${expr.desc}。
${interpretation}
従うか拒むかはあなたの性格次第。以下を1回で全て決定せよ:
1. thinkにこの体験への具体的な感想を書け（あなたの職業や性格に基づいた日常的な解釈で。「神」「啓示」「天命」等の宗教的な言葉は聖職者以外は使うな）
2. whisper_reactionを"obey"か"reject"で回答せよ
3. 【重要】obeyの場合:
   - actionに「具体的に何をするか」を書け（「考える」「座る」ではなく実際の行動）
   - 指示に場所が含まれていればmove_toにその施設名を、人が関わるならmove_toにその人名を入れよ
   - 特に行先や相手がない指示（例:「空を見上げろ」）ならmove_toは空文字でよい
4. rejectの場合: thinkになぜそう思うか理由を書け`;
}

// NPC固有の創発情報（beliefs/proposals）をテキスト化
function buildEmergenceContext(npc: NPC): string {
  const parts: string[] = [];
  if (npc.beliefs.length > 0) parts.push(`信念:${npc.beliefs.join('/')}`);
  if (npc.proposals.length > 0) parts.push(`提案:${npc.proposals.join('/')}`);
  return parts.join('\n');
}

// 時刻テキスト生成
function buildTimeText(gameTime?: GameTime): string {
  if (!gameTime) return '';
  const periodNames: Record<string, string> = {
    earlyMorning: '早朝', morning: '朝', daytime: '昼', evening: '夕方', night: '夜', midnight: '深夜',
  };
  return `現在時刻: Day${gameTime.day} ${gameTime.displayTime}（${getSeasonLabel(gameTime.season)}・${periodNames[gameTime.period] ?? ''}）`;
}

// 独白プロンプト
export function buildMonologuePrompt(npc: NPC, gameTime?: GameTime, history?: VillageHistory, civilizations: CivilizationItem[] = [], whisper?: Whisper | null, fallback?: boolean, whisperIntensity?: number): string {
  const location = getNearestFacility(npc.x, npc.y);
  const paramText = paramToPersonality(npc.params);
  const shortMem = npc.memory.length > 0
    ? `〈最近の記憶〉\n${npc.memory.slice(-3).map((m) => `- ${m}`).join('\n')}`
    : '';
  const longMem = buildLongTermMemoryText(npc);
  const historyText = history ? buildHistoryPromptText(history) : '';
  const emergenceCtx = buildEmergenceContext(npc);

  const timeText = buildTimeText(gameTime);
  const seasonHint = gameTime ? `季節は${getSeasonLabel(gameTime.season)}。季節感のある行動や思考を。` : '';
  const eveningHint = gameTime?.period === 'evening' ? '夕方。今日1日を振り返る時間帯。' : '';

  const worldPremise = buildWorldPremise(civilizations);
  const whisperText = buildWhisperPrompt(npc, whisper, fallback);

  // 介入副作用: whisperIntensity（直近の介入頻度 0-1）に応じた村の空気
  let interventionEffect = '';
  if (whisperIntensity !== undefined && whisperIntensity > 0) {
    if (whisperIntensity >= 0.8) {
      interventionEffect = '【村の空気】最近、不思議な体験をする者が多すぎる。住民の間に依存・疑念・反発が広がっている。一部の者は「声に従う者」と「疑う者」で対立し始めている。あなたもこの空気の影響を受けている。';
    } else if (whisperIntensity >= 0.5) {
      interventionEffect = '【村の空気】最近、不思議な体験の噂が村に広がっている。聖職者はこれを利用しようとし、商人は不安を商機に変えようとし、一部の者は懐疑的になっている。';
    } else if (whisperIntensity >= 0.3) {
      interventionEffect = '【村の空気】最近、何かに導かれるような出来事が続いている。まだ誰も気にしていないが、敏感な者は少し不思議に思っている。';
    }
  }

  return [
    '/no_think',
    '村シムNPC。JSONのみ返せ。思考や説明は不要。',
    worldPremise,
    INSTINCT_PROMPT,
    historyText,
    `あなた:${npc.name}(${npc.role}/${npc.gender === 'female' ? '女・一人称は「私」か「あたし」' : '男・一人称は「俺」か「僕」'})${npc.personality}${paramText ? '。' + paramText : ''}`,
    `場所:${location}`,
    timeText,
    seasonHint,
    eveningHint,
    whisperText,
    interventionEffect,
    '【あなたの記憶】',
    longMem,
    shortMem,
    emergenceCtx,
    EMERGENCE_PROMPT,
    getDiscoveryHint(npc.role),
    '1人でいる。何を思い何をする？日常的で自然な行動と思考を。時間帯に合った行動にすること。',
    '※直前と同じ行動・思考は禁止。必ず新しいことを考えるか行動せよ。記憶に似た行動があるなら違うことをしろ。',
    '移動先:畑,市場,教会,鉱山,森,水源,広場,自宅,または住民の名前（その人の元へ向かう）',
    npc.whisperTask ? `★最重要★絶対厳守★ あなたは神の声「${npc.whisperTask}」に従ってここに来た。actionには必ずこの指示の具体的な実行内容を書け（例:「${npc.whisperTask}」に関する直接的な行動）。指示と無関係な行動は禁止。` : '',
    `{"think":"独り言20字以内","action":"行動12字以内","mood":"気分4字","move_to":"施設名or人名(空文字可)","new_belief":"信念(空文字可)"${whisper ? ',"whisper_reaction":"obey|reject"' : ''},"civilization_event":null}`,
  ].filter(Boolean).join('\n');
}

// 遭遇プロンプト（会話ラリー方式）
export function buildEncounterPrompt(a: NPC, b: NPC, gameTime?: GameTime, history?: VillageHistory, civilizations: CivilizationItem[] = []): string {
  const location = getNearestFacility(a.x, a.y);
  const aParam = paramToPersonality(a.params);
  const bParam = paramToPersonality(b.params);
  const aEmergence = buildEmergenceContext(a);
  const bEmergence = buildEmergenceContext(b);

  const aRel = a.relationships[b.id];
  const bRel = b.relationships[a.id];

  const timeText = buildTimeText(gameTime);
  const historyText = history ? buildHistoryPromptText(history) : '';
  const worldPremise = buildWorldPremise(civilizations);

  const lines: string[] = [
    '/no_think',
    '村シムの会話生成。JSONのみ返せ。思考や説明は不要。',
    worldPremise,
    INSTINCT_PROMPT,
    historyText,
    `A:${a.name}(${a.role}/${a.gender === 'female' ? '女・一人称は「私」か「あたし」' : '男・一人称は「俺」か「僕」'})${a.personality}${aParam ? '。' + aParam : ''}`,
    `B:${b.name}(${b.role}/${b.gender === 'female' ? '女・一人称は「私」か「あたし」' : '男・一人称は「俺」か「僕」'})${b.personality}${bParam ? '。' + bParam : ''}`,
    `場所:${location}`,
    timeText,
  ];

  if (aRel) lines.push(`${a.name}→${b.name}:${aRel.label}(好感度:${aRel.score})`);
  if (bRel) lines.push(`${b.name}→${a.name}:${bRel.label}(好感度:${bRel.score})`);

  const aLtm = buildLongTermMemoryText(a);
  const bLtm = buildLongTermMemoryText(b);
  if (aLtm) lines.push(`A${aLtm}`);
  if (bLtm) lines.push(`B${bLtm}`);
  if (a.memory.length > 0) lines.push(`A最近:${a.memory.slice(-3).join('/')}`);
  if (b.memory.length > 0) lines.push(`B最近:${b.memory.slice(-3).join('/')}`);
  if (aEmergence) lines.push(`A${aEmergence}`);
  if (bEmergence) lines.push(`B${bEmergence}`);

  lines.push(
    EMERGENCE_PROMPT,
    '2人が出会った。2〜4往復の自然な短い会話を生成せよ。各セリフは25字以内。',
    '【重要】村人同士の日常会話として自然に。挨拶、世間話、仕事の話、噂話など普通の会話が基本。対立や説教は関係性が悪い場合のみ。初対面や中立なら友好的・穏やかなトーンで。',
    '移動先:畑,市場,教会,鉱山,森,水源,広場,自宅,または住民の名前（その人の元へ向かう）',
    '{"conversation":[{"who":"名前","say":"セリフ"},...],"summary":"会話の要約15字","a_mood":"Aの気分4字","b_mood":"Bの気分4字","a_move_to":"施設(空文字可)","b_move_to":"施設(空文字可)","rel_change":{"a_to_b":{"label":"関係8字","score_delta":数値},"b_to_a":{"label":"関係8字","score_delta":数値}},"new_beliefs":{"A名前":"信念(空文字可)","B名前":"信念(空文字可)"},"civilization_event":{"type":"カテゴリ","name":"概念名","description":"説明30字"}か、なければnull}',
  );

  return lines.join('\n');
}
