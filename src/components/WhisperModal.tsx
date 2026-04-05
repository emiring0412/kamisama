import { useState, useEffect, useRef } from 'react';
import type { NPC, Whisper } from '../types';
import styles from './WhisperModal.module.css';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';

interface Props {
  npcs: NPC[];
  visible?: boolean;
  onSend: (whisper: Whisper) => void;
  onClose: () => void;
  cooldownRemaining: number; // 秒
  preselectedNpcId?: string | null;
}

export default function WhisperModal({ npcs, onSend, onClose, cooldownRemaining, preselectedNpcId }: Props) {
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(preselectedNpcId ?? null);

  // preselectedNpcIdが変わったら反映
  useEffect(() => {
    if (preselectedNpcId) setSelectedNpcId(preselectedNpcId);
  }, [preselectedNpcId]);
  const [message, setMessage] = useState('');
  const prevCooldown = useRef(cooldownRemaining);

  // 閉じたとき（cooldownが0超から入った = 送信直後）にリセット
  useEffect(() => {
    if (prevCooldown.current === 0 && cooldownRemaining > 0) {
      setSelectedNpcId(null);
      setMessage('');
    }
    prevCooldown.current = cooldownRemaining;
  }, [cooldownRemaining]);

  // インジェクション系パターンを弾く
  const BLOCKED_PATTERNS = [
    /ignore.*(?:instruction|prompt|system)/i,
    /system\s*prompt/i,
    /you\s+are\s+(?:now|a)\s/i,
    /disregard/i,
    /override/i,
    /forget.*(?:previous|above)/i,
    /act\s+as\s/i,
    /pretend\s/i,
  ];

  const handleSend = () => {
    if (!selectedNpcId || !message.trim()) return;
    const trimmed = message.trim();
    if (BLOCKED_PATTERNS.some((p) => p.test(trimmed))) {
      return; // 静かにブロック
    }
    onSend({ targetNpcId: selectedNpcId, message: trimmed, consumed: false });
  };

  const inCooldown = cooldownRemaining > 0;

  // iOS Safari: textareaフォーカス時にoverlayのonClickが誤発火するのを防止
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <h3 className={styles.title}>{'\uD83D\uDD2E'} 神のささやき</h3>
        <p className={styles.desc}>NPCに天の声を送る。従うかどうかはNPC次第。<br/>まず住民を選び、メッセージを入力してください。</p>

        {inCooldown && (
          <div className={styles.cooldown}>
            {'\u23F3'} クールダウン中... あと{Math.ceil(cooldownRemaining)}秒
          </div>
        )}

        {!inCooldown && (
          <>
            <div className={styles.npcList}>
              {npcs.map((npc) => (
                <button
                  key={npc.id}
                  className={`${styles.npcBtn} ${selectedNpcId === npc.id ? styles.npcBtnActive : ''}`}
                  onClick={() => setSelectedNpcId(npc.id)}
                >
                  <CharacterSprite gender={npc.gender} hairColor={npc.color} clothColor={idToClothHex(npc.id)} skinColor={idToSkinHex(npc.id)} eyeColor={idToEyeHex(npc.id)} mouthColor={idToMouthHex(npc.id)} hairFrontVariant={idToHairFront(npc.id, npc.gender)} hairBackVariant={idToHairBack(npc.id)} hasBeard={npc.gender === 'male' ? idToHasBeard(npc.id) : false} role={npc.role} rarity={npc.rarity} size={24} /> {npc.name}
                </button>
              ))}
            </div>

            <textarea
              className={styles.input}
              placeholder="例:「森に行ってみよ」「仲間を集めよ」"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 50))}
              maxLength={50}
            />
            <div className={styles.charCount}>{message.length}/50</div>
            <div style={{ fontSize: '10px', color: '#555', marginTop: '4px', lineHeight: 1.5 }}>
              {'\u203B'} 住民への指示内容は自己責任です。入力内容はAI APIに送信されます。
            </div>

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose}>やめる</button>
              <button
                className={styles.sendBtn}
                disabled={!selectedNpcId || !message.trim()}
                onClick={handleSend}
              >
                ささやく
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
