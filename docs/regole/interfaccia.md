# Regole: interfaccia (apps/web)

## Base
- React + Vite + TypeScript, Tailwind per lo stile, ECharts per i grafici, SVG per il campo da gioco.
- Colori, spaziature e font come **token** (variabili CSS in `apps/web/src/styles/tokens.css`, mappate nel tema
  Tailwind): niente colori scritti a mano nei componenti. Tema chiaro e scuro.
- Componenti riusabili in `apps/web/src/components/`; prima di crearne uno nuovo cerca quello esistente.
- Grafici: un solo modulo di tema ECharts (`apps/web/src/charts/theme.ts`) usato da tutti i grafici; colori casa/ospite
  sempre gli stessi in tutte le viste.

## Pagina pubblica `/live/:shareToken`
- Deve funzionare su smartphone (larghezza 360 px), tablet e maxischermo (modalità a schermo intero).
- Aggiornamento solo via WebSocket, con riconnessione automatica e stato completo alla riconnessione;
  indicatore di connessione visibile ("in diretta" / "riconnessione…").
- Animazioni brevi ad ogni punto (≤ 600 ms), rispettando `prefers-reduced-motion`.
- Nessun dato che non sia della partita; nessun link all'area riservata.

## Area riservata `/admin`
- Login, partita live, storico partite, token agente, link pubblici (crea, copia, revoca).
- Ogni attesa di rete mostra uno stato di caricamento; ogni errore un messaggio comprensibile in italiano.

## Testi
- Tutti i testi a video in italiano, terminologia della pallavolo italiana (battuta, ricezione, attacco, muro, difesa,
  alzata, break point, cambio palla).
