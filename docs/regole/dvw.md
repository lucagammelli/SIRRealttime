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
- Primo campo = codice. Azione: squadra (`*` casa, `a` ospite) + numero maglia (2 cifre) + fondamentale
  (`S` battuta, `R` ricezione, `A` attacco, `B` muro, `D` difesa, `E` alzata, `F` free ball) + tipo
  (`H M Q T U N O`) + valutazione (`# + ! - / =`) + campi estesi (combinazione/chiamata, zona partenza, zona arrivo,
  sottozona, tocchi, extra). Campi mancanti = `~`.
- Codici speciali: `*p`/`ap` + `HH:VV` punto con punteggio; `*z`/`az` + n rotazione (posizione del palleggiatore);
  `*c`/`ac` + `OUT:IN` cambio; `*T`/`aT` timeout; `*P`/`aP` palleggiatore in campo; `**Nset` fine set N.
- Campi dopo il codice: flag, ora `HH.MM.SS`, set, rotazione casa/ospite, tempo video, posizioni in campo dei
  giocatori (6+6). Il parser tiene sempre `rawLine` e l'indice della riga.

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
