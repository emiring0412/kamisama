import { useState } from 'react';
import styles from './AboutModal.module.css';

interface Props {
  onClose: () => void;
}

type Tab = 'about' | 'terms' | 'privacy' | 'notice';

export default function AboutModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('about');

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>{'\u26E9\uFE0F'}</span>
          <h3 className={styles.title}><img src={`${import.meta.env.BASE_URL}title.png`} alt="高天原より常世のくにへ" style={{ height: '36px' }} /></h3>
          <span className={styles.subtitle}>AI駆動 箱庭文明シミュレーター</span>
        </div>

        <div className={styles.tabs}>
          {([
            ['about', 'このゲームについて'],
            ['notice', '\u26A0\uFE0F テスト公開について'],
            ['terms', '利用規約'],
            ['privacy', 'プライバシーポリシー'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {tab === 'about' && (
            <>
              <h4>{'\uD83C\uDF0F'} このゲームについて</h4>
              <p>
                「高天原より常世のくにへ」は、AIが駆動する箱庭文明シミュレーターです。
                村人たちはAIによって自律的に思考・会話・行動し、プレイヤーは「神」として彼らの世界を見守ります。
              </p>
              <p>
                神は「ささやき」を通じて村人に干渉できますが、従うかどうかは村人の性格と判断次第。
                村人同士の関係性、文明の発展、そして時に訪れる予想外の出来事を楽しむゲームです。
              </p>

              <h4>{'\uD83D\uDD27'} 使用技術</h4>
              <ul>
                <li>フロントエンド: React + TypeScript + Vite</li>
                <li>会話AI: Cerebras（Qwen3-235B）</li>
                <li>独白・バックエンドAI: Groq（Qwen3-32B / Llama-3.1-8B）</li>
                <li>すべてブラウザ上で動作、サーバー不要</li>
              </ul>

              <h4>{'\uD83D\uDC68\u200D\uD83D\uDCBB'} 開発</h4>
              <p>
                開発: <a href="https://laf-create.jp/laf/" target="_blank" rel="noopener noreferrer" style={{ color: '#c41e3a', textDecoration: 'none' }}>L.a.F</a>
              </p>
            </>
          )}

          {tab === 'notice' && (
            <>
              <div className={styles.warning}>
                <h4>{'\u26A0\uFE0F'} テスト公開について</h4>
                <p>本ゲームは現在<strong style={{ color: '#ff9800' }}>テスト公開中</strong>です。以下の点をご了承ください。</p>
                <ul>
                  <li><strong>予告なく頻繁に仕様変更やUI変更</strong>、それに伴うUXの変化があります</li>
                  <li><strong>プレイデータは予告なく破損する場合があります</strong>（バージョン間の互換性の兼ね合いで）</li>
                  <li>あくまで現在は<strong>テスト公開</strong>となります</li>
                </ul>
                <p style={{ fontSize: '12px', color: '#8b7a66' }}>
                  正式リリースまでの間、データの永続性は保証されません。大切なデータのバックアップは各自でお願いいたします。
                </p>
              </div>
            </>
          )}

          {tab === 'terms' && (
            <>
              <h4>利用規約</h4>

              <h4>1. 本ゲームについて</h4>
              <p>
                本ゲーム「高天原より常世のくにへ」は、AIを活用した箱庭文明シミュレーターです。
                どなたでも無料でご利用いただけます。
              </p>

              <h4>2. APIキーについて</h4>
              <p>
                本ゲームの動作には、ユーザーご自身が取得したAPIキー（Groq、Cerebras等）が必要です。
                APIキーはブラウザのローカルストレージに保存され、当方のサーバーに送信されることはありません。
                APIキーの管理はユーザーご自身の責任で行ってください。
              </p>

              <h4>3. AI生成コンテンツについて</h4>
              <p>
                ゲーム内の村人の発言・行動はAIによって自動生成されます。
                生成されるコンテンツは予測不可能であり、不適切な内容が含まれる可能性があります。
                生成されたコンテンツについて、当方は一切の責任を負いません。
              </p>

              <h4>4. データの保存と消失</h4>
              <p>
                ゲームデータはブラウザのローカルストレージに保存されます。
                ブラウザのデータ消去、アップデートによる互換性の変更等により、データが消失する可能性があります。
                データの永続性は保証いたしません。
              </p>

              <h4>5. 免責事項</h4>
              <p>
                本ゲームは現状のまま（as-is）提供されます。
                ゲームの利用により生じた損害について、当方は一切の責任を負いません。
                仕様・提供形態は予告なく変更される場合があります。
              </p>

              <h4>6. ユーザー入力コンテンツについて</h4>
              <p>
                「神のささやき」等でユーザーが入力した内容は、AIサービスに送信されます。
                入力内容はユーザーご自身の責任で管理してください。
                各AIサービスの利用規約に反する内容の送信はお控えください。
              </p>

              <h4>7. API利用料について</h4>
              <p>
                本ゲームは無料枠の範囲内で動作するよう設計していますが、
                利用状況によっては無料枠を超過する可能性が絶対にないとは保証できません。
              </p>
              <p>
                Groq・Cerebrasいずれも、クレジットカードを登録しない限り有料プランに移行することは通常ありません。
                念のため、各サービスのダッシュボードからクレジット制限（利用上限）を設定しておくことをおすすめします。
                設定は数クリックで完了します。
              </p>
            </>
          )}

          {tab === 'privacy' && (
            <>
              <h4>プライバシーポリシー</h4>

              <h4>1. 収集する情報</h4>
              <p>
                本ゲームは、当方のサーバーにユーザーの個人情報を収集・送信しません。
                すべてのゲームデータはユーザーのブラウザ内（ローカルストレージ）にのみ保存されます。
              </p>

              <h4>2. APIキーの取り扱い</h4>
              <p>
                ユーザーが入力したAPIキーは、ブラウザのローカルストレージに保存されます。
                APIキーはAIサービス（Groq、Cerebras等）への直接通信にのみ使用され、
                当方を含む第三者のサーバーに送信されることはありません。
              </p>

              <h4>3. 外部サービスとの通信</h4>
              <p>
                本ゲームは以下の外部サービスと直接通信します。
              </p>
              <ul>
                <li>Groq API（api.groq.com）— AI推論</li>
                <li>Cerebras API（api.cerebras.ai）— AI推論</li>
              </ul>
              <p>
                これらのサービスへの通信内容（プロンプト・応答）は各サービスのプライバシーポリシーに準じます。
              </p>

              <h4>4. Cookie・トラッキング</h4>
              <p>
                本ゲームは独自のCookie・トラッキングを使用しません。
              </p>

              <h4>5. お問い合わせ</h4>
              <p>
                プライバシーに関するお問い合わせは、開発者のWebサイトよりご連絡ください。
              </p>
            </>
          )}
        </div>

        <button className={styles.closeBtn} onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
