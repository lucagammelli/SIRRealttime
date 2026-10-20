import type { SystemLogoPair } from '@arenalive/shared';
import { VariantLogo } from './SystemLogo.tsx';

/** Name of the product. */
export const PRODUCT_NAME = 'ArenaLive';

/** Logo of ArenaLive (public/brand): positive (dark text) for light backgrounds, negative (white text) for dark ones. */
export const PRODUCT_LOGO: SystemLogoPair = {
  positive: { url: '/brand/arenalive-positivo.png', mime: 'image/png', width: 150, height: 35 },
  negative: { url: '/brand/arenalive-negativo.png', mime: 'image/png', width: 150, height: 36 },
};

/** The logo of ArenaLive in the variant meant for the background behind it, alt «ArenaLive». */
export function ProductLogo({ size = 'max-h-8' }: { size?: string }) {
  return (
    <VariantLogo
      pair={PRODUCT_LOGO}
      alt={PRODUCT_NAME}
      size={size}
      marker={(variant) => ({ 'data-product-logo': variant })}
    />
  );
}
