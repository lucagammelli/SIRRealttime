# Regole: formato DVW, parser e simulatore

## Il file
- Testo a sezioni `[3NOME]`: `[3DATAVOLLEYSCOUT]`, `[3MATCH]`, `[3TEAMS]`, `[3MORE]`, `[3COMMENTS]`, `[3SET]`,
  `[3PLAYERS-H]`, `[3PLAYERS-V]`, `[3ATTACKCOMBINATION]`, `[3SETTERCALL]`, `[3WINNINGSYMBOLS]`, `[3RESERVE]`,
  `[3VIDEO]`, `[3SCOUT]`. Campi separati da `;`.
- Codifica: di solito Windows-1252 (latin1); si decodifica con `iconv-lite`, con fallback UTF-8 (BOM o sequenze valide).
- Fine riga CRLF: il parser accetta CRLF e LF.
- **DataVolley riscrive l'intero file** a ogni salvataggio: non è un log in coda. Le righe già scritte possono cambiare
  (lo scoutman corregge un'azione): il diff dell'agente deve accorgersene (snapshot).

## Righe [3SCOUT]
- Primo campo = codice. Azione, per posizione dei caratteri: 1 squadra (`*` casa, `a` ospite), 2-3 numero maglia,
  4 fondamentale (`S` battuta, `R` ricezione, `A` attacco, `B` muro, `D` difesa, `E` alzata, `F` free ball),
  5 tipo (`H M Q T U N O`), 6 valutazione (`# + ! - / =`), 7-8 combinazione/chiamata, 9 target dell'alzata,
  10 zona di partenza, 11 zona di arrivo, 12 sottozona, 13 tipo di fondamentale, 14 numero di giocatori, poi extra.
  Campi mancanti = `~`.
- Suffisso `>...` (es. `*P05>LUp`, `*z3>LUp`): parte del codice, il parser lo salva in `suffix`.
- Codici speciali: `*p`/`ap` + `HH:VV` punto con punteggio; `*z`/`az` + n rotazione (posizione del palleggiatore);
  `*c`/`ac` + `OUT:IN` cambio; `*T`/`aT` timeout; `*P`/`aP` palleggiatore in campo; `**Nset` fine set N;
  codici verdi `*$$&H#` (`$$` + simbolo + resto) → `greenCode`.
- Campi dopo il codice (layout DV4, indice 0 = codice): 1-3 flag (1 fase del punto `s`/`r`, 2 fase dell'attacco),
  4-6 coordinate di partenza, intermedia e arrivo, 7 ora `HH.MM.SS`, 8 set, 9-10 posizione dei palleggiatori
  casa/ospite, 11 file video, 12 tempo video, 14-19 giocatori di casa in posizione 1-6, 20-25 giocatori ospiti.
  Il parser tiene sempre `rawLine` e l'indice della riga.
- Giocatori `[3PLAYERS-H/V]` (DV4): 0 squadra, 1 maglia, 2 indice, 3-7 posizione di partenza nei set 1-5
  (`*` = panchina), 8 id, 9 cognome, 10 nome, 11 soprannome, 12 ruolo speciale (`L`/`C`), 13 ruolo (1-5).
- Dettaglio e punti ancora da verificare con un file reale: `docs/dvw-parser.md`.

## Regole del parser
- Funzione pura `parseDvw(buffer | string)`; nessun I/O.
- Mai eccezioni per una riga: riga non riconosciuta → azione `{ kind: 'unknown', rawLine }` e un avviso nei `warnings`.
- Sezioni sconosciute ignorate (ma conservate grezze).
- Il punteggio ufficiale viene dalle righe `*p`/`ap`, non dal conteggio delle azioni.

## Simulatore (`tools/dvw-simulator`)
- Genera partite sintetiche coerenti (set a 25/15, rotazioni, punteggi) e le "suona" nel tempo riscrivendo l'intero
  file come DataVolley (scrittura su file temporaneo + rinomina, e anche scrittura diretta per simulare file troncati).
- Opzione per correggere righe passate (verifica snapshot) e per accelerare il tempo.
- I file di esempio stanno in `samples/` (sintetici; quelli reali solo se Luca li fornisce e non contengono dati riservati).
