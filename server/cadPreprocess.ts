import zlib from 'node:zlib';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CadWallCandidate {
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  orientation: 'h' | 'v';
  lengthNorm: number;
}

export interface CadOpeningCandidate {
  u: number;
  v: number;
  widthNorm: number;
  orientation: 'h' | 'v';
  kindHint: 'door_or_passage';
}

export interface NormalizedWallInput {
  u1: number;
  v1: number;
  u2: number;
  v2: number;
}

export interface NormalizedOpeningInput {
  u: number;
  v: number;
  widthNorm?: number;
  angle?: number;
}

export interface CadWallAuditResult {
  wallRecall: number;
  wallPrecision: number;
  missingWalls: CadWallCandidate[];
  unsupportedWalls: Array<NormalizedWallInput & { hitRatio: number }>;
}

export interface CadPixelAnalysis {
  width: number;
  height: number;
  isOrthogonalCad: boolean;
  bbox: { minU: number; minV: number; maxU: number; maxV: number };
  xAxes: number[];
  yAxes: number[];
  wallCandidates: CadWallCandidate[];
  openingGaps: CadOpeningCandidate[];
  auditProposedNormalizedWalls: (
    walls: NormalizedWallInput[]
  ) => CadWallAuditResult;
  renderOverlayPngBase64: (
    walls: NormalizedWallInput[],
    doors?: NormalizedOpeningInput[],
    windows?: NormalizedOpeningInput[]
  ) => string;
}

/**
 * Reads pixel dimensions from PNG, JPEG, or WebP buffers without external deps.
 */
export function parseImageDimensions(
  buf: Buffer,
  mimeType = ''
): ImageDimensions | null {
  if (!buf || buf.length < 16) return null;

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0 && width < 32768 && height < 32768) {
      return { width, height };
    }
  }

  // JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (i + 4 > buf.length) break;
      const segLen = buf.readUInt16BE(i + 2);
      if (segLen < 2) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (i + 9 <= buf.length) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (width > 0 && height > 0) return { width, height };
        }
      }
      i += 2 + segLen;
    }
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 30 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ' && buf.length >= 30) {
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return { width: w, height: h };
    }
  }

  void mimeType;
  return null;
}

// CRC32 table for pure-TS PNG encoding
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbToPngBase64(width: number, height: number, rgb: Uint8Array): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter none
    const srcStart = y * width * 3;
    raw.set(rgb.subarray(srcStart, srcStart + width * 3), rowStart + 1);
  }
  const compressed = zlib.deflateSync(raw, { level: 3 });

  const png = Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

function decodePngToRgbAndGray(buf: Buffer): {
  width: number;
  height: number;
  gray: Uint8Array;
  rgb: Uint8Array;
} | null {
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Buffer | null = null;
  const idats: Buffer[] = [];

  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    if (pos + 12 + len > buf.length) break;
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096 ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    idats.length === 0
  ) {
    return null;
  }

  const bpp =
    colorType === 6
      ? 4
      : colorType === 2
      ? 3
      : colorType === 4
      ? 2
      : colorType === 0 || colorType === 3
      ? 1
      : 0;
  if (bpp === 0) return null;

  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) return null;

  const gray = new Uint8Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);

  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  let rIdx = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rIdx++];
    for (let x = 0; x < stride; x++) {
      const val = raw[rIdx++];
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 255;
      else if (filter === 2) recon = (val + b) & 255;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 255;
      else if (filter === 4) recon = (val + paeth(a, b, c)) & 255;
      curRow[x] = recon;
    }
    prevRow.set(curRow);

    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      let r = 255;
      let g = 255;
      let bl = 255;
      if (colorType === 6 || colorType === 2) {
        const alpha = colorType === 6 ? curRow[i + 3] / 255 : 1;
        r = Math.round(curRow[i] * alpha + 255 * (1 - alpha));
        g = Math.round(curRow[i + 1] * alpha + 255 * (1 - alpha));
        bl = Math.round(curRow[i + 2] * alpha + 255 * (1 - alpha));
      } else if (colorType === 4 || colorType === 0) {
        const alpha = colorType === 4 ? curRow[i + 1] / 255 : 1;
        const v = Math.round(curRow[i] * alpha + 255 * (1 - alpha));
        r = v;
        g = v;
        bl = v;
      } else if (colorType === 3 && palette) {
        const idx = curRow[i] * 3;
        if (idx + 2 < palette.length) {
          r = palette[idx];
          g = palette[idx + 1];
          bl = palette[idx + 2];
        }
      }
      const pIdx = y * width + x;
      rgb[pIdx * 3] = r;
      rgb[pIdx * 3 + 1] = g;
      rgb[pIdx * 3 + 2] = bl;
      gray[pIdx] = Math.round(0.299 * r + 0.587 * g + 0.114 * bl);
    }
  }

  return { width, height, gray, rgb };
}

function drawThickLineRgb(
  rgb: Uint8Array,
  w: number,
  h: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  radiusPx: number
) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x1 + (x2 - x1) * t);
    const cy = Math.round(y1 + (y2 - y1) * t);
    for (let dy = -radiusPx; dy <= radiusPx; dy++) {
      for (let dx = -radiusPx; dx <= radiusPx; dx++) {
        if (dx * dx + dy * dy > radiusPx * radiusPx + 1) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const idx = (py * w + px) * 3;
        rgb[idx] = r;
        rgb[idx + 1] = g;
        rgb[idx + 2] = b;
      }
    }
  }
}

function pointToSegDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Deterministic CAD Structural Analyzer for PNG architectural drawings.
 * Detects orthogonal wall axes, wall segments, intentional doorway/corridor gaps,
 * foreground bounding box, and provides visual overlay + ink-coverage verification.
 */
export function analyzePngCadBlueprint(buf: Buffer): CadPixelAnalysis | null {
  let decoded: ReturnType<typeof decodePngToRgbAndGray> = null;
  try {
    decoded = decodePngToRgbAndGray(buf);
  } catch {
    return null;
  }
  if (!decoded) return null;

  const { width, height, gray, rgb } = decoded;

  // Determine border median brightness (detect white-paper CAD vs dark blueprint)
  const borderSamples: number[] = [];
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 40))) {
    borderSamples.push(gray[x], gray[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) {
    borderSamples.push(gray[y * width], gray[y * width + (width - 1)]);
  }
  borderSamples.sort((a, b) => a - b);
  const bgLum = borderSamples[Math.floor(borderSamples.length / 2)] ?? 255;
  const isLightBg = bgLum >= 128;

  const isInk = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const lum = gray[y * width + x];
    return isLightBg
      ? lum < Math.min(195, bgLum - 40)
      : lum > Math.max(85, bgLum + 40);
  };

  // Bounding box of foreground ink (with 2-neighbor filter to ignore stray speckles)
  let minPx = width;
  let maxPx = 0;
  let minPy = height;
  let maxPy = 0;
  const colCounts = new Int32Array(width);
  const rowCounts = new Int32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) {
        colCounts[x]++;
        rowCounts[y]++;
        if (x < minPx) minPx = x;
        if (x > maxPx) maxPx = x;
        if (y < minPy) minPy = y;
        if (y > maxPy) maxPy = y;
      }
    }
  }

  if (maxPx <= minPx || maxPy <= minPy) {
    return null;
  }

  const bbox = {
    minU: Math.round((minPx / width) * 1000),
    minV: Math.round((minPy / height) * 1000),
    maxU: Math.round((maxPx / width) * 1000),
    maxV: Math.round((maxPy / height) * 1000),
  };

  const findProjectionBands = (counts: Int32Array, crossLen: number, mainLen: number) => {
    const thresh = Math.max(14, Math.round(crossLen * 0.095));
    const mergeGap = Math.max(8, Math.round(mainLen * 0.024));
    const bands: Array<{ start: number; end: number; center: number; norm: number }> = [];
    let start = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= thresh) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        bands.push({
          start,
          end: i - 1,
          center: (start + i - 1) / 2,
          norm: 0,
        });
        start = -1;
      }
    }
    if (start !== -1) {
      bands.push({
        start,
        end: counts.length - 1,
        center: (start + counts.length - 1) / 2,
        norm: 0,
      });
    }

    const merged: typeof bands = [];
    for (const b of bands) {
      if (merged.length > 0 && b.start - merged[merged.length - 1].end <= mergeGap) {
        const prev = merged[merged.length - 1];
        prev.end = b.end;
        prev.center = (prev.start + prev.end) / 2;
      } else {
        merged.push({ ...b });
      }
    }
    for (const m of merged) {
      m.norm = Math.round((m.center / mainLen) * 1000);
    }
    return merged;
  };

  const xBands = findProjectionBands(colCounts, height, width);
  const yBands = findProjectionBands(rowCounts, width, height);

  const halfSearchX = Math.max(4, Math.round(width * 0.009));
  const halfSearchY = Math.max(4, Math.round(height * 0.009));
  const minRunX = Math.max(14, Math.round(width * 0.032));
  const minRunY = Math.max(14, Math.round(height * 0.032));
  const bridgeGap = Math.max(3, Math.round(Math.min(width, height) * 0.009));

  const traceAxisRuns = (
    centerPx: number,
    isVertical: boolean
  ): Array<[number, number]> => {
    const mainLen = isVertical ? height : width;
    const halfSearch = isVertical ? halfSearchX : halfSearchY;
    const minRun = isVertical ? minRunY : minRunX;

    const active = new Uint8Array(mainLen);
    const cRound = Math.round(centerPx);
    for (let t = 0; t < mainLen; t++) {
      let hits = 0;
      for (let d = -halfSearch; d <= halfSearch; d++) {
        const hit = isVertical ? isInk(cRound + d, t) : isInk(t, cRound + d);
        if (hit) hits++;
      }
      if (hits >= 2) active[t] = 1;
    }

    // Bridge tiny white anti-aliasing / column stipple gaps
    for (let t = bridgeGap; t < mainLen - bridgeGap; t++) {
      if (!active[t]) {
        let leftOk = false;
        let rightOk = false;
        for (let k = 1; k <= bridgeGap; k++) {
          if (active[t - k]) leftOk = true;
          if (active[t + k]) rightOk = true;
        }
        if (leftOk && rightOk) active[t] = 1;
      }
    }

    const runs: Array<[number, number]> = [];
    let s = -1;
    for (let t = 0; t < mainLen; t++) {
      if (active[t]) {
        if (s === -1) s = t;
      } else if (s !== -1) {
        if (t - 1 - s >= minRun) {
          runs.push([
            Math.round((s / mainLen) * 1000),
            Math.round(((t - 1) / mainLen) * 1000),
          ]);
        }
        s = -1;
      }
    }
    if (s !== -1 && mainLen - 1 - s >= minRun) {
      runs.push([
        Math.round((s / mainLen) * 1000),
        Math.round(((mainLen - 1) / mainLen) * 1000),
      ]);
    }
    return runs;
  };

  // Snap endpoints onto perpendicular detected axes within 22 normalized units (2.2%)
  const snapToAxes = (val: number, axes: number[], tolerance = 22): number => {
    let best = val;
    let bestDiff = tolerance + 1;
    for (const a of axes) {
      const diff = Math.abs(a - val);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = a;
      }
    }
    return best;
  };

  const validXBands = xBands.filter((xb) => traceAxisRuns(xb.center, true).length > 0);
  const validYBands = yBands.filter((yb) => traceAxisRuns(yb.center, false).length > 0);

  const xAxes = validXBands.map((b) => b.norm);
  const yAxes = validYBands.map((b) => b.norm);

  const wallCandidates: CadWallCandidate[] = [];
  const openingGaps: CadOpeningCandidate[] = [];

  for (const xb of validXBands) {
    const rawRuns = traceAxisRuns(xb.center, true);
    const snappedRuns = rawRuns.map(([v1, v2]) => [
      snapToAxes(v1, yAxes),
      snapToAxes(v2, yAxes),
    ]) as Array<[number, number]>;

    for (let i = 0; i < snappedRuns.length; i++) {
      const [v1, v2] = snappedRuns[i];
      if (v2 - v1 >= 30) {
        wallCandidates.push({
          u1: xb.norm,
          v1,
          u2: xb.norm,
          v2,
          orientation: 'v',
          lengthNorm: v2 - v1,
        });
      }
      if (i + 1 < snappedRuns.length) {
        const nextV1 = snappedRuns[i + 1][0];
        const gap = nextV1 - v2;
        if (gap >= 30 && gap <= 180) {
          openingGaps.push({
            u: xb.norm,
            v: Math.round((v2 + nextV1) / 2),
            widthNorm: gap,
            orientation: 'v',
            kindHint: 'door_or_passage',
          });
        }
      }
    }
  }

  for (const yb of validYBands) {
    const rawRuns = traceAxisRuns(yb.center, false);
    const snappedRuns = rawRuns.map(([u1, u2]) => [
      snapToAxes(u1, xAxes),
      snapToAxes(u2, xAxes),
    ]) as Array<[number, number]>;

    for (let i = 0; i < snappedRuns.length; i++) {
      const [u1, u2] = snappedRuns[i];
      if (u2 - u1 >= 30) {
        wallCandidates.push({
          u1,
          v1: yb.norm,
          u2,
          v2: yb.norm,
          orientation: 'h',
          lengthNorm: u2 - u1,
        });
      }
      if (i + 1 < snappedRuns.length) {
        const nextU1 = snappedRuns[i + 1][0];
        const gap = nextU1 - u2;
        if (gap >= 30 && gap <= 180) {
          openingGaps.push({
            u: Math.round((u2 + nextU1) / 2),
            v: yb.norm,
            widthNorm: gap,
            orientation: 'h',
            kindHint: 'door_or_passage',
          });
        }
      }
    }
  }

  // Also detect dead-end gaps between a stub wall endpoint and a perpendicular wall axis
  // that actually spans near the stub coordinate (e.g. vertical stub stopping ~95 units short of a horizontal wall)
  const addUniqueGap = (gap: CadOpeningCandidate) => {
    const dup = openingGaps.some(
      (g) =>
        g.orientation === gap.orientation &&
        Math.abs(g.u - gap.u) <= 25 &&
        Math.abs(g.v - gap.v) <= 25
    );
    if (!dup) openingGaps.push(gap);
  };

  for (const w of wallCandidates) {
    if (w.orientation === 'v') {
      for (const yAx of yAxes) {
        const gapTop = w.v1 - yAx;
        if (gapTop >= 45 && gapTop <= 145) {
          const hasPerpWallAtIntersection = wallCandidates.some(
            (other) =>
              other.orientation === 'h' &&
              Math.abs(other.v1 - yAx) <= 22 &&
              other.u1 <= w.u1 + 25 &&
              other.u2 >= w.u1 - 25
          );
          const covered = wallCandidates.some(
            (other) =>
              other.orientation === 'v' &&
              Math.abs(other.u1 - w.u1) <= 22 &&
              other.v1 <= yAx + 10 &&
              other.v2 >= w.v1 - 10
          );
          if (hasPerpWallAtIntersection && !covered) {
            addUniqueGap({
              u: w.u1,
              v: Math.round((yAx + w.v1) / 2),
              widthNorm: gapTop,
              orientation: 'v',
              kindHint: 'door_or_passage',
            });
          }
        }
      }
    } else {
      for (const xAx of xAxes) {
        const gapLeft = w.u1 - xAx;
        if (gapLeft >= 45 && gapLeft <= 145) {
          const hasPerpWallAtIntersection = wallCandidates.some(
            (other) =>
              other.orientation === 'v' &&
              Math.abs(other.u1 - xAx) <= 22 &&
              other.v1 <= w.v1 + 25 &&
              other.v2 >= w.v1 - 25
          );
          const covered = wallCandidates.some(
            (other) =>
              other.orientation === 'h' &&
              Math.abs(other.v1 - w.v1) <= 22 &&
              other.u1 <= xAx + 10 &&
              other.u2 >= w.u1 - 10
          );
          if (hasPerpWallAtIntersection && !covered) {
            addUniqueGap({
              u: Math.round((xAx + w.u1) / 2),
              v: w.v1,
              widthNorm: gapLeft,
              orientation: 'h',
              kindHint: 'door_or_passage',
            });
          }
        }
      }
    }
  }

  const auditProposedNormalizedWalls = (
    proposedWalls: NormalizedWallInput[]
  ): CadWallAuditResult => {
    const missingWalls: CadWallCandidate[] = [];
    let coveredCandidates = 0;

    for (const cand of wallCandidates) {
      // Sample 10 points along candidate wall and check distance to closest proposed wall
      let hits = 0;
      const samples = 10;
      for (let s = 1; s <= samples; s++) {
        const t = s / (samples + 1);
        const su = cand.u1 + (cand.u2 - cand.u1) * t;
        const sv = cand.v1 + (cand.v2 - cand.v1) * t;
        let minD = Infinity;
        for (const pw of proposedWalls) {
          const d = pointToSegDist(su, sv, pw.u1, pw.v1, pw.u2, pw.v2);
          if (d < minD) minD = d;
        }
        if (minD <= 32) hits++;
      }
      if (hits / samples >= 0.55) {
        coveredCandidates++;
      } else {
        missingWalls.push(cand);
      }
    }

    const unsupportedWalls: Array<NormalizedWallInput & { hitRatio: number }> = [];
    let supportedProposed = 0;
    const radPx = Math.max(5, Math.round(Math.min(width, height) * 0.015));

    for (const pw of proposedWalls) {
      const samples = 12;
      let inkHits = 0;
      for (let s = 1; s <= samples; s++) {
        const t = s / (samples + 1);
        const px = Math.round(((pw.u1 + (pw.u2 - pw.u1) * t) / 1000) * width);
        const py = Math.round(((pw.v1 + (pw.v2 - pw.v1) * t) / 1000) * height);
        let found = false;
        for (let dy = -radPx; dy <= radPx && !found; dy++) {
          for (let dx = -radPx; dx <= radPx; dx++) {
            if (isInk(px + dx, py + dy)) {
              found = true;
              break;
            }
          }
        }
        if (found) inkHits++;
      }
      const hitRatio = Number((inkHits / samples).toFixed(2));
      if (hitRatio >= 0.35) {
        supportedProposed++;
      } else {
        unsupportedWalls.push({ ...pw, hitRatio });
      }
    }

    const wallRecall =
      wallCandidates.length > 0
        ? Number((coveredCandidates / wallCandidates.length).toFixed(2))
        : 1;
    const wallPrecision =
      proposedWalls.length > 0
        ? Number((supportedProposed / proposedWalls.length).toFixed(2))
        : 0;

    return {
      wallRecall,
      wallPrecision,
      missingWalls,
      unsupportedWalls,
    };
  };

  const renderOverlayPngBase64 = (
    walls: NormalizedWallInput[],
    doors: NormalizedOpeningInput[] = [],
    windows: NormalizedOpeningInput[] = []
  ): string => {
    const out = new Uint8Array(rgb);
    const wallRadius = Math.max(2, Math.round(Math.min(width, height) * 0.0045));
    for (const w of walls) {
      drawThickLineRgb(
        out,
        width,
        height,
        (w.u1 / 1000) * width,
        (w.v1 / 1000) * height,
        (w.u2 / 1000) * width,
        (w.v2 / 1000) * height,
        239,
        68,
        68, // bright red
        wallRadius
      );
    }
    for (const d of doors) {
      const cx = (d.u / 1000) * width;
      const cy = (d.v / 1000) * height;
      drawThickLineRgb(
        out,
        width,
        height,
        cx - 8,
        cy,
        cx + 8,
        cy,
        16,
        185,
        129, // emerald green
        wallRadius + 1
      );
    }
    for (const win of windows) {
      const cx = (win.u / 1000) * width;
      const cy = (win.v / 1000) * height;
      drawThickLineRgb(
        out,
        width,
        height,
        cx - 8,
        cy,
        cx + 8,
        cy,
        59,
        130,
        246, // blue
        wallRadius + 1
      );
    }
    return encodeRgbToPngBase64(width, height, out);
  };

  return {
    width,
    height,
    isOrthogonalCad: wallCandidates.length >= 4 && xAxes.length >= 2 && yAxes.length >= 2,
    bbox,
    xAxes,
    yAxes,
    wallCandidates,
    openingGaps,
    auditProposedNormalizedWalls,
    renderOverlayPngBase64,
  };
}
