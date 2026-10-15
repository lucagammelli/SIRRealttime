import { formatShortCode } from '@sir/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button, CopyButton } from '../components/ui.tsx';
import { useTenantLook } from '../lib/branding.ts';
import { qrPngDataUrl, readLogoDataUrl } from './qrCanvas.ts';
import { qrSvg, svgDataUrl } from './qrImage.ts';

export interface ShareQrProps {
  /** Address encoded in the QR (the short link). */
  url: string;
  /** Canonical short code (shown under the QR as «K7M2-QX9P»). */
  code: string;
  /** Square logo in the middle; default: the logoMark of the client in use; null: none. */
  logoSrc?: string | null;
  /** Buttons «Copia link», «Scarica QR (PNG)», «Scarica QR (SVG)»; false: only the QR (pause, maxischermo). */
  actions?: boolean;
  /** Classes of the preview image (size). */
  imageClassName?: string;
}

function download(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * QR code of a public link, made in the browser without network (error correction H, logo of the client in the
 * middle, code under it), with copy and download of the PNG (1024 px, for printing) and of the SVG.
 */
export function ShareQr({ url, code, logoSrc, actions = true, imageClassName = 'h-auto w-36' }: ShareQrProps) {
  const look = useTenantLook();
  const logo = logoSrc === undefined ? (look?.images.logoMark ?? null) : logoSrc;
  const caption = formatShortCode(code);
  const [loaded, setLoaded] = useState<{ src: string; dataUrl: string | null } | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [pngError, setPngError] = useState(false);

  useEffect(() => {
    if (!logo) return;
    let alive = true;
    void readLogoDataUrl(logo).then((dataUrl) => {
      if (alive) setLoaded({ src: logo, dataUrl });
    });
    return () => {
      alive = false;
    };
  }, [logo]);

  // undefined: the logo is still loading (the QR waits for it, so it is not drawn twice).
  const logoDataUrl = !logo ? null : loaded?.src === logo ? loaded.dataUrl : undefined;
  const svg = useMemo(
    () => (logoDataUrl === undefined ? null : svgDataUrl(qrSvg(url, { caption, logoDataUrl }))),
    [url, caption, logoDataUrl],
  );

  const savePng = async (): Promise<void> => {
    setPngBusy(true);
    setPngError(false);
    try {
      download(await qrPngDataUrl(url, { caption, logoDataUrl: logoDataUrl ?? null }), `qr-${code}.png`);
    } catch {
      setPngError(true);
    } finally {
      setPngBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-3">
      {svg ? (
        <img src={svg} alt={`Codice QR del link ${caption}`} className={`rounded-card ${imageClassName}`} />
      ) : (
        <div role="status" className={`animate-pulse rounded-card bg-surface-2 ${imageClassName} aspect-[1024/1184]`}>
          <span className="sr-only">Preparazione del codice QR…</span>
        </div>
      )}
      {actions && (
        <div className="flex flex-col items-start gap-2">
          <CopyButton text={url} label="Copia link" />
          <Button onClick={() => void savePng()} disabled={!svg || pngBusy}>
            {pngBusy ? 'Preparazione…' : 'Scarica QR (PNG)'}
          </Button>
          <Button onClick={() => svg && download(svg, `qr-${code}.svg`)} disabled={!svg}>
            Scarica QR (SVG)
          </Button>
          {pngError && (
            <p role="alert" className="text-xs text-danger">
              Non è stato possibile creare il PNG in questo browser: scarica l’SVG.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
