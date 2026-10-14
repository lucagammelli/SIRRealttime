#!/usr/bin/env node
import { runCli } from './cli.js';

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`errore non gestito: ${String(reason)}\n`);
});

runCli(process.argv.slice(2), {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`errore fatale: ${String(err)}\n`);
    process.exitCode = 1;
  },
);
