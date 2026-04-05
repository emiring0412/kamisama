import type { Facility } from '../types';

// 建築プロジェクト
export interface BuildProject {
  id: string;
  facility: Omit<Facility, 'x' | 'y'> & { x: number; y: number };
  builderId: string;
  builderName: string;
  daysRequired: number;
  daysWorked: number;
  startDay: number;
}

// AI応答から建築意図を検出
export interface BuildIntent {
  building: string;  // 施設名（AIが自由に命名）
  reason: string;    // 理由
}

// 名前から絵文字を推測
function guessEmoji(name: string): string {
  const emojiMap: [string[], string][] = [
    [['畑', '農', '耕', '田'], '\uD83C\uDF31'],
    [['家', '小屋', '住居', '寝床', '宿'], '\uD83D\uDED6'],
    [['店', '商', '市場', '売'], '\uD83C\uDFEA'],
    [['祠', '祭壇', '神殿', '寺', '廟'], '\u26E9\uFE0F'],
    [['塔', '見張', '櫓', '監視'], '\uD83D\uDDFC'],
    [['集会', '会議', '広場'], '\uD83C\uDFDB\uFE0F'],
    [['橋', '渡'], '\uD83C\uDF09'],
    [['井戸', '水', '泉'], '\uD83D\uDCA7'],
    [['倉', '蔵', '保管', '貯'], '\uD83D\uDCE6'],
    [['窯', '炉', '鍛冶', '火'], '\uD83D\uDD25'],
    [['柵', '壁', '囲', '門'], '\uD83E\uDDF1'],
    [['船', '舟', '筏'], '\u26F5'],
    [['道', '路'], '\uD83D\uDEE4\uFE0F'],
    [['墓', '弔'], '\uD83E\uDEA6'],
    [['風車', '水車'], '\u2699\uFE0F'],
    [['旗', '印', '標'], '\uD83C\uDFF3\uFE0F'],
  ];
  for (const [keywords, emoji] of emojiMap) {
    if (keywords.some((kw) => name.includes(kw))) return emoji;
  }
  return '\uD83C\uDFD7\uFE0F'; // デフォルト: 建設中
}

// 名前から建築日数を推測（大きいものほど日数がかかる）
function guessDays(name: string): number {
  const quickBuilds = ['柵', '旗', '印', '標', '道具', '斧', '槍', '縄', '棒'];
  if (quickBuilds.some((kw) => name.includes(kw))) return 1;

  const smallBuilds = ['小屋', '祠', '井戸', '畑', '柵', '見張り', '窯'];
  if (smallBuilds.some((kw) => name.includes(kw))) return 2;

  const mediumBuilds = ['商店', '倉庫', '橋', '水車', '風車', '鍛冶場'];
  if (mediumBuilds.some((kw) => name.includes(kw))) return 4;

  const largeBuilds = ['集会所', '神殿', '城', '砦', '港'];
  if (largeBuilds.some((kw) => name.includes(kw))) return 7;

  // 不明なものはデフォルト3日
  return 3;
}

// 名前からサイズを推測（建物のみ。道具はcreateBuildProject前にフィルタされる想定）
function guessSize(name: string): { width: number; height: number } {
  const tiny = ['柵', '井戸', '祠', '窯', '見張り', '標', '墓', '碑', '像'];
  if (tiny.some((kw) => name.includes(kw))) return { width: 40, height: 40 };

  const medium = ['小屋', '家', '住居', '宿', '商店', '倉庫', '橋', '畑', '鍛冶', '工房', '港', '船着'];
  if (medium.some((kw) => name.includes(kw))) return { width: 70, height: 50 };

  const large = ['集会所', '神殿', '広場', '城', '砦', '水車', '風車', '市場', '教会', '寺', '塔'];
  if (large.some((kw) => name.includes(kw))) return { width: 100, height: 70 };

  // 未知の建物 → 中サイズ
  return { width: 60, height: 50 };
}

// 矩形の重なり判定
function overlaps(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  margin: number = 10,
): boolean {
  return ax - margin < bx + bw && ax + aw + margin > bx &&
         ay - margin < by + bh && ay + ah + margin > by;
}

// 重ならない位置を探す（最大20回試行）
function findOpenPosition(
  w: number, h: number,
  mapWidth: number, mapHeight: number,
  existing: Array<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = Math.random() * (mapWidth - w - 40) + 20;
    const y = Math.random() * (mapHeight - h - 40) + 20;
    const collides = existing.some((e) => overlaps(x, y, w, h, e.x, e.y, e.width, e.height));
    if (!collides) return { x, y };
  }
  // 見つからなければ適当に
  return { x: Math.random() * (mapWidth - w - 40) + 20, y: Math.random() * (mapHeight - h - 40) + 20 };
}

// AIが自由に発明したものから BuildProject を生成
export function createBuildProject(
  intent: BuildIntent,
  builderId: string,
  builderName: string,
  currentDay: number,
  mapWidth: number,
  mapHeight: number,
  existingFacilities: Array<{ x: number; y: number; width: number; height: number }> = [],
): BuildProject {
  const size = guessSize(intent.building);
  const emoji = guessEmoji(intent.building);
  const days = guessDays(intent.building);

  const w = Math.max(size.width, 20);
  const h = Math.max(size.height, 20);
  const { x, y } = findOpenPosition(w, h, mapWidth, mapHeight, existingFacilities);

  return {
    id: `build-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    facility: {
      name: intent.building,
      emoji,
      x,
      y,
      width: size.width,
      height: size.height,
    },
    builderId,
    builderName,
    daysRequired: days,
    daysWorked: 0,
    startDay: currentDay,
  };
}

// 建築の進捗を1日分進める
export function advanceBuild(project: BuildProject): BuildProject {
  return { ...project, daysWorked: project.daysWorked + 1 };
}

// 完成したかどうか
export function isBuildComplete(project: BuildProject): boolean {
  return project.daysWorked >= project.daysRequired;
}

// 道具かどうか（マップに表示しない）
export function isTool(project: BuildProject): boolean {
  return project.facility.width === 0 && project.facility.height === 0;
}
