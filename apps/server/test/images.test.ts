import { describe, expect, it } from 'vitest';
import { ImageRejected, inspectImage } from '../src/lib/images.js';
import { jpeg, png, svg, webp, webpExtended } from './imageFixtures.js';

const rejected = (buf: Buffer): boolean => {
  try {
    inspectImage(buf);
    return false;
  } catch (err) {
    if (err instanceof ImageRejected) return true;
    throw err;
  }
};

describe('raster images recognized from the bytes', () => {
  it('reads type and size of PNG, JPEG and WebP', () => {
    expect(inspectImage(png(64, 32))).toEqual({ mime: 'image/png', width: 64, height: 32 });
    expect(inspectImage(jpeg(800, 600))).toEqual({ mime: 'image/jpeg', width: 800, height: 600 });
    expect(inspectImage(webp(300, 150))).toEqual({ mime: 'image/webp', width: 300, height: 150 });
    expect(inspectImage(webpExtended(4000, 20))).toEqual({ mime: 'image/webp', width: 4000, height: 20 });
  });

  it('rejects polyglots: valid images with HTML or script appended', () => {
    const tail = Buffer.from('<html><script>alert(1)</script></html>');
    expect(rejected(Buffer.concat([png(4, 4), tail]))).toBe(true);
    expect(rejected(Buffer.concat([jpeg(4, 4), tail]))).toBe(true);
    expect(rejected(Buffer.concat([webp(4, 4), tail]))).toBe(true);
  });

  it('rejects truncated or broken files, other formats and oversized images', () => {
    expect(rejected(png(4, 4).subarray(0, 40))).toBe(true);
    expect(rejected(jpeg(4, 4).subarray(0, 10))).toBe(true);
    expect(rejected(Buffer.from('GIF89a\x01\x00\x01\x00'))).toBe(true);
    expect(rejected(Buffer.from('<html><body>ciao</body></html>'))).toBe(true);
    expect(rejected(Buffer.from('%PDF-1.7'))).toBe(true);
    expect(rejected(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(true);
    expect(rejected(png(4097, 10))).toBe(true);
    expect(inspectImage(png(4096, 1))).toMatchObject({ width: 4096 });
    expect(rejected(png(0, 10).fill(0, 16, 20))).toBe(true);
  });
});

describe('SVG strict check', () => {
  it('accepts a plain logo, sizing it from width/height or the viewBox', () => {
    const logo = svg(
      '<title>Logo</title><defs><linearGradient id="g"><stop offset="0" stop-color="#003399"/></linearGradient></defs>' +
        '<rect width="120" height="40" fill="url(#g)"/><text x="4" y="30" style="font-weight:700">SIR &amp; co</text>' +
        '<use href="#g"/><!-- commento -->',
    );
    expect(inspectImage(logo)).toEqual({ mime: 'image/svg+xml', width: 120, height: 40 });
    expect(inspectImage(svg('<circle r="5"/>', 'width="48px" height="48"'))).toMatchObject({ width: 48, height: 48 });
    expect(inspectImage(svg('<style>.a{fill:url(#g)}</style><path class="a" d="M0 0h1v1z"/>'))).toMatchObject({
      mime: 'image/svg+xml',
    });
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['script in upper case', '<SCRIPT>alert(1)</SCRIPT>'],
    ['onload', '<rect width="1" height="1" onload="alert(1)"/>'],
    ['onclick in upper case', '<rect width="1" height="1" ONCLICK="alert(1)"/>'],
    ['foreignObject', '<foreignObject><div>x</div></foreignObject>'],
    ['javascript: href', '<a href="javascript:alert(1)"><text>x</text></a>'],
    ['javascript: in use', '<use href="javascript:alert(1)"/>'],
    ['javascript: with a tab', '<use href="java\tscript:alert(1)"/>'],
    ['external xlink:href', '<use xlink:href="https://evil.example/x.svg#a"/>'],
    ['external image', '<image href="https://evil.example/x.png"/>'],
    ['numeric entity', '<use href="&#106;avascript:alert(1)"/>'],
    ['custom entity', '<text>&xxe;</text>'],
    ['style with external url()', '<style>rect{fill:url(https://evil.example/a)}</style>'],
    ['style with @import', '<style>@import "https://evil.example/a.css";</style>'],
    ['style with escapes', '<style>rect{fill:u\\72l(https://evil.example/a)}</style>'],
    ['style attribute with url()', '<rect width="1" height="1" style="fill:url(//evil.example/a)"/>'],
    ['fill with external url()', '<rect width="1" height="1" fill="url(https://evil.example/a#b)"/>'],
    ['style with image-set()', '<style>rect{fill:image-set("https://evil.example/a.png" 1x)}</style>'],
    ['style with -webkit-image-set()', '<rect width="1" height="1" style="fill:-webkit-image-set(\'a.png\' 1x)"/>'],
    ['style with src()', '<style>rect{fill:src("https://evil.example/a.png")}</style>'],
    ['fill with image-set()', '<rect width="1" height="1" fill="image-set(\'https://evil.example/a.png\' 1x)"/>'],
    ['CDATA', '<style><![CDATA[rect{}]]></style>'],
    ['processing instruction', '<?xml-stylesheet href="https://evil.example/a.css"?><rect/>'],
    ['animation that sets href', '<set attributeName="href" to="javascript:alert(1)"/>'],
    ['XHTML namespace', '<g xmlns="http://www.w3.org/1999/xhtml"><rect/></g>'],
    ['prefixed element', '<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script>'],
    ['unquoted attribute', '<rect width=1 height="1"/>'],
    ['iframe', '<iframe src="https://evil.example"/>'],
    ['feImage', '<filter id="f"><feImage href="https://evil.example/a.png"/></filter>'],
  ])('rejects %s', (_label, inner) => {
    expect(rejected(svg(inner))).toBe(true);
  });

  it('accepts only UTF-8 (declared or not) and rejects another declared encoding', () => {
    const body = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>';
    expect(inspectImage(Buffer.from(body)).mime).toBe('image/svg+xml');
    expect(inspectImage(Buffer.from(`<?xml version="1.0" encoding="utf-8"?>${body}`)).mime).toBe('image/svg+xml');
    expect(inspectImage(Buffer.from(`<?xml version="1.0"?>${body}`)).mime).toBe('image/svg+xml');
    for (const enc of ['ISO-2022-JP', 'UTF-16', 'iso-8859-1', 'utf-7']) {
      expect(rejected(Buffer.from(`<?xml version="1.0" encoding="${enc}"?>${body}`))).toBe(true);
    }
  });

  it('rejects DOCTYPE and entity declarations (XXE, billion laughs)', () => {
    const doc = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&a;</text></svg>',
    );
    expect(rejected(doc)).toBe(true);
  });

  it('rejects a root that is not <svg>, a missing namespace, missing sizes, broken nesting and text outside', () => {
    expect(rejected(Buffer.from('<html xmlns="http://www.w3.org/2000/svg"></html>'))).toBe(true);
    expect(rejected(Buffer.from('<svg viewBox="0 0 1 1"></svg>'))).toBe(true);
    expect(rejected(svg('<rect/>', ''))).toBe(true);
    expect(rejected(svg('<g><rect/>'))).toBe(true);
    expect(rejected(Buffer.concat([svg('<rect/>'), Buffer.from('<script>alert(1)</script>')]))).toBe(true);
    expect(rejected(Buffer.concat([svg('<rect/>'), Buffer.from('testo')]))).toBe(true);
    expect(rejected(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe]))).toBe(true);
  });
});
