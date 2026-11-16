import { getCatalogItem } from '../shared/catalog.ts';
import type { ActionId, AvatarConfig, Direction, ExpressionId } from '../shared/types.ts';

export type TurnaroundView = Direction | '3/4';

export interface RenderAvatarOptions {
  avatar: AvatarConfig;
  view?: TurnaroundView;
  expression?: ExpressionId;
  action?: ActionId;
  frame?: number;
  scale?: number;
}

const imageCache = new Map<string, HTMLImageElement>();
const composedCache = new Map<string, HTMLCanvasElement>();
const listeners = new Set<() => void>();

export function onSpriteLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSpriteImage(url: string): HTMLImageElement | null {
  const existing = imageCache.get(url);
  if (existing) {
    return existing.complete && existing.naturalWidth > 0 ? existing : null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    composedCache.clear();
    listeners.forEach((cb) => cb());
  };
  img.src = url;
  imageCache.set(url, img);
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return [0, 0, 0];
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function getSpriteUrl(
  gender: AvatarConfig['gender'],
  view: TurnaroundView,
  action: ActionId
): string {
  const folder = gender === 'feminino' ? 'female' : 'male';
  if (action !== 'parado') {
    return `/assets/sprites/${folder}/act_${action}.png`;
  }
  if (view === '3/4') return `/assets/sprites/${folder}/view_34.png`;
  return `/assets/sprites/${folder}/view_${view}.png`;
}

export function getExpressionSpriteUrl(
  gender: AvatarConfig['gender'],
  expression: ExpressionId
): string {
  const folder = gender === 'feminino' ? 'female' : 'male';
  return `/assets/sprites/${folder}/exp_${expression}.png`;
}

/**
 * Composites the exact user pixel-art character sprite with optional skin tone,
 * hair color, facial expression head, and clothing/accessory layers.
 */
function getComposedSprite(
  avatar: AvatarConfig,
  view: TurnaroundView,
  action: ActionId,
  expression: ExpressionId
): HTMLCanvasElement | null {
  const spriteUrl = getSpriteUrl(avatar.gender, view, action);
  const baseImg = getSpriteImage(spriteUrl);
  if (!baseImg) return null;

  // Optionally composite expression head when standing/idle in front or 3/4 view
  const canOverlayExp =
    expression !== 'normal' &&
    (action === 'parado' || action === 'andando' || action === 'acenando' || action === 'pensando') &&
    (view === 'frente' || view === '3/4');

  const expUrl = canOverlayExp ? getExpressionSpriteUrl(avatar.gender, expression) : null;
  const expImg = expUrl ? getSpriteImage(expUrl) : null;

  const key = [
    spriteUrl,
    expUrl && expImg ? expUrl : 'noexp',
    avatar.skinTone,
    avatar.hairColor,
    avatar.shirtId || '',
    avatar.pantsId || '',
    avatar.shoesId || '',
    avatar.accessoryId || '',
  ].join('|');

  const cached = composedCache.get(key);
  if (cached) return cached;

  const w = baseImg.naturalWidth;
  const h = baseImg.naturalHeight;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(baseImg, 0, 0);

  // Overlay expression head onto front/3-4 standing character if loaded
  if (expImg && action === 'parado') {
    const headRatio = avatar.gender === 'feminino' ? 0.42 : 0.40;
    const targetHeadH = Math.round(h * headRatio);
    const targetHeadW = Math.round((expImg.naturalWidth / expImg.naturalHeight) * targetHeadH);
    const hx = Math.round((w - targetHeadW) / 2);
    octx.drawImage(expImg, hx, 0, targetHeadW, targetHeadH);
  }

  // Pixel-level recoloring & garment layering preserving exact dark outlines
  const defaultSkin = '#e09664';
  const defaultHair = avatar.gender === 'feminino' ? '#4a2c20' : '#1e1b26';
  const recolorSkin = avatar.skinTone.toLowerCase() !== defaultSkin;
  const recolorHair = avatar.hairColor.toLowerCase() !== defaultHair;

  const shirt = getCatalogItem(avatar.shirtId);
  const pants = getCatalogItem(avatar.pantsId);
  const shoes = getCatalogItem(avatar.shoesId);
  const acc = getCatalogItem(avatar.accessoryId);

  const hasCustomShirt =
    shirt &&
    shirt.shape !== 'none' &&
    shirt.id !== 'shirt_top_branco';
  const hasCustomPants =
    pants && pants.id !== 'pants_shorts_branco';
  const hasCustomShoes =
    shoes && shoes.id !== 'shoes_chinelo';

  if (recolorSkin || recolorHair || hasCustomShirt || hasCustomPants || hasCustomShoes) {
    const imgData = octx.getImageData(0, 0, w, h);
    const d = imgData.data;

    const [sr, sg, sb] = hexToRgb(avatar.skinTone);
    const [dsr, dsg, dsb] = hexToRgb(defaultSkin);
    const [hr, hg, hb] = hexToRgb(avatar.hairColor);
    const [shr, shg, shb] = shirt ? hexToRgb(shirt.primaryColor) : [0, 0, 0];
    const [sh2r, sh2g, sh2b] = shirt ? hexToRgb(shirt.accentColor) : [0, 0, 0];
    const [pr, pg, pb] = pants ? hexToRgb(pants.primaryColor) : [0, 0, 0];
    const [cr, cg, cb] = shoes ? hexToRgb(shoes.primaryColor) : [0, 0, 0];

    const isLying = action === 'deitado';
    const isSitting = action === 'sentado';

    const torsoTop = isLying ? 0.35 : isSitting ? 0.42 : 0.42;
    const torsoBot = isLying ? 0.65 : isSitting ? 0.68 : 0.62;
    const pantsTop = isLying ? 0.60 : isSitting ? 0.66 : 0.61;
    const pantsBot = isLying ? 0.85 : isSitting ? 0.90 : pants?.shape === 'pants' ? 0.87 : 0.74;
    const shoesTop = 0.88;

    for (let y = 0; y < h; y++) {
      const yn = y / h;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = d[i + 3];
        if (a < 30) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        // Protect pure dark pixel-art outlines
        if (r < 28 && g < 24 && b < 32) continue;

        // Skin tone detection (warm peach/orange pixels R > G > B)
        const isSkinPixel = r > 125 && g > 65 && b < g && r - b >= 35;

        // Hair detection (top 40% of sprite, non-skin, non-white, dark/brown tones)
        const isHairPixel =
          yn < 0.40 &&
          !isSkinPixel &&
          !(r > 190 && g > 190 && b > 190) &&
          !(r > 180 && g < 90); // protect heart/red effects

        // White swimwear/shorts pixels (neutral bright grey/white)
        const isWhiteCloth = r > 155 && g > 155 && b > 160 && Math.abs(r - g) < 28;

        // 1. Clothing Layers (Torso Shirt)
        if (hasCustomShirt && shirt && yn >= torsoTop && yn <= torsoBot) {
          const xn = x / w;
          // Keep hands/edges outside torso width untouched for tee/crop
          const inTorsoCore = xn > 0.24 && xn < 0.76;
          if (inTorsoCore && (isSkinPixel || isWhiteCloth)) {
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 215;
            // Subtle center stripe/emblem accent
            const isEmblem =
              (shirt.shape === 'jacket' && Math.abs(xn - 0.5) < 0.05) ||
              (shirt.shape === 'hoodie' && yn > 0.48 && yn < 0.55 && Math.abs(xn - 0.5) < 0.12);
            const [tr, tg, tb] = isEmblem ? [sh2r, sh2g, sh2b] : [shr, shg, shb];
            d[i] = clampByte(tr * lum);
            d[i + 1] = clampByte(tg * lum);
            d[i + 2] = clampByte(tb * lum);
            continue;
          }
        }

        // 2. Pants / Shorts / Skirt Layer
        if (hasCustomPants && pants && yn >= pantsTop && yn <= pantsBot) {
          const xn = x / w;
          const inLegs = xn > 0.24 && xn < 0.76;
          if (inLegs && (isWhiteCloth || (pants.shape === 'pants' && isSkinPixel))) {
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 215;
            d[i] = clampByte(pr * lum);
            d[i + 1] = clampByte(pg * lum);
            d[i + 2] = clampByte(pb * lum);
            continue;
          }
        }

        // 3. Shoes Layer
        if (hasCustomShoes && shoes && yn >= shoesTop) {
          if (isWhiteCloth || (shoes.shape !== 'sandal' && isSkinPixel)) {
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 210;
            d[i] = clampByte(cr * lum);
            d[i + 1] = clampByte(cg * lum);
            d[i + 2] = clampByte(cb * lum);
            continue;
          }
        }

        // 4. Skin Tint
        if (recolorSkin && isSkinPixel) {
          d[i] = clampByte((r / dsr) * sr);
          d[i + 1] = clampByte((g / dsg) * sg);
          d[i + 2] = clampByte((b / dsb) * sb);
          continue;
        }

        // 5. Hair Tint
        if (recolorHair && isHairPixel) {
          const lum = Math.max(0.25, (r * 0.3 + g * 0.59 + b * 0.11) / 72);
          d[i] = clampByte(hr * lum);
          d[i + 1] = clampByte(hg * lum);
          d[i + 2] = clampByte(hb * lum);
        }
      }
    }
    octx.putImageData(imgData, 0, 0);
  }

  // 6. Accessory pixel overlays (sunglasses / cap / headphones / crown)
  if (acc && action !== 'deitado') {
    if (acc.shape === 'glasses' && view !== 'costas') {
      octx.fillStyle = '#09090b';
      const gy = Math.round(h * 0.23);
      const gw = Math.round(w * 0.34);
      const gh = Math.max(4, Math.round(h * 0.045));
      octx.fillRect(Math.round(w * 0.32), gy, gw, gh);
      octx.fillStyle = acc.accentColor;
      octx.fillRect(Math.round(w * 0.35), gy + 1, Math.max(2, Math.round(gw * 0.18)), Math.max(2, Math.round(gh * 0.4)));
    } else if (acc.shape === 'crown') {
      const cw = Math.round(w * 0.36);
      const ch = Math.max(8, Math.round(h * 0.07));
      const cx = Math.round((w - cw) / 2);
      octx.fillStyle = acc.primaryColor;
      octx.fillRect(cx, 2, cw, ch);
      octx.fillStyle = acc.accentColor;
      octx.fillRect(Math.round(w / 2) - 2, 4, 4, 4);
    } else if (acc.shape === 'cap') {
      const cw = Math.round(w * 0.56);
      const ch = Math.max(8, Math.round(h * 0.09));
      const cx = Math.round((w - cw) / 2);
      octx.fillStyle = acc.primaryColor;
      octx.fillRect(cx, 2, cw, ch);
      octx.fillStyle = acc.accentColor;
      octx.fillRect(cx - 4, 2 + ch - 3, cw + 8, 4);
    } else if (acc.shape === 'headphones') {
      const cw = Math.round(w * 0.58);
      const cx = Math.round((w - cw) / 2);
      octx.fillStyle = acc.primaryColor;
      octx.fillRect(cx, 3, cw, 5);
      octx.fillStyle = acc.secondaryColor;
      octx.fillRect(cx - 3, Math.round(h * 0.17), 7, Math.round(h * 0.09));
      octx.fillRect(cx + cw - 4, Math.round(h * 0.17), 7, Math.round(h * 0.09));
    }
  }

  composedCache.set(key, off);
  return off;
}

/**
 * Draws the user's pixel-art OASIS character sprite onto any Canvas 2D context.
 * `originX, originY` is the top-left of a virtual 32x48 character box scaled by `scale`
 * (kept compatible with IsometricWorld and PixelAvatarPreview!).
 */
export function drawPixelAvatar(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  opts: RenderAvatarOptions
) {
  const {
    avatar,
    view = 'frente',
    expression = 'normal',
    action = 'parado',
    frame = 0,
    scale = 2,
  } = opts;

  const boxW = 32 * scale;
  const boxH = 48 * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Ground shadow
  ctx.fillStyle = 'rgba(10, 6, 24, 0.42)';
  ctx.beginPath();
  ctx.ellipse(
    originX + boxW / 2,
    originY + boxH - 2 * scale,
    9 * scale,
    3 * scale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  const composed = getComposedSprite(avatar, view, action, expression);
  if (!composed) {
    ctx.restore();
    return;
  }

  // Subtle rhythmic animation offsets matching action
  const tick = Math.floor(frame);
  const bob =
    action === 'andando' || action === 'correndo'
      ? -Math.abs(Math.sin(tick * 0.45)) * 2.5 * scale
      : action === 'pulando'
      ? -Math.abs(Math.sin(tick * 0.35)) * 5 * scale
      : action === 'dancando'
      ? -Math.abs(Math.sin(tick * 0.4)) * 2 * scale
      : 0;

  const targetH = action === 'deitado' ? boxH * 0.56 : action === 'sentado' ? boxH * 0.78 : boxH * 1.05;
  const targetW = (composed.width / composed.height) * targetH;

  const drawX = Math.round(originX + (boxW - targetW) / 2);
  const drawY = Math.round(originY + boxH - targetH - 2 * scale + bob);

  if (view === 'esquerda' && action !== 'parado') {
    ctx.translate(drawX + targetW / 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(composed, -targetW / 2, drawY, targetW, targetH);
  } else {
    ctx.drawImage(composed, drawX, drawY, targetW, targetH);
  }

  ctx.restore();
}
