# Changelog

Le versioni seguono il versionamento semantico (`vX.Y.Z`); la fonte della versione è il campo `version` del
`package.json` alla radice. Le sezioni nuove le aggiunge `scripts/rilascia.sh` con i titoli dei commit dal tag
precedente; le note della release su GitHub sono la sezione della versione (`docs/regole/test-job-rilasci.md`).

## [1.2.0] - 2026-10-20

- Studio: comandi di blocchi e diapositive sotto il nome
- Studio: icona «−» per Rimuovi e menu che non si chiude da solo
- Loghi di sistema nelle testate
- Mappa del campo: colori e spessori scelti nello Studio
- Portale: avviso di nuova versione al posto di «Risposta non valida»
- Studio e Sponsor: anteprime, Rimuovi e diapositive attivabili
- Sezione Sponsor nell'area riservata
- Link e QR per singola partita come opzione del cliente
- Test intermittente dello Studio: attesa del caricamento prima di scrivere il colore

## [1.1.0] - 2026-10-18

- Versione visibile e script di rilascio

## [1.0.0] - 2026-10-18

Prima release di SIRRealtime: dal file `.dvw` di DataVolley al portale con punteggio e statistiche in diretta.

- Parser DVW e statistiche della partita (punteggio, fondamentali, rotazioni, andamento), con simulatore di partite.
- Agente Windows (C#, exe unico): lettura del `.dvw`, coda offline, invio al server, registrazione guidata dalla finestra.
- Server con ingest idempotente, Postgres, WebSocket, più clienti separati e ruoli (superadmin, lettura e scrittura, sola lettura).
- Portale pubblico `/live/:shareToken` per TV, tablet e telefono, con link brevi e QR; pause, avvisi e diapositive.
- Area riservata: partite, calendario e campionati dal sito della Lega, Studio grafico, utenti, agenti, statistiche delle visite, guida.
- Produzione su Ubuntu con Caddy (certificati interni o Let's Encrypt), backup e aggiornamento con `scripts/aggiorna-produzione.sh`.
