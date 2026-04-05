import { memo } from 'react';

interface Props {
  gender: 'male' | 'female';
  hairColor: string;
  clothColor: string;
  skinColor?: string;
  eyeColor?: string;
  mouthColor?: string;
  size: number;
  profile?: boolean;
  hairFrontVariant?: string;
  hairBackVariant?: string;
  hasBeard?: boolean;
  role?: string;
}

type ColorType = 'hair' | 'cloth' | 'skin' | 'eye' | 'mouth' | 'beard';
type LayerDef = { file: string; color: ColorType | null };

// 職業装飾の定義
// position: 'over_cloth'(服の上) or 'top'(最前面)
// color: CSS filter染色する色タイプ、null=そのまま表示
interface JobLayerDef {
  file: string;
  color: ColorType | null;
  position: 'over_cloth' | 'top';
}

// 職業名→装飾パーツのマッピング
const JOB_LAYERS: Record<string, JobLayerDef[]> = {
  '農民': [
    { file: 'job/job_farmer_hat', color: null, position: 'top' },
    { file: 'job/job_farmer_ribbon', color: 'hair', position: 'top' },
  ],
  '聖職者': [
    { file: 'job/job_priest_robe', color: 'cloth', position: 'over_cloth' },
    { file: 'job/job_priest_necklace', color: null, position: 'top' },
  ],
  '僧侶': [
    { file: 'job/job_priest_robe', color: 'cloth', position: 'over_cloth' },
    { file: 'job/job_priest_necklace', color: null, position: 'top' },
  ],
};

function buildLayersFemale(hairFront: string, hairBack: string, profile: boolean, role?: string): LayerDef[] {
  const p = profile ? '_p' : '';
  const jobDefs = role ? JOB_LAYERS[role] : undefined;
  const overCloth = jobDefs?.filter((j) => j.position === 'over_cloth')
    .map((j) => ({ file: `${j.file}${p}`, color: j.color })) ?? [];
  const topLayers = jobDefs?.filter((j) => j.position === 'top')
    .map((j) => ({ file: `${j.file}${p}`, color: j.color })) ?? [];

  return [
    { file: `f/hair_back_f_${hairBack}${p}`, color: 'hair' },
    { file: `f/body_f_01${p}`, color: 'skin' },
    { file: `f/cloth_f_01${p}`, color: 'cloth' },
    ...overCloth,
    { file: `f/eye_f_01${p}`, color: 'eye' },
    { file: `f/mouth_f_01${p}`, color: 'mouth' },
    { file: `f/hair_front_f_${hairFront}${p}`, color: 'hair' },
    { file: 'f/eye_f_01_high', color: null },
    { file: `f/hair_front_f_${hairFront}_high`, color: null },
    ...topLayers,
  ];
}

function buildLayersMale(hairFront: string, hasBeard: boolean, profile: boolean, role?: string): LayerDef[] {
  const p = profile ? '_p' : '';
  const jobDefs = role ? JOB_LAYERS[role] : undefined;
  const overCloth = jobDefs?.filter((j) => j.position === 'over_cloth')
    .map((j) => ({ file: `${j.file}${p}`, color: j.color })) ?? [];
  const topLayers = jobDefs?.filter((j) => j.position === 'top')
    .map((j) => ({ file: `${j.file}${p}`, color: j.color })) ?? [];

  const layers: LayerDef[] = [
    { file: `m/body_m_01${p}`, color: 'skin' },
    { file: `m/cloth_m_01${p}`, color: 'cloth' },
    ...overCloth,
    { file: `m/eye_m_01${p}`, color: 'eye' },
    { file: `m/mouth_m_01${p}`, color: 'mouth' },
  ];
  if (hasBeard) {
    layers.push({ file: `m/beard_m_01${p}`, color: 'beard' });
  }
  layers.push({ file: `m/hair_front_m_${hairFront}${p}`, color: 'hair' });
  layers.push({ file: 'm/eye_m_01_high', color: null });
  layers.push({ file: `m/hair_front_m_${hairFront}_high`, color: null });
  layers.push(...topLayers);
  return layers;
}

// hex → HSL
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const c = hex.replace('#', '');
  let r = parseInt(c.substring(0, 2), 16) / 255;
  let g = parseInt(c.substring(2, 4), 16) / 255;
  let b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(hue * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function colorToFilter(hex: string, darken = 1.0): string {
  const { h, s, l } = hexToHsl(hex);
  const hueRotate = h - 30;
  const saturate = s / 50;
  const brightness = (l / 50) * darken;
  return `brightness(${brightness}) sepia(1) hue-rotate(${hueRotate}deg) saturate(${saturate})`;
}

function skinToFilter(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  const yellowFix = l > 80 ? -30 : l > 70 ? -25 : -20;
  const hueRotate = h - 30 + yellowFix;
  const saturate = Math.max(0.4, s / 35);
  const brightness = l / 80;
  return `brightness(${brightness}) sepia(1) hue-rotate(${hueRotate}deg) saturate(${saturate})`;
}

function CharacterSpriteInner(props: Props) {
  const base = `${import.meta.env.BASE_URL}sprites/`;
  const hf = props.hairFrontVariant || '01';
  const hb = props.hairBackVariant || '01';

  const layers = props.gender === 'female'
    ? buildLayersFemale(hf, hb, !!props.profile, props.role)
    : buildLayersMale(hf, !!props.hasBeard, !!props.profile, props.role);

  const colorFilters: Record<string, string> = {
    hair: colorToFilter(props.hairColor, 0.7),
    cloth: colorToFilter(props.clothColor, 0.65),
    skin: skinToFilter(props.skinColor || '#F5D0B0'),
    eye: colorToFilter(props.eyeColor || '#4A3728'),
    mouth: colorToFilter(props.mouthColor || '#E08080'),
    beard: colorToFilter(props.hairColor, 0.6),
  };

  return (
    <div style={{
      position: 'relative',
      width: props.size,
      height: props.size,
      flexShrink: 0,
    }}>
      {layers.map((layer) => (
        <img
          key={layer.file}
          src={`${base}${layer.file}.png`}
          width={props.size}
          height={props.size}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            filter: layer.color ? colorFilters[layer.color] : undefined,
          }}
          alt=""
          onError={(e) => { const el = e.target as HTMLImageElement; el.style.width = '0'; el.style.height = '0'; }}
        />
      ))}
    </div>
  );
}

const CharacterSprite = memo(CharacterSpriteInner);
export default CharacterSprite;
