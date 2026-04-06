import { useState, useRef } from 'react';
import styles from './SettingsModal.module.css';

interface Props {
  groqKey: string;
  geminiKey: string | null;
  onSave: (groqKey: string, geminiKey: string | null) => void;
  onLogout: () => void;
  onClose: () => void;
}

export default function SettingsModal({ groqKey, geminiKey, onSave, onLogout, onClose }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [newGroq, setNewGroq] = useState(groqKey);
  const [newGemini, setNewGemini] = useState(geminiKey ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const trimGroq = newGroq.trim();
    if (!trimGroq.startsWith('gsk_') || trimGroq.length < 20) {
      setError('Groq APIキーが正しくありません（gsk_で始まる文字列）');
      return;
    }
    const trimGemini = newGemini.trim() || null;
    if (trimGemini && !trimGemini.startsWith('csk-')) {
      setError('Cerebras APIキーが正しくありません（csk-で始まる文字列）');
      return;
    }
    onSave(trimGroq, trimGemini);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // マスク表示
  const mask = (key: string) => key.slice(0, 8) + '...' + key.slice(-4);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>{'\u2699\uFE0F'} 設定</h3>

        <div className={styles.section}>
          <label className={styles.label}>Groq APIキー（必須）</label>
          <div className={styles.keyDisplay}>{mask(groqKey)}</div>
          <input
            className={styles.input}
            type="password"
            placeholder="新しいキーを入力..."
            value={newGroq}
            onChange={(e) => { setNewGroq(e.target.value); setError(''); }}
          />
        </div>

        <div className={styles.section}>
          <label className={styles.label}>
            Cerebras APIキー（任意）
            {geminiKey ? (
              <span className={styles.active}> {'\u2728'} 有効</span>
            ) : (
              <span className={styles.inactive}> 未設定</span>
            )}
          </label>
          {geminiKey && <div className={styles.keyDisplay}>{mask(geminiKey)}</div>}
          <input
            className={styles.input}
            type="password"
            placeholder={geminiKey ? '変更する場合は入力...' : 'csk-... を入力すると会話が自然に'}
            value={newGemini}
            onChange={(e) => { setNewGemini(e.target.value); setError(''); }}
          />
          {!geminiKey && (
            <p className={styles.hint}>
              <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener noreferrer">
                cloud.cerebras.ai
              </a> で無料取得 → Qwen3-235Bで会話が自然になります
            </p>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {saved && <p className={styles.saved}>{'\u2705'} 保存しました</p>}

        <div className={styles.actions}>
          <button className={styles.saveBtn} onClick={handleSave}>保存</button>
          <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
        </div>

        <div style={{ textAlign: 'center', padding: '12px 0', borderTop: '1px solid #e0d4c4', marginTop: '12px' }}>
          <a
            href="https://ofuse.me/lafcreate"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '0.8rem', fontWeight: 600, padding: '8px 20px',
              borderRadius: '20px', textDecoration: 'none',
              background: 'linear-gradient(135deg, #f5ece0, #e8ddd0)',
              color: '#c41e3a', border: '1px solid #d4c4b0',
              transition: 'all 0.2s',
            }}
          >
            {'\u2615'} 開発を応援する（OFUSE）
          </a>
          <div style={{ fontSize: '0.65rem', color: '#a09080', marginTop: '6px', lineHeight: 1.6 }}>
            50円から・登録不要で送れます
          </div>
        </div>

        {/* データ引っ越し */}
        <div className={styles.section}>
          <label className={styles.label}>{'\uD83D\uDCE6'} データ引っ越し</label>
          <p className={styles.hint}>APIキー含む全データをJSONファイルでエクスポート/インポートできます<br/>インポートするファイル: <code>kamisama_backup_YYYY-MM-DD.json</code></p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className={styles.saveBtn} onClick={() => {
              const data: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('kamisama_')) {
                  data[key] = localStorage.getItem(key) ?? '';
                }
              }
              // STORAGE_KEYも含める（APIキー）
              const apiKeyVal = localStorage.getItem('groq_api_key');
              if (apiKeyVal) data['groq_api_key'] = apiKeyVal;
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `kamisama_backup_${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}>
              {'\uD83D\uDCE4'} エクスポート
            </button>
            <button className={styles.closeBtn} onClick={() => importRef.current?.click()}>
              {'\uD83D\uDCE5'} インポート
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string) as Record<string, string>;
                    if (!confirm(`${Object.keys(data).length}件のデータをインポートします。現在のデータは上書きされます。よろしいですか？`)) return;
                    // まず既存データをクリア（容量確保）
                    const keysToRemove: string[] = [];
                    for (let j = 0; j < localStorage.length; j++) {
                      const k = localStorage.key(j);
                      if (k && (k.startsWith('kamisama_') || k === 'groq_api_key')) keysToRemove.push(k);
                    }
                    for (const k of keysToRemove) localStorage.removeItem(k);

                    let failed: string[] = [];
                    let totalSize = 0;
                    for (const [key, value] of Object.entries(data)) {
                      try {
                        localStorage.setItem(key, value);
                        totalSize += key.length + value.length;
                        console.log(`[Import] OK: ${key} (${(value.length / 1024).toFixed(1)}KB)`);
                      } catch (err) {
                        failed.push(key);
                        console.error(`[Import] FAIL: ${key} (${(value.length / 1024).toFixed(1)}KB)`, err);
                      }
                    }
                    // 検証: 実際に保存されたか確認
                    for (const key of Object.keys(data)) {
                      const stored = localStorage.getItem(key);
                      if (!stored) {
                        console.error(`[Import] MISSING after import: ${key}`);
                        if (!failed.includes(key)) failed.push(key);
                      } else {
                        console.log(`[Import] Verified: ${key} (${(stored.length / 1024).toFixed(1)}KB)`);
                      }
                    }
                    console.log(`[Import] Total: ${(totalSize / 1024).toFixed(1)}KB, Failed: ${failed.length}`);
                    // 自動保存に上書きされる前に即リロード
                    (window as unknown as Record<string, boolean>).__kamisama_resetting = true;
                    if (failed.length > 0) {
                      alert(`インポート完了（${failed.length}件失敗: ${failed.join(', ')}）`);
                    }
                    window.location.reload();
                  } catch {
                    alert('JSONファイルの読み込みに失敗しました。');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className={styles.danger}>
          <button className={styles.logoutBtn} onClick={() => {
            if (confirm('ログアウトしますか？APIキーが削除されます。ゲームデータは残ります。')) {
              onLogout();
            }
          }}>
            {'\uD83D\uDEAA'} ログアウト（APIキー削除）
          </button>
          <button className={styles.logoutBtn} style={{ marginTop: '8px', color: '#ff6b6b', borderColor: '#ff6b6b' }} onClick={() => {
            if (confirm('APIキーを残して村のデータをすべて削除し、最初からやり直しますか？')) {
              (window as unknown as Record<string, boolean>).__kamisama_resetting = true;
              const groqKey = localStorage.getItem('kamisama_api_key');
              const geminiKey = localStorage.getItem('kamisama_gemini_key');
              localStorage.clear();
              if (groqKey) localStorage.setItem('kamisama_api_key', groqKey);
              if (geminiKey) localStorage.setItem('kamisama_gemini_key', geminiKey);
              window.location.href = window.location.pathname + '?reset=' + Date.now();
            }
          }}>
            {'\uD83D\uDDD1\uFE0F'} リセット（村データ全削除）
          </button>
        </div>
      </div>
    </div>
  );
}
