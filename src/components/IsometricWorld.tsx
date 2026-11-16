import React, { useEffect, useRef, useState } from 'react';
import {
  Armchair,
  Blocks,
  Coffee,
  Compass,
  DoorOpen,
  Droplets,
  Edit3,
  HeartHandshake,
  Home,
  RotateCw,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  ROOM_THEMES,
  ROOMS_META,
  STARTER_PLOT_MAX_BLOCKS,
  createStarterPlotTiles,
  getCatalogItem,
} from '../shared/catalog.ts';
import type {
  ActionId,
  Direction,
  InventoryItem,
  PlacedFurniture,
  RoomId,
  RoomTheme,
  SpaceInfoPayload,
  WorldPlayer,
} from '../shared/types.ts';
import { drawPixelAvatar } from '../utils/pixelAvatarRenderer.ts';
import { PixelAvatarPreview } from './PixelAvatarPreview.tsx';
import { ItemThumbnail } from './ItemThumbnail.tsx';
import { soundFX } from '../utils/sound.ts';

interface IsometricWorldProps {
  roomKey: string;
  currentPlayerId: string;
  players: WorldPlayer[];
  spaceInfo: SpaceInfoPayload | null;
  myInventory: InventoryItem[];
  myFriends: Array<{ id: string; name: string }>;
  onMove: (x: number, y: number, direction: Direction, action: ActionId, steps: number) => void;
  onChangeRoom: (targetRoomKey: string) => void;
  onFurnish: (
    op: 'place' | 'remove' | 'rotate' | 'theme',
    data: { instanceId?: string; x?: number; y?: number; rotation?: number; theme?: RoomTheme }
  ) => void;
  onBuildTile: (x: number, y: number) => void;
  onRoutineAction: (actionType: string) => void;
  onAddFriend: (friendId: string, friendName: string) => void;
  onStartTrade: (targetPlayer: WorldPlayer) => void;
  onOpenShop: () => void;
  onOpenMinigames: () => void;
}

const GRID_SIZE = 12;
const PRACA_W = 1240;
const PRACA_H = 816;
const PRACA_MAP_URL = '/assets/maps/praca_central_clean.png';

interface InteractiveProp {
  x: number;
  y: number;
  kind: 'bench' | 'portal' | 'shop_kiosk' | 'job_kiosk' | 'food_kiosk';
  label: string;
  targetRoom?: RoomId;
  routineAction?: string;
}

interface PracaHotspot {
  id: string;
  kind: 'portal' | 'bench' | 'catalog';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
  targetRoom?: RoomId;
  sitPos?: { px: number; py: number; dir: Direction };
}

const PRACA_HOTSPOTS: PracaHotspot[] = [
  // Building Entrances
  {
    id: 'portal_balada',
    kind: 'portal',
    x0: 30,
    y0: 155,
    x1: 262,
    y1: 495,
    label: 'Entrar na Balada Neon',
    targetRoom: 'balada',
  },
  {
    id: 'portal_shopping',
    kind: 'catalog',
    x0: 255,
    y0: 10,
    x1: 525,
    y1: 225,
    label: 'Abrir Catálogo OASIS',
  },
  {
    id: 'portal_cafeteria',
    kind: 'portal',
    x0: 618,
    y0: 10,
    x1: 842,
    y1: 228,
    label: 'Entrar na Cafeteria Aroma',
    targetRoom: 'cafeteria',
  },
  {
    id: 'portal_mercado',
    kind: 'portal',
    x0: 975,
    y0: 25,
    x1: 1235,
    y1: 335,
    label: 'Entrar no Mercado da Vila',
    targetRoom: 'mercado',
  },
  // Plaza Benches
  {
    id: 'bench_tl',
    kind: 'bench',
    x0: 562,
    y0: 318,
    x1: 662,
    y1: 386,
    label: 'Sentar no banco da Fonte',
    sitPos: { px: 612, py: 365, dir: 'frente' },
  },
  {
    id: 'bench_tr',
    kind: 'bench',
    x0: 800,
    y0: 320,
    x1: 896,
    y1: 386,
    label: 'Sentar no banco Nordeste',
    sitPos: { px: 848, py: 362, dir: 'frente' },
  },
  {
    id: 'bench_bot',
    kind: 'bench',
    x0: 612,
    y0: 534,
    x1: 736,
    y1: 614,
    label: 'Sentar no banco Sul',
    sitPos: { px: 676, py: 585, dir: 'frente' },
  },
  {
    id: 'bench_street',
    kind: 'bench',
    x0: 866,
    y0: 696,
    x1: 974,
    y1: 768,
    label: 'Sentar no banco da Rua',
    sitPos: { px: 922, py: 728, dir: 'frente' },
  },
];

// Convert server world coords (0..11) <-> Praça artwork native pixels (0..1240, 0..816)
function gridToPracaPx(gx: number, gy: number) {
  return {
    px: (gx / 11) * PRACA_W,
    py: (gy / 11) * PRACA_H,
  };
}

function pracaPxToGrid(px: number, py: number) {
  return {
    x: Number(Math.max(0, Math.min(11, (px / PRACA_W) * 11)).toFixed(2)),
    y: Number(Math.max(0, Math.min(11, (py / PRACA_H) * 11)).toFixed(2)),
  };
}

function isPointInsidePracaObstacle(px: number, py: number): boolean {
  // Keep within plaza cobblestone plaza bounds
  if (px < 235 || px > 1130 || py < 210 || py > 750) {
    // Allow Balada entrance forecourt
    if (px >= 175 && px <= 265 && py >= 375 && py <= 465) return false;
    return true;
  }

  // Central Fountain & Flower Ring oval
  const fx = (px - 728) / 146;
  const fy = (py - 492) / 110;
  if (fx * fx + fy * fy < 1) return true;

  // Planter beds & sidewalk props
  const boxes: Array<[number, number, number, number]> = [
    [425, 420, 545, 520], // Left fountain flower bed
    [395, 550, 520, 635], // Lower-left flower bed
    [285, 610, 415, 710], // Lamp/trash planter corner
    [590, 212, 692, 285], // Cafeteria outdoor umbrella table
    [942, 565, 1068, 705], // Hotdog cart
    [1085, 430, 1235, 735], // Red phone booth + right bushes
    [562, 318, 662, 378], // Bench TL backrest (sit hotspot overrides)
    [800, 320, 896, 378], // Bench TR backrest
    [612, 534, 736, 598], // Bench South
    [728, 650, 775, 755], // South lamp & bush island
  ];

  for (const [x0, y0, x1, y1] of boxes) {
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return true;
  }
  return false;
}

function findNearestWalkablePraca(targetPx: number, targetPy: number): { px: number; py: number } {
  const clampedPx = Math.max(235, Math.min(1130, targetPx));
  const clampedPy = Math.max(215, Math.min(745, targetPy));
  if (!isPointInsidePracaObstacle(clampedPx, clampedPy)) {
    return { px: clampedPx, py: clampedPy };
  }
  for (let r = 14; r <= 180; r += 14) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const tx = Math.round(clampedPx + Math.cos(ang) * r);
      const ty = Math.round(clampedPy + Math.sin(ang) * r);
      if (!isPointInsidePracaObstacle(tx, ty)) {
        return { px: tx, py: ty };
      }
    }
  }
  return { px: 565, py: 520 };
}

function getRoomProps(roomId: RoomId): InteractiveProp[] {
  if (roomId === 'balada') {
    return [
      { x: 5, y: 10, kind: 'portal', label: 'Voltar para Praça', targetRoom: 'praca' },
      { x: 2, y: 4, kind: 'bench', label: 'Sofá VIP' },
      { x: 9, y: 4, kind: 'bench', label: 'Sofá VIP' },
      { x: 5, y: 3, kind: 'job_kiosk', label: 'Trabalhar de DJ (F2P)' },
    ];
  }
  if (roomId === 'cafeteria') {
    return [
      { x: 5, y: 10, kind: 'portal', label: 'Voltar para Praça', targetRoom: 'praca' },
      { x: 3, y: 5, kind: 'bench', label: 'Mesa de Café' },
      { x: 8, y: 6, kind: 'bench', label: 'Mesa de Café' },
      { x: 5, y: 3, kind: 'job_kiosk', label: 'Trabalhar de Barista (F2P)' },
      { x: 7, y: 3, kind: 'food_kiosk', label: 'Tomar Café (-8m)', routineAction: 'lanche_cafeteria' },
    ];
  }
  if (roomId === 'mercado') {
    return [
      { x: 5, y: 10, kind: 'portal', label: 'Voltar para Praça', targetRoom: 'praca' },
      { x: 5, y: 3, kind: 'job_kiosk', label: 'Fazer Entregas (F2P)' },
      { x: 7, y: 3, kind: 'food_kiosk', label: 'Comer Frutas (-8m)', routineAction: 'frutas_mercado' },
    ];
  }
  return [{ x: 5, y: 10, kind: 'portal', label: 'Sair para Praça', targetRoom: 'praca' }];
}

function isBlockedTile(roomId: RoomId, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x > 10 || y > 10) return true;
  if (roomId === 'praca') {
    const { px, py } = gridToPracaPx(x, y);
    return isPointInsidePracaObstacle(px, py);
  }
  return false;
}

export const IsometricWorld: React.FC<IsometricWorldProps> = ({
  roomKey,
  currentPlayerId,
  players,
  spaceInfo,
  myInventory,
  myFriends,
  onMove,
  onChangeRoom,
  onFurnish,
  onBuildTile,
  onRoutineAction,
  onAddFriend,
  onStartTrade,
  onOpenShop,
  onOpenMinigames,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pracaImgRef = useRef<HTMLImageElement | null>(null);
  const furnitureImgsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [pracaImgLoaded, setPracaImgLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 960, h: 620 });

  const baseRoomId = (roomKey.startsWith('espaco') ? 'espaco' : roomKey) as RoomId;
  const isOwnSpace = roomKey === `espaco:${currentPlayerId}`;
  const roomMeta = ROOMS_META[baseRoomId] || ROOMS_META.praca;

  const [editMode, setEditMode] = useState(false);
  const [buildTab, setBuildTab] = useState<'mobiliar' | 'terreno'>('terreno');
  const [placingInstanceId, setPlacingInstanceId] = useState<string | null>(null);
  const [selectedFurnId, setSelectedFurnId] = useState<string | null>(null);
  const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);
  const [hoveredHotspot, setHoveredHotspot] = useState<PracaHotspot | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<WorldPlayer | null>(null);

  const visualPosRef = useRef<Record<string, { vx: number; vy: number }>>({});
  const playersRef = useRef<WorldPlayer[]>(players);
  playersRef.current = players;

  const hoverTileRef = useRef(hoverTile);
  hoverTileRef.current = hoverTile;

  const hoveredHotspotRef = useRef<PracaHotspot | null>(hoveredHotspot);
  hoveredHotspotRef.current = hoveredHotspot;

  const spaceInfoRef = useRef(spaceInfo);
  spaceInfoRef.current = spaceInfo;

  const buildTabRef = useRef(buildTab);
  buildTabRef.current = buildTab;

  // Preload exact user Praça Central mockup artwork
  useEffect(() => {
    const img = new Image();
    img.src = PRACA_MAP_URL;
    img.onload = () => {
      pracaImgRef.current = img;
      setPracaImgLoaded(true);
    };
  }, []);

  useEffect(() => {
    if (!isOwnSpace) {
      setEditMode(false);
      setPlacingInstanceId(null);
      setSelectedFurnId(null);
    }
  }, [isOwnSpace, roomKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(280, Math.floor(entry.contentRect.width));
        const h = Math.max(220, Math.floor(entry.contentRect.height));
        setCanvasSize({ w, h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute exact Praça transform (aspect-fit centered cleanly so every building/hotspot aligns)
  const getPracaTransform = (cw: number, ch: number) => {
    const scale = Math.min(cw / PRACA_W, ch / PRACA_H);
    const drawW = PRACA_W * scale;
    const drawH = PRACA_H * scale;
    const ox = (cw - drawW) / 2;
    const oy = (ch - drawH) / 2;
    return { scale, drawW, drawH, ox, oy };
  };

  // Keyboard WASD / Arrow movement
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const me = playersRef.current.find((p) => p.id === currentPlayerId);
      if (!me) return;

      let dx = 0;
      let dy = 0;
      let dir: Direction = me.direction;

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        dy = -1;
        dir = 'costas';
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        dy = 1;
        dir = 'frente';
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        dx = -1;
        dir = 'esquerda';
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        dx = 1;
        dir = 'direita';
      } else {
        return;
      }

      e.preventDefault();

      if (baseRoomId === 'praca') {
        const cur = gridToPracaPx(me.x, me.y);
        const stepPx = 38;
        const targetPx = cur.px + dx * stepPx;
        const targetPy = cur.py + dy * stepPx;
        if (!isPointInsidePracaObstacle(targetPx, targetPy)) {
          const g = pracaPxToGrid(targetPx, targetPy);
          soundFX.playStep();
          onMove(g.x, g.y, dir, 'andando', 1);
        }
        return;
      }

      if (baseRoomId === 'espaco') {
        const plotTiles = spaceInfoRef.current?.plotTiles || createStarterPlotTiles();
        const nx = Math.max(0, Math.min(11, Math.round(me.x) + dx));
        const ny = Math.max(0, Math.min(11, Math.round(me.y) + dy));
        if (plotTiles.includes(`${nx},${ny}`)) {
          soundFX.playStep();
          onMove(nx, ny, dir, 'andando', 1);
        }
        return;
      }

      const nx = Math.max(1, Math.min(10, Math.round(me.x) + dx));
      const ny = Math.max(1, Math.min(10, Math.round(me.y) + dy));
      if (!isBlockedTile(baseRoomId, nx, ny)) {
        soundFX.playStep();
        onMove(nx, ny, dir, 'andando', 1);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPlayerId, baseRoomId, onMove]);

  // Isometric math for indoor rooms (fits cleanly on PC and Mobile)
  const tileW = Math.min(
    76,
    Math.max(28, Math.floor(Math.min(canvasSize.w / 13.2, (canvasSize.h * 0.74) / 6.6)))
  );
  const tileH = Math.floor(tileW * 0.5);
  const originX = Math.floor(canvasSize.w / 2);
  const originY = Math.floor(Math.max(84, canvasSize.h * 0.24));

  const gridToScreen = (gx: number, gy: number) => ({
    sx: originX + (gx - gy) * (tileW / 2),
    sy: originY + (gx + gy) * (tileH / 2),
  });

  const screenToGrid = (sx: number, sy: number) => {
    const rx = sx - originX;
    const ry = sy - originY;
    const gx = Math.floor((rx / (tileW / 2) + ry / (tileH / 2)) / 2);
    const gy = Math.floor((ry / (tileH / 2) - rx / (tileW / 2)) / 2);
    return { x: gx, y: gy };
  };

  // Main Render Loop
  useEffect(() => {
    let rafId = 0;
    let tick = 0;

    const drawIsoTile = (
      ctx: CanvasRenderingContext2D,
      gx: number,
      gy: number,
      fill: string,
      stroke = 'rgba(15,23,42,0.28)',
      elevation = 0
    ) => {
      const { sx, sy } = gridToScreen(gx, gy);
      const y = sy - elevation;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + tileW / 2, y + tileH / 2);
      ctx.lineTo(sx, y + tileH);
      ctx.lineTo(sx - tileW / 2, y + tileH / 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const drawIsoBox = (
      ctx: CanvasRenderingContext2D,
      gx: number,
      gy: number,
      height: number,
      topColor: string,
      leftColor: string,
      rightColor: string
    ) => {
      const { sx, sy } = gridToScreen(gx, gy);
      const hw = tileW / 2;
      const hh = tileH / 2;

      ctx.beginPath();
      ctx.moveTo(sx, sy - height);
      ctx.lineTo(sx + hw, sy + hh - height);
      ctx.lineTo(sx, sy + tileH - height);
      ctx.lineTo(sx - hw, sy + hh - height);
      ctx.closePath();
      ctx.fillStyle = topColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx - hw, sy + hh - height);
      ctx.lineTo(sx, sy + tileH - height);
      ctx.lineTo(sx, sy + tileH);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.closePath();
      ctx.fillStyle = leftColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx, sy + tileH - height);
      ctx.lineTo(sx + hw, sy + hh - height);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.lineTo(sx, sy + tileH);
      ctx.closePath();
      ctx.fillStyle = rightColor;
      ctx.fill();
    };

    const getFurnSprite = (url: string): HTMLImageElement | null => {
      const cache = furnitureImgsRef.current;
      let img = cache.get(url);
      if (!img) {
        img = new Image();
        img.src = url;
        cache.set(url, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    };

    const drawFurniturePiece = (
      ctx: CanvasRenderingContext2D,
      furn: PlacedFurniture,
      isSelected: boolean
    ) => {
      const item = getCatalogItem(furn.itemId);
      if (!item) return;
      const { sx, sy } = gridToScreen(furn.x, furn.y);

      if (isSelected) {
        drawIsoTile(ctx, furn.x, furn.y, 'rgba(251, 191, 36, 0.28)', '#fbbf24', 1);
      }

      if (item.spriteUrl) {
        const sprite = getFurnSprite(item.spriteUrl);
        if (sprite) {
          // Subtle shadow for non-rug items
          if (item.shape !== 'rug') {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
            ctx.beginPath();
            ctx.ellipse(sx, sy + tileH * 0.56, tileW * 0.28, tileH * 0.28, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // Scale sprite proportionally to tileW (sprites range ~40..295px natively)
          const unitScale = Math.max(0.32, Math.min(0.62, tileW / 128));
          const maxBox = tileW * 1.48;
          let drawW = sprite.naturalWidth * unitScale;
          let drawH = sprite.naturalHeight * unitScale;
          if (drawW > maxBox) {
            const ratio = maxBox / drawW;
            drawW *= ratio;
            drawH *= ratio;
          }

          const anchorY = item.shape === 'rug' ? sy + tileH * 0.5 + drawH * 0.45 : sy + tileH * 0.68;
          const flipX = furn.rotation === 90 || furn.rotation === 270;

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(Math.round(sx), Math.round(anchorY));
          if (flipX) ctx.scale(-1, 1);
          ctx.drawImage(sprite, Math.round(-drawW / 2), Math.round(-drawH), Math.round(drawW), Math.round(drawH));
          ctx.restore();
          return;
        }
      }

      // Minimal fallback while PNG loads
      drawIsoBox(ctx, furn.x, furn.y, 14, item.primaryColor, item.secondaryColor, '#1e1b4b');
    };

    const drawSignLabel = (
      ctx: CanvasRenderingContext2D,
      gx: number,
      gy: number,
      text: string,
      bg: string,
      border: string,
      textColor = '#ffffff',
      yOffset = -54
    ) => {
      const { sx, sy } = gridToScreen(gx, gy);
      ctx.font = 'bold 11px Silkscreen, monospace';
      const w = ctx.measureText(text).width + 16;
      const x = Math.round(sx - w / 2);
      const y = Math.round(sy + yOffset);
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, 20);
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, 20);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.fillText(text, sx, y + 14);
    };

    const drawPlayerNameAndBubble = (
      ctx: CanvasRenderingContext2D,
      sx: number,
      topY: number,
      pl: WorldPlayer,
      now: number
    ) => {
      const labelY = topY - 8;
      ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
      const nameW = ctx.measureText(pl.name).width + 14;
      ctx.fillStyle =
        pl.id === currentPlayerId
          ? 'rgba(245, 158, 11, 0.94)'
          : pl.isNpc
          ? 'rgba(20, 26, 54, 0.88)'
          : 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(Math.round(sx - nameW / 2), labelY - 15, nameW, 17);
      ctx.strokeStyle =
        pl.id === currentPlayerId ? '#fef08a' : pl.isNpc ? 'rgba(168,85,247,0.55)' : 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(sx - nameW / 2), labelY - 15, nameW, 17);
      ctx.fillStyle = pl.id === currentPlayerId ? '#0f172a' : '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(pl.name, sx, labelY - 2);

      const showBubble = pl.bubbleText && (!pl.bubbleExpiresAt || pl.bubbleExpiresAt > now);
      if (showBubble && pl.bubbleText) {
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        const text = pl.bubbleText.slice(0, 42);
        const bw = Math.max(64, ctx.measureText(text).width + 18);
        const bx = Math.round(sx - bw / 2);
        const by = labelY - 43;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, bw, 22);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, 22);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx - 3, by + 21, 6, 4);

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.fillText(text, sx, by + 15);
      }
    };

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      tick += 0.14;
      const now = Date.now();

      // Clear deep twilight canvas background
      ctx.fillStyle = '#0d1022';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // ============================================================
      // 1) PRAÇA CENTRAL — EXACT USER MOCKUP WORLD
      // ============================================================
      if (baseRoomId === 'praca') {
        const tf = getPracaTransform(canvas.width, canvas.height);
        const mapImg = pracaImgRef.current;

        if (mapImg && mapImg.complete) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(mapImg, tf.ox, tf.oy, tf.drawW, tf.drawH);

          // Living ambient fountain water shimmer
          const fcx = tf.ox + 728 * tf.scale;
          const fcy = tf.oy + 492 * tf.scale;
          const pulse = Math.sin(tick * 0.45);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(56, 189, 248, ${0.09 + 0.04 * pulse})`;
          ctx.beginPath();
          ctx.ellipse(fcx, fcy, 62 * tf.scale, 34 * tf.scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(224, 242, 254, ${0.14 + 0.08 * pulse})`;
          ctx.beginPath();
          ctx.arc(fcx, tf.oy + (404 + pulse * 2) * tf.scale, 8 * tf.scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = '#151a36';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Carregando Praça Central...', canvas.width / 2, canvas.height / 2);
        }

        // Hover highlight on interactive mockup landmarks / benches / city NPCs
        const hs = hoveredHotspotRef.current;
        if (hs) {
          const hx = tf.ox + hs.x0 * tf.scale;
          const hy = tf.oy + hs.y0 * tf.scale;
          const hw = (hs.x1 - hs.x0) * tf.scale;
          const hh = (hs.y1 - hs.y0) * tf.scale;
          ctx.save();
          ctx.strokeStyle =
            hs.kind === 'portal'
              ? 'rgba(251, 191, 36, 0.9)'
              : hs.kind === 'bench'
              ? 'rgba(56, 189, 248, 0.9)'
              : 'rgba(192, 132, 252, 0.9)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(hx, hy, hw, hh);
          ctx.fillStyle =
            hs.kind === 'portal'
              ? 'rgba(251, 191, 36, 0.08)'
              : hs.kind === 'bench'
              ? 'rgba(56, 189, 248, 0.12)'
              : 'rgba(192, 132, 252, 0.12)';
          ctx.fillRect(hx, hy, hw, hh);
          ctx.restore();
        }

        // Real Human Players (yourself + online WebSocket players) walking on Praça!
        const humanPlayers = playersRef.current.filter((p) => !p.isNpc);
        const renderHumans: Array<{ pl: WorldPlayer; vx: number; vy: number; sx: number; sy: number }> = [];

        for (const pl of humanPlayers) {
          const cur = visualPosRef.current[pl.id] || { vx: pl.x, vy: pl.y };
          cur.vx += (pl.x - cur.vx) * 0.18;
          cur.vy += (pl.y - cur.vy) * 0.18;
          visualPosRef.current[pl.id] = cur;

          const pxy = gridToPracaPx(cur.vx, cur.vy);
          const sx = tf.ox + pxy.px * tf.scale;
          const sy = tf.oy + pxy.py * tf.scale;
          renderHumans.push({ pl, vx: cur.vx, vy: cur.vy, sx, sy });
        }

        renderHumans.sort((a, b) => a.sy - b.sy);

        for (const item of renderHumans) {
          const { pl, vx, vy, sx, sy } = item;
          const isMoving = Math.abs(pl.x - vx) > 0.08 || Math.abs(pl.y - vy) > 0.08;
          const avatarScale = Math.max(1.25, 2.15 * tf.scale);
          const drawW = 32 * avatarScale;
          const drawH = 48 * avatarScale;
          const drawX = Math.round(sx - drawW / 2);
          const drawY = Math.round(sy - drawH + 2 * avatarScale);

          drawPixelAvatar(ctx, drawX, drawY, {
            avatar: pl.avatar,
            view: pl.direction,
            expression: pl.expression,
            action: isMoving ? 'andando' : pl.action,
            frame: tick,
            scale: avatarScale,
          });

          drawPlayerNameAndBubble(ctx, sx, drawY, pl, now);
        }

        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      // ============================================================
      // 2) INDOOR ROOMS (Shopping, Balada, Cafeteria, Mercado, Nosso Espaço)
      // ============================================================
      ctx.imageSmoothingEnabled = false;
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, '#0f0b24');
      bgGrad.addColorStop(1, '#191438');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (let i = 0; i < 24; i++) {
        const starX = (i * 137) % canvas.width;
        const starY = (i * 73) % Math.floor(canvas.height * 0.45);
        ctx.fillRect(starX, starY, 2, 2);
      }

      let floorA = roomMeta.floorPrimary;
      let floorB = roomMeta.floorSecondary;
      let wallCol = roomMeta.wallColor;
      if (baseRoomId === 'espaco' && spaceInfoRef.current) {
        const th = ROOM_THEMES.find((t) => t.id === spaceInfoRef.current?.theme);
        if (th) {
          floorA = th.floorA;
          floorB = th.floorB;
          wallCol = th.wall;
        }
      }

      // Back walls
      const topCorner = gridToScreen(0, 0);
      const leftCorner = gridToScreen(0, GRID_SIZE);
      const rightCorner = gridToScreen(GRID_SIZE, 0);

      ctx.beginPath();
      ctx.moveTo(topCorner.sx, topCorner.sy - 88);
      ctx.lineTo(leftCorner.sx, leftCorner.sy - 88);
      ctx.lineTo(leftCorner.sx, leftCorner.sy);
      ctx.lineTo(topCorner.sx, topCorner.sy);
      ctx.closePath();
      ctx.fillStyle = wallCol;
      ctx.fill();
      ctx.strokeStyle = 'rgba(168,85,247,0.35)';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(topCorner.sx, topCorner.sy - 88);
      ctx.lineTo(rightCorner.sx, rightCorner.sy - 88);
      ctx.lineTo(rightCorner.sx, rightCorner.sy);
      ctx.lineTo(topCorner.sx, topCorner.sy);
      ctx.closePath();
      ctx.fillStyle = wallCol;
      ctx.fill();
      ctx.stroke();

      const espacoPlotTiles =
        baseRoomId === 'espaco'
          ? new Set(spaceInfoRef.current?.plotTiles || createStarterPlotTiles())
          : null;

      for (let gx = 0; gx < GRID_SIZE; gx++) {
        for (let gy = 0; gy < GRID_SIZE; gy++) {
          const tileKey = `${gx},${gy}`;
          const isBuilt = espacoPlotTiles ? espacoPlotTiles.has(tileKey) : true;
          const h = hoverTileRef.current;
          const isHover = Boolean(h && h.x === gx && h.y === gy);

          if (!isBuilt) {
            if (editMode && buildTabRef.current === 'terreno') {
              drawIsoTile(
                ctx,
                gx,
                gy,
                isHover ? 'rgba(52, 211, 153, 0.28)' : 'rgba(148, 163, 184, 0.06)',
                isHover ? '#34d399' : 'rgba(148, 163, 184, 0.22)'
              );
            }
            continue;
          }

          let fill = (gx + gy) % 2 === 0 ? floorA : floorB;
          if (baseRoomId === 'balada' && gx >= 3 && gx <= 8 && gy >= 4 && gy <= 8) {
            const pulse = Math.floor(tick * 0.4 + gx + gy) % 4;
            const colors = ['#6d28d9', '#db2777', '#0284c7', '#4338ca'];
            fill = colors[pulse];
          }
          drawIsoTile(ctx, gx, gy, fill);

          if (isHover) {
            const isTerrainEdit = editMode && baseRoomId === 'espaco' && buildTabRef.current === 'terreno';
            drawIsoTile(
              ctx,
              gx,
              gy,
              isTerrainEdit
                ? 'rgba(244, 63, 94, 0.35)'
                : editMode
                ? 'rgba(251,191,36,0.35)'
                : 'rgba(255,255,255,0.16)',
              isTerrainEdit
                ? '#f43f5e'
                : editMode
                ? '#fbbf24'
                : 'rgba(255,255,255,0.45)'
            );
          }
        }
      }

      const props = getRoomProps(baseRoomId);
      for (const prop of props) {
        if (prop.kind === 'portal') {
          if (baseRoomId === 'espaco') continue;
          drawIsoTile(ctx, prop.x, prop.y, 'rgba(245, 158, 11, 0.35)', '#fbbf24', 1);
        } else if (prop.kind === 'bench') {
          drawIsoBox(ctx, prop.x, prop.y, 11, '#b45309', '#92400e', '#78350f');
        } else if (prop.kind === 'shop_kiosk') {
          drawIsoBox(ctx, prop.x, prop.y, 26, '#ec4899', '#9d174d', '#831843');
        } else if (prop.kind === 'job_kiosk') {
          drawIsoBox(ctx, prop.x, prop.y, 24, '#22c55e', '#15803d', '#14532d');
        } else if (prop.kind === 'food_kiosk') {
          drawIsoBox(ctx, prop.x, prop.y, 22, '#f59e0b', '#d97706', '#92400e');
        }
      }

      if (baseRoomId !== 'espaco') {
        drawSignLabel(ctx, 5, 10, 'SAIR P/ PRAÇA', '#1e293b', '#fbbf24', '#fde047', -28);
      }
      if (baseRoomId === 'balada') {
        drawSignLabel(ctx, 5, 3, 'TRABALHAR DE DJ', '#3b0764', '#a855f7', '#f0abfc', -38);
      } else if (baseRoomId === 'cafeteria') {
        drawSignLabel(ctx, 5, 3, 'BALCÃO BARISTA', '#451a03', '#fb923c', '#ffedd5', -38);
        drawSignLabel(ctx, 7, 3, 'TOMAR CAFÉ (-8M)', '#78350f', '#fbbf24', '#fef3c7', -38);
      } else if (baseRoomId === 'mercado') {
        drawSignLabel(ctx, 5, 3, 'ENTREGAS F2P', '#14532d', '#22c55e', '#dcfce7', -38);
        drawSignLabel(ctx, 7, 3, 'FRUTAS (-8M)', '#3f2314', '#4ade80', '#dcfce7', -38);
      }

      type RenderEntity =
        | { kind: 'furn'; depth: number; furn: PlacedFurniture }
        | { kind: 'player'; depth: number; player: WorldPlayer; vx: number; vy: number };

      const entities: RenderEntity[] = [];

      if (baseRoomId === 'espaco' && spaceInfoRef.current) {
        for (const f of spaceInfoRef.current.furniture) {
          const item = getCatalogItem(f.itemId);
          const depthOffset = item?.shape === 'rug' ? -20 : 0;
          entities.push({ kind: 'furn', depth: f.x + f.y + depthOffset, furn: f });
        }
      }

      for (const pl of playersRef.current) {
        const cur = visualPosRef.current[pl.id] || { vx: pl.x, vy: pl.y };
        cur.vx += (pl.x - cur.vx) * 0.22;
        cur.vy += (pl.y - cur.vy) * 0.22;
        visualPosRef.current[pl.id] = cur;
        entities.push({
          kind: 'player',
          depth: cur.vx + cur.vy + 0.1,
          player: pl,
          vx: cur.vx,
          vy: cur.vy,
        });
      }

      entities.sort((a, b) => a.depth - b.depth);

      for (const ent of entities) {
        if (ent.kind === 'furn') {
          drawFurniturePiece(ctx, ent.furn, ent.furn.instanceId === selectedFurnId);
        } else {
          const pl = ent.player;
          const { sx, sy } = gridToScreen(ent.vx, ent.vy);
          const scale = Math.max(1.45, Math.min(2.25, tileW / 32));
          const drawX = Math.round(sx - 16 * scale);
          const drawY = Math.round(sy + tileH / 2 - 44 * scale);

          const isMoving = Math.abs(pl.x - ent.vx) > 0.08 || Math.abs(pl.y - ent.vy) > 0.08;
          drawPixelAvatar(ctx, drawX, drawY, {
            avatar: pl.avatar,
            view: pl.direction,
            expression: pl.expression,
            action: isMoving ? 'andando' : pl.action,
            frame: tick,
            scale,
          });

          drawPlayerNameAndBubble(ctx, sx, drawY, pl, now);
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [baseRoomId, canvasSize, currentPlayerId, editMode, selectedFurnId, roomMeta, pracaImgLoaded]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (baseRoomId === 'praca') {
      const tf = getPracaTransform(canvas.width, canvas.height);
      const px = (sx - tf.ox) / tf.scale;
      const py = (sy - tf.oy) / tf.scale;
      if (px < 0 || py < 0 || px > PRACA_W || py > PRACA_H) return;

      // 1. Check real online players (non-NPC) click
      const avatarScale = Math.max(1.35, 2.05 * tf.scale);
      const halfW = 18 * avatarScale;
      const fullH = 44 * avatarScale;
      for (const pl of players) {
        if (pl.id === currentPlayerId || pl.isNpc) continue;
        const vp = visualPosRef.current[pl.id] || { vx: pl.x, vy: pl.y };
        const pxy = gridToPracaPx(vp.vx, vp.vy);
        const psx = tf.ox + pxy.px * tf.scale;
        const psy = tf.oy + pxy.py * tf.scale;
        if (Math.abs(sx - psx) < halfW && sy >= psy - fullH && sy <= psy + 8) {
          soundFX.playClick();
          setSelectedPlayer(pl);
          return;
        }
      }

      // 2. Check Mockup Landmarks & Benches
      const hit = PRACA_HOTSPOTS.find(
        (h) => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1
      );
      if (hit) {
        if (hit.kind === 'catalog') {
          soundFX.playClick();
          onOpenShop();
          return;
        }
        if (hit.kind === 'portal' && hit.targetRoom) {
          soundFX.playClick();
          onChangeRoom(hit.targetRoom);
          return;
        }
        if (hit.kind === 'bench' && hit.sitPos) {
          setSelectedPlayer(null);
          const g = pracaPxToGrid(hit.sitPos.px, hit.sitPos.py);
          soundFX.playStep();
          onMove(g.x, g.y, hit.sitPos.dir, 'sentado', 2);
          return;
        }
      }

      setSelectedPlayer(null);

      // 3. Walk anywhere along the Praça cobblestones
      const dest = findNearestWalkablePraca(px, py);
      const me = players.find((p) => p.id === currentPlayerId);
      const curPx = me ? gridToPracaPx(me.x, me.y) : { px: dest.px, py: dest.py };
      const dx = dest.px - curPx.px;
      const dy = dest.py - curPx.py;

      let dir: Direction = me?.direction || 'frente';
      if (Math.abs(dx) >= Math.abs(dy)) {
        dir = dx >= 0 ? 'direita' : 'esquerda';
      } else {
        dir = dy >= 0 ? 'frente' : 'costas';
      }
      const distSteps = Math.max(1, Math.min(8, Math.round(Math.hypot(dx, dy) / 70)));
      const nextGrid = pracaPxToGrid(dest.px, dest.py);
      soundFX.playStep();
      onMove(nextGrid.x, nextGrid.y, dir, 'parado', distSteps);
      return;
    }

    // INDOOR ROOMS CLICK LOGIC
    for (const pl of players) {
      if (pl.id === currentPlayerId) continue;
      const vp = visualPosRef.current[pl.id] || { vx: pl.x, vy: pl.y };
      const { sx: px, sy: py } = gridToScreen(vp.vx, vp.vy);
      if (Math.abs(sx - px) < 26 && sy >= py - 75 && sy <= py + 24) {
        soundFX.playClick();
        setSelectedPlayer(pl);
        return;
      }
    }
    setSelectedPlayer(null);

    const { x, y } = screenToGrid(sx, sy);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return;

    if (isOwnSpace && editMode) {
      if (buildTab === 'terreno') {
        soundFX.playClick();
        onBuildTile(x, y);
        return;
      }
      if (placingInstanceId) {
        soundFX.playClick();
        onFurnish('place', { instanceId: placingInstanceId, x, y, rotation: 0 });
        setPlacingInstanceId(null);
        return;
      }
      const existing = spaceInfo?.furniture.find((f) => f.x === x && f.y === y);
      if (existing) {
        soundFX.playClick();
        setSelectedFurnId(existing.instanceId);
        return;
      }
      setSelectedFurnId(null);
      return;
    }

    // Cozy Home Furniture Interactions in Nosso Espaço (outside editMode)
    if (baseRoomId === 'espaco' && spaceInfo) {
      const furn = spaceInfo.furniture.find((f) => f.x === x && f.y === y);
      if (furn) {
        const cat = getCatalogItem(furn.itemId);
        if (cat) {
          soundFX.playClick();
          if (cat.shape === 'bed') {
            onMove(x, y, 'frente', 'deitado', 1);
            onRoutineAction('dormir_cama');
            return;
          }
          if (cat.shape === 'sofa') {
            onMove(x, y, 'frente', 'sentado', 1);
            onRoutineAction('relaxar_sofa');
            return;
          }
          if (cat.shape === 'plant') {
            onRoutineAction('regar_planta');
            return;
          }
          if (cat.shape === 'arcade' || cat.shape === 'dj') {
            onRoutineAction('jogar_arcade');
            return;
          }
          if (cat.shape === 'table') {
            onRoutineAction('lanche_cafeteria');
            return;
          }
        }
      }
    }

    const props = getRoomProps(baseRoomId);
    const prop = props.find((p) => p.x === x && p.y === y);
    if (prop) {
      if (prop.kind === 'portal' && prop.targetRoom && baseRoomId !== 'espaco') {
        soundFX.playClick();
        onChangeRoom(prop.targetRoom);
        return;
      }
      if (prop.kind === 'shop_kiosk') {
        soundFX.playClick();
        onOpenShop();
        return;
      }
      if (prop.kind === 'job_kiosk') {
        soundFX.playClick();
        onOpenMinigames();
        return;
      }
      if (prop.kind === 'food_kiosk' && prop.routineAction) {
        soundFX.playCoin();
        onRoutineAction(prop.routineAction);
        return;
      }
      if (prop.kind === 'bench') {
        soundFX.playStep();
        onMove(x, y, 'frente', 'sentado', 1);
        return;
      }
    }

    const canWalk =
      baseRoomId === 'espaco'
        ? (spaceInfo?.plotTiles || createStarterPlotTiles()).includes(`${x},${y}`)
        : !isBlockedTile(baseRoomId, x, y);

    if (canWalk) {
      const me = players.find((p) => p.id === currentPlayerId);
      const dx = x - (me?.x ?? x);
      const dy = y - (me?.y ?? y);
      let dir: Direction = me?.direction || 'frente';
      if (Math.abs(dx) >= Math.abs(dy)) {
        dir = dx >= 0 ? 'direita' : 'esquerda';
      } else {
        dir = dy >= 0 ? 'frente' : 'costas';
      }
      const dist = Math.max(1, Math.min(8, Math.abs(dx) + Math.abs(dy)));
      soundFX.playStep();
      onMove(x, y, dir, 'parado', dist);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    setMouseCanvasPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (baseRoomId === 'praca') {
      const tf = getPracaTransform(canvas.width, canvas.height);
      const px = (sx - tf.ox) / tf.scale;
      const py = (sy - tf.oy) / tf.scale;
      const hit =
        PRACA_HOTSPOTS.find((h) => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) ||
        null;
      setHoveredHotspot(hit);
      setHoverTile(null);
      return;
    }

    setHoveredHotspot(null);
    const { x, y } = screenToGrid(sx, sy);
    if (x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE) {
      setHoverTile({ x, y });
    } else {
      setHoverTile(null);
    }
  };

  const ownedFurniture = myInventory.filter((inv) => {
    const cat = getCatalogItem(inv.itemId);
    return cat?.category === 'movel';
  });

  const isAlreadyFriend = (id: string) => myFriends.some((f) => f.id === id);

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden bg-[#0d1022]">
      {/* Canvas Stage (auto-resizes cleanly around the right-side builder panel!) */}
      <div
        ref={containerRef}
        className="relative flex-1 min-w-0 min-h-0 h-full bg-[#0d1022] overflow-hidden select-none"
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => {
            setHoveredHotspot(null);
            setMouseCanvasPos(null);
          }}
          className="w-full h-full block cursor-pointer"
        />

        {/* Interactive Hotspot Tooltip on Praça Central */}
        {baseRoomId === 'praca' && hoveredHotspot && mouseCanvasPos && (
          <div
            style={{
              left: Math.min(canvasSize.w - 190, Math.max(12, mouseCanvasPos.x + 12)),
              top: Math.max(12, mouseCanvasPos.y - 34),
            }}
            className="absolute z-20 pointer-events-none px-2.5 py-1 rounded-lg bg-[#11162b]/95 border border-amber-400/70 text-[11px] font-bold text-amber-200 shadow-lg whitespace-nowrap"
          >
            {hoveredHotspot.label}
          </div>
        )}

        {/* Top-Left Location Card for Indoor Rooms */}
        {baseRoomId !== 'praca' && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#11162b]/92 border border-[#323d6e] shadow-lg backdrop-blur-sm">
            <div className="w-7 h-7 rounded-lg bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-300">
              {baseRoomId === 'espaco' ? <Home className="w-4 h-4" /> : <Compass className="w-4 h-4" />}
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">
                {baseRoomId === 'espaco' && spaceInfo
                  ? `Canto de ${spaceInfo.ownerName}`
                  : roomMeta.name}
              </div>
              <div className="text-[11px] text-slate-300 leading-tight mt-0.5 hidden sm:block">
                {roomMeta.subtitle}
              </div>
            </div>
          </div>
        )}

        {/* Top-Right Room Controls */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {baseRoomId !== 'praca' && (
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                onChangeRoom('praca');
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#11162b]/92 hover:bg-[#1e2647] border border-[#323d6e] text-xs font-bold text-amber-300 cursor-pointer whitespace-nowrap"
            >
              <DoorOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Voltar p/ Praça</span>
              <span className="sm:hidden">Praça</span>
            </button>
          )}

          {isOwnSpace && (
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setEditMode((v) => !v);
                setPlacingInstanceId(null);
                setSelectedFurnId(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                editMode
                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                  : 'bg-[#11162b]/92 text-white border-purple-500 hover:bg-[#1f1742]'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{editMode ? 'Concluir Obra' : 'Construir & Mobiliar'}</span>
            </button>
          )}
        </div>

        {/* Nosso Espaço Cozy Routine Strip when NOT editing */}
        {isOwnSpace && !editMode && (
          <div className="absolute bottom-2 left-2 right-2 sm:right-auto sm:bottom-3 sm:left-3 z-10 flex flex-wrap items-center gap-1.5 sm:gap-2 rounded-xl bg-[#11162b]/92 border border-[#323d6e] px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-xl backdrop-blur-sm">
            <span className="text-[11px] font-bold text-amber-300 mr-1 hidden sm:inline">
              Rotina da Casa:
            </span>
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                onRoutineAction('arrumar_casa');
              }}
              className="px-2 py-1 rounded-lg bg-[#1a2247] hover:bg-emerald-600/30 border border-emerald-500/40 text-[11px] font-semibold text-emerald-200 flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Arrumar Casa</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                onRoutineAction('regar_planta');
              }}
              className="px-2 py-1 rounded-lg bg-[#1a2247] hover:bg-sky-600/30 border border-sky-500/40 text-[11px] font-semibold text-sky-200 flex items-center gap-1 cursor-pointer"
            >
              <Droplets className="w-3 h-3" />
              <span>Regar Plantas</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                onRoutineAction('tomar_banho');
              }}
              className="px-2 py-1 rounded-lg bg-[#1a2247] hover:bg-purple-600/30 border border-purple-500/40 text-[11px] font-semibold text-purple-200 flex items-center gap-1 cursor-pointer"
            >
              <Coffee className="w-3 h-3" />
              <span>Renovar Visual</span>
            </button>
          </div>
        )}

        {/* Selected Online Player Interaction Card */}
        {selectedPlayer && (
          <div className="absolute bottom-3 left-3 z-20 w-72 rounded-xl bg-[#11162b]/95 border-2 border-[#6d28d9] p-3.5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-[#1b0c38] border border-purple-700/60 p-1 shrink-0">
                <PixelAvatarPreview
                  avatar={selectedPlayer.avatar}
                  expression={selectedPlayer.expression}
                  scale={2}
                  width={56}
                  height={78}
                  animate={false}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white truncate">
                    {selectedPlayer.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedPlayer(null)}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-300 mt-1 line-clamp-2">
                  {selectedPlayer.bio}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                type="button"
                disabled={isAlreadyFriend(selectedPlayer.id)}
                onClick={() => {
                  soundFX.playClick();
                  onAddFriend(selectedPlayer.id, selectedPlayer.name);
                }}
                className="px-2.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{isAlreadyFriend(selectedPlayer.id) ? 'Amigo' : 'Add Amigo'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  soundFX.playClick();
                  onStartTrade(selectedPlayer);
                  setSelectedPlayer(null);
                }}
                className="px-2.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <HeartHandshake className="w-3.5 h-3.5" />
                <span>Trocar</span>
              </button>
            </div>
          </div>
        )}

        {/* Subtle walk hint bottom-right */}
        {!editMode && (
          <div className="hidden sm:block absolute bottom-2.5 right-3 pointer-events-none px-2.5 py-1 rounded-md bg-black/55 text-[11px] text-slate-200">
            {baseRoomId === 'praca'
              ? 'Clique na calçada ou use WASD para andar · Clique nas lojas ou bancos'
              : 'Clique no chão para andar · Clique em bancos/portas para interagir'}
          </div>
        )}
      </div>

      {/* RIGHT-CORNER DOCKED MENU FOR NOSSO CANTO CONSTRUCTION (Never covers the room tiles!) */}
      {isOwnSpace && editMode && (
        <aside className="w-full md:w-80 shrink-0 max-h-[45%] md:max-h-full md:h-full bg-[#10152b] border-t-2 md:border-t-0 md:border-l-2 border-amber-400/75 p-3 flex flex-col gap-3 overflow-y-auto shadow-2xl z-20">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#252e59]">
            <div className="flex items-center gap-2">
              <Blocks className="w-4 h-4 text-amber-300" />
              <span className="font-pixel text-xs text-white">Construir Nosso Canto</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setPlacingInstanceId(null);
                setSelectedFurnId(null);
              }}
              className="text-xs font-bold text-slate-300 hover:text-white px-2 py-1 rounded bg-[#1b2345] cursor-pointer"
            >
              Fechar
            </button>
          </div>

          {/* Sub-mode tabs */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setBuildTab('terreno');
                setPlacingInstanceId(null);
                setSelectedFurnId(null);
              }}
              className={`px-2.5 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                buildTab === 'terreno'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-[#1a2042] text-slate-300 hover:text-white'
              }`}
            >
              <Blocks className="w-3.5 h-3.5" />
              <span>Terreno</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setBuildTab('mobiliar');
              }}
              className={`px-2.5 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                buildTab === 'mobiliar'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-[#1a2042] text-slate-300 hover:text-white'
              }`}
            >
              <Armchair className="w-3.5 h-3.5" />
              <span>Móveis</span>
            </button>
          </div>

          {/* Floor Theme Selector */}
          <div>
            <div className="text-[11px] font-bold text-slate-300 mb-1.5">Tema do Piso</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ROOM_THEMES.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => {
                    soundFX.playClick();
                    onFurnish('theme', { theme: th.id });
                  }}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer truncate ${
                    spaceInfo?.theme === th.id
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-[#18203f] text-slate-300 border-[#2b3668]'
                  }`}
                >
                  {th.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {buildTab === 'terreno' ? (
            <div className="rounded-xl bg-[#0b0f21] border border-emerald-500/35 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-300">Blocos do Terreno</span>
                <span className="font-mono-nums text-amber-300">
                  {spaceInfo?.plotTiles?.length ?? 36}/{spaceInfo?.plotMaxBlocks ?? STARTER_PLOT_MAX_BLOCKS}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Clique nos quadrados tracejados no mapa ao lado para <strong>adicionar</strong> blocos ou clique sobre um piso existente para <strong>remover</strong> e esculpir seu terreno livremente!
              </p>
              <div className="text-[10px] text-amber-300/90 font-semibold pt-1 border-t border-[#1e2647]">
                Expansões futuras poderão ampliar o limite de blocos.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 flex-1 min-h-0">
              <div className="text-[11px] text-slate-200 bg-[#0b0f21] border border-[#252e59] rounded-lg px-2.5 py-2">
                {placingInstanceId
                  ? 'Clique em qualquer bloco construído no mapa para posicionar o móvel!'
                  : 'Selecione um móvel abaixo para colocar ou clique em um já colocado para girar/guardar.'}
              </div>

              {selectedFurnId && (
                <div className="flex flex-col gap-1.5 bg-amber-500/15 border border-amber-400/40 rounded-lg p-2.5">
                  <span className="text-[11px] font-bold text-amber-200">Móvel selecionado:</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onFurnish('rotate', { instanceId: selectedFurnId })}
                      className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>Girar 90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onFurnish('remove', { instanceId: selectedFurnId });
                        setSelectedFurnId(null);
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Guardar</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
                {ownedFurniture.length === 0 ? (
                  <div className="text-xs text-slate-400 py-2">
                    Você ainda não possui móveis extras. Visite o Catálogo ou o Bazar!
                  </div>
                ) : (
                  ownedFurniture.map((inv) => {
                    const cat = getCatalogItem(inv.itemId);
                    if (!cat) return null;
                    const isPlaced = spaceInfo?.furniture.some((f) => f.instanceId === inv.instanceId);
                    const isActive = placingInstanceId === inv.instanceId;
                    return (
                      <button
                        key={inv.instanceId}
                        type="button"
                        onClick={() => {
                          soundFX.playClick();
                          setPlacingInstanceId(isActive ? null : inv.instanceId);
                        }}
                        className={`w-full px-2.5 py-2 rounded-lg border text-left transition-colors cursor-pointer flex items-center gap-2.5 ${
                          isActive
                            ? 'bg-amber-400 text-slate-950 border-amber-200'
                            : isPlaced
                            ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                            : 'bg-[#1a203d] border-slate-700 text-slate-200 hover:border-purple-400'
                        }`}
                      >
                        <ItemThumbnail item={cat} className="w-10 h-10" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate">{cat.name}</div>
                          <div className="text-[10px] opacity-80">
                            {isPlaced ? 'No quarto (clique p/ mover)' : 'Pronto p/ colocar'}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
