import { useState } from 'react';
import styles from './ApiKeyScreen.module.css';
import AboutModal from './AboutModal';

interface Props {
  onSubmit: (groqKey: string, geminiKey: string | null) => void;
}

export default function ApiKeyScreen({ onSubmit }: Props) {
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [error, setError] = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showOfuse, setShowOfuse] = useState(false);

  const handleSubmit = () => {
    const trimmedGroq = groqKey.trim();
    if (!trimmedGroq) {
      setError('村を動かすための神器（APIキー）が必要です');
      return;
    }
    if (!trimmedGroq.startsWith('gsk_')) {
      setError('Groqの神器は「gsk_」で始まる文字列です');
      return;
    }
    if (trimmedGroq.length < 20) {
      setError('神器が短すぎます。正しくコピーしてください');
      return;
    }
    const trimmedGemini = geminiKey.trim() || null;
    if (trimmedGemini && !trimmedGemini.startsWith('csk-')) {
      setError('Cerebrasの神器は「csk-」で始まる文字列です');
      return;
    }
    onSubmit(trimmedGroq, trimmedGemini);
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.titleArea}>
          <span className={styles.icon}>&#x26E9;&#xFE0F;</span>
          <h1 className={styles.title}><img src={`${import.meta.env.BASE_URL}title.png`} alt="高天原より常世のくにへ" style={{ height: '48px' }} /></h1>
          <p className={styles.subtitle}>AI駆動 箱庭文明シミュレーター</p>
        </div>

        <p className={styles.lore}>
          神様。村を創るには、天界から<strong>神器（APIキー）</strong>を持ち込む必要があります。
          以下の手順で無料で取得できます。
        </p>

        <div className={styles.form}>
          {/* Groq（必須） */}
          <label className={styles.label}>Groqの神器（必須）</label>
          <input
            className={styles.input}
            type="password"
            placeholder="gsk_..."
            value={groqKey}
            onChange={(e) => { setGroqKey(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />

          <div className={styles.guide}>
            <p className={styles.guideTitle}>取得の儀（Groq・無料）</p>
            <ol className={styles.guideSteps}>
              <li><a href="https://console.groq.com" target="_blank" rel="noopener noreferrer">console.groq.com</a>（天の事務局）にアクセス</li>
              <li>Googleアカウント等でサインアップ（無料・お金はかかりません）</li>
              <li>左メニューの「API Keys」をクリック</li>
              <li>「Create API Key」（神器を作成）をクリック</li>
              <li><strong>gsk_</strong> で始まるキーをコピーして上に貼り付け</li>
            </ol>
            <p className={styles.guideNote}>
              ※「デベロッパーとして同意」等の堅い言葉が出ますが、
              「自分専用のゲーム用カギを発行する」という意味です。
              職業がプロでなくてもOK。趣味でも「開発」扱いです。
            </p>
          </div>

          {/* Cerebras（任意） */}
          {!showGemini ? (
            <button className={styles.optionalToggle} onClick={() => setShowGemini(true)}>
              {'\u2728'} さらなる神力を求める方はこちら（任意・村人の会話が自然に）
            </button>
          ) : (
            <>
              <label className={styles.label} style={{ marginTop: 12 }}>
                Cerebrasの神器（任意）
                <span className={styles.optional}> — Qwen3-235Bで会話が格段に自然に！</span>
              </label>
              <input
                className={styles.input}
                type="password"
                placeholder="csk-..."
                value={geminiKey}
                onChange={(e) => { setGeminiKey(e.target.value); setError(''); }}
              />

              <div className={styles.guide}>
                <p className={styles.guideTitle}>取得の儀（Cerebras・無料）</p>
                <ol className={styles.guideSteps}>
                  <li><a href="https://cloud.cerebras.ai" target="_blank" rel="noopener noreferrer">cloud.cerebras.ai</a>（もう一つの天の事務局）にアクセス</li>
                  <li>Googleアカウント等でサインアップ（無料）</li>
                  <li>ダッシュボードから「API Keys」をクリック</li>
                  <li>キー作成時に「Credit limit」を <strong>$0</strong> に設定（無料枠のみ使用、課金が発生しません）</li>
                  <li><strong>csk-</strong> で始まるキーをコピーして上に貼り付け</li>
                </ol>
                <p className={styles.guideNote}>
                  ※完全無料（100万トークン/日）です。この神器を持ち込むと、
                  Qwen3-235Bの力で村人同士の会話がより豊かになります。
                  なくても村は動きますが、あると神の力が増します。
                </p>
              </div>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.button} onClick={handleSubmit}>
            天岩戸を開く
          </button>
        </div>

        <div style={{ textAlign: 'center', padding: '20px 16px', marginTop: '16px' }}>
          <button
            onClick={() => setShowOfuse(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              fontSize: '0.85rem', fontWeight: 700, padding: '10px 24px',
              borderRadius: '24px', cursor: 'pointer',
              background: 'linear-gradient(135deg, #f5ece0, #e8ddd0)',
              color: '#c41e3a', border: '1.5px solid #d4c4b0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)', transition: 'all 0.25s',
            }}
          >
            {'\u2615'} 開発を応援する
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button
            onClick={() => setShowAbout(true)}
            style={{
              background: 'none', border: 'none', color: '#8b7a66', fontSize: '12px',
              cursor: 'pointer', textDecoration: 'underline', padding: '4px',
            }}
          >
            このゲームについて・利用規約・プライバシーポリシー
          </button>
        </div>
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {showOfuse && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setShowOfuse(false)}
        >
          <div
            style={{
              background: '#fff', border: '1px solid #e0d4c4', borderRadius: '16px',
              maxWidth: '480px', width: '100%', padding: '28px 24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)', textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>{'\u26E9\uFE0F'}</div>
            <h3 style={{ color: '#c41e3a', fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>
              天地開闢のその先へ — 創造主への献上
            </h3>
            <div style={{ color: '#7a6a55', fontSize: '13px', lineHeight: 1.9, textAlign: 'left', marginBottom: '20px' }}>
              <p style={{ marginBottom: '10px' }}>
                この世界「高天原より常世のくにへ」は、一柱の創造主の手によって生み出されました。
              </p>
              <p style={{ marginBottom: '10px' }}>
                高天原の神殿を整え、常世のくにをより豊かにするため、創造主は日夜、天地の仕組みを磨き続けています。
              </p>
              <p style={{ marginBottom: '10px' }}>
                もしこの世界を気に入ってくださったなら、創造主へのお布施という形で天地開闢の営みを支えていただけると幸いです。
              </p>
              <p style={{ marginBottom: '10px', color: '#8b7a66', fontSize: '12px' }}>
                いただいた献上は、高天原の環境整備 ── 新たな住民の創出、世界の安定、より深い物語の実現 ── に充てられます。
              </p>
              <p style={{ color: '#c41e3a', fontSize: '12px' }}>
                神々の遊びを、ともに紡いでいきましょう。
              </p>
            </div>
            <a
              href="https://ofuse.me/lafcreate"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                fontSize: '15px', fontWeight: 700, padding: '12px 32px',
                borderRadius: '28px', textDecoration: 'none',
                background: 'linear-gradient(135deg, #c41e3a, #9a1630)',
                color: '#fff', border: 'none',
                boxShadow: '0 4px 16px rgba(196,30,58,0.3)',
                transition: 'all 0.25s',
              }}
            >
              {'\u2615'} 創造主へ献上する（OFUSE）
            </a>
            <div style={{ fontSize: '11px', color: '#a09080', marginTop: '10px' }}>
              メッセージなしでもOK！50円から・登録不要で送れます
            </div>
            <button
              onClick={() => setShowOfuse(false)}
              style={{
                marginTop: '16px', background: 'none', border: '1px solid #d4c4b0',
                borderRadius: '8px', color: '#9a8a70', padding: '6px 20px',
                fontSize: '12px', cursor: 'pointer',
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
