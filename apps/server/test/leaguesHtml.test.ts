import { describe, expect, it } from 'vitest';
import {
  byTag,
  decodeEntities,
  extractTables,
  findAll,
  findFirst,
  parseHtml,
  selectOptions,
  textOf,
  tokenize,
} from '../src/leagues/html.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(decodeEntities('Venerd&iacute; &amp; Luned&igrave; &laquo;x&raquo;')).toBe('Venerdí & Lunedì «x»');
    expect(decodeEntities('&#34;prima&#34; &#x27;a&#X27;')).toBe('"prima" \'a\'');
    expect(decodeEntities('a&nbsp;b')).toBe('a\u00a0b');
  });

  it('leaves unknown or unterminated entities and replaces invalid code points', () => {
    expect(decodeEntities('&nonesiste; &amp senza')).toBe('&nonesiste; &amp senza');
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('\ufffd\ufffd\ufffd');
  });
});

describe('tokenize', () => {
  it('reads tags, attributes (quoted, unquoted, empty) and text', () => {
    const tokens = tokenize('<option selected value=2026>2026/2027</option><a href=\'/x\' title="a &amp; b">t</a>');
    expect(tokens).toEqual([
      { type: 'start', name: 'option', attrs: { selected: '', value: '2026' }, selfClosing: false },
      { type: 'text', text: '2026/2027' },
      { type: 'end', name: 'option' },
      { type: 'start', name: 'a', attrs: { href: '/x', title: 'a & b' }, selfClosing: false },
      { type: 'text', text: 't' },
      { type: 'end', name: 'a' },
    ]);
  });

  it('drops comments, doctype, scripts and styles; keeps the title as text', () => {
    const tokens = tokenize(
      '<!DOCTYPE html><!-- <td>no</td> --><title>A &amp; B</title><script>if (a<b) "</td>"</script><style>td{}</style>x',
    );
    expect(tokens.filter((t) => t.type === 'text').map((t) => (t.type === 'text' ? t.text : ''))).toEqual([
      'A & B',
      'x',
    ]);
  });

  it('reads a tag without its closing bracket like a browser (the next tag becomes attributes)', () => {
    const [tr] = tokenize('<tr title=""  onclick="go()"\n<td colspan="8"><span>Gara 3</span>');
    expect(tr).toEqual({
      type: 'start',
      name: 'tr',
      attrs: { title: '', onclick: 'go()', '<td': '', colspan: '8' },
      selfClosing: false,
    });
  });

  it('never throws on broken input', () => {
    for (const broken of ['<', '<a href="never closed', '</', '<!--', '<<>>', '<a b=>', '&#;'])
      expect(() => parseHtml(broken)).not.toThrow();
  });
});

describe('parseHtml and tables', () => {
  it('builds nested elements and closes cells and rows implicitly', () => {
    const doc = parseHtml('<table><tr><td>a<td>b<tr><th>c</table><p>dopo</p>');
    const [table] = extractTables(doc);
    expect(table?.rows.map((r) => r.cells.map((c) => [c.tag, c.text]))).toEqual([
      [
        ['td', 'a'],
        ['td', 'b'],
      ],
      [['th', 'c']],
    ]);
    expect(textOf(findFirst(doc, byTag('p')) ?? doc)).toBe('dopo');
  });

  it('keeps the rows of a nested table out of the outer one, also when the outer is never closed', () => {
    const doc = parseHtml(
      '<table id="outer"><div>titolo</div><table id="inner"><tr><td>1</td></tr></table>' +
        '<table id="inner2"><tr><td>2</td></tr></td></tr></table>',
    );
    const tables = extractTables(doc);
    expect(tables.map((t) => [t.attrs.id, t.rows.length])).toEqual([
      ['outer', 0],
      ['inner', 1],
      ['inner2', 1],
    ]);
  });

  it('reads cells with links, colspan and line breaks', () => {
    const doc = parseHtml(
      '<table><tr><td colspan="2" onclick="x(\'/team/6865\')">Sir&nbsp;Susa\n  Scai</td>' +
        '<td><a href="https://www.legavolley.it/match/39283">\n 3-1 \n</a></td>' +
        '<td>Pala MAGIS<br>Verona (VR)</td></tr></table>',
    );
    const [row] = extractTables(doc)[0]?.rows ?? [];
    expect(row?.cells.map((c) => ({ text: c.text, links: c.links, colspan: c.colspan }))).toEqual([
      { text: 'Sir Susa\nScai', links: [], colspan: 2 },
      { text: '3-1', links: ['https://www.legavolley.it/match/39283'], colspan: 1 },
      { text: 'Pala MAGIS\nVerona (VR)', links: [], colspan: 1 },
    ]);
    expect(row?.cells[0]?.attrs.onclick).toBe("x('/team/6865')");
  });

  it('ignores end tags of table parts outside their table and unknown end tags', () => {
    const doc = parseHtml('<div><table><tr><td>a</div>b</td></tr></table></span>c</div>');
    const [table] = extractTables(doc);
    expect(table?.rows[0]?.cells[0]?.text).toBe('ab');
    expect(textOf(doc)).toBe('ab\nc');
  });

  it('reads the options of a select box with the selected one', () => {
    const doc = parseHtml(
      '<select id="Fase"><option value=1>Andata<option selected value=2>Ritorno</select><select id="x"></select>',
    );
    expect(selectOptions(doc, 'Fase')).toEqual([
      { value: '1', text: 'Andata', selected: false },
      { value: '2', text: 'Ritorno', selected: true },
    ]);
    expect(selectOptions(doc, 'Nessuna')).toBeNull();
  });

  it('survives very deep nesting without recursion', () => {
    const deep = '<div>'.repeat(5000) + 'fondo' + '</div>'.repeat(5000);
    const doc = parseHtml(deep);
    expect(textOf(doc)).toBe('fondo');
    expect(findAll(doc, byTag('div')).length).toBe(5000);
  });
});
