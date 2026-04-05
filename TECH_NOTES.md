# 高天原より常世のくにへ — 技術解説ノート

> ビッグテックの「開発者呼び込み用リソース」を贅沢にハシゴして、行き着く先が「原始人の石交換」。
> 無料枠の善意が、最もくだらない形で結晶化している背徳感のあるプロジェクト。

---

## 全体アーキテクチャ

```
[ブラウザ] ← React + TypeScript + Vite（サーバーなし）
    │
    ├── 会話・ささやき → Cerebras API（Qwen3-235B、100万トークン/日・無料）
    ├── 独白 → Groq API（Qwen3-32B → Llama-70B → Llama-8B 自動フォールバック）
    ├── バックエンド処理 → Groq API（Llama-3.1-8B、JSON精度重視）
    └── 全データ → localStorage（サーバー完全不要）
```

| 層 | 技術 |
|---|---|
| フロントエンド | React 19 + TypeScript 5.9 + Vite |
| 状態管理 | React Hooks（useState, useRef, useCallback）|
| AI呼び出し | 素のFetch API（SDKなし） |
| ストレージ | localStorage（JSON） |
| AI Providers | Cerebras（Qwen3-235B）+ Groq（Qwen3-32B / Llama-70B / Llama-8B） |

---

## 1. マルチプロバイダ戦略 — 無料枠ハシゴの全貌

### 用途別AI振り分け

| 処理 | プロバイダ | モデル | 理由 |
|---|---|---|---|
| NPC同士の会話 | Cerebras | Qwen3-235B | 長文・複数ターン、日本語品質が命 |
| ささやき反応 | Cerebras | Qwen3-235B | 神の言葉への反応、品質重要 |
| おかえりログ | Cerebras | Qwen3-235B | 不在中のイベント生成 |
| NPC独白 | Groq | Qwen3-32B | 短文一言、速度優先で十分 |
| パラメータ判定 | Groq | Llama-3.1-8B | JSON出力、日本語品質不要 |
| 歴史圧縮（骨格） | Groq | Llama-3.1-8B | 英語でキーワード抽出 |
| 歴史圧縮（清書） | Groq | Qwen3-32B | 日本語で時代名を付ける |
| 職業変化判定 | Groq | Llama-3.1-8B | バッチ処理 |

**ポイント**: 「日本語の自然さが必要な場面」だけ235Bの大砲を撃ち、それ以外は8Bの小銃で節約。
原始人の石交換シーンに235Bパラメータのモデルが動員される贅沢。

### フォールバックチェーン

```
Cerebras (Qwen3-235B)
  ↓ 429 or エラー
Groq (Qwen3-32B)
  ↓ 429 → 10分ブロック
Groq (Llama-3.3-70B)
  ↓ 429 → 10分ブロック
Groq (Llama-3.1-8B)  ← 最終防衛ライン（RPD 14400）
```

全モデルがブロック中でも最後のモデルを返す。クラッシュしない。
各モデルの`blockedUntil`と`hitCount`を独立追跡し、解禁時刻が来たら自動復帰。

### レート制限の多層防御

```typescript
// 層1: リアルタイム追跡（直近1分/1時間のリクエスト数）
let requestTimestamps: number[] = [];
let hourlyTimestamps: number[] = [];

// 層2: 予防的スロットル（15req/min超えたら抑制）
export function shouldThrottle(): boolean {
  return getRequestsInLastMinute() >= 15;
}

// 層3: 日次上限（残量に応じてAI間隔を自動調整）
export function getSavingMultiplier(): number {
  const pct = getRemainingPercent();
  if (pct <= 5) return 2.0;   // 残量5%以下: AI間隔2倍
  if (pct <= 20) return 1.5;  // 残量20%以下: AI間隔1.5倍
  return 1.0;
}

// 層4: Groqレスポンスヘッダーからサーバー側の残量を直接取得
const remaining = response.headers.get('x-ratelimit-remaining-requests');
// ※Safari CORS制限でヘッダー読めない場合はtry-catchで無視
```

### Cerebrasの制御

```typescript
const CB_MIN_GAP = 5000;  // 30RPMなので2秒で足りるが余裕持って5秒
// 429なら1分ブロック（全体混雑なので短め）
// その他エラーは5分ブロック
// <think>タグ自動除去（Qwen3系の思考タグ対応）
```

---

## 2. プロンプトエンジニアリング — 4層構造

### 独白プロンプトの設計

NPCの独白は4つのレイヤーで構成される：

**Layer 0: 世界の前提**
```
通貨・法律・宗教なし。「お金」という言葉を使えない。
既に採択された文明アイテムのみ使用許可。
→ AIが勝手に「銀行を作ろう」とか言い出すのを防ぐ
```

**Layer 1: 本能（5つの普遍的欲求）**
```
安全・仲間・刺激・承認・理解
→ 原始人でも持っている普遍的な動機付け
```

**Layer 2: 個別パラメータ → 性格文変換**
```typescript
// 6軸パラメータ（合計100）を日本語の性格文に変換
// 0-15: 極端に低い / 16-35: 低い / 36-65: 普通(言及なし) / 66-85: 高い / 86+: 極端に高い
paramToPersonality({ logic: 14, creativity: 10, morality: 30, empathy: 26, ambition: 5, sociability: 15 })
// → "あまり論理的でなく、感情に流されやすい。創造性に乏しく、定型的に行動しがち。..."
```

**Layer 3: 記憶**
```
短期記憶: 直近3件
長期記憶: 20件以内、日付付き
→ 「Day5にタケシと喧嘩した」みたいな情報がAIの判断に影響
```

**Layer 4: 創発**
```
新しい仕組み（物々交換、役割分担）を自発的に提案できる
信仰・決まりごとを生み出せる
建物を提案できる（小屋、祠、見張り台）
不要な建物を取り壊せる（demolish）
```

### ささやきモードの工夫

```typescript
// 通常モード（Cerebras/Qwen3向け）
// → obey/reject を自分で判断させる
"神（プレイヤー）からの声が聞こえた。この声に従うか拒むか、性格と状況から判断せよ。"

// フォールバックモード（Llama向け）
// → 強制obey（Llamaに「拒否の判断」は難しい）
"whisper_reaction MUST be 'obey'"
```

### 会話ラリーの設計

```json
{
  "conversation": [{"who":"ゲンジ","say":"ここは寒いな"},{"who":"タケシ","say":"そうだね"},...],
  "summary": "鉱山での石拾いと畑の予定",
  "rel_change": {
    "a_to_b": {"label":"協力的", "score_delta": 2},
    "b_to_a": {"label":"信頼する", "score_delta": 1}
  },
  "civilization_event": {"type":"tool","name":"火打石","description":"石を打ち合わせて火を起こす道具"}
}
```

会話の中で自然に文明が生まれる。「石を打ち合わせたら火が出た」みたいな発見が会話ラリーの副産物として発生。

---

## 3. ゲームシステム — NPCの完全自律化

### メインループ（20秒ごとのタスク選択）

```
20秒タイマー発火
  ↓
レート制限チェック（Cerebrasキーあれば無視）
  ↓
遭遇ペア検索（距離60px以内の2体を抽選）
  ├── 遭遇成立 → processEncounter()（会話ラリー、Cerebras優先）
  ├── すれ違い → processPassingBy()（API不使用、定型セリフ）
  └── 遭遇なし → 独白
       ├── ささやき対象 → processMonologue()（Cerebras）
       ├── AI独白（50%確率）→ processMonologue()（Groq）
       └── PG定型行動 → getSoloAction()（API不使用）
```

### ループ検出と防止

AIが同じ行動を繰り返すのを検出して、プログラム側の定型行動に差し替え：

```typescript
const isLoopAction = (npc: NPC, action: string, think: string): boolean => {
  const recent = npc.memory.slice(-3);  // 直近3件の記憶
  const newWords = (action + think).split(/[\s、。！？を・に]/g).filter((w) => w.length >= 2);
  
  let overlapCount = 0;
  for (const mem of recent) {
    for (const word of newWords) {
      if (mem.includes(word)) { overlapCount++; break; }
    }
  }
  return overlapCount >= 2;  // 3件中2件以上とキーワード被ったらループ
};
```

### 遭遇確率の動的計算

```typescript
let chance = 10;  // 基本10%
chance += (a.params.sociability + b.params.sociability) / 2 * 0.3;  // 社交性補正
chance += avgScore * 0.2;  // 関係性補正（abs値 = 好きでも嫌いでも絡みやすい）
if (eventActive) chance += 15;  // イベント中は活発
if (now - lastEnc < 60000) chance -= 50;  // 直近60秒は同ペア抑制
```

**注目**: 関係性スコアを`abs()`で絶対値化。好感度+100でも-100でも「絡みやすい」。
ドラマは仲良しからも敵対からも生まれるという設計思想。

### 神のささやき — キーワード推測システム

AIが`move_to`を正しく返さない場合に備えて、ささやき文からキーワード推測：

```typescript
const keywordToFacility: [string, string][] = [
  ['釣', '水源'], ['水汲', '水源'], ['泳', '水源'],
  ['掘', '鉱山'], ['採掘', '鉱山'], ['鍛冶', '鉱山'],
  ['耕', '畑'], ['種まき', '畑'], ['収穫', '畑'],
  ['説教', '教会'], ['布教', '教会'], ['祈', '教会'],
  // ... 26パターン
];

// 優先順位: NPC名マッチ > 施設名直接マッチ > キーワード推測
```

「ゲンジのところに行け」→ NPC名マッチ、「畑を耕せ」→ 施設名マッチ、「魚を釣ってこい」→ キーワード「釣」→ 水源。
AIの不完全な応答を補完するセーフティネット。

### プログラム側定型行動（API完全不使用）

```typescript
// 時間帯 × 職業 のマトリクス = 540種類の定型行動
const SOLO_BY_PERIOD: Record<TimePeriod, Record<string, SoloLine[]>> = {
  earlyMorning: {
    '農民': [
      { think: 'よし、今日も頑張るか', action: '朝露の畑を見回る' },
      { think: '早起きは三文の徳', action: '井戸で顔を洗う' },
    ],
    '商人': [
      { think: '今日の仕入れは…', action: '在庫の確認をする' },
    ],
    // ... 各職業 × 6時間帯
  },
};
```

AI枠を消費せずに「NPCが生きてる感」を出すための定型行動データベース。

---

## 4. 歴史圧縮 — 2段階方式

### なぜ2段階？

歴史エントリが15件を超えたら圧縮するが、1回のAI呼び出しで「英語分析 + 日本語清書」をやらせると品質が不安定。
裏方（Llama-8B）で英語の骨格を抽出し、表舞台（Qwen3-32B）で日本語の時代名と要約を付ける。

### Step 1: 骨格抽出（裏方・英語）

```typescript
// Llama-8Bに英語でキーワード抽出させる
{
  "era_name_en": "Foundation Era",
  "period": "Day1-15",
  "key_events": ["stone axe invented", "farming expanded", "first trade"]
}
```

Dayの範囲は実際のイベントから自動計算（AIの捏造を防止）：
```typescript
const dayNumbers = recentHistory.map((e) => {
  const m = e.match(/Day(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}).filter((d): d is number => d !== null);
```

### Step 2: 日本語清書（表舞台）

```typescript
// Qwen3-32Bに骨格を渡して日本語化
{
  "eraName": "黎明の時代",
  "period": "Day1-Day15",
  "summary": "最初の道具が生まれ、畑が広がり、村人たちが初めて物々交換を始めた時代。"
}
```

### 歴史の3層構造

```
ancientLog     → 1行圧縮（無制限蓄積）
  "Day1-15 黎明の時代: 最初の道具が生まれ..."
pastEras       → 詳細版（最新5件のみ保持）
  { eraName: "黎明の時代", period: "Day1-15", summary: "..." }
recentHistory  → イベント（15件で圧縮発火）
  "Day16: タケシが市場で石を交換した"
```

古い時代は1行に圧縮されて`ancientLog`に移動。永遠に成長する歴史。

---

## 5. おかえりシステム

### 不在時間の計算

```typescript
// 現実1分 = ゲーム内60分（1時間）
const elapsedGameMinutes = Math.floor(elapsedRealMinutes * 60);
// 最大7日分に上限
const capped = Math.min(elapsedGameMinutes, 24 * 60 * 7);
```

5分以上不在 → おかえり画面表示。24時間超は24時間分として処理。

### イベント生成

経過時間に応じてイベント件数が変わる：
- < 1時間: 2件
- 1〜6時間: 5件
- 6〜24時間: 10件

Cerebras (Qwen3-235B) で生成。不在中も高品質なイベントが得られる。

### イベント反映

```
記憶追加 → 気分更新 → 信念追加 → 関係性変更 → 歴史記録 → パラメータ再分配
```

全てをNPC状態に反映してから「村を見に行く」ボタンで再開。

---

## 6. 建築システム — AIの自由発明に対応

### AIが「小屋を建てたい」と言ったら

1. **名前 → 絵文字推測**: 16パターンのキーワードマッチ
   ```typescript
   [['畑', '農', '耕', '田'], '🌱'],
   [['家', '小屋', '住居'], '🛖'],
   [['祠', '祭壇', '神殿'], '⛩'],
   ```

2. **建築日数推測**: 規模に応じて1〜7日
   - 柵・旗: 1日 / 小屋・祠: 2日 / 商店・倉庫: 4日 / 神殿・城: 7日

3. **配置**: マップ上で既存施設と重ならない位置を自動探索（最大20回試行）

4. **進捗**: ゲーム内日数経過で自動進行、完成時にログと歴史に記録

### 住居判定

「小屋」「家」「住居」を含む建物 → 建てたNPCの自宅として登録。帰宅先が変わる。

---

## 7. 子ども・寿命システム

### 出生条件

```typescript
// 28日（ゲーム内1年）ごとに判定
if (canHaveChild(a, b, allNPCs) && Math.random() < 0.25) {
  const child = createChild(a, b, existingNames);
}
```

- 異性ペアのみ
- 双方の好感度 +10以上
- 3等身以内の血縁関係なし（近親防止）
- ペアあたり最大4人
- 判定に通っても25%の確率

### 遺伝

```typescript
// 両親のパラメータ平均 ± ランダム変異
const avg = (a.params[k] + b.params[k]) / 2;
child[k] = Math.max(0, Math.round(avg + (Math.random() - 0.5) * 20));
// → トータル100に正規化
```

### 寿命

```typescript
const lifespan = 60 + Math.floor(Math.random() * 21);  // 60〜80歳
// 14日ごとに加齢、寿命到達で死亡
// 「{name}が天に召された（享年{age}歳）」
```

---

## 8. JSONパース修復 — AIの不完全応答との戦い

AIが途中で切れたJSONを返すことがある。3段階で修復：

```
Step 1: 完全なJSON → そのままパース
Step 2: 括弧の数が合わない → 不足分を補完してパース
Step 3: それでも失敗 → conversation配列だけ正規表現で救出
```

特にStep 3の「会話だけ救出」は、NPC会話のログ表示を途切れさせないための最後の手段。
rel_changeやmoodはデフォルト値で埋めて、会話テキストだけは死守する。

---

## 9. 夜型判定 — パラメータから生活リズムを決定

```typescript
function isNightOwl(npc: NPC): boolean {
  return npc.params.creativity >= 35 || npc.params.sociability <= 5;
}
```

- creativity高い → 創造的で夜更かしタイプ
- sociability低い → 人嫌いで夜に活動
- ambition高い + sociability低い → 野心家で昼は寝て夜に策謀

深夜帯はNPCの90%が活動停止するが、夜型NPCだけは動き続ける。

---

## 10. 時間帯×季節のグラデーション背景

6時間帯 × 4季節 = 24パターンの動的CSSグラデーション：

```typescript
const seasonTint = {
  spring: { r: 0, g: 5, b: 0 },     // 緑がかる
  summer: { r: 5, g: 3, b: -3 },    // 暖色系
  autumn: { r: 8, g: 2, b: -5 },    // オレンジがかる
  winter: { r: -3, g: -3, b: 5 },   // 青みがかる
};
```

RGB値への微調整で「冬の早朝」と「夏の早朝」の色味が変わる。

---

## 11. `/no_think` — トークン節約の秘密兵器

全プロンプトの先頭に付く接頭辞：

```
/no_think
村シムNPC。JSONのみ返せ。思考や説明は不要。
```

Qwen3-235Bは思考ステップ（`<think>`タグ）を大量に生成する癖がある。
これを抑制することで、応答トークンを60〜70%削減。無料枠の実質容量が2〜3倍になる。

それでも漏れ出てくる`<think>`タグは、レスポンス受信後に正規表現で除去：
```typescript
text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
```

---

## まとめ: 背徳感の構造

1. **Cerebras** の100万トークン/日無料枠で、235Bパラメータの最大級モデルを「原始人の会話」に使う
2. **Groq** の超高速推論を、「畑を耕すかどうか」の判断に使う
3. **Llama-8B** の14400RPD枠を、「石斧と火打石どっちが先に発明されたか」の歴史圧縮に使う
4. 3社の429対策が完璧に連携して、1日中原始人を動かし続ける
5. 全てブラウザだけで動く。サーバー代: **0円**

各社の「開発者呼び込み用リソース」が、人類最初期の文明シミュレーションという最もくだらない用途に集結している。
これが「天地開闢」の正体。
