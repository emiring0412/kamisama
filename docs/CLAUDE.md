# CLAUDE.md

## プロジェクト概要

「高天原より常世のくにへ」— AIが駆動するNPCたちの箱庭文明シミュレーター。
詳細な仕様は `docs/spec.md` を参照すること。

## 技術スタック

- React + Vite + TypeScript
- スタイリング: CSS Modules（Tailwind不使用）
- AI API: Groq API（OpenAI互換）
- デプロイ: 静的ファイルをレンタルサーバーにアップ

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動（localhost:5173）
npm run build    # 本番ビルド（dist/に出力）
npm run preview  # ビルド結果のプレビュー
```

## 開発ルール

### コーディング規約

- 言語は TypeScript を使用（.tsx / .ts）、anyは極力使わない
- コンポーネントは関数コンポーネント + Hooks で統一
- 1ファイル1コンポーネントを基本とする
- コンポーネントファイル名はPascalCase（例: WorldMap.tsx）
- hooks, lib のファイル名はcamelCase（例: useSimulation.ts）
- コメントは日本語でOK
- console.log はデバッグ時のみ、完成時は削除

### ディレクトリ構成

```
kamisama/
├── docs/           # 仕様書
├── src/
│   ├── components/ # UIコンポーネント
│   ├── hooks/      # カスタムフック
│   ├── lib/        # ユーティリティ・API関連
│   └── types/      # 型定義
├── .env            # APIキー（gitignore対象）
└── .gitignore
```

### 環境変数

- `.env` に `VITE_GROQ_API_KEY` を設定
- コード内では `import.meta.env.VITE_GROQ_API_KEY` でアクセス
- **APIキーは絶対にハードコードしない**

### API呼び出し

- Groq API はクライアントサイドから直接呼び出す
- エンドポイント: `https://api.groq.com/openai/v1/chat/completions`
- デフォルトモデル: `qwen/qwen3-32b`
- max_tokens: 200（NPC応答は短文のため）
- temperature: 0.8
- レスポンスはJSON形式を期待。パース失敗時はスキップ
- 429エラー時は30秒間リクエストを停止

### 状態管理

- 外部ライブラリ（Redux等）は使わない
- useState / useRef で管理
- NPC一覧、ログ、設定などの主要ステートは App.tsx で保持し、子コンポーネントにpropsで渡す

### パフォーマンス注意点

- NPCの移動アニメーションは60msのsetIntervalで処理
- AI呼び出しは非同期で、1人ずつ順番に処理（同時呼び出ししない）
- ログは最大100件を超えたら古いものから削除
- NPCが10人を超えたらAI呼び出し間隔を自動延長

## 開発の進め方

- `docs/spec.md` の「開発フェーズ」に従い、Phase 1 → 5 の順で実装
- 各Phase完了時に動作確認できる状態にすること
- Phase 1 だけでも画面が表示されてNPCが歩き回る状態にする
- 一度に大量のコードを書かず、こまめに動作確認しながら進める

## やってはいけないこと

- APIキーをソースコードにハードコードすること
- サーバーサイドのコードを書くこと（フロントエンド完結）
- 外部のCDNからLLMモデルを勝手にダウンロードすること
- npm パッケージを大量に追加すること（最小限に）
