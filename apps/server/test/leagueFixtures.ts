import { readFileSync } from 'node:fs';

/** Real pages of www.legavolley.it downloaded on 2026-10-16 (header and footer of the site cut away). */
export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/legavolley/${name}`, import.meta.url), 'utf8');

/** Real logo of a team (JPEG 220x110, served by the site as `image/png`). */
export const logoBytes = (): Buffer => readFileSync(new URL('./fixtures/legavolley/logo-6865.jpg', import.meta.url));

/** Answer of the site for a team without logo: a 2x2 JPEG (real, downloaded on 2026-10-16). */
export const placeholderLogoBytes = (): Buffer =>
  readFileSync(new URL('./fixtures/legavolley/logo-segnaposto.jpg', import.meta.url));

const htmlResponse = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } });

/**
 * www.legavolley.it for the SuperLega 2026/27 (IdCampionato 999) from the saved pages: calendar (andata and
 * ritorno), standings, the team page of Perugia (6865, the others are not saved: 404) and one logo for every team.
 */
export function superLega2026Fetch(): (url: string, init: RequestInit) => Promise<Response> {
  return (url) => {
    const u = new URL(url);
    const q = u.searchParams;
    if (u.pathname === '/calendario/' && q.get('Anno') === '2026' && q.get('IdCampionato') === '999')
      return Promise.resolve(
        htmlResponse(
          fixture(q.get('IdFase') === '2' ? 'calendario-999-2026-ritorno.html' : 'calendario-999-2026-andata.html'),
        ),
      );
    if (u.pathname === '/classifica/' && q.get('IdCampionato') === '999')
      return Promise.resolve(htmlResponse(fixture('classifica-999-2026.html')));
    if (u.pathname === '/team/6865') return Promise.resolve(htmlResponse(fixture('squadra-6865.html')));
    if (u.pathname === '/GetLogo.aspx')
      return Promise.resolve(new Response(logoBytes(), { headers: { 'content-type': 'image/png' } }));
    return Promise.resolve(new Response('non trovato', { status: 404 }));
  };
}
