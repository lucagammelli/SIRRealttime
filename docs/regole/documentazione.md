# Regole: documentazione

- Ogni sezione ha il suo documento (tabella in `CLAUDE.md`). Si aggiorna quando cambia il comportamento della sezione.
- Struttura di un documento di sezione:
  1. **A cosa serve** (2–5 righe);
  2. **Come funziona**: flusso, stati, casi limite gestiti (es. pennina rimossa, rete assente, riga corretta);
  3. **Configurazione**: variabili, file di config, valori di default;
  4. **Come si usa / si prova**: comandi, script completi con le variabili in alto (regole di Luca);
  5. **Riferimenti**: file e funzioni principali (`percorso`), schemi dei messaggi, tabelle DB.
- Le decisioni importanti si annotano con data e motivo in `docs/decisioni.md` (una riga ciascuna).
- I nomi citati (comandi, variabili, pagine, pulsanti) devono esistere nel codice: verificarli prima di scrivere.
- Script e comandi nei documenti: completi, con tutte le variabili in un blocco in alto, nessun segnaposto sparso.
- Niente menzioni dell'IA nei testi che vedono gli utenti del portale.
