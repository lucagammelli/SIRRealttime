import { describe, expect, it } from 'vitest';
import { MAX_GUI_LINE, parseGuiLine } from '../src/gui/protocol.js';

describe('protocollo finestra ↔ agente', () => {
  it('accetta start, stop e quit', () => {
    expect(parseGuiLine('{"type":"start","watchPath":"E:\\\\"}')).toEqual({ type: 'start', watchPath: 'E:\\' });
    expect(parseGuiLine('\uFEFF{"type":"start","watchPath":" F:\\\\partita.dvw ","token":"abc"}')).toEqual({
      type: 'start',
      watchPath: 'F:\\partita.dvw',
      token: 'abc',
    });
    expect(parseGuiLine('{"type":"stop"}')).toEqual({ type: 'stop' });
    expect(parseGuiLine('{"type":"quit"}')).toEqual({ type: 'quit' });
  });

  it.each([
    ['testo qualsiasi'],
    ['{"type":"start"}'],
    ['{"type":"start","watchPath":""}'],
    ['{"type":"start","watchPath":"E:\\\\","extra":1}'],
    ['{"type":"start","watchPath":42}'],
    ['{"type":"rm","path":"C:\\\\"}'],
    ['{"type":"stop","now":true}'],
    ['[{"type":"stop"}]'],
    ['null'],
    [`{"type":"start","watchPath":"${'x'.repeat(MAX_GUI_LINE)}"}`],
  ])('scarta le righe non valide: %s', (line) => {
    expect(parseGuiLine(line)).toBeNull();
  });
});
