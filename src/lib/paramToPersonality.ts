import type { NPCParams } from '../types';

// パラメータ値→性格修飾文の変換
// 0-15: 極端に低い / 16-35: 低い / 36-65: 普通(言及なし) / 66-85: 高い / 86-100: 極端に高い

interface ParamDescriptor {
  veryLow: string;
  low: string;
  high: string;
  veryHigh: string;
}

const DESCRIPTORS: Record<keyof NPCParams, ParamDescriptor> = {
  logic: {
    veryLow: 'まったく論理的に考えられず、完全に感情と直感で動く',
    low: 'あまり論理的でなく、感情に流されやすい',
    high: '論理的思考を重視し、合理的に判断する',
    veryHigh: '極めて論理的で、すべてを合理性で判断する。感情論を嫌う',
  },
  creativity: {
    veryLow: '極端に保守的で、決まったことしかできない',
    low: '創造性に乏しく、定型的に行動しがち',
    high: '創造的で、予想外のアイデアを出すことがある',
    veryHigh: '非常に創造的で、常識にとらわれない突飛な発想をする',
  },
  morality: {
    veryLow: '自分の利益のためなら嘘も裏切りも厭わない。罪悪感をほとんど感じない',
    low: '道徳観が薄く、自分本位で手段を選ばないところがある',
    high: '正義感が強く、嘘をつくことに抵抗がある',
    veryHigh: '非常に強い倫理観を持ち、不正を絶対に許さない。嘘をつくことができない',
  },
  empathy: {
    veryLow: '他者の感情にまったく無関心で、冷淡',
    low: 'あまり他者に共感せず、やや冷たい',
    high: '他者の気持ちを察し、助けようとする',
    veryHigh: '極めて共感力が高く、他者の痛みを自分のことのように感じる',
  },
  ambition: {
    veryLow: '野心がまったくなく、現状維持で完全に満足している',
    low: 'あまり野心がなく、穏やかに暮らしたい',
    high: '野心的で、影響力や地位を求める',
    veryHigh: '極めて野心的で権力を渇望する。支配欲に突き動かされる',
  },
  sociability: {
    veryLow: '極端に人付き合いが苦手で、孤独を強く好む',
    low: '社交性が低く、一人でいることを好む',
    high: '社交的で、積極的に人と関わる',
    veryHigh: '非常に社交的で、常に人と一緒にいたがる。孤独を嫌う',
  },
};

export function paramToPersonality(params: NPCParams): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const desc = DESCRIPTORS[key as keyof NPCParams];
    if (value <= 15) {
      parts.push(desc.veryLow);
    } else if (value <= 35) {
      parts.push(desc.low);
    } else if (value >= 86) {
      parts.push(desc.veryHigh);
    } else if (value >= 66) {
      parts.push(desc.high);
    }
    // 36-65は言及なし
  }

  return parts.join('。');
}
