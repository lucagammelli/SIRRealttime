import type { BlockOptions } from '@sir/shared';
import { publicAssetPath, SHORT_CODE_PATTERN } from '@sir/shared';
import { useEffect, useState } from 'react';
import { Card } from '../components/ui.tsx';
import { ShareQr } from '../qr/ShareQr.tsx';
import type { BlockEnv } from './env.ts';

const FILL = 'h-full min-h-0';

/** Logo of the client (horizontal or square), otherwise its name. */
export function LogoBlock({ options, env }: { options: BlockOptions<'logo'>; env: BlockEnv }) {
  const name = env.brand?.name ?? 'SIRRealtime';
  const src = options.variant === 'mark' ? env.brand?.logoMark : env.brand?.logoMain;
  return (
    <Card className={FILL} bodyClassName="flex items-center justify-center">
      {src ? (
        <img src={src} alt={name} className="max-h-40 w-auto max-w-full object-contain" />
      ) : (
        <p className="font-display text-3xl font-bold uppercase tracking-widest text-primary">{name}</p>
      )}
    </Card>
  );
}

/**
 * Sponsor images of the client in turn, each for `seconds` (stopped with the rotation of the big screen). The image
 * changes with a short fade, none with reduced motion.
 */
export function SponsorBlock({ options, env }: { options: BlockOptions<'sponsor'>; env: BlockEnv }) {
  const { images, seconds } = options;
  const [index, setIndex] = useState(0);
  const rotating = images.length > 1 && !env.paused;
  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(() => setIndex((i) => i + 1), seconds * 1000);
    return () => clearInterval(id);
  }, [rotating, seconds]);
  const current = images.length > 0 ? images[index % images.length] : undefined;
  return (
    <Card title="Sponsor" className={FILL} bodyClassName="flex items-center justify-center">
      {current ? (
        <img
          key={current}
          src={publicAssetPath(current)}
          alt={`Sponsor ${(index % images.length) + 1} di ${images.length}`}
          className="sir-fade max-h-40 w-auto max-w-full object-contain"
        />
      ) : (
        <p className="text-sm text-muted">Nessuna immagine sponsor scelta.</p>
      )}
    </Card>
  );
}

/** Text of the client, always as plain text (React escapes it: no HTML is ever interpreted). */
export function MessageBlock({ options }: { options: BlockOptions<'message'> }) {
  return (
    <Card className={FILL} bodyClassName="flex items-center justify-center">
      <p
        className={`break-words text-center font-display font-semibold text-text ${
          options.size === 'large' ? 'text-4xl' : 'text-2xl'
        }`}
      >
        {options.text}
      </p>
    </Card>
  );
}

/** Short code of the page when it is open as `/l/<code>`; null for the long link. */
export function shortCodeOf(url: string): string | null {
  try {
    const match = /^\/l\/([^/]+)\/?$/.exec(new URL(url).pathname);
    const code = match?.[1]?.toUpperCase() ?? null;
    return code && SHORT_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Public address of the page now: origin and path, without query (`?tv=1`) and fragment. */
export function currentPageUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** QR code of the address of this page (the short link when opened with it), with a short text. */
export function QrBlock({ options, env }: { options: BlockOptions<'qr'>; env: BlockEnv }) {
  const url = env.pageUrl ?? currentPageUrl();
  const code = shortCodeOf(url);
  return (
    <Card title={options.caption} className={FILL} bodyClassName="flex items-center justify-center">
      <ShareQr
        url={url}
        {...(code ? { code } : {})}
        logoSrc={env.brand?.logoMark ?? null}
        actions={false}
        imageClassName="h-auto w-full max-w-48"
      />
    </Card>
  );
}
