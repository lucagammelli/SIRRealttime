import { readFileSync } from 'node:fs';

/** Real pages of www.legavolley.it downloaded on 2026-10-16 (header and footer of the site cut away). */
export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/legavolley/${name}`, import.meta.url), 'utf8');

/** Real logo of a team (JPEG 220x110, served by the site as `image/png`). */
export const logoBytes = (): Buffer => readFileSync(new URL('./fixtures/legavolley/logo-6865.jpg', import.meta.url));

/** Answer of the site for a team without logo: a 2x2 JPEG (real, downloaded on 2026-10-16). */
export const placeholderLogoBytes = (): Buffer =>
  readFileSync(new URL('./fixtures/legavolley/logo-segnaposto.jpg', import.meta.url));

/**
 * Page of the team of Perugia with the tables «Roster» and «Staff Tecnico» (`squadra-6865-rosa.html`) and the photo of
 * one player (`foto-HEN-MAT-05.jpg`, JPEG 90x120), downloaded from www.legavolley.it on 2026-10-24.
 */
export const rosterPage = (): string => fixture('squadra-6865-rosa.html');
export const playerPhotoBytes = (): Buffer =>
  readFileSync(new URL('./fixtures/legavolley/foto-HEN-MAT-05.jpg', import.meta.url));
/** Answer of the site for a player without photo (a text, real, 2026-10-24). */
export const NO_PLAYER_PHOTO =
  '<font style="font-family: Verdana; font-size: 10pt; font-variant: small-caps; color:aa0000"><b>Impossibile carica l\'immagine</b></font><br><br>Nessuna immagine con id: XXX-YYY-01';

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
    if (u.pathname === '/Foto.aspx')
      return Promise.resolve(
        q.get('Key') === 'HEN-MAT-05'
          ? new Response(playerPhotoBytes(), { headers: { 'content-type': 'image/jpg' } })
          : new Response(NO_PLAYER_PHOTO, { headers: { 'content-type': 'image/jpg' } }),
      );
    if (u.pathname === '/GetLogo.aspx')
      return Promise.resolve(new Response(logoBytes(), { headers: { 'content-type': 'image/png' } }));
    return Promise.resolve(new Response('non trovato', { status: 404 }));
  };
}
