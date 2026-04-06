import { useState } from 'react';
import type { NPC, Buff, ForceConversation, ConfessionUrge } from '../types';
import { ALL_ITEMS, getItemDef } from '../lib/itemGachaData';
import { R_TEMPLATES, SR_TEMPLATES } from '../lib/gachaData';
import CharacterSprite from './CharacterSprite';
import { idToClothHex, idToSkinHex, idToEyeHex, idToMouthHex, idToHairFront, idToHairBack, idToHasBeard } from './NPCSprite';
import styles from './InventoryModal.module.css';

const BUFF_LABELS: Record<string, string> = {
  discovery_up: '🔍 発見率UP',
  positive: '☀️ ポジティブバフ',
  affection: '💛 好感度ボーナス',
  cataclysm: '🌪️ 天変地異',
};

function getGenderLock(npc: NPC): 'male' | 'female' | undefined {
  const allTemplates = [...R_TEMPLATES, ...SR_TEMPLATES];
  const tmpl = allTemplates.find((t) => t.role === npc.role && t.genderLock);
  return tmpl?.genderLock;
}

function NPCAvatar({ npc, size }: { npc: NPC; size: number }) {
  return (
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
      role={npc.role} rarity={npc.rarity} size={size} profile={false}
    />
  );
}

interface Props {
  inventory: Record<string, number>;
  npcs: NPC[];
  buffs: Buff[];
  currentDay: number;
  unharvestedCount: number;
  totalCivCount: number;
  forceConversations: ForceConversation[];
  confessionUrges: ConfessionUrge[];
  onUseItem: (itemId: string, targets: string[], extra?: string) => void;
  onClose: () => void;
}

// 確認ダイアログ state
type ConfirmState = null | {
  itemId: string;
  label: string;
};

// 対象選択 state
type SelectMode = null | {
  itemId: string;
  targetType: 'npc1' | 'npc2';
  selected: string[];
  nameInput?: string;
  nameError?: string;
};

export default function InventoryModal({ inventory, npcs, buffs, currentDay, unharvestedCount, totalCivCount, forceConversations, confessionUrges, onUseItem, onClose }: Props) {
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [selectMode, setSelectMode] = useState<SelectMode>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const ownedItems = ALL_ITEMS.filter((item) => (inventory[item.id] || 0) > 0);

  const showResult = (msg: string) => {
    setResultMsg(msg);
    setTimeout(() => setResultMsg(null), 3000);
  };

  // アイテムタップ → まず確認ダイアログを出す
  const handleItemClick = (itemId: string) => {
    const def = getItemDef(itemId);
    if (!def) return;
    if (itemId === 'harvest_prayer' && totalCivCount === 0) {
      showResult('図鑑にアイテムがありません');
      return;
    }
    // プロンプト注入系バフは重ねがけ不可
    if (itemId === 'positive_buff' && buffs.some((b) => b.type === 'positive')) {
      showResult('ポジティブバフは既に有効です');
      return;
    }
    if (itemId === 'discovery_up' && buffs.some((b) => b.type === 'discovery_up')) {
      showResult('発見率UPは既に有効です');
      return;
    }
    if (itemId === 'cataclysm' && buffs.some((b) => b.type === 'cataclysm')) {
      showResult('天変地異の影響がまだ続いています');
      return;
    }
    setConfirmState({ itemId, label: `${def.emoji} ${def.name}` });
  };

  // 確認ダイアログで「はい」
  const handleConfirmUse = () => {
    if (!confirmState) return;
    const { itemId } = confirmState;
    const def = getItemDef(itemId);
    setConfirmState(null);
    if (!def) return;

    if (def.targetType === 'none') {
      // 即発動
      onUseItem(itemId, []);
      if (itemId === 'discovery_up') showResult('発見率UPバフが3日間有効になりました！');
      else if (itemId === 'positive_buff') showResult('ポジティブバフが7日間有効になりました！');
      else if (itemId === 'affection_bonus') showResult('好感度ボーナスが7日間有効になりました！');
      else if (itemId === 'cataclysm') showResult('天変地異が発生しました！');
      else if (itemId === 'harvest_prayer') showResult(`豊作祈願！ 図鑑${totalCivCount}件 → ${totalCivCount}Pの物理Pを獲得！`);
    } else {
      // 対象選択画面へ
      setSelectMode({
        itemId,
        targetType: def.targetType as 'npc1' | 'npc2',
        selected: [],
        nameInput: itemId === 'name_change' ? '' : undefined,
      });
    }
  };

  const toggleNPCSelect = (npcId: string) => {
    if (!selectMode) return;
    if (selectMode.itemId === 'gender_change') {
      const npc = npcs.find((n) => n.id === npcId);
      if (npc && getGenderLock(npc)) return;
    }
    const { targetType, selected } = selectMode;
    if (targetType === 'npc1') {
      setSelectMode({ ...selectMode, selected: [npcId] });
    } else {
      if (selected.includes(npcId)) {
        setSelectMode({ ...selectMode, selected: selected.filter((id) => id !== npcId) });
      } else if (selected.length < 2) {
        setSelectMode({ ...selectMode, selected: [...selected, npcId] });
      }
    }
  };

  const canConfirmTarget = () => {
    if (!selectMode) return false;
    const { itemId, targetType, selected, nameInput } = selectMode;
    if (targetType === 'npc1' && selected.length !== 1) return false;
    if (targetType === 'npc2' && selected.length !== 2) return false;
    if (itemId === 'name_change' && (!nameInput || nameInput.trim().length === 0)) return false;
    return true;
  };

  const handleTargetConfirm = () => {
    if (!selectMode || !canConfirmTarget()) return;
    const { itemId, selected, nameInput } = selectMode;

    if (itemId === 'name_change') {
      const newName = nameInput!.trim();
      if (npcs.some((n) => n.name === newName)) {
        setSelectMode({ ...selectMode, nameError: 'その名前は既に使われています' });
        return;
      }
    }

    onUseItem(itemId, selected, itemId === 'name_change' ? nameInput!.trim() : undefined);
    setSelectMode(null);

    const targetNames = selected.map((id) => npcs.find((n) => n.id === id)?.name || '?');
    if (itemId === 'force_talk') {
      const pairHasConfession = confessionUrges.some(
        (u) => (u.npcId1 === selected[0] && u.npcId2 === selected[1]) ||
               (u.npcId1 === selected[1] && u.npcId2 === selected[0])
      );
      showResult(pairHasConfession
        ? `💘 ${targetNames[0]}と${targetNames[1]}の告白イベント発動！`
        : `${targetNames[0]}と${targetNames[1]}の強制会話をセットしました！`);
    }
    else if (itemId === 'hair_change') showResult(`${targetNames[0]}の髪色が変わりました！`);
    else if (itemId === 'name_change') showResult(`${targetNames[0]}の名前を「${nameInput!.trim()}」に変更しました！`);
    else if (itemId === 'reconcile') showResult(`${targetNames[0]}と${targetNames[1]}の好感度が+3されました！`);
    else if (itemId === 'gender_change') showResult(`${targetNames[0]}の性別が変わりました！`);
    else if (itemId === 'confession') {
      const pairHasForce = forceConversations.some(
        (f) => (f.npcId1 === selected[0] && f.npcId2 === selected[1]) ||
               (f.npcId1 === selected[1] && f.npcId2 === selected[0])
      );
      showResult(pairHasForce
        ? `💘 ${targetNames[0]}と${targetNames[1]}の告白イベント発動！`
        : `${targetNames[0]}と${targetNames[1]}の告白促進をセットしました！`);
    }
  };

  // ===== 確認ダイアログ =====
  if (confirmState) {
    const def = getItemDef(confirmState.itemId);
    return (
      <div className={styles.selectOverlay} onClick={() => setConfirmState(null)}>
        <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.confirmEmoji}>{def?.emoji}</div>
          <div className={styles.confirmTitle}>{def?.name}</div>
          <div className={styles.confirmDesc}>{def?.description}</div>
          <div className={styles.confirmQuestion}>使用しますか？</div>
          <div className={styles.selectActions}>
            <button className={styles.confirmBtn} onClick={handleConfirmUse}>はい</button>
            <button className={styles.cancelBtn} onClick={() => setConfirmState(null)}>いいえ</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== 対象選択画面 =====
  if (selectMode) {
    const def = getItemDef(selectMode.itemId)!;
    const maxSelect = selectMode.targetType === 'npc1' ? 1 : 2;
    return (
      <div className={styles.selectOverlay} onClick={() => setSelectMode(null)}>
        <div className={styles.selectModal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.selectTitle}>{def.emoji} {def.name}</div>
          <div className={styles.selectDesc}>
            {selectMode.targetType === 'npc1' ? 'NPCを1人選択してください' : 'NPCを2人選択してください'}
          </div>

          <div className={styles.npcGrid}>
            {npcs.map((npc) => {
              const isSelected = selectMode.selected.includes(npc.id);
              const isGenderLocked = selectMode.itemId === 'gender_change' && !!getGenderLock(npc);
              const isDisabled = isGenderLocked || (!isSelected && selectMode.selected.length >= maxSelect);
              return (
                <div
                  key={npc.id}
                  className={`${styles.npcOption} ${isSelected ? styles.npcOptionSelected : ''} ${isDisabled ? styles.npcOptionDisabled : ''}`}
                  onClick={() => !isDisabled && toggleNPCSelect(npc.id)}
                >
                  <div className={styles.npcAvatar}>
                    <NPCAvatar npc={npc} size={32} />
                  </div>
                  <span className={styles.npcName}>{npc.name}</span>
                  <span className={styles.npcRole}>
                    {npc.role} {npc.gender === 'female' ? '♀' : '♂'}
                    {isGenderLocked && ' (変更不可)'}
                  </span>
                </div>
              );
            })}
          </div>

          {selectMode.itemId === 'name_change' && selectMode.selected.length === 1 && (
            <>
              <input
                className={styles.nameInput}
                placeholder="新しい名前を入力..."
                value={selectMode.nameInput || ''}
                onChange={(e) => setSelectMode({ ...selectMode, nameInput: e.target.value, nameError: undefined })}
                maxLength={10}
              />
              {selectMode.nameError && <div className={styles.nameError}>{selectMode.nameError}</div>}
            </>
          )}

          <div className={styles.selectActions}>
            <button className={styles.confirmBtn} disabled={!canConfirmTarget()} onClick={handleTargetConfirm}>
              使用する
            </button>
            <button className={styles.cancelBtn} onClick={() => setSelectMode(null)}>
              戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== メイン画面 =====
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{'\uD83C\uDF92'} 持ち物</div>
        <div className={styles.subtitle}>アイテムをタップして使用</div>

        {resultMsg && <div className={styles.resultBanner}>{resultMsg}</div>}

        {buffs.length > 0 && (() => {
          // 同種バフをグルーピング（累積表示）
          const grouped = new Map<string, { count: number; maxExpiry: number }>();
          for (const buff of buffs) {
            const existing = grouped.get(buff.type);
            if (existing) {
              existing.count++;
              existing.maxExpiry = Math.max(existing.maxExpiry, buff.expiresDay);
            } else {
              grouped.set(buff.type, { count: 1, maxExpiry: buff.expiresDay });
            }
          }
          return (
            <div className={styles.buffSection}>
              <div className={styles.buffTitle}>有効なバフ</div>
              <div className={styles.buffList}>
                {[...grouped.entries()].map(([type, { count, maxExpiry }]) => (
                  <div key={type} className={styles.buffItem}>
                    <span>{BUFF_LABELS[type] || type}{count > 1 ? ` ×${count}（+${count * 2}）` : ''}</span>
                    <span className={styles.buffExpiry}>残り{maxExpiry - currentDay}日</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {ownedItems.length > 0 ? (
          <div className={styles.itemList}>
            {ownedItems.map((item) => (
              <div
                key={item.id}
                className={`${styles.itemRow} ${item.rarity === 'R' ? styles.itemRowR : ''}`}
                onClick={() => handleItemClick(item.id)}
              >
                <div className={styles.itemEmoji}>{item.emoji}</div>
                <div className={styles.itemInfo}>
                  <div className={styles.itemName}>
                    {item.name}
                    <span className={`${styles.itemRarity} ${item.rarity === 'R' ? styles.rarityR : styles.rarityN}`} style={{ marginLeft: 6 }}>
                      {item.rarity}
                    </span>
                  </div>
                  <div className={styles.itemDesc}>{item.description}</div>
                </div>
                <div className={styles.itemCount}>×{inventory[item.id]}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyMsg}>アイテムがありません。概念ガチャで手に入れよう！</div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
