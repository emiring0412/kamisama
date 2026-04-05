import { useState, useEffect } from 'react';
import styles from './InfoModal.module.css';

interface InfoEntry {
  date: string;
  title: string;
  body: string;
}

interface Props {
  onClose: () => void;
}

export default function InfoModal({ onClose }: Props) {
  const [entries, setEntries] = useState<InfoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('./info.json?t=' + Date.now())
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      })
      .then((data: InfoEntry[]) => {
        setEntries(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{'\uD83D\uDCE2'} お知らせ</div>

        {loading && <div className={styles.loading}>読み込み中...</div>}
        {error && <div className={styles.error}>お知らせの取得に失敗しました</div>}

        {!loading && !error && entries.length === 0 && (
          <div className={styles.empty}>お知らせはありません</div>
        )}

        {entries.map((entry, i) => (
          <div key={i} className={styles.entry}>
            <div className={styles.entryHeader}>
              <span className={styles.entryDate}>{entry.date}</span>
              <span className={styles.entryTitle}>{entry.title}</span>
            </div>
            <div className={styles.entryBody}>{entry.body}</div>
          </div>
        ))}

        <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
