import type { NPC } from '../types';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';
import styles from './DepartureModal.module.css';

interface Props {
  npc: NPC;
  reason: string;
  onRetain: () => void;  // 引き留める
  onLetGo: () => void;   // 見送る
}

export default function DepartureModal({ npc, reason, onRetain, onLetGo }: Props) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.icon}>{'\uD83D\uDEE4\uFE0F'}</div>
        <div className={styles.title}>{npc.name}が村を去ろうとしている</div>

        <div className={styles.card}>
          <div className={styles.header}>
            <CharacterSprite
              gender={npc.gender}
              hairColor={npc.color}
              clothColor={idToClothHex(npc.id)}
              skinColor={idToSkinHex(npc.id)}
              eyeColor={idToEyeHex(npc.id)}
              mouthColor={idToMouthHex(npc.id)}
              hairFrontVariant={idToHairFront(npc.id, npc.gender)}
              hairBackVariant={idToHairBack(npc.id)}
              hasBeard={npc.gender === 'male' ? idToHasBeard(npc.id) : false}
              role={npc.role}
              rarity={npc.rarity}
              size={64}
              profile
            />
            <div>
              <div className={styles.name} style={{ color: npc.color }}>{npc.name}</div>
              <div className={styles.role}>{npc.role}{npc.age ? ` / ${npc.age}歳` : ''}</div>
            </div>
          </div>

          <div className={styles.reason}>
            {'\u300C'}{reason}{'\u300D'}
          </div>
        </div>

        <div className={styles.hint}>
          引き留めても、必ず残ってくれるとは限りません
        </div>

        <div className={styles.actions}>
          <button className={styles.retainBtn} onClick={onRetain}>
            {'\uD83E\uDD1D'} 引き留める
          </button>
          <button className={styles.letGoBtn} onClick={onLetGo}>
            {'\uD83D\uDC4B'} 見送る
          </button>
        </div>
      </div>
    </div>
  );
}
