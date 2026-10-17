import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaletteScope } from './usePalette.ts';
import { PaletteScopeContext, usePalette, usePaletteKey } from './usePalette.ts';

function Probe() {
  const palette = usePalette();
  const { key } = usePaletteKey();
  return (
    <output data-testid="palette" data-key={key}>
      {palette.home}
    </output>
  );
}

/** A scope with its own colours, like the preview of the «Studio grafico». */
function Scope({ home, children }: { home: string; children: React.ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const scope: PaletteScope | null = root ? { root, key: home } : null;
  return (
    <div ref={setRoot} data-sir-scope="" style={{ ['--sir-home' as string]: home }}>
      <PaletteScopeContext.Provider value={scope}>{children}</PaletteScopeContext.Provider>
    </div>
  );
}

afterEach(cleanup);

describe('palette of the charts', () => {
  it('outside a scope reads <html>; inside one, the colours of the scope, read again when they change', () => {
    document.documentElement.style.setProperty('--sir-home', '#111111');
    const { rerender } = render(<Probe />);
    expect(screen.getByTestId('palette').textContent).toBe('#111111');
    rerender(
      <Scope home="#e30613">
        <Probe />
      </Scope>,
    );
    expect(screen.getByTestId('palette').textContent).toBe('#e30613');
    rerender(
      <Scope home="#1d4ed8">
        <Probe />
      </Scope>,
    );
    expect(screen.getByTestId('palette').textContent).toBe('#1d4ed8');
    expect(screen.getByTestId('palette').dataset.key).toContain('#1d4ed8');
    document.documentElement.style.removeProperty('--sir-home');
  });
});
