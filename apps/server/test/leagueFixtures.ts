import { readFileSync } from 'node:fs';

/** Real pages of www.legavolley.it downloaded on 2026-10-16 (header and footer of the site cut away). */
export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/legavolley/${name}`, import.meta.url), 'utf8');

/** Real logo of a team (JPEG 220x110, served by the site as `image/png`). */
export const logoBytes = (): Buffer => readFileSync(new URL('./fixtures/legavolley/logo-6865.jpg', import.meta.url));

/** Answer of the site for a team without logo: a 2x2 JPEG (real, downloaded on 2026-10-16). */
export const placeholderLogoBytes = (): Buffer =>
  readFileSync(new URL('./fixtures/legavolley/logo-segnaposto.jpg', import.meta.url));
