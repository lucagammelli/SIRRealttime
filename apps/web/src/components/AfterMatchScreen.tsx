import type { AfterMatch, ScheduleFixture } from '@arenalive/shared';
import { formatFixtureDate } from '../lib/format.ts';
import type { Device } from '../lib/layout.ts';
import { teamColorVars } from '../lib/teamColors.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { MediaPicture } from './MediaPicture.tsx';
import { countdownTo, CountdownView, useNow } from './NextMatch.tsx';

/** Countdown to the next match over the photo: teams, date and time, days/hours/minutes/seconds left. */
function NextMatchCountdown({ fixture, big }: { fixture: ScheduleFixture; big: boolean }) {
  // Ticks every second only while the screen is shown (the component is mounted only then).
  const now = useNow();
  const left = countdownTo(fixture.startsAt, now);
  const when = formatFixtureDate(fixture.startsAt);
  return (
    <section
      aria-labelledby="dopo-partita-prossima"
      style={teamColorVars(fixture.ourSide)}
      className={`sir-surface sir-card mx-auto flex w-fit max-w-full flex-col items-center rounded-panel border border-border bg-surface/90 text-center text-text shadow-card ${
        big ? 'gap-5 p-8' : 'gap-3 p-4 sm:p-6'
      }`}
    >
      <h2
        id="dopo-partita-prossima"
        className={`font-display font-bold uppercase tracking-wide text-accent ${big ? 'text-4xl' : 'text-xl sm:text-2xl'}`}
      >
        Prossima partita
      </h2>
      <p
        className={`font-display font-bold uppercase leading-tight tracking-wide ${big ? 'text-4xl' : 'text-lg sm:text-2xl'}`}
      >
        <span data-team="home" className="text-home-ink">
          {fixture.home.name}
        </span>
        <span className="text-muted"> – </span>
        <span data-team="away" className="text-away-ink">
          {fixture.away.name}
        </span>
      </p>
      <p className={`font-semibold ${big ? 'text-2xl' : 'text-base sm:text-lg'}`}>
        {when.date.charAt(0).toUpperCase() + when.date.slice(1)}
        {fixture.startsAt && ` · ore ${when.time}`}
      </p>
      {left && <CountdownView left={left} big={big} />}
    </section>
  );
}

/** The file of «Dopo la partita» to draw: its address and the options of the screen (`AfterMatch`). */
export interface AfterMatchFile {
  url: string;
  kind: AfterMatch['kind'];
  fit: AfterMatch['fit'];
  audio: boolean;
}

/** Pure: the file of «Dopo la partita» at `url`, with its kind, fit and sound. */
export const afterMatchFile = (config: AfterMatch, url: string): AfterMatchFile => ({
  url,
  kind: config.kind,
  fit: config.fit,
  audio: config.audio,
});

/**
 * «Dopo la partita»: the photo or video chosen by the client full screen («Riempi»: cropped to fill it, as the photo
 * always was; «Intero»: whole, the sides filled) and, over it, the countdown to the next match of the club; only the
 * file when there is none. A video loops as long as the screen is on, muted unless its sound is on (`MediaPicture`, the
 * component of the overlays and of the «Foto o video» slides); with reduced motion no video (there is no poster): the
 * screen with the countdown only. Nothing to tap or click (it works the same with «Touch» off); no animation.
 * `contained`: inside its parent instead of over the page (preview of the Studio, always muted).
 */
export function AfterMatchScreen({
  file,
  fixture,
  device,
  contained = false,
}: {
  file: AfterMatchFile;
  fixture: ScheduleFixture | null;
  device: Device;
  contained?: boolean;
}) {
  const reduced = useReducedMotion();
  const big = device === 'tv';
  const shown = !(reduced && file.kind === 'video');
  return (
    <div
      data-testid="dopo-partita"
      role="region"
      aria-label="Dopo la partita"
      className={`${contained ? 'absolute' : 'fixed'} inset-0 z-50 overflow-hidden bg-bg ${big ? 'p-8' : 'p-3 sm:p-6'}`}
    >
      {shown && (
        <div data-after-match={file.kind} data-fit={file.fit} className="absolute inset-0">
          <MediaPicture kind={file.kind} url={file.url} fit={file.fit} audio={file.audio && !contained} />
        </div>
      )}
      {fixture && (
        <div className="relative">
          <NextMatchCountdown fixture={fixture} big={big} />
        </div>
      )}
    </div>
  );
}
