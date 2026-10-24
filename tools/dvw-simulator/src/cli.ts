#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { PROFILE_LIMITS, generateMatch, play, renderDvw } from './index.js';
import type { MatchProfile } from './index.js';

export const HELP = `dvw-simulator: genera e riproduce nel tempo file .dvw sintetici (simula DataVolley)

Uso:
  dvw-simulator generate --out <file> [--seed N] [--sets N] [andamento]
  dvw-simulator play --out <file> [--seed N] [--sets N] [andamento] [--speed 20] [--min-break 20] [--mode atomic|direct] [--corrections]

Comandi:
  generate        scrive la partita completa in un colpo solo
  play            riscrive l'intero file a ogni nuova riga, secondo i tempi simulati

Opzioni:
  --out <file>    file .dvw di destinazione (obbligatorio)
  --seed N        seme del generatore; stesso seme = stessa partita (default 1)
  --sets N        set giocati: 3, 4 o 5 (default 3)
  --speed N       accelerazione del tempo, solo play (default 20)
  --min-break N   solo play: pausa minima in secondi reali tra un set e l'altro (default 20)
  --mode M        atomic: file temporaneo + rinomina (default); direct: scrittura diretta in due pezzi
  --corrections   solo play: ogni tanto corregge una riga già scritta
  --help          mostra questo testo

Andamento della partita (medie per squadra e per set, non conteggi esatti):
  --home-strength N  forza della squadra di casa, 0-100: 50 alla pari (default 50)
  --variability N    quanto cambia il livello delle squadre tra i set e nel set, 0-100 (default 50)
  --aces N           ace, 0-8 (default 1.5)
  --serve-errors N   errori al servizio, 0-10 (default 3.5)
  --blocks N         muri punto, 0-8 (default 2)
  --subs N           cambi, 0-6 (default 2)
  --timeouts N       time-out, 0-2 (default 1.5)
`;

/** CLI option -> field of the profile. */
const PROFILE_OPTIONS = {
  'home-strength': 'homeStrength',
  variability: 'variability',
  aces: 'acesPerSet',
  'serve-errors': 'serveErrorsPerSet',
  blocks: 'blocksPerSet',
  subs: 'substitutionsPerSet',
  timeouts: 'timeoutsPerSet',
} as const satisfies Record<string, keyof MatchProfile>;

/** The profile given on the command line: only the options written, each a number inside its limits. */
function profileOptions(values: Partial<Record<keyof typeof PROFILE_OPTIONS, string>>): Partial<MatchProfile> {
  const profile: Partial<MatchProfile> = {};
  for (const [option, field] of Object.entries(PROFILE_OPTIONS) as [
    keyof typeof PROFILE_OPTIONS,
    keyof MatchProfile,
  ][]) {
    const value = values[option];
    if (value === undefined) continue;
    const n = Number(value);
    const { min, max } = PROFILE_LIMITS[field];
    if (value.trim() === '' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`Valore non valido per --${option}: ${value} (da ${min} a ${max})`);
    profile[field] = n;
  }
  return profile;
}

function intOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Valore non valido per ${name}: ${value}`);
  return n;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      seed: { type: 'string' },
      sets: { type: 'string' },
      speed: { type: 'string' },
      'min-break': { type: 'string' },
      mode: { type: 'string' },
      corrections: { type: 'boolean' },
      help: { type: 'boolean' },
      'home-strength': { type: 'string' },
      variability: { type: 'string' },
      aces: { type: 'string' },
      'serve-errors': { type: 'string' },
      blocks: { type: 'string' },
      subs: { type: 'string' },
      timeouts: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }
  if (command !== 'generate' && command !== 'play') throw new Error(`Comando sconosciuto: ${command}`);
  if (!values.out) throw new Error('Manca --out <file>');
  const sets = intOption(values.sets, '--sets', 3);
  if (sets !== 3 && sets !== 4 && sets !== 5) throw new Error('--sets deve essere 3, 4 o 5');
  const seed = intOption(values.seed, '--seed', 1);
  const match = generateMatch({ seed, sets, profile: profileOptions(values) });
  await mkdir(dirname(values.out), { recursive: true });

  if (command === 'generate') {
    await writeFile(values.out, renderDvw(match, match.lines.length));
    process.stdout.write(`Scritto ${values.out} (${match.lines.length} righe di scout)\n`);
    return 0;
  }

  const mode = values.mode ?? 'atomic';
  if (mode !== 'atomic' && mode !== 'direct') throw new Error('--mode deve essere atomic o direct');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  await play(match, {
    out: values.out,
    speed: intOption(values.speed, '--speed', 20),
    minBreakSeconds: intOption(values['min-break'], '--min-break', 20),
    mode,
    corrections: values.corrections ?? false,
    seed,
    signal: controller.signal,
    onWrite: (n) => process.stdout.write(`\rRighe scritte: ${n}/${match.lines.length}`),
  });
  process.stdout.write('\n');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`Errore: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
