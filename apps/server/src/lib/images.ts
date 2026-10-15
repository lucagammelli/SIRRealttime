import type { AssetMime } from '@sir/shared';

/** Image recognized from its bytes. */
export interface ImageInfo {
  mime: AssetMime;
  width: number;
  height: number;
}

/** Why an upload is not an accepted image (the message is shown to the admin). */
export class ImageRejected extends Error {
  readonly code = 'IMAGE_REJECTED';
}

/** Largest side accepted, in pixels (raster) or user units (SVG). */
export const IMAGE_MAX_SIDE = 4096;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const size = (width: number, height: number): { width: number; height: number } => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new ImageRejected('Immagine senza dimensioni valide');
  if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE)
    throw new ImageRejected(`Immagine troppo grande (massimo ${IMAGE_MAX_SIDE} px per lato)`);
  return { width: Math.ceil(width), height: Math.ceil(height) };
};

/**
 * Pure: PNG with valid structure: signature, IHDR first, chunks one after the other up to IEND and nothing after it
 * (a file with other content appended, e.g. HTML or a script, is not accepted).
 */
function readPng(buf: Buffer): ImageInfo {
  if (buf.length < 8 + 25 + 12) throw new ImageRejected('PNG non valido');
  if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR')
    throw new ImageRejected('PNG non valido');
  const dims = size(buf.readUInt32BE(16), buf.readUInt32BE(20));
  let offset = 8;
  for (;;) {
    if (offset + 12 > buf.length) throw new ImageRejected('PNG non valido');
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new ImageRejected('PNG non valido');
    const next = offset + 12 + length;
    if (next > buf.length) throw new ImageRejected('PNG non valido');
    if (type === 'IEND') {
      if (next !== buf.length) throw new ImageRejected('PNG con dati dopo la fine del file');
      break;
    }
    offset = next;
  }
  return { mime: 'image/png', ...dims };
}

/** Start-of-frame markers carrying the size (all SOFn except DHT C4, JPG C8, DAC CC). */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Pure: JPEG with its segments up to a start of frame, ending with the end-of-image marker. */
function readJpeg(buf: Buffer): ImageInfo {
  if (buf.length < 4 || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9)
    throw new ImageRejected('JPEG non valido o con dati dopo la fine del file');
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) throw new ImageRejected('JPEG non valido');
    const marker = buf[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buf.length) throw new ImageRejected('JPEG non valido');
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) throw new ImageRejected('JPEG non valido');
      return { mime: 'image/jpeg', ...size(buf.readUInt16BE(offset + 7), buf.readUInt16BE(offset + 5)) };
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset += 2 + length;
  }
  throw new ImageRejected('JPEG senza dimensioni');
}

/** Pure: WebP (RIFF container whose declared size is exactly the file) with a VP8, VP8L or VP8X first chunk. */
function readWebp(buf: Buffer): ImageInfo {
  if (buf.length < 30 || buf.readUInt32LE(4) + 8 !== buf.length)
    throw new ImageRejected('WebP non valido o con dati dopo la fine del file');
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new ImageRejected('WebP non valido');
    return { mime: 'image/webp', ...size(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff) };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) throw new ImageRejected('WebP non valido');
    const bits = buf.readUInt32LE(21);
    return { mime: 'image/webp', ...size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) };
  }
  if (chunk === 'VP8X') {
    return { mime: 'image/webp', ...size(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1) };
  }
  throw new ImageRejected('WebP non valido');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * SVG elements allowed: shapes, text, gradients, clips, masks, patterns, `use` and the filters that do not load
 * anything. Everything else is refused (script, foreignObject, image, a, iframe, animate/set, feImage, prefixed
 * elements of other namespaces…).
 */
const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'style',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
]);

/** Predefined XML entities, the only references accepted (no numeric ones, which could hide `javascript:`). */
const XML_ENTITY = /&(?!(?:amp|lt|gt|quot|apos);)/;
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/y;
const URL_REFERENCE = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
/** CSS functions that load an image other than url() (`image-set()`, `-webkit-image-set()`, `src()`): always refused. */
const OTHER_LOADERS = /(?:image-set|\bsrc)\s*\(/i;
/** Attribute values that need the CSS check. */
const CSS_FUNCTION = /(?:url|image-set|\bsrc)\s*\(/i;

/**
 * Pure: CSS (a `<style>` or a `style` attribute) without imports, escapes, expressions, image-set()/src() or url()
 * other than `#id`.
 */
function checkCss(css: string): void {
  const lower = css.toLowerCase();
  if (
    lower.includes('@import') ||
    lower.includes('\\') ||
    lower.includes('expression') ||
    lower.includes('javascript:') ||
    OTHER_LOADERS.test(css)
  )
    throw new ImageRejected('SVG con stili non ammessi');
  for (const m of css.matchAll(URL_REFERENCE)) {
    if (!(m[2] ?? '').trim().startsWith('#')) throw new ImageRejected('SVG con riferimenti esterni negli stili');
  }
  if (/url\s*\(/i.test(css.replace(URL_REFERENCE, ''))) throw new ImageRejected('SVG con stili non ammessi');
}

function checkAttribute(name: string, value: string): void {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) throw new ImageRejected('SVG con gestori di eventi (on…)');
  if (XML_ENTITY.test(value)) throw new ImageRejected('SVG con entità non ammesse');
  // Browsers ignore spaces and control characters inside a scheme (`java\tscript:`): they are removed first.
  const compact = [...value]
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase();
  if (compact.includes('javascript:') || compact.includes('vbscript:')) throw new ImageRejected('SVG con javascript:');
  if (lower === 'href' || lower === 'xlink:href') {
    if (!value.trim().startsWith('#')) throw new ImageRejected('SVG con collegamenti esterni');
    return;
  }
  if (lower === 'xmlns') {
    if (value !== SVG_NS) throw new ImageRejected('SVG con namespace non ammesso');
    return;
  }
  if (lower === 'xmlns:xlink') {
    if (value !== XLINK_NS) throw new ImageRejected('SVG con namespace non ammesso');
    return;
  }
  if (lower.includes(':') && lower !== 'xml:space' && lower !== 'xml:lang')
    throw new ImageRejected('SVG con attributi di altri namespace');
  if (lower === 'style') checkCss(value);
  else if (CSS_FUNCTION.test(value)) checkCss(value);
}

const SVG_LENGTH = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/;

/** Pure: size of the root element from width/height in px (or plain numbers), otherwise from the viewBox. */
function svgSize(attributes: Map<string, string>): { width: number; height: number } {
  const w = SVG_LENGTH.exec(attributes.get('width') ?? '');
  const h = SVG_LENGTH.exec(attributes.get('height') ?? '');
  if (w?.[1] && h?.[1]) return size(Number(w[1]), Number(h[1]));
  const box = (attributes.get('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) return size(box[2] ?? 0, box[3] ?? 0);
  throw new ImageRejected('SVG senza dimensioni (width e height o viewBox)');
}

/**
 * Pure: strict check of an SVG, refused at the first doubt (it is never rewritten). UTF-8 text with an optional XML
 * declaration, comments, a root `<svg>` in the SVG namespace, only the elements of SVG_ELEMENTS, quoted attributes
 * without `on*`, without references other than `#id`, without `javascript:`, without entities other than the five
 * predefined; no DOCTYPE/ENTITY, CDATA or processing instructions; `<style>` without url() other than `#id`.
 */
export function checkSvg(buf: Buffer): ImageInfo {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new ImageRejected('SVG non in UTF-8');
  }
  if (text.includes('\u0000')) throw new ImageRejected('SVG non valido');
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const declaration = /^\s*<\?xml\s([^?<>]*)\?>/y;
  declaration.lastIndex = pos;
  const xml = declaration.exec(text);
  if (xml) {
    // The file is checked and served as UTF-8: another declared encoding would be read differently by the browser.
    const encoding = /\bencoding\s*=\s*(["'])([^"']*)\1/i.exec(xml[1] ?? '');
    if (encoding && !/^utf-?8$/i.test(encoding[2] ?? '')) throw new ImageRejected('SVG con codifica diversa da UTF-8');
    pos = declaration.lastIndex;
  }
  const lower = text.toLowerCase();
  if (lower.includes('<!doctype') || lower.includes('<!entity')) throw new ImageRejected('SVG con DOCTYPE o entità');
  if (lower.includes('<![cdata[')) throw new ImageRejected('SVG con sezioni CDATA');
  if (text.indexOf('<?', pos) !== -1) throw new ImageRejected('SVG con istruzioni di elaborazione');

  const stack: string[] = [];
  let root: ImageInfo | null = null;
  let closedRoot = false;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    const chunk = lt === -1 ? text.slice(pos) : text.slice(pos, lt);
    if (XML_ENTITY.test(chunk)) throw new ImageRejected('SVG con entità non ammesse');
    if (stack.at(-1) === 'style') checkCss(chunk);
    else if (stack.length === 0 && chunk.trim() !== '') throw new ImageRejected('SVG non valido');
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new ImageRejected('SVG non valido');
      pos = end + 3;
      continue;
    }
    if (text[lt + 1] === '/') {
      const close = /<\/([A-Za-z][\w.-]*)\s*>/y;
      close.lastIndex = lt;
      const m = close.exec(text);
      if (!m || stack.pop() !== m[1]) throw new ImageRejected('SVG non valido');
      if (stack.length === 0) closedRoot = true;
      pos = close.lastIndex;
      continue;
    }
    const open = /<([A-Za-z][\w.:-]*)/y;
    open.lastIndex = lt;
    const m = open.exec(text);
    const name = m?.[1];
    if (!name) throw new ImageRejected('SVG non valido');
    if (!SVG_ELEMENTS.has(name)) throw new ImageRejected(`SVG con elemento non ammesso: ${name.slice(0, 40)}`);
    if (closedRoot || (stack.length === 0 && name !== 'svg')) throw new ImageRejected('SVG non valido');
    let cursor = open.lastIndex;
    const attributes = new Map<string, string>();
    for (;;) {
      ATTRIBUTE.lastIndex = cursor;
      const a = ATTRIBUTE.exec(text);
      if (!a?.[1] || !a[2]) break;
      const value = a[2].slice(1, -1);
      if (attributes.has(a[1])) throw new ImageRejected('SVG con attributi ripetuti');
      checkAttribute(a[1], value);
      attributes.set(a[1], value);
      cursor = ATTRIBUTE.lastIndex;
    }
    const end = /\s*(\/?)>/y;
    end.lastIndex = cursor;
    const e = end.exec(text);
    if (!e) throw new ImageRejected('SVG con attributi non ammessi');
    if (stack.length === 0) {
      if (attributes.get('xmlns') !== SVG_NS) throw new ImageRejected('SVG senza namespace SVG');
      root = { mime: 'image/svg+xml', ...svgSize(attributes) };
    }
    if (e[1] === '/') {
      if (stack.length === 0) closedRoot = true;
    } else stack.push(name);
    pos = end.lastIndex;
  }
  if (!root || !closedRoot || stack.length > 0) throw new ImageRejected('SVG non valido');
  return root;
}

const looksLikeXml = (buf: Buffer): boolean => {
  let i = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  return buf[i] === 0x3c;
};

/**
 * Pure: type and size of an image recognized from its bytes alone: PNG, JPEG, WebP or a strictly checked SVG.
 * Throws ImageRejected for anything else (the declared name and type of the upload are never used).
 */
export function inspectImage(buf: Buffer): ImageInfo {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return readPng(buf);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return readJpeg(buf);
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return readWebp(buf);
  if (looksLikeXml(buf)) return checkSvg(buf);
  throw new ImageRejected('Formato non ammesso: usa PNG, JPEG, WebP o SVG');
}
