import { createHash } from 'node:crypto';
import { decodeDvw, extractScoutLines } from '@arenalive/dvw-parser';
import { generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import { describe, expect, it } from 'vitest';
import {
  IngestRequestSchema,
  IngestResponseSchema,
  buildDvwText,
  diffScoutLines,
  hashScoutLines,
  splitDvwText,
} from './index.js';

const HASH = 'a'.repeat(64);
const base = { protocol: 1, matchKey: 'gara-01_2024.25', seq: 0, fromIndex: 0, lines: ['a'], contentHash: HASH };

describe('diffScoutLines', () => {
  it('appends when prev is a prefix of next', () => {
    expect(diffScoutLines(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual({
      kind: 'append',
      fromIndex: 2,
      lines: ['c', 'd'],
    });
  });
  it('appends zero lines when nothing changed', () => {
    expect(diffScoutLines(['a'], ['a'])).toEqual({ kind: 'append', fromIndex: 1, lines: [] });
    expect(diffScoutLines([], [])).toEqual({ kind: 'append', fromIndex: 0, lines: [] });
  });
  it('appends everything from an empty previous file', () => {
    expect(diffScoutLines([], ['a'])).toEqual({ kind: 'append', fromIndex: 0, lines: ['a'] });
  });
  it('sends a snapshot when a past line changed', () => {
    expect(diffScoutLines(['a', 'b', 'c'], ['a', 'X', 'c', 'd'])).toEqual({
      kind: 'snapshot',
      fromIndex: 0,
      lines: ['a', 'X', 'c', 'd'],
    });
  });
  it('sends a snapshot when lines were removed', () => {
    expect(diffScoutLines(['a', 'b'], ['a'])).toEqual({ kind: 'snapshot', fromIndex: 0, lines: ['a'] });
  });
  it('does not alias the input array', () => {
    const next = ['x'];
    const d = diffScoutLines(['y'], next);
    d.lines.push('z');
    expect(next).toEqual(['x']);
  });
});

describe('hashScoutLines', () => {
  it('is the sha256 hex of the lines joined with \\n', async () => {
    const lines = ['*14SH+;;', 'aèé;€'];
    const expected = createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
    expect(await hashScoutLines(lines)).toBe(expected);
  });
  it('hashes the empty list as the empty string', async () => {
    expect(await hashScoutLines([])).toBe(createHash('sha256').update('').digest('hex'));
  });
});

describe('splitDvwText / buildDvwText', () => {
  it('round-trips a simulated file', () => {
    const match = generateMatch({ seed: 3 });
    const text = decodeDvw(renderDvw(match, 120));
    const { header, scoutLines } = splitDvwText(text);
    expect(header).toContain('[3TEAMS]');
    expect(header).not.toContain('[3SCOUT]');
    expect(scoutLines).toEqual(extractScoutLines(text));
    expect(scoutLines).toHaveLength(120);
    const rebuilt = buildDvwText(header, scoutLines);
    expect(extractScoutLines(rebuilt)).toEqual(scoutLines);
    expect(splitDvwText(rebuilt).header.replace(/\r/g, '').trimEnd()).toBe(header.replace(/\r/g, '').trimEnd());
  });
  it('treats a text without [3SCOUT] as header only', () => {
    expect(splitDvwText('[3MATCH]\nx')).toEqual({ header: '[3MATCH]\nx', scoutLines: [] });
  });
  it('builds a file with an empty header', () => {
    expect(buildDvwText('', ['a', 'b'])).toBe('[3SCOUT]\na\nb\n');
  });
});

describe('IngestRequestSchema', () => {
  it('accepts a valid append', () => {
    expect(IngestRequestSchema.safeParse({ ...base, kind: 'append' }).success).toBe(true);
  });
  it('requires the header with a snapshot', () => {
    expect(IngestRequestSchema.safeParse({ ...base, kind: 'snapshot' }).success).toBe(false);
    expect(IngestRequestSchema.safeParse({ ...base, kind: 'snapshot', header: 'h' }).success).toBe(true);
  });
  it('accepts a header with other sections and lines with brackets', () => {
    const ok = { ...base, kind: 'append', header: '[3DATAVOLLEYSCOUT]\n[3MATCH]\n', lines: ['*P01;[x]'] };
    expect(IngestRequestSchema.safeParse(ok).success).toBe(true);
  });
  it('requires fromIndex 0 with a snapshot', () => {
    expect(IngestRequestSchema.safeParse({ ...base, kind: 'snapshot', header: 'h', fromIndex: 3 }).success).toBe(false);
  });
  it.each([
    ['protocol', { protocol: 2 }],
    ['matchKey empty', { matchKey: '' }],
    ['matchKey with a slash', { matchKey: 'a/b' }],
    ['matchKey too long', { matchKey: 'a'.repeat(129) }],
    ['negative seq', { seq: -1 }],
    ['fractional seq', { seq: 1.5 }],
    ['negative fromIndex', { fromIndex: -1 }],
    ['too many lines', { lines: Array.from({ length: 5001 }, () => 'x') }],
    ['line too long', { lines: ['x'.repeat(2001)] }],
    ['header too long', { header: 'x'.repeat(512 * 1024 + 1) }],
    ['line with \\n', { lines: ['a\nb'] }],
    ['line with \\r', { lines: ['a\rb'] }],
    ['line that opens a section', { lines: ['[3SCOUT]'] }],
    ['line with NUL', { lines: ['a\u0000b'] }],
    ['header with NUL', { header: '[3MATCH]\u0000' }],
    ['header with [3SCOUT]', { header: '[3MATCH]\n[3SCOUT]\n' }],
    ['bad hash', { contentHash: 'ABC' }],
    ['unknown kind', { kind: 'replace' }],
  ])('rejects %s', (_name, patch) => {
    expect(IngestRequestSchema.safeParse({ ...base, kind: 'append', ...patch }).success).toBe(false);
  });
});

describe('IngestResponseSchema', () => {
  it('accepts the server responses', () => {
    expect(IngestResponseSchema.safeParse({ status: 'ok', seq: 3, lineCount: 10, contentHash: HASH }).success).toBe(
      true,
    );
    expect(IngestResponseSchema.safeParse({ status: 'needSnapshot', seq: -1, lineCount: 0 }).success).toBe(true);
    expect(IngestResponseSchema.safeParse({ status: 'boh', seq: 0, lineCount: 0 }).success).toBe(false);
  });
});
