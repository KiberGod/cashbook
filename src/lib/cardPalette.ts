import { resolveImage } from '../icons/builtin';
import type { FormId } from './types';

/**
 * Colours for an account card, taken from the financial service's logo: the logo's main
 * saturated hue, darkened so white text always reads on it. A logo with no real colour
 * (black, white, grey) gives a graphite card. Without a logo, or when the picture can't be
 * read (another site without CORS), the colour comes from the form of funds.
 */
export interface CardPalette {
  from: string;
  to: string;
}

const FORM_HUE: Record<FormId, number> = { cash: 152, bank: 222, crypto: 262 };

const fromHue = (h: number, s = 0.55): CardPalette => {
  const sat = Math.round(Math.min(0.75, Math.max(0.35, s)) * 100);
  return { from: `hsl(${Math.round(h)} ${sat}% 40%)`, to: `hsl(${Math.round(h + 16) % 360} ${Math.round(sat * 0.9)}% 21%)` };
};

const GRAPHITE: CardPalette = { from: 'hsl(222 9% 30%)', to: 'hsl(222 12% 12%)' };

export const formPalette = (form: FormId) => fromHue(FORM_HUE[form]);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** The palette of picture pixels; null when nothing could be read. */
function analyse(img: HTMLImageElement): CardPalette | null {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  let px: Uint8ClampedArray;
  try {
    px = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null; // a picture from another site that doesn't allow reading it
  }
  let opaque = 0;
  let weight = 0;
  let x = 0;
  let y = 0;
  let sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    opaque++;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.28 || l < 0.12 || l > 0.88) continue;
    // vivid mid-tones count most; hues are averaged on the circle
    const w = s * (1 - Math.abs(l - 0.5) * 1.4);
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
    sat += s * w;
    weight += w;
  }
  if (!opaque) return null;
  if (weight < opaque * 0.03) return GRAPHITE;
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return fromHue(hue, sat / weight);
}

const cache = new Map<string, Promise<CardPalette | null>>();

/** The card palette for a service picture (url or builtin:…), computed once per picture. */
export function imagePalette(image: string): Promise<CardPalette | null> {
  const src = resolveImage(image);
  if (!src) return Promise.resolve(null);
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(analyse(img));
      img.onerror = () => resolve(null);
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}
