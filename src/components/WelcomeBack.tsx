import { useState, useEffect } from 'react';
import styles from './WelcomeBack.module.css';

interface Props {
  elapsedMinutes: number;
  historyLines: string[];   // 歴史エントリ（"Day5: ○○が起きた"）
  loading: boolean;
  onEnter: () => void;
}

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  const d = Math.floor(h / 24);
  return `${d}日${h % 24}時間`;
}

export default function WelcomeBack({ elapsedMinutes, historyLines, loading, onEnter }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (loading || historyLines.length === 0) return;
    setVisibleCount(0);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVisibleCount(i);
      if (i >= historyLines.length) clearInterval(timer);
    }, 1200);
    return () => clearInterval(timer);
  }, [loading, historyLines.length]);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}><img src={`${import.meta.env.BASE_URL}title.png`} alt="高天原より常世のくにへ" style={{ height: '48px' }} /></h1>
        <div className={styles.greeting}>
          <span className={styles.icon}>{'\uD83C\uDF05'}</span>
          <p>おかえりなさい、神様。</p>
        </div>
        <p className={styles.elapsed}>
          あなたがいない間に<br />
          <strong>{formatElapsed(elapsedMinutes)}</strong>が経ちました。
        </p>

        {loading && (
          <div className={styles.loading}>
            <div>{'\u23F3'} 記録を生成中...</div>
            <button className={styles.skipBtn} onClick={onEnter}>
              スキップして村へ {'\u2192'}
            </button>
          </div>
        )}

        {!loading && historyLines.length > 0 && (
          <div className={styles.events}>
            <p className={styles.eventsTitle}>村では様々なことが起きていたようです...</p>
            {historyLines.slice(0, visibleCount).map((line, i) => (
              <div key={i} className={styles.event}>
                <div className={styles.eventSummary}>{line}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && (visibleCount >= historyLines.length || historyLines.length === 0) && (
          <button className={styles.enterBtn} onClick={onEnter}>
            {historyLines.length === 0 ? '村を見に行く（記録なし）' : '村を見に行く'} {'\u2192'}
          </button>
        )}
      </div>
    </div>
  );
}
