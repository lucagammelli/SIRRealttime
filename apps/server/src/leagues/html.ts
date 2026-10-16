/**
 * Minimal HTML reader written for the pages of the official league sites (no external library): a tokenizer of tags
 * and text, a forgiving tree builder with the few implied-close rules that tables need, and helpers to read tables,
 * select boxes and text. Pure functions: no I/O, same input same output. Malformed HTML never throws: it is read the
 * way a browser would read it, as far as these pages need.
 */

export interface HtmlElement {
  type: 'element';
  /** Lower case tag name (`#document` for the root). */
  name: string;
  /** Attributes with lower case names and decoded values (an attribute without value is `''`). */
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElement | null;
}

export interface HtmlText {
  type: 'text';
  text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

export type HtmlToken =
  | { type: 'start'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'text'; text: string };

/** Named entities of the pages (Italian letters, punctuation); the numeric ones are always decoded. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  agrave: 'à',
  aacute: 'á',
  egrave: 'è',
  eacute: 'é',
  igrave: 'ì',
  iacute: 'í',
  ograve: 'ò',
  oacute: 'ó',
  ugrave: 'ù',
  uacute: 'ú',
  Agrave: 'À',
  Aacute: 'Á',
  Egrave: 'È',
  Eacute: 'É',
  Igrave: 'Ì',
  Iacute: 'Í',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ntilde: 'ñ',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  deg: '°',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  ordf: 'ª',
  ordm: 'º',
  acute: '´',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  times: '×',
  bull: '•',
};

const ENTITY = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

const codePoint = (n: number): string =>
  n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '\ufffd' : String.fromCodePoint(n);

/** Pure: text with the HTML entities decoded (unknown named entities are left as written). */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return codePoint(Number.parseInt(dec, 10));
    if (hex !== undefined) return codePoint(Number.parseInt(hex, 16));
    return (name !== undefined ? NAMED_ENTITIES[name] : undefined) ?? whole;
  });
}

/** Elements whose content is not HTML: skipped (script, style) or kept as plain text (title, textarea). */
const RAW_TEXT = new Set(['script', 'style']);
const RCDATA = new Set(['title', 'textarea']);
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const TAG_START = /[A-Za-z]/;

/** Pure: tokens of an HTML text (comments, doctype and the content of script and style are dropped). */
export function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const n = html.length;
  let pos = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    if (end > textStart) tokens.push({ type: 'text', text: decodeEntities(html.slice(textStart, end)) });
  };
  while (pos < n) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) break;
    const next = html[lt + 1];
    if (html.startsWith('<!--', lt)) {
      flushText(lt);
      const end = html.indexOf('-->', lt + 4);
      pos = end === -1 ? n : end + 3;
      textStart = pos;
      continue;
    }
    if (next === '!' || next === '?') {
      flushText(lt);
      const end = html.indexOf('>', lt + 2);
      pos = end === -1 ? n : end + 1;
      textStart = pos;
      continue;
    }
    if (next === '/' && TAG_START.test(html[lt + 2] ?? '')) {
      flushText(lt);
      let i = lt + 2;
      while (i < n && !isSpace(html[i]) && html[i] !== '>' && html[i] !== '/') i++;
      const name = html.slice(lt + 2, i).toLowerCase();
      const end = html.indexOf('>', i);
      pos = end === -1 ? n : end + 1;
      textStart = pos;
      tokens.push({ type: 'end', name });
      continue;
    }
    if (next === undefined || !TAG_START.test(next)) {
      pos = lt + 1;
      continue;
    }
    flushText(lt);
    const tag = readStartTag(html, lt);
    tokens.push({ type: 'start', name: tag.name, attrs: tag.attrs, selfClosing: tag.selfClosing });
    pos = tag.end;
    textStart = pos;
    if (RAW_TEXT.has(tag.name) || RCDATA.has(tag.name)) {
      // The name is one of RAW_TEXT/RCDATA (letters only): safe in a pattern.
      const closing = new RegExp(`</${tag.name}`, 'ig');
      closing.lastIndex = pos;
      const close = closing.exec(html)?.index ?? -1;
      const contentEnd = close === -1 ? n : close;
      if (RCDATA.has(tag.name) && contentEnd > pos)
        tokens.push({ type: 'text', text: decodeEntities(html.slice(pos, contentEnd)) });
      const gt = close === -1 ? -1 : html.indexOf('>', close);
      pos = gt === -1 ? n : gt + 1;
      textStart = pos;
      tokens.push({ type: 'end', name: tag.name });
    }
  }
  flushText(n);
  return tokens;
}

/**
 * Start tag at `lt`: name and attributes read like a browser does (an attribute name is anything up to a space, `/`,
 * `>` or `=`, so `<tr title="" <td colspan="8">` is one `tr` tag); a missing closing quote takes the rest of the text.
 */
function readStartTag(
  html: string,
  lt: number,
): { name: string; attrs: Record<string, string>; selfClosing: boolean; end: number } {
  const n = html.length;
  let i = lt + 1;
  while (i < n && !isSpace(html[i]) && html[i] !== '>' && html[i] !== '/') i++;
  const name = html.slice(lt + 1, i).toLowerCase();
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (i < n) {
    while (i < n && isSpace(html[i])) i++;
    const c = html[i];
    if (c === undefined) break;
    if (c === '>') {
      i++;
      return { name, attrs, selfClosing, end: i };
    }
    if (c === '/') {
      selfClosing = html[i + 1] === '>';
      i++;
      continue;
    }
    const nameStart = i;
    i++;
    while (i < n && !isSpace(html[i]) && html[i] !== '>' && html[i] !== '/' && html[i] !== '=') i++;
    const attrName = html.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < n && isSpace(html[j])) j++;
    let value = '';
    if (html[j] === '=') {
      j++;
      while (j < n && isSpace(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1);
        const valueEnd = close === -1 ? n : close;
        value = html.slice(j + 1, valueEnd);
        i = close === -1 ? n : close + 1;
      } else {
        const valueStart = j;
        while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        value = html.slice(valueStart, j);
        i = j;
      }
    }
    if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value);
  }
  return { name, attrs, selfClosing, end: n };
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const TABLE_SECTIONS = new Set(['tbody', 'thead', 'tfoot']);
const CELLS = new Set(['td', 'th']);
/** End tags of table parts never close anything outside their own table. */
const TABLE_SCOPED = new Set(['tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption']);
/** Deepest nesting kept: past it new elements become siblings (no runaway depth from broken pages). */
const MAX_DEPTH = 512;

/** Pure: tree of an HTML text, root `#document`. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: 'element', name: '#document', attrs: {}, children: [], parent: null };
  const stack: HtmlElement[] = [root];
  const current = (): HtmlElement => stack[stack.length - 1] ?? root;
  /** Index in the stack of the nearest open element named in `names`, not looking past `boundary`. */
  const openIndex = (names: Set<string>, boundary: Set<string>): number => {
    for (let k = stack.length - 1; k > 0; k--) {
      const el = stack[k];
      if (!el) continue;
      if (names.has(el.name)) return k;
      if (boundary.has(el.name)) return -1;
    }
    return -1;
  };
  const popTo = (index: number) => {
    stack.length = Math.max(1, index);
  };
  const TABLE = new Set(['table']);
  for (const token of tokenize(html)) {
    if (token.type === 'text') {
      current().children.push({ type: 'text', text: token.text });
      continue;
    }
    if (token.type === 'start') {
      const { name } = token;
      // Implied ends: a new row ends the open row, a new cell the open cell, a new option the open option.
      if (name === 'tr') {
        const k = openIndex(new Set(['tr']), new Set(['table', ...TABLE_SECTIONS]));
        if (k !== -1) popTo(k);
      } else if (CELLS.has(name)) {
        const k = openIndex(CELLS, new Set(['table', 'tr']));
        if (k !== -1) popTo(k);
      } else if (TABLE_SECTIONS.has(name)) {
        const k = openIndex(new Set([...TABLE_SECTIONS, 'tr', 'td', 'th']), TABLE);
        if (k !== -1) popTo(k);
      } else if (name === 'option') {
        const k = openIndex(new Set(['option']), new Set(['select']));
        if (k !== -1) popTo(k);
      } else if (name === 'li') {
        const k = openIndex(new Set(['li']), new Set(['ul', 'ol']));
        if (k !== -1) popTo(k);
      }
      const parent = current();
      const el: HtmlElement = { type: 'element', name, attrs: token.attrs, children: [], parent };
      parent.children.push(el);
      if (!VOID.has(name) && !token.selfClosing && stack.length < MAX_DEPTH) stack.push(el);
      continue;
    }
    const { name } = token;
    if (VOID.has(name)) continue;
    const boundary =
      name === 'table' ? new Set<string>() : TABLE_SCOPED.has(name) ? TABLE : new Set(['table', 'td', 'th']);
    const k = openIndex(new Set([name]), boundary);
    if (k !== -1) popTo(k);
  }
  return root;
}

/** Elements under `node` (not `node` itself) in document order that satisfy `test`. */
export function findAll(node: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement[] {
  const found: HtmlElement[] = [];
  const pending: HtmlNode[] = [...node.children].reverse();
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (item.type !== 'element') continue;
    if (test(item)) found.push(item);
    for (let k = item.children.length - 1; k >= 0; k--) {
      const child = item.children[k];
      if (child) pending.push(child);
    }
  }
  return found;
}

export function findFirst(node: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement | null {
  return findAll(node, test)[0] ?? null;
}

export const hasClass = (el: HtmlElement, cls: string): boolean => (el.attrs.class ?? '').split(/\s+/).includes(cls);

/** Matcher of an element by tag name and optional class. */
export const byTag =
  (name: string, cls?: string) =>
  (el: HtmlElement): boolean =>
    el.name === name && (cls === undefined || hasClass(el, cls));

/** Matcher of an element by id (case-sensitive, as in HTML). */
export const byId =
  (id: string) =>
  (el: HtmlElement): boolean =>
    el.attrs.id === id;

const BLOCK = new Set([
  'div',
  'p',
  'tr',
  'li',
  'ul',
  'ol',
  'table',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'select',
]);

/**
 * Pure: visible text of a node: `<br>` and block elements break the line, cells are separated by a space, spaces
 * (non-breaking included) are collapsed, lines trimmed and empty lines dropped. Lines joined with `\n`.
 */
export function textOf(node: HtmlNode): string {
  if (node.type === 'text') return normalizeText(node.text);
  const parts: string[] = [];
  type Step = HtmlNode | { close: string };
  const pending: Step[] = [node];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if ('close' in item) {
      parts.push(item.close);
      continue;
    }
    if (item.type === 'text') {
      parts.push(item.text);
      continue;
    }
    if (BLOCK.has(item.name)) parts.push('\n');
    pending.push({ close: BLOCK.has(item.name) ? '\n' : CELLS.has(item.name) ? ' ' : '' });
    for (let k = item.children.length - 1; k >= 0; k--) {
      const child = item.children[k];
      if (child) pending.push(child);
    }
  }
  return normalizeText(parts.join(''));
}

/** Pure: whitespace collapsed per line, lines trimmed, empty lines dropped. */
export function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n|\r/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export interface TableCell {
  tag: 'td' | 'th';
  attrs: Record<string, string>;
  /** Visible text (see `textOf`). */
  text: string;
  /** `href` of the links in the cell, as written. */
  links: string[];
  colspan: number;
  element: HtmlElement;
}

export interface TableRow {
  attrs: Record<string, string>;
  cells: TableCell[];
  /** Visible text of the whole row (also what is outside any cell). */
  text: string;
  element: HtmlElement;
}

export interface HtmlTable {
  attrs: Record<string, string>;
  /** Rows of this table only (the rows of tables nested in it belong to those). */
  rows: TableRow[];
  element: HtmlElement;
}

const nearest = (el: HtmlElement, names: Set<string>): HtmlElement | null => {
  for (let p = el.parent; p; p = p.parent) if (names.has(p.name)) return p;
  return null;
};

const ROW_OWNER = new Set(['table']);
const CELL_OWNER = new Set(['tr', 'table']);

/** Pure: every table of the tree in document order, each with its own rows and cells. */
export function extractTables(root: HtmlElement): HtmlTable[] {
  return findAll(root, byTag('table')).map((table) => ({
    attrs: table.attrs,
    element: table,
    rows: findAll(table, (el) => el.name === 'tr' && nearest(el, ROW_OWNER) === table).map((tr) => ({
      attrs: tr.attrs,
      element: tr,
      text: textOf(tr),
      cells: findAll(tr, (el) => CELLS.has(el.name) && nearest(el, CELL_OWNER) === tr).map((cell) => {
        const span = Number.parseInt(cell.attrs.colspan ?? '1', 10);
        return {
          tag: cell.name === 'th' ? 'th' : 'td',
          attrs: cell.attrs,
          text: textOf(cell),
          links: findAll(cell, byTag('a'))
            .map((a) => a.attrs.href)
            .filter((href): href is string => href !== undefined),
          colspan: Number.isInteger(span) && span > 0 && span < 1000 ? span : 1,
          element: cell,
        };
      }),
    })),
  }));
}

export interface SelectOption {
  value: string;
  text: string;
  selected: boolean;
}

/** Pure: options of the `<select>` with this id, null when there is no such select. */
export function selectOptions(root: HtmlElement, id: string): SelectOption[] | null {
  const select = findFirst(root, (el) => el.name === 'select' && el.attrs.id === id);
  if (!select) return null;
  return findAll(select, byTag('option')).map((o) => ({
    value: (o.attrs.value ?? textOf(o)).trim(),
    text: textOf(o),
    selected: 'selected' in o.attrs,
  }));
}
