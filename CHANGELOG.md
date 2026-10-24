# Changelog

Le versioni seguono il versionamento semantico (`vX.Y.Z`); la fonte della versione è il campo `version` del
`package.json` alla radice. Le sezioni nuove le aggiunge `scripts/rilascia.sh` con i titoli dei commit dal tag
precedente; le note della release su GitHub sono la sezione della versione (`docs/regole/test-job-rilasci.md`).

## [2.6.1] - 2026-10-24

- Libreria: video QuickTime (.mov) accettati, anche con tipo non riconosciuto dal browser
- Avvisi: foto e video del giocatore senza velo, testo sì/no, foto anche a tutto schermo

## [2.6.0] - 2026-10-24

- Test Tabellone: rosa nel tenant pubblico dopo l'allineamento
- Squadra: pagina della rosa nel portale, foto e video del giocatore negli avvisi ACE!, Muro e Cambio
- Logo del club sempre per la nostra squadra, con dimensione piccolo/medio/grande scelta in Club
- Rosa: giocatori della squadra dal sito della Lega con foto, modifiche a mano, foto e video per giocatore negli avvisi (dati e server)

## [2.5.1] - 2026-10-24

- Dopo la partita: visibile in simulazione e in anteprima nello Studio; tolto il doppione della foto

## [2.5.0] - 2026-10-23

- Test Club: più avvisi nella pagina con la libreria
- Libreria «Immagini e video» nel menu, caricamenti solo dalla libreria; durata dell'avviso pari al video
- Club: «Aggiungi competizione» dal sito della Lega, squadra automatica e cambio stagione
- Mappa di campo: sulla TV squadre e fondamentali a turno, o solo la nostra squadra
- Studio: sezione «Immagini e video» con la libreria dei file e l'uso reale

## [2.4.0] - 2026-10-23

- TV: schermate rimpicciolite fino al 15% invece di una schermata in più; misure azzerate a ogni set
- Avvisi: video con audio, posizione e solo per la nostra squadra; nome dei file caricati e libreria media

## [2.3.0] - 2026-10-23

- Calendario: competizione delle partite a mano (es. Champions League) e filtro per competizione
- Simulatore: in modo velocità la pausa tra i set dura almeno la pausa «Fine set» del cliente
- Pause: dimensione a tutto schermo (Normale, Grande, Riempi lo schermo); sponsor uno alla volta o tutti in una pagina
- Studio: l'anteprima TV usa il rem della TV vera, stessi gruppi di blocchi dello schermo intero
- Studio: sezione «Esporta / Importa» sotto «Avvisi»
- Calendario: pulsante «Scollega» per staccare un file .dvw abbinato a una partita
- Portale: mappa di campo senza scorrimento sulla TV, rotazioni verticali a tutta altezza

## [2.2.0] - 2026-10-23

- Foto a tutto schermo dopo la partita con conto alla rovescia della prossima
- Sfondo immagine o video negli avvisi
- Opzione Touch Sì/No per dispositivo
- Mappa del campo: colore singolo o tricolore
- La pagina live recepisce subito le modifiche dello Studio
- Solo cognome dei giocatori, «Miglior Realizzatore», rotazioni in verticale

## [2.1.0] - 2026-10-23

- Certificati automatici per gli hostname dei clienti
- Agente: token manuale sotto «Avanzate», registrazione online come via principale

## [2.0.1] - 2026-10-21

- Pagina live: con i loghi di sistema il marchio solo nella barra in alto

## [2.0.0] - 2026-10-20

- Il prodotto diventa ArenaLive

## [1.3.0] - 2026-10-20

- Login: logo centrato, titolo «Area riservata» solo per i lettori di schermo
- Loghi di sistema: positivo e negativo, logo sinistro nella sidebar
- Decisioni: produzione su rt.istante.info e sir.istante.info con Let's Encrypt

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
