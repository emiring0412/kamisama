import { FACILITIES, MAP_WIDTH, MAP_HEIGHT } from '../lib/constants';
import type { NPC } from '../types';
import NPCSprite from './NPCSprite';
import styles from './WorldMap.module.css';

interface ExtraFacility {
  name: string;
  emoji: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  npcs: NPC[];
  onSelectNPC: (id: string) => void;
  selectedNPCId: string | null;
  background?: string;
  extraFacilities?: ExtraFacility[];
}

export default function WorldMap({ npcs, onSelectNPC, selectedNPCId, background, extraFacilities }: Props) {
  const allFacilities = [...FACILITIES, ...(extraFacilities ?? [])];

  return (
    <div className={styles.map} style={{ width: MAP_WIDTH, height: MAP_HEIGHT, background: background || undefined, transition: 'background 10s ease', '--map-scale': `${Math.min(1, (window.innerWidth - 32) / MAP_WIDTH)}` } as React.CSSProperties}>
      {/* 施設（初期+AI建築） */}
      {allFacilities.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className={styles.facility}
          style={{
            left: f.x,
            top: f.y,
            width: f.width,
            height: f.height,
          }}
        >
          <span className={styles.facilityEmoji}>{f.emoji}</span>
          <span className={styles.facilityName}>{f.name}</span>
        </div>
      ))}

      {/* NPC自宅 */}
      {npcs.map((npc) => (
        <div
          key={`home-${npc.id}`}
          className={styles.home}
          style={{ left: npc.homeX - 12, top: npc.homeY - 12, borderColor: npc.color + '44' }}
        >
          <span className={styles.homeIcon}>{'\uD83C\uDFE0'}</span>
          <span className={styles.homeLabel} style={{ color: npc.color + '99' }}>{npc.name}</span>
        </div>
      ))}

      {/* NPC */}
      {npcs.map((npc) => (
        <NPCSprite
          key={npc.id}
          npc={npc}
          isSelected={npc.id === selectedNPCId}
          onClick={() => onSelectNPC(npc.id)}
        />
      ))}
    </div>
  );
}
