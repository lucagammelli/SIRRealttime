# Portale

## A cosa serve
`@sir/web` (`apps/web/`) è il portale di SIRRealtime: una applicazione a pagina singola (React, Vite, Tailwind 4,
ECharts) che mostra la partita in tempo reale. Ha due parti: la **pagina pubblica** `/live/:token`, raggiunta con un
link di condivisione e senza accesso, e l'**area riservata** `/admin` per chi gestisce partite, link, agenti e utenti.
Non calcola nulla: riceve dal server lo `MatchState` di `@sir/volley-stats` (`docs/statistiche.md`) e lo disegna.

## Come funziona

### Pagina pubblica `/live/:token` e `/l/:token` (`src/pages/LivePage.tsx`)
La stessa pagina risponde a due rotte (`src/App.tsx`): `/live/:token` (token lungo) e `/l/:token` (codice breve, come
`/l/K7M2QX9P`; accettati anche minuscole e il trattino a metà). Un valore che non rispetta `SHARE_TOKEN_PATTERN`
(`@sir/shared`: token di almeno 22 caratteri o codice breve) mostra subito «Link non valido o scaduto», senza aprire
connessioni. Con un valore valido la pagina si collega a `/ws/public/<token o codice>` e mostra (`src/components/MatchView.tsx`):

| Blocco | Contenuto |
|---|---|
| Tabellone | punteggio del set, set vinti, pallino della battuta, parziali dei set, «Ultimo punto», «Serie in corso», «Timeout nel set», «Cambi nel set», «Vince» a partita finita |
| Andamento del set | vantaggio punto per punto, selettore «Set» |
| Confronto squadre | statistiche delle due squadre, selettore «Periodo» |
| Statistiche giocatori | tabella per squadra («Squadra») e per set («Set») |
| Mappe di campo | frecce partenza → arrivo di attacchi e battute; filtri «Squadra», «Fondamentale» (Attacco, Battuta), «Giocatore», «Valutazione» |
| Rotazioni | «Punti vinti e persi per posizione del palleggiatore» |

Questi sei sono i blocchi predefiniti; il cliente può nasconderli, riordinarli e aggiungerne altri (Logo, Sponsor,
Messaggio, Codice QR, Ultimo punto, Parziali dei set, Migliori giocatori) per ogni dispositivo, vedi «Pagina pubblica a
blocchi».

Nell'intestazione ci sono il pulsante «Schermo intero» (diventa «Esci da schermo intero») e il cambio tema.
La pagina pubblica non ha nessun collegamento all'area riservata.

**Dispositivi e impaginazione** (`src/lib/layout.ts`, `useLayout.ts`, `components/BlockLayout.tsx`). `deviceFor` sceglie
tra tre impaginazioni, con gli stessi blocchi della tabella sopra:

| Dispositivo | Quando | Impaginazione |
|---|---|---|
| Telefono | larghezza fino a 767 px (`viewportClass`: `phone`); in orizzontale (più larga che alta, alta al massimo 500 px, sotto 1200 px) il telefono resta tale sotto 560 px (`PHONE_LANDSCAPE_MIN_WIDTH`) | una colonna; tabellone compatto fisso in alto con «Dettagli del set» (`ScoreFacts`); sezioni comprimibili (`Card` con `aria-expanded`), all'inizio aperta solo «Andamento del set»; grafici semplificati (legenda sotto, più bassi); tabella giocatori con le colonne essenziali (vedi «Regole del telefono») |
| Tablet | da 768 px e sotto le soglie della TV; telefono orizzontale da 560 px | **verticale** 768-899 px: una colonna; **orizzontale** 900-1199 px: griglia a 12 colonne con card a metà; **desktop** da 1200 px: la griglia a 12 colonne del layout (le soglie sono sulla larghezza della griglia, `GRID_LANDSCAPE_MIN_PX` 856 e `GRID_DESKTOP_MIN_PX` 1150, perciò l'anteprima dell'editor si comporta come la pagina vera) |
| TV | da sola con almeno 1600 × 800 px e proporzioni ≥ 16:10; sempre con `?tv=1`; mai con `?tv=0`; con «Schermo intero» solo da tablet in su (mai da telefono, anche orizzontale) | senza scorrimento, testi scalati, rotazione dei gruppi |

I breakpoint sono quelli delle specifiche grafiche (`docs/grafica/`) e valgono per **tutti** i modelli. Un monitor
desktop 4:3 o 16:10 basso resta quindi tablet/desktop e mantiene lo scorrimento. `defaultLayouts` è l'elenco predefinito dei
blocchi per dispositivo del modello standard (da `defaultDeviceBlocks` di `@sir/shared`, larghezze 12/8/6/4 su 12
colonne come prima); `templateLayouts` ha quelli di ogni modello e `blocksFor(layout, dispositivo, modello)` sceglie quello
giusto quando il cliente non ha un layout. Il cliente può cambiarlo nella pagina «Pagina pubblica» (vedi «Pagina pubblica a blocchi»). Nell'area riservata `MatchView` usa al massimo l'impaginazione tablet.

**Regole del telefono** (valgono per tutti i modelli): `PlayerTable` mostra le colonne essenziali (N., Giocatore, Punti,
Attacco %, Ace, Muro, Errori) con il pulsante «Tutte le colonne», e il giocatore si può evidenziare; `Rotations` mostra
una squadra alla volta con un selettore; `CourtMap` raccoglie i filtri sotto «Altri filtri».
Il tabellone del telefono resta fisso in alto e `scroll-padding-top` segue la sua altezza (`useStickyOffset`, variabile
`--sir-sticky-offset`), così le sezioni aperte non finiscono sotto di lui.

**Modalità TV.** Classe `html.sir-tv`: corpo del testo `clamp(16px, min(1.25vw, 2.2vh), 48px)`, quindi ogni `rem` cresce
con lo schermo (leggibile a 4-5 m). I blocchi sotto il tabellone sono divisi in gruppi in base all'altezza (`tvGroups`
con `TV_BLOCK_MIN_REM`, altezze minime in rem **stimate**, da verificare su TV veri) e i gruppi ruotano ogni 12 s
(`TV_ROTATION_MS`, `rotationIndex`) con l'indicatore «Schermata N di M». La rotazione si ferma con
`prefers-reduced-motion` (resta il primo gruppo) e con il pulsante «Ferma rotazione» (`aria-pressed`; in pausa il
`title` è «Riprendi rotazione» e riprende dalla schermata corrente), richiesto da WCAG 2.2.2. Dopo 3 s senza movimenti
(`IDLE_CURSOR_MS`) cursore e pulsanti si nascondono, ma restano raggiungibili da tastiera. Lo schermo resta acceso con
Screen Wake Lock (`useWakeLock`, `src/lib/tvScreen.ts`), rilasciato a pagina nascosta e richiesto di nuovo al ritorno.
Senza intestazione e con partita in corso, il logo del cliente (`BrandMark`) e i pulsanti stanno nel tabellone. Se la
Fullscreen API non è disponibile o fallisce, «Schermo intero» attiva comunque l'impaginazione.

**Stati** (`src/components/LiveMatch.tsx`, `ConnectionBadge.tsx`, `StatusScreen.tsx`):

| Situazione | Messaggio |
|---|---|
| connessione in corso | «Connessione alla partita» (indicatore «Connessione…») |
| server giù o rete assente, senza dati | «Server non raggiungibile», con il numero del tentativo; la pagina si ricollega da sola |
| server al completo (503) o troppe richieste (429), senza dati | «Troppi spettatori collegati»: «Il server è al completo in questo momento: nuovo tentativo tra poco. La pagina si aggiorna da sola.» |
| già mostrata una partita e connessione persa | i dati restano a video, l'indicatore passa a «Riconnessione…» |
| partita in corso e connessione attiva | l'indicatore mostra «In diretta» (solo mentre si gioca) |
| partita conclusa e connessione attiva | l'indicatore mostra «Risultato finale», in stile neutro |
| nessuna partita live | «Nessuna partita in corso»: la partita appare appena inizia, senza ricaricare |
| link revocato, scaduto o inesistente | «Link non valido o scaduto» (indicatore «Link non valido») |
| sessione admin terminata (solo area riservata) | «Sessione terminata» (indicatore «Sessione terminata») |
| errore del server sullo stato | riquadro «Aggiornamento non disponibile: …» sopra la partita |
| qualsiasi altro indirizzo | «SIRRealtime»: «Per seguire una partita apri il link che ti è stato inviato.» |

### Area riservata `/admin` (`src/pages/admin/`)
Prima si verifica la sessione («Verifica della sessione…»); senza sessione compare il login «Area riservata»
(email e password), se il server non risponde «Area riservata non disponibile» con «Riprova». Il **menu laterale**
(`AdminSidebar.tsx`; `menuGroups` è pura e dà i gruppi in base al ruolo, quelli vuoti spariscono) sostituisce la barra
a pillole. Gruppi: «Partite» (Partita live, Partite, Link pubblici), «Pagina pubblica» (Grafica, Pagina pubblica, Pause e
sponsor, Avvisi), «Dispositivi» (Agenti), «Amministrazione» (Utenti; Clienti solo superadmin):

- in cima il logo (`BrandMark`), in fondo cliente (selettore per il superadmin), account, tema e «Esci»; la voce attiva è
  evidenziata (`--sir-nav-active`, rosso in SIR VOLLEY);
- da 1200 px (`WIDE_MENU_MIN`) il menu è largo 240 px; tra 768 e 1199 px parte ridotto alle icone (nomi nel `title` e per
  i lettori di schermo) e il pulsante «Riduci il menu» / «Espandi il menu» lo allarga o lo riduce; lo stato non è
  ricordato tra le visite;
- sotto i 768 px (`PHONE_MAX`) è a scomparsa: ☰ (`MenuButton`, «Apri il menu») nella barra in alto, X «Chiudi il menu»
  nel menu; aperto, il focus va alla prima voce, Esc o un tocco fuori lo chiudono restituendo il focus al ☰, e la
  pagina sotto è `inert`.

Le voci:

| Voce | Percorso | Chi la vede | Contenuto |
|---|---|---|---|
| Partita live | `/admin/live` | admin e viewer | la partita live via `/ws/admin`, con gli stessi componenti della pagina pubblica |
| Partite | `/admin/partite`, `/admin/partite/:id` | admin e viewer | elenco delle partite ricevute e dettaglio (`MatchDetailSchema`: «Stato», «Righe di scout», «Versione», «Aggiornata») |
| Link pubblici | `/admin/link` | solo admin | «Nuovo link pubblico» (etichetta, partita o live, «Scadenza (facoltativa)»), «Link creati» (per i link attivi «Link breve», codice e QR, vedi «Link breve e QR»), «Revoca» |
| Agenti | `/admin/agenti` | solo admin | «Agente per Windows» (vedi sotto), «Nuovo agente» («Crea token», mostrato una sola volta con «Copia config.json»), «Richieste in attesa» (vedi sotto), «Agenti», «Revoca» |
| Utenti | `/admin/utenti` | solo admin | «Nuovo utente» (sottotitolo «Cliente: …»; email, password di almeno 12 caratteri, ruolo), «Utenti» |
| Grafica | `/admin/grafica` | solo admin (il superadmin lavora sul cliente scelto) | colori, nome e loghi del cliente, vedi «Grafica per cliente» |
| Pagina pubblica | `/admin/pagina` | solo admin (il superadmin lavora sul cliente scelto) | blocchi della pagina della partita per TV, tablet e telefono, vedi «Pagina pubblica a blocchi» |
| Pause e sponsor | `/admin/pause` | solo admin (il superadmin lavora sul cliente scelto) | schermate di time-out, fine set, fine partita e «ogni N punti», vedi «Pause della partita» |
| Avvisi | `/admin/avvisi` | solo admin (il superadmin lavora sul cliente scelto) | avvisi sugli eventi della partita, vedi «Avvisi sugli eventi» |
| Clienti | `/admin/clienti` | solo superadmin | «Nuovo cliente» (Nome, Identificativo, Hostname; «Crea cliente»), «Clienti» con «Modifica» (nome e hostname, «Salva») |
| Esci | - | tutti | chiude la sessione |

**Più clienti** (`docs/server.md`, «Clienti»). Nel menu compare il nome del cliente corrente (`user.tenant`). Il
**superadmin** vede invece il selettore «Cliente» (`TenantSelector` in `src/pages/admin/TenantsPage.tsx`): la scelta va a
`POST /api/admin/active-tenant`, resta nella sessione (vale anche per `/ws/admin`) e al cambio le pagine si ricaricano
(`Routes` con `key` sul cliente). Finché non ne sceglie uno, le pagine che lavorano su un cliente mostrano l'errore
«Seleziona un cliente». Un admin o un viewer vede solo il proprio cliente e non ha né selettore né voce «Clienti»; un
utente di un cliente può accedere solo dagli hostname del proprio cliente.

### Link breve e QR (`src/qr/`, `pages/admin/ShareLinksPage.tsx`)
Ogni link attivo ha un link breve `<base>/l/<codice>` (codice di 8 lettere, mostrato `K7M2-QX9P`; server in
`docs/server.md`, «Link breve e codice»). Nella pagina «Link pubblici»: alla creazione, sotto il link lungo (mostrato
una sola volta), compare anche «Link breve (sempre disponibile nell’elenco, con il QR)»; in «Link creati» ogni link
**attivo** mostra «Link breve», il codice e l'anteprima del QR con i pulsanti «Copia link», «Scarica QR (PNG)» e
«Scarica QR (SVG)». Un link revocato o scaduto non li mostra.

- **Il QR è generato nel browser**, senza servizi esterni (libreria `qrcode` 1.5.4), con correzione d'errore H (si può
  perdere circa il 30% del simbolo). Sempre nero su bianco, qualunque sia il tema, perché va stampato e inquadrato.
- **PNG** di 1024 px (`qrPngDataUrl`, `src/qr/qrCanvas.ts`): QR con il **logo quadrato** del cliente (`logoMark`, da
  «Grafica per cliente») al centro e il codice scritto sotto; se il logo non si carica ne fa a meno. **SVG** con gli
  stessi elementi (`qrSvg`, `src/qr/qrImage.ts`, funzioni pure: matrice, impaginazione, pixel).
- `ShareQr` (`src/qr/ShareQr.tsx`) è riutilizzabile: con `actions={false}` mostra solo il QR (pensato per pause e
  maxischermo); `logoSrc` sceglie un altro logo o `null` per nessuno.
- Dipendenze: `qrcode`, `@types/qrcode` e `jsqr` (solo dev, decodifica il QR nei test).

**Agente per Windows** (`AgentDownload` in `apps/web/src/pages/admin/AgentsPage.tsx`, sottotitolo «Già configurato per
questo portale, con i colori e il logo del cliente.»): legge `GET /api/admin/agent/info` (`docs/server.md`, «Agente
scaricabile»). Se l'agente è pubblicato mostra versione, data, dimensione in MB e il pulsante «Scarica l’agente per
Windows», un normale link a `/api/admin/agent/download` (`AGENT_DOWNLOAD_PATH`: il browser scarica lo zip del cliente con
il cookie di sessione, senza passare dal codice della pagina), poi i passi: scompatta lo zip in `C:\SIRAgent` (non sulla
pennina); doppio clic su `sir-agent.exe` (non è firmato: «Ulteriori informazioni» e «Esegui comunque»); scrivi il nome
dell'agente e premi «Registra»; abilitalo in «Richieste in attesa» controllando il codice mostrato sul PC. Se l'exe non è
pubblicato: «L’agente non è ancora stato pubblicato sul server.» con il comando `scripts/costruisci-agente.sh`
(`docs/infrastruttura.md`). Il resto della finestra dell'agente è in `docs/agente.md`.

**Richieste in attesa** (`PendingRegistrations` in `apps/web/src/pages/admin/AgentsPage.tsx`): i PC che si sono
auto-registrati come agenti (`docs/server.md`). Ogni richiesta mostra nome, «Codice di abbinamento» (6 caratteri, in
grande), IP di provenienza, ora della richiesta e scadenza. L'admin controlla che il codice sia quello mostrato sul PC con
DataVolley e preme «Abilita» (l'agente riceve il token da solo entro pochi secondi e compare in «Agenti») oppure
«Rifiuta», senza conferma perché la richiesta si può rifare. Senza richieste: «Nessuna richiesta in attesa.». Elenco
richieste e agenti si aggiornano ogni 5 secondi (`AGENTS_REFRESH_MS`) e si fermano a scheda nascosta.

Un **viewer** (ruolo «sola lettura») vede solo «Partita live» e «Partite»; gli indirizzi riservati agli admin lo
riportano a `/admin/live`. Il ruolo è mostrato accanto all'email («superadmin», «amministratore» o «sola lettura», `ROLE_TEXT` in `AdminApp.tsx`); la vera
protezione è sempre nel server (`docs/server.md`).

### Connessione WebSocket (`src/lib/liveConnection.ts`, `useLiveSocket.ts`)
- `LiveConnection` tiene aperto il socket e, a ogni (ri)connessione, il server rimanda lo stato intero.
- **Patch**: dopo lo stato intero arrivano messaggi `patch`. `applyPatchMessage` li applica con `applyPatch`
  (`@sir/shared`) solo se la `baseVersion` è la versione a video; se non combacia, la partita è un'altra o il patch non
  è applicabile (o il risultato non `looksLikeMatchState`) il client manda `{ "type": "resync" }` e ignora i patch finché
  non arriva lo stato intero. Il `resync` è rimandato se nessuna risposta arriva entro 8 s (`resyncRetryMs`; il server
  risponde al massimo ogni 5 s per socket). Patch con versione non maggiore di quella a video sono ignorati.
- **Gzip**: se il browser ha `DecompressionStream` (`supportsGzip`) l'URL del socket ha `?enc=gzip` (`withGzip`) e i frame
  binari sono decompressi con `gunzipFrame` (`src/lib/frames.ts`), con tetto di 4 MB (`LIVE_FRAME_MAX_DECODED_BYTES`).
  I frame sono elaborati **in ordine**, anche se uno è ancora in decompressione. Opzione `gzip` per forzare o escludere.
- **Backoff**: dopo una chiusura riprova dopo `backoffDelay` (1 s, raddoppia fino a 30 s, con variazione ±50% già dal
  primo tentativo).
- **Dopo un riavvio del server** (chiusure `1001`, `1006`, `1012`, `1013` su un socket che era aperto) i client
  attendono in più un tempo casuale fino a 5 s (`restartSpreadMs`), per non tornare tutti insieme.
- **Server al completo**: la sonda (`probeShareToken`) legge 503 e 429 con `Retry-After` (secondi, massimo 5 minuti,
  20 s se illeggibile): l'attesa è `Retry-After` × (1–1,5), mai meno del backoff; lo stato `serverFull` mostra la
  schermata «Troppi spettatori collegati».
- **Nessuna riconnessione** su `4404` (link non valido: stato `invalid`) e `4401` (sessione terminata: `unauthorized`).
- **Sonda HTTP**: il browser nasconde il 404/401 dell'upgrade, quindi se il socket si chiude prima di aprirsi (o con
  `1008`) la connessione chiede `probe`: per il link pubblico `GET /api/public/<token>/state` (`probeShareToken`, 404 =
  link non valido), per l'area riservata `GET /api/auth/me` (401 = sessione terminata). Un errore di rete conta come «ok»
  e si riprova con il backoff.
- **Flag `probing`**: mentre la sonda è in corso nient'altro può riconnettere (nemmeno `retryNow`).
- **Versioni vecchie ignorate**: `applyMessage` scarta uno `state` della stessa partita con `version` non maggiore di
  quella a video e uno che `looksLikeMatchState` non riconosce (`src/lib/messages.ts`).
- Quando il browser torna online (evento `online`) si riconnette subito, a meno che il link sia già non valido.

### Dati e grafici
I dati vengono **solo** da `MatchState`: il portale non rifà calcoli di pallavolo. Le trasformazioni da stato a grafico
sono funzioni pure in `src/charts/` (`momentum.ts`, `compare.ts`, `players.ts`, `rotations.ts`, `zones.ts`, `options.ts`)
con test; i componenti ECharts passano da `EChart.tsx`. Le mappe di campo sono SVG (`CourtMap.tsx`) e mostrano le 14
traiettorie più frequenti.

### Tema e stile
I token (colori, font, raggi) sono scritti **solo** in `src/styles/tokens.css`. Tailwind li legge con
`@theme` in `index.css`; ECharts li legge a runtime (`src/charts/theme.ts`, `usePalette.ts`) e si riadatta al cambio di
tema. Chiaro di default, scuro con `prefers-color-scheme` o con il cambio tema (`ThemeToggle`; scelta salvata in
`localStorage` con chiave `sir-theme`). Con `prefers-reduced-motion: reduce` niente animazioni nei grafici. Un modello
grafico (vedi «Modelli grafici») può forzare il tema: con SIR VOLLEY il tema è sempre scuro (`lib/theme.ts`:
`forcedTheme`, `useForcedTheme`) e il pulsante del tema non compare.

### Modelli grafici (template)
Il cliente sceglie il **modello grafico** nella pagina «Grafica» («Modello grafico»); l'elenco è chiuso in `@sir/shared`
(`TEMPLATES`, `docs/architettura.md`): «Standard» (l'aspetto di prima) e «SIR VOLLEY». I colori scelti dal cliente
valgono sopra quelli del modello. Specifiche e originali dei loghi: `docs/grafica/` (non si modificano).

- **Come si applica** (`lib/branding.ts`): `applyTemplate` scrive `data-template` su `<html>` (nessun attributo per lo
  standard) e imposta il tema forzato; `initTemplate` lo fa all'avvio leggendo la voce `localStorage` `sir-template`, così
  la pagina non mostra per un attimo l'aspetto standard; appena arriva `GET /api/public/tenant` il modello vero la
  riallinea. `useTemplate` dà la definizione del modello ai componenti. I token del modello stanno in `tokens.css` nel
  blocco `[data-template='sir-volley']` (palette e misure delle specifiche); l'anteprima di «Grafica» lo usa con
  `data-sir-scope`.
- **Font**: Google Sans Code self-hosted, `src/styles/fonts.css` (importato da `index.css`) con i file in
  `src/styles/fonts/google-sans-code/` (woff2 `latin` e `latin-ext`, variabile 400-700, `font-display: swap`, licenza
  `OFL.txt`). La CSP è invariata (`font-src 'self'`).
- **Colori**: la palette si calcola con `brandPalette(colori, modello)`. Il rosso `#E30613` su `#151518` ha solo 3,7:1: il
  testo piccolo usa la variante `-ink` (`#eb515a`), il rosso pieno resta per sfondi, pulsanti e testo grande.
- **Logo** (`public/templates/sir-volley/`): `logo-sir-realtime.png` (1200×269, senza la riga «Powered by Istante»),
  nella testata via `BrandMark`. Non c'è più nessun piè di pagina «Powered by Istante®» (tolto su richiesta di Luca:
  `TemplateFooter` e `powered-by-istante.png` non esistono più). Si rigenera dall'originale di `docs/grafica/` con
  `apps/web/scripts/trim-logo.ts` (solo `node:zlib`, PNG RGBA 8 bit):

  ```bash
  # --- variabili ---
  RADICE="/percorso/del/repository"                                  # radice del repository o del worktree del job
  LOGO_ORIGINALE="docs/grafica/sir real time logo-02.png"            # originale del logo SIR Real Time (relativo a RADICE)
  USCITA="apps/web/public/templates/sir-volley"                      # cartella del logo del modello (relativa a RADICE)

  # --- comandi ---
  cd "$RADICE/apps/web"
  pnpm exec tsx scripts/trim-logo.ts "../../$LOGO_ORIGINALE" "../../$USCITA/logo-sir-realtime.png" 1200 0 top
  ```

  Argomenti: `<input> <output> [larghezza=1200] [margine=0] [all|top|bottom]` (`top`: il logo senza la riga di testo
  sotto; `bottom`: solo la riga).
- **Nostra squadra** (`lib/branding.ts` `useOurTeamColors`, `lib/teamColors.ts` `teamColorVars`): con il codice e/o il testo
  nel nome scelti in «Grafica» (`ourTeamSide`, `docs/architettura.md`) i colori «casa» e «ospite» del portale sono puntati
  sulla **nostra** squadra (colore di casa nello standard, colore di risalto in SIR VOLLEY) e sull'avversaria (colore ospite)
  anche quando giochiamo in trasferta; vale per punteggio, grafici, mappe, tabelle, avvisi e pause. Senza corrispondenza
  (o con due) restano i colori casa/ospite del file.
- **Mappe di campo** (`CourtMap`): con SIR VOLLEY le frecce hanno il colore della squadra che attacca, spessore 1,5 px e
  opacità 85%; nello standard restano colorate per valutazione.
- **Pagina predefinita**: ogni modello ha la sua (`docs/architettura.md`, «Pagina pubblica a blocchi»): SIR VOLLEY segue il
  mockup di una schermata a 1920×1080 (tabellone, poi andamento, confronto e mappe di campo in tre colonne, poi giocatori e
  rotazioni); `MomentumChart` è ammesso anche a larghezza 4.
- **Area riservata e tabellone**: `Scoreboard` ha la variante del mockup; l'area riservata usa il menu laterale (vedi
  «Area riservata»).
- **Font monospazio**: in SIR VOLLEY `--sir-font-mono` è Google Sans Code (prima codici e token ricadevano su
  `ui-monospace`).
- **Tagli e sovrapposizioni**: le righe a specchio delle statistiche (`StatSlides.tsx`) sono una griglia
  barra | valore | etichetta | valore | barra con valore largo almeno `6ch`; i nomi lunghi stanno su al massimo 2 righe, con
  `title`, e vanno a capo dopo «_» (`BreakableName` in `components/ui.tsx`); le liste di giocatori si impilano nei
  contenitori stretti; «Confronto squadre» ha colonne fisse; in TV `BlockLayout` misura l'altezza reale dei blocchi e
  rifà i gruppi della rotazione (`tvGroups` con `measured`, `lib/layout.ts`), una scheda più alta dello schermo scorre
  dentro; le diapositive a tutto schermo scorrono sugli schermi bassi; il tabellone dà ai parziali al massimo il 40%
  della larghezza e ai nomi fino a 3 righe; i titoli delle schede sono larghi almeno 12 rem, con i comandi sotto.
- **Limiti noti**: nessun logo per squadra (scelta di Luca); il tema forzato non dà avvisi di contrasto (`brandContrastIssues`
  è vuoto); dopo il primo salvataggio il layout del cliente resta fisso anche se cambia modello (va reimpostato con
  «Ripristina predefinito» in «Pagina pubblica»); l'anteprima tablet dell'editor è a 1024 px.

### Grafica per cliente
Ogni cliente ha i suoi colori e i suoi loghi, scelti nella pagina «Grafica» e mostrati sull'hostname del cliente (API e
controlli in `docs/server.md`, «Grafica per cliente»).

- **Caricamento all'avvio** (`src/lib/branding.ts`, `initBranding` chiamata in `main.tsx`): `GET /api/public/tenant`
  (`PublicTenantResponseSchema`). Se la richiesta fallisce, o la risposta non è valida, restano i predefiniti di
  `tokens.css`: la pagina funziona lo stesso.
- **Colori come variabili CSS**: `brandPalette` (`@sir/shared`, `colors.ts`) calcola dai cinque colori le variabili,
  anche le varianti per il tema scuro (colori schiariti e sfondo scurito fino al contrasto minimo 4,5:1 del WCAG,
  `ensureContrast`; il testo sui colori pieni è bianco o nero, `textColorOn`). `writePalette` le scrive su `:root` con il
  CSSOM (`style.setProperty`), consentito dalla CSP senza `unsafe-inline`, e segue il cambio tema chiaro/scuro. Valgono
  sopra `tokens.css`, che resta la fonte dei predefiniti: componenti e tema ECharts leggono le variabili, e i grafici si
  ridisegnano al cambio (`useBrandingRevision`). Nuovi token `--sir-primary` e `--sir-accent`; sopra le testate c'è una
  barra di risalto nel colore d'accento (predefinito `#c2410c`).
- **Nome e loghi**: il titolo della pagina pubblica usa il nome del cliente (`useBrandName`: «… · Diretta»); `BrandMark` (`src/components/BrandMark.tsx`, nelle
  testate di pagina pubblica, area riservata e login) mostra il logo orizzontale in un `<img>` (SVG compresi, mai
  markup in linea), altrimenti il nome, altrimenti la scritta «SIRRealtime». Il cliente predefinito senza nome
  visualizzato è mostrato come «SIRRealtime». Il favicon è il logo quadrato. La CSP resta quella di prima
  (`img-src 'self' data:`, le immagini sono servite dalla stessa origine).
- **Pagina «Grafica»** (`src/pages/admin/BrandingPage.tsx`, solo admin; titolo scheda «Grafica · Area riservata»). Scheda
  «Grafica del cliente» (sottotitolo «Cliente: …»): «Modello grafico» (scelta fra i modelli, vedi «Modelli grafici»),
  «Nostra squadra» («Codice squadra», es. PER, e «Testo nel nome della squadra», es. Perugia, entrambi facoltativi),
  «Nome visualizzato» (facoltativo), cinque colori («Colore
  principale», «Colore di risalto», «Squadra di casa», «Squadra ospite», «Sfondo della pagina»), ciascuno con selettore e
  campo esadecimale `#rrggbb` e il pulsante «Predefinito»; tre immagini («Logo orizzontale», «Logo quadrato», «Logo dello
  sponsor») con «Carica immagine» (PNG, JPEG, WebP o SVG, al massimo 2 MB) e «Togli». Avvisi di contrasto (`brandContrastIssues`,
  sotto 4,5:1), per esempio «Lo sfondo è troppo scuro per il testo della pagina…» o «“Colore di risalto” ha contrasto
  …:1 sullo sfondo (minimo 4,5:1): i testi in questo colore si leggono male.». Pulsanti «Salva» (dopo il salvataggio:
  «Grafica salvata: la pagina pubblica la usa da subito.») e «Ripristina predefiniti», avviso «Modifiche non salvate.».
  Scheda «Immagini caricate» (sottotitolo «Spazio usato: … MB di … MB») con l'elenco, «in uso» e «Elimina» /
  «Conferma eliminazione»; vuota: «Nessuna immagine caricata.». Scheda «Anteprima» (`BrandingPreview.tsx`): pagina
  pubblica con dati d'esempio e le modifiche non ancora salvate. Il caricamento invia il file in base64 (`fileToBase64`,
  `src/lib/base64.ts`) a `POST /api/admin/assets`, poi `PUT /api/admin/branding` con «Salva».
- **Limiti noti**: la testata dell'area riservata del superadmin ha la grafica del cliente dell'hostname, non quella del
  cliente attivo; un'immagine SVG non ammessa è rifiutata con un messaggio, non convertita.

### Pagina pubblica a blocchi (editor «Pagina pubblica»)
Ogni cliente sceglie quali blocchi mostra la pagina della partita, in che ordine e con che larghezza, separatamente per
TV, tablet e telefono. Il contratto (`TenantLayoutSchema`, `docs/architettura.md`) e le rotte (`GET`/`PUT
/api/admin/layout`, `docs/server.md`) sono altrove; il layout arriva al portale in `GET /api/public/tenant` (`layout`,
letto da `initBranding` e tenuto in `lib/branding.ts`). Senza layout salvato (`{}`) valgono i blocchi predefiniti, cioè la
pagina di prima.

- **Disegno** (`MatchView` → `BlockLayout`): `blocksFor(layout, device)` prende i blocchi visibili del dispositivo e
  ognuno è disegnato dal registro (`src/blocks/registry.tsx`, `BLOCKS`: etichetta, descrizione, larghezze, opzioni e
  `render` per tipo). Tablet e TV usano una griglia a 12 colonne (`col-span-N` secondo `width`); sul telefono una colonna,
  ogni blocco a tutta larghezza e, tranne il tabellone, comprimibile (`collapsed` = «Chiuso all'apertura»). Sulla TV il
  tabellone sta sempre in alto e gli altri blocchi vanno in righe (`packRows`) e gruppi (`tvGroups`) che ruotano come
  prima; `TV_BLOCK_MIN_REM` ha le altezze minime anche dei nuovi tipi. `LayoutScaleContext` (`lib/useLayout.ts`) dà la
  scala dell'anteprima, così le misure restano quelle della pagina vera.
- **Tipi di blocco**: Tabellone (uno solo, sempre a larghezza 12), Andamento del set, Confronto squadre, Statistiche
  giocatori, Mappe di campo, Rotazioni (i sei di prima), più:

| Blocco | Opzioni | Comportamento |
|---|---|---|
| Logo | Orizzontale / Quadrato | logo del cliente in un `<img>`; senza logo, il nome |
| Sponsor | fino a 12 immagini del cliente, «Secondi per immagine» (3-60, predefinito 8) | immagini a rotazione con dissolvenza breve (nessuna con `prefers-reduced-motion`); si ferma con «Ferma rotazione» della TV; senza immagini: «Nessuna immagine sponsor scelta.» |
| Messaggio | testo (al massimo 280 caratteri, una riga), «Dimensione» Normale / Grande | sempre testo semplice, mai HTML |
| Codice QR | testo sopra il codice (al massimo 80 caratteri, predefinito «Segui la partita sul telefono») | QR del link della pagina aperta (origine + percorso, senza query come `?tv=1`); il codice breve sotto compare solo se la pagina è aperta con `/l/<codice>` |
| Ultimo punto | - | squadra, punteggio e come è stato vinto (`LastPointBlock`) |
| Parziali dei set | - | punteggio di ogni set (`SetScoresBlock`) |
| Migliori giocatori | «Quanti» (1-10), «Squadra» Entrambe / Casa / Ospiti | classifica a punti di `topPlayers` (`docs/statistiche.md`); tabella Giocatore, Att, Muro, Ace, Punti |
| Parziale e marcatori, Ace, Muri, Attacco, Sfida per ruolo, Squadre a confronto | periodo («Il set in corso» / «Tutta la partita»), «Marcatori per squadra» (3-8) o «Attaccanti per squadra» (1-5), «Ruolo» (predefinito «Tutti i ruoli, a rotazione»), «Righe del confronto» (nessuna scelta = tutte) | viste in stile TV dei calcoli di `period.ts` (`docs/statistiche.md`), le stesse delle diapositive delle pause; senza dati un messaggio (per esempio «Nessun dato della partita.») |

Le sei viste statistiche (`blocks/StatSlides.tsx`) hanno tre misure: `full` (tutto schermo, per le diapositive a tutto schermo),
`card` (riquadro dentro la pagina, per i blocchi) e `compact` (una riga per la banda). Casa sempre a sinistra, colori secondo
«nostra squadra»; barre e nomi entrano con un'animazione di 500 ms (`sir-enter-left`, `sir-enter-right`, `sir-grow`),
spenta con `prefers-reduced-motion`. I testi (nomi dei giocatori) sono sempre testo React, mai HTML. Le opzioni si modificano con
`pages/admin/StatOptionsFields.tsx`, usato sia da «Pagina pubblica» sia da «Pause e sponsor». Il registro (`registry.tsx`) disegna
queste viste anche come blocchi della pagina, con le stesse etichette di `SLIDE_LABELS`; la pagina usa il set in corso
(`statPeriod`), il confronto di `charts/compare.ts` usa `teamDuel` di `@sir/volley-stats` (niente più calcoli copiati).

- **Pagina «Pagina pubblica»** (`src/pages/admin/LayoutPage.tsx`, rotta `/admin/pagina`, solo admin; titolo scheda
  «Pagina pubblica · Area riservata»). Tre schede «TV», «Tablet», «Telefono». Per ogni blocco: maniglia ⠿ (trascinamento),
  «Sposta su» e «Sposta giù», «Visibile», «Larghezza» (non sul telefono; i valori ammessi dipendono dal tipo, per esempio
  «Metà (6/12)»), «Chiuso all'apertura» (solo telefono, non per il tabellone), le opzioni del tipo (per lo sponsor anche
  «Carica immagine sponsor») e «Rimuovi». In fondo «Tipo di blocco» con «Aggiungi blocco» (in coda; il tabellone si può
  aggiungere solo se manca; al massimo 24 blocchi, contatore «N di al massimo 24 blocchi.»), «Salva» (dopo il
  salvataggio: «Pagina pubblica salvata: la vedono da subito tutti gli spettatori.») e «Ripristina predefinito», che
  rimette i blocchi predefiniti **solo del dispositivo aperto**. I blocchi con opzioni non valide (per esempio testo
  vuoto) sono evidenziati e «Salva» resta disattivato. Le modifiche sono logica pura in `layoutEditor.ts` (`moveBlock`,
  `updateBlock`, `removeBlock`, `addBlock`, `resetDevice`, `layoutProblems`).
- **Accessibilità**: spostamenti, aggiunte, rimozioni e ripristino sono annunciati in una regione `aria-live`
  («Messaggio in posizione 2 di 6.», «Messaggio rimosso.»); dopo uno spostamento con la tastiera il focus resta sul
  pulsante usato. Il trascinamento è un'aggiunta: tutto si fa anche con «Sposta su»/«Sposta giù».
- **Anteprima**: scheda «Anteprima» con la pagina del dispositivo scelto, disegnata alla grandezza vera (1920×1080,
  1024×768, 390×845) e ridotta, non interattiva, con le modifiche non ancora salvate. Usa la partita live del cliente
  (`/ws/admin`: «Dati della partita live.») oppure, se non c'è, la «Partita d'esempio» (`src/blocks/sampleMatch.json`,
  caricata solo dall'editor in un suo file separato; si rigenera con `pnpm --filter @sir/web sample-match`).
- **Limiti noti**: l'avviso «Modifiche non salvate.» compare sempre, ma il browser chiede conferma solo alla chiusura della
  scheda: cambiando voce del menu dell'area riservata le modifiche si perdono (come nella pagina «Grafica»). Una
  immagine usata in un blocco sponsor non si può eliminare dalla pagina «Grafica» finché non viene tolta dal blocco.
  Un layout salvato e poi non più valido (per esempio di versione futura) si legge come predefinito.

### Pause della partita (schermate di time-out, fine set e fine partita)
Quando la partita ha una pausa il portale mostra una schermata con riepilogo e sponsor. Il portale non decide nulla: la
fase viene da `state.phase` (`docs/statistiche.md`, «Fase della partita»), la configurazione del cliente da
`intermissions` di `GET /api/public/tenant` (`docs/architettura.md`, «Pause della partita»; `docs/server.md`).

- **«Ogni N punti»** (`milestone`): pausa breve durante il set, non una fase. `milestoneStep` (`lib/intermission.ts`, pura) la
  apre quando `pointMilestone` dà una soglia più alta di quella già raggiunta nel set (la memoria tiene per set la soglia più
  alta, anche se non ha aperto nulla; una correzione dello scout che la abbassa non la riapre). Non si apre: al primo stato,
  dopo una riconnessione o un `resync` (solo aggiornamenti `live`), con un time-out, una fine set o una fine partita in corso
  (che hanno la precedenza e la chiudono), né vicino al traguardo del set: con `stopBeforeEnd` K (predefinito 5) niente pausa
  se una squadra è a K punti dal traguardo (25, 15 al tie-break; il traguardo viene da `@sir/volley-stats`). Mostra le sue
  diapositive una volta e si chiude da sola; se time-out e fine set sono disattivati resta fino al suo timer. Titolo
  (`pauseTitle`): «2° set: 9-7». È attiva di default per tutti i clienti e si spegne da «Pause e sponsor».
- **Quando compare** (`components/Intermission.tsx`, montato da `LivePage.tsx` sotto la pagina): per `timeout`, `setBreak` e
  `matchEnd`, se la pausa è attiva (`intermissionFor`) e ha almeno una diapositiva da mostrare. Parte dopo il ritardo
  `delaySeconds` della pausa (il tabellone mostra prima la fine del set); **non si applica a chi apre la pagina durante
  una pausa**, che la vede subito. Si chiude da sola alla prima azione dopo (la fase torna `rally`); la fine partita
  resta finché lo spettatore non la chiude. Sotto la pausa la pagina continua ad aggiornarsi.
- **Chiusura a mano**: una pausa chiusa a mano non si riapre; la pausa successiva (`describePause` dà una chiave per ogni
  pausa: set, squadra e numero del time-out) sì.
- **Tutto schermo**: finestra di dialogo (`role="dialog"`, `aria-modal`) sopra la pagina con i pulsanti «Torna alla
  partita» e (con più diapositive) «Ferma rotazione»; Esc chiude, il focus va su «Torna alla partita», resta intrappolato
  nella finestra e torna dov'era alla chiusura.
- **Banda**: fissa in basso, una riga compatta con titolo, diapositiva, punti indicatori (per i lettori di schermo «Schermata N di M»), «Ferma rotazione»
  e «Chiudi»; non prende il focus (un messaggio `role="status"` avvisa i lettori di schermo). Sul telefono e sul tablet
  la pagina ha uno spazio vuoto sotto di pari altezza, così la banda non copre il tabellone.
- **Titoli** (`pauseTitle`): «Fine N° set», «Time-out <squadra>», «Fine partita».
- **Rotazione**: le diapositive girano ognuna per i suoi secondi. «Ferma rotazione» (`aria-pressed`, `title` «Riprendi
  rotazione») è lo stesso interruttore della rotazione della TV; con `prefers-reduced-motion` la rotazione è ferma e il
  pulsante non c'è.
- **Diapositive** (`blocks/IntermissionSlides.tsx`, `renderSlide`, a tutto schermo o compatte): «Riepilogo del set»
  (`setRecap`: punteggio, tabella per squadra con punti, attacco, efficienza, battuta, ricezione, muri, errori e «Migliore
  del set»), «Risultato» (set vinti e parziali), «MVP» (`matchMvp`: maglia, nome, punti, attacchi vincenti, muri, ace,
  efficienza d'attacco), «Parziali dei set», «Sponsor», «Messaggio», «Codice QR», «Logo» (gli ultimi quattro come i blocchi
  omonimi, `docs/portale.md` «Pagina pubblica a blocchi»), più le sei viste statistiche in stile TV: «Parziale e marcatori»,
  «Ace», «Muri» (titolo «Muri vincenti»), «Attacco», «Sfida per ruolo» e «Squadre a confronto» (misure e animazioni in
  «Pagina pubblica a blocchi»). «Sfida per ruolo» a rotazione diventa una diapositiva per ogni ruolo con un duello (id
  `<id>:<ruolo>`, ognuna per i suoi secondi). Le diapositive senza nulla da mostrare sono saltate
  (`visibleSlides`): lo sponsor senza immagini usa il logo sponsor della grafica, e se non c'è nemmeno quello è saltato;
  il riepilogo senza il set, l'MVP senza giocatori con punti, i parziali senza set, ace/muri/attacco senza nemmeno un punto
  o tentativo, il confronto senza righe con valori, il duello senza giocatori. **Conseguenza**: la pausa time-out di
  default (solo sponsor) non compare se il cliente non ha né immagini sponsor né logo sponsor.
- **Caricamento della grafica** (`useTenantIntermissions` in `lib/branding.ts`, stato caricamento/caricata/fallita):
  finché `GET /api/public/tenant` non risponde non si mostra nessuna pausa; se fallisce valgono i predefiniti.
- **Pagina «Pause e sponsor»** (`src/pages/admin/IntermissionsPage.tsx`, rotta `/admin/pause`, solo admin; titolo scheda
  «Pause e sponsor · Area riservata»). Schede «Time-out», «Fine set», «Fine partita», «Ogni N punti» (con «Ogni quanti punti»,
  4-25, e il campo «Non negli ultimi punti del set» per `stopBeforeEnd`, con il traguardo da `setTarget` di volley-stats); per «Fine set» una seconda fila
  «Tutti i set», «1° set»…«4° set» con la casella «Pausa propria per la fine del N° set» (senza, quel set usa «Tutti i
  set»). Per ogni pausa: «Pausa attiva», «Come si mostra» (per TV, tablet e telefono «Tutto schermo» o «Banda in basso»),
  «Ritardo prima della pausa (secondi)», elenco di diapositive riordinabili con «Sposta su» e «Sposta giù» (niente
  trascinamento), «Secondi sullo schermo», le opzioni del tipo (come nell'editor a blocchi, anche «Carica immagine
  sponsor») e «Rimuovi»; in fondo «Tipo di diapositiva» con «Aggiungi diapositiva» (al massimo 12). «Salva» (dopo:
  «Pause salvate: valgono da subito per tutti gli spettatori.»), «Ripristina predefinito» (solo della pausa aperta),
  avviso «Modifiche non salvate.»; «Salva» è disattivato se una pausa attiva non ha diapositive o un testo è vuoto. Le
  modifiche sono logica pura in `intermissionEditor.ts` (`moveSlide`, `addSlide`, `removeSlide`, `updateSlide`,
  `setOwnPause`, `resetPause`, `pauseProblems`). Spostamenti e aggiunte sono annunciati in una regione `aria-live`.
- **Anteprima**: scheda «Anteprima» con la pagina del dispositivo scelto e la pausa mostrata subito, con le modifiche non
  salvate (`previewState` mette nello stato la fase della pausa aperta). Usa la partita live del cliente o la «Partita
  d'esempio» (`src/blocks/sampleMatch.json`, rigenerata con `pnpm --filter @sir/web sample-match`, ora in 2° set con un
  set chiuso).
- **Limiti noti**: come nella pagina «Grafica», cambiando voce del menu le modifiche non salvate si perdono (il browser
  chiede conferma solo alla chiusura della scheda). Un'immagine usata in una diapositiva sponsor non si può eliminare dalla
  pagina «Grafica» finché non viene tolta. Da provare su dispositivi veri (TV a 4-5 m, telefono con la banda).

### Avvisi sugli eventi (messaggi rapidi sopra la pagina)
Quando succede qualcosa in partita (ace, set point, match point…) compare per pochi secondi un messaggio sopra la pagina.
Il portale non rileva nulla: gli eventi vengono da `state.events` (`docs/statistiche.md`, «Eventi della partita»), la
configurazione del cliente da `overlays` di `GET /api/public/tenant` (`docs/architettura.md`, «Avvisi sugli eventi»;
`docs/server.md`).

- **Quando compare** (`components/Overlay.tsx`, montato da `LivePage.tsx` accanto a `Intermission`): per ogni evento nuovo
  il cui avviso è acceso e ammesso sul dispositivo; testo da `overlayText` (`fillOverlayText` di `@sir/shared`), sempre testo
  semplice, mai HTML. Il riquadro ha il colore della squadra dell'evento (neutro senza squadra), cade dall'alto con
  l'animazione `.sir-overlay` (450 ms, spenta con `prefers-reduced-motion`) e resta per i secondi scelti.
- **Nessun avviso per ciò che è già successo**: non compaiono all'apertura della pagina, dopo una riconnessione né dopo un
  `resync`, perché lo stato in arrivo in quei casi non è un aggiornamento dal vivo (`LiveData.live`, `liveConnection.ts`: falso
  per il primo stato di ogni socket e per la risposta a un `resync`). Un rally passato corretto dallo scout cambia il
  punteggio e quindi gli id: si mostrano solo gli eventi dalla riga più alta già vista in poi, quelli precedenti sono
  ignorati.
- **Coda** (`lib/overlay.ts`): uno alla volta. Al massimo 5 in attesa (`OVERLAY_QUEUE_MAX`, restano i più recenti), nessuno
  aspetta più di 10 s (`OVERLAY_MAX_AGE_MS`: poi è scartato). Tra quelli in coda va prima la priorità più alta, a parità
  l'evento più vecchio: un match point scavalca un ace.
- **Con una pausa**: sopra una pausa a tutto schermo gli avvisi sono scartati (`blocked`, e quello a video sparisce); sopra la
  banda e nel resto della pagina compaiono. Fine set e fine partita compaiono come avviso nei secondi prima della pausa
  (il ritardo `delaySeconds` della pausa, `docs/portale.md` «Pause della partita»).
- **Accessibilità**: regione `aria-live="polite"` con `aria-atomic="true"`: i lettori di schermo leggono il testo senza
  spostare il focus.
- **Caricamento della grafica** (`useTenantOverlays` in `lib/branding.ts`, stato caricamento/caricata/fallita): finché
  `GET /api/public/tenant` non risponde non si mostra nessun avviso; se fallisce valgono i predefiniti.
- **Pagina «Avvisi»** (`src/pages/admin/OverlaysPage.tsx`, rotta `/admin/avvisi`, solo admin; titolo scheda «Avvisi · Area
  riservata»). Scheda «Avvisi» (sottotitolo «Cliente: …») con l'elenco «Eventi» (Fine partita, Match point, Fine set, Set
  point, Ace, Muro punto, Sorpasso, Pareggio, Break, Time-out, Scambio lungo, Cambio) e, in alto, i «Segnaposto ammessi nel
  testo». Per ogni evento: interruttore acceso/spento, «Testo» (il risultato con i dati d'esempio compare sotto, «Risultato:
  …», oppure il problema: vuoto, oltre 80 caratteri, segnaposto sconosciuto, `<` o `>`), «Secondi» (2-8), «Priorità» (1-10),
  i dispositivi (TV, tablet, telefono), «Prova» e «Ripristina predefinito» (solo di quell'evento). In fondo «Salva» (dopo:
  «Avvisi salvati: valgono da subito per tutti gli spettatori.»), disattivato senza modifiche o con un testo non valido, e
  l'avviso «Modifiche non salvate.». La scheda «Anteprima» mostra la pagina del dispositivo scelto (partita live del cliente
  o «Partita d'esempio») e «Prova» ci fa comparire l'avviso con le modifiche non salvate, per i suoi secondi. Il browser
  chiede conferma solo alla chiusura della scheda. Logica pura: `lib/overlay.ts` (`overlayValues`, `overlayText`,
  `overlayFor`, `unseenEvents`, `enqueue`, `nextOverlay`, `sampleEvent`).
- **Limiti noti**: come nelle altre pagine di configurazione, cambiando voce del menu le modifiche non salvate si perdono.

### Grafica del portale
Strisce nei colori delle squadre, cifre del punteggio con animazione `sir-pop`, «IN DIRETTA» pieno (testo
`--sir-on-live`), gradienti leggeri (`--sir-glow`, `--sir-glow-soft`, `--sir-home-glow`, `--sir-away-glow`, in
`tokens.css`, derivati dai colori del cliente). Classi in `src/styles/index.css`: `.sir-surface`, `.sir-scoreboard`,
`.sir-scroll-x` (scorrimento laterale), `.sir-fade` (dissolvenza). Con `prefers-reduced-motion` `sir-pop` e `.sir-fade`
sono spente. Testi nei grafici: «Legenda», «X avanti (sopra/sotto)» nell'andamento del set, «Punti vinti» e «Punti persi»
nelle rotazioni. Le squadre non hanno un logo proprio: nel tabellone si usa il logo del cliente.

### Tooltip e `richSafe`
I tooltip di ECharts usano `renderMode: 'richText'` (`buildEchartsTheme`): sono disegnati nel canvas, senza HTML né stili
inline. Ogni testo che vi entra (nomi di squadre e giocatori) passa da `richSafe` (`src/charts/theme.ts`), che toglie
`{`, `}`, `|` (significato nel rich text di ECharts) e, per difesa in più, `<`, `>`, `&`.

### CSP rigida
`docker/web.security-headers.conf` imposta `Content-Security-Policy` **senza `unsafe-inline` e senza `unsafe-eval`**
(`script-src 'self'; style-src 'self'`), più `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (il token è
nell'URL), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` e `Permissions-Policy`. Per rispettarla:
- zod gira in modalità `jitless` (`z.config({ jitless: true })` in `src/main.tsx`), perché la modalità normale prova
  `new Function`, che sarebbe una violazione `unsafe-eval`;
- i tooltip sono nel canvas (sopra) e gli stili vengono da file della build, non da attributi `style` scritti a mano.

### Stub di `iconv-lite`
`@sir/shared` raggiunge il parser DVW attraverso gli schemi di ingest e il parser usa `iconv-lite`, che in un browser non
funziona (richiede il `Buffer` di Node). Il portale non legge file DVW, quindi in `vite.config.ts` l'alias `iconv-lite`
punta a `src/lib/iconv-browser.ts`, che lancia un errore se chiamato. Inoltre `treeshake.moduleSideEffects` scarta dal
bundle i pacchetti del monorepo non usati.

## Configurazione

### Sviluppo (`apps/web/vite.config.ts`)
- `vite dev` ascolta sulla porta **5173** (`strictPort`: se è occupata non ne cerca un'altra).
- Proxy verso il server: `/api` e `/ws` (con WebSocket) vanno a `SIR_SERVER_URL`, default `http://localhost:8090`. Il
  browser vede una sola origine, quindi cookie di sessione e controllo `Origin` funzionano con `CORS_ORIGIN` e
  `PUBLIC_BASE_URL` = `http://localhost:5173` (default del server, `docs/server.md`).
- Build: `pnpm --filter @sir/web build` scrive in `apps/web/dist`; ECharts ha un chunk a parte (`echarts`).

### Demo (`apps/web/scripts/demo.ts`)
Avvia in un solo processo un server con PGlite in memoria, un agente vero e il simulatore che suona una partita sintetica.
Tutto si perde con Ctrl+C. Variabili, tutte facoltative:

| Variabile | Default | Significato |
|---|---|---|
| `DEMO_SPEED` | `15` | accelerazione del simulatore (numero positivo, massimo 10000) |
| `DEMO_SEED` | `1` | seme della partita generata (intero da 0) |
| `DEMO_SETS` | `4` | numero di set: `3`, `4` o `5` |
| `DEMO_PORT` | `8090` | porta del server della demo (deve coincidere con `SIR_SERVER_URL` di vite) |
| `DEMO_ADMIN_EMAIL` | `admin@sir.local` | email dell'admin di prova |
| `DEMO_ADMIN_PASSWORD` | `password-demo-sir` | password dell'admin di prova (almeno 12 caratteri) |

L'admin di prova (`admin@sir.local` / `password-demo-sir`) esiste solo nel database in memoria della demo. La demo
usa `COOKIE_SECURE=false`, `CORS_ORIGIN` e `PUBLIC_BASE_URL` = `http://localhost:5173` e limiti di richieste molto alti.

### Docker
- `docker/web.Dockerfile`: stadio `build` (Node 24, `pnpm install --frozen-lockfile`, `pnpm --filter @sir/web build`),
  stadio `runtime` `nginxinc/nginx-unprivileged` (utente 101, porta 8080 nel container, healthcheck su `/healthz`).
- `docker/web.nginx.main.conf`: `nginx.conf` principale, copiata da `docker/web.Dockerfile` in `/etc/nginx/nginx.conf`.
  Come quella di nginx-unprivileged (pid e file temporanei in `/tmp`, utente non root) ma con `worker_processes auto`,
  `worker_rlimit_nofile 40000`, `worker_connections 16384` e `multi_accept on`, perché ogni WebSocket pubblico occupa due
  connessioni (client e server) e `WS_MAX_TOTAL` di default è 6000. Il servizio `web` di `docker-compose.yml` alza il
  limite di file aperti a 65536 (`ulimits`, `nofile`). Sintassi verificata con nginx 1.28: da ricontrollare al primo
  build con la 1.29 unprivileged dell'immagine. Definisce anche il `log_format main`, che **maschera** nei log di accesso
  i segreti nel percorso (due `map`, senza distinzione di maiuscole): `$request_uri` diventa `/l/[codice]`,
  `/live/[token]`, `/api/public/[token]/…` o `/ws/public/[token]/…` (restano leggibili `/api/public/tenant` e
  `/api/public/assets/`), e il Referer con quei percorsi diventa `[omesso]`.
- `docker/web.nginx.conf`: serve la SPA (ogni percorso non-file riceve `index.html`, senza cache; `/assets/` con cache
  immutabile), fa da proxy di `/api/` e `/ws/` verso `server:8090`, risponde a `/healthz`, accetta corpi fino a 3 MB
  (l'ingest dell'agente ne ammette 2 sul filo). Sovrascrive `X-Forwarded-For` con l'IP reale del client e passa
  `Host $host`, da cui il server ricava il cliente (`docs/server.md`). Oggi ha `server_name _`; con più clienti in
  produzione vanno elencati i `server_name` espliciti, chiudendo il resto con un `default_server`, e ogni hostname
  ha il suo certificato https (a cura del deploy).
  Solo per `location = /api/admin/agent/download` (zip dell'agente, ~90 MB generato al volo) c'è `proxy_buffering off`: nginx
  lo passa al browser senza scriverlo su disco; le altre rotte non cambiano.
- `docker/web.security-headers.conf`: le intestazioni di sicurezza (sezione «CSP rigida»).
- Servizio `web` in `docker-compose.yml`: parte quando il server è sano, pubblica `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}:8080`.
  Dietro compose, `CORS_ORIGIN` e `PUBLIC_BASE_URL` di default **seguono `WEB_PORT`** (`http://localhost:<WEB_PORT>`):
  con un dominio vero vanno impostati in `.env` (`https://…`). `TRUST_PROXY` vale `true` di default **solo perché il
  server sta dietro nginx**.
- **nginx è l'unico ingresso**: la porta 8090 del server è pubblicata solo su `127.0.0.1` (`SERVER_BIND`). Mai su
  `0.0.0.0`: con `TRUST_PROXY=true` un client che arriva diretto potrebbe inviare un `X-Forwarded-For` falso ed eludere il
  rate limit.
- **L'agente passa dal portale**: il suo `serverUrl` è l'URL del portale (es. `https://<host>/`) e invia a
  `<serverUrl>/api/ingest`, che nginx inoltra al server (`docs/agente.md`). Non serve esporre la 8090.

## Come si usa / si prova

### Demo in locale
Due terminali dalla radice del repository. Primo (server, agente e simulatore):

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DEMO_SPEED="15"                          # accelerazione della partita simulata
DEMO_SEED="1"                            # seme della partita
DEMO_SETS="4"                            # set: 3, 4 o 5
DEMO_PORT="8090"                         # porta del server della demo
DEMO_ADMIN_EMAIL="admin@sir.local"       # email dell'admin di prova
DEMO_ADMIN_PASSWORD="password-demo-sir" # password dell'admin di prova, almeno 12 caratteri

# --- comandi ---
cd "$RADICE"
corepack enable
pnpm install
DEMO_SPEED="$DEMO_SPEED" DEMO_SEED="$DEMO_SEED" DEMO_SETS="$DEMO_SETS" DEMO_PORT="$DEMO_PORT" \
  DEMO_ADMIN_EMAIL="$DEMO_ADMIN_EMAIL" DEMO_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD" \
  pnpm --filter @sir/web demo
```

La demo stampa l'indirizzo della pagina pubblica (`http://localhost:5173/live/<token>`), quello per il maxischermo
(`…?tv=1`) e dell'area riservata. Secondo terminale (il portale):

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DEMO_PORT="8090"                         # la stessa porta usata dalla demo

# --- comandi ---
cd "$RADICE"
SIR_SERVER_URL="http://localhost:$DEMO_PORT" pnpm --filter @sir/web dev
```

Poi si apre `http://localhost:5173` nel browser, con l'indirizzo stampato dalla demo.

### Con Docker Compose
Variabili e comandi di `docker compose` sono in `docs/server.md`; il portale è su `http://localhost:8080` (o
`WEB_PORT`). Controllo: `http://localhost:8080/healthz` risponde `ok`.

### Comandi del pacchetto (`apps/web/package.json`)

| Comando | Cosa fa |
|---|---|
| `pnpm --filter @sir/web dev` | Vite in sviluppo su 5173 |
| `pnpm --filter @sir/web build` | build in `apps/web/dist` |
| `pnpm --filter @sir/web preview` | serve la build sulla 5173 |
| `pnpm --filter @sir/web demo` | demo (sopra) |
| `pnpm --filter @sir/web test` | `vitest run` (jsdom) |
| `pnpm --filter @sir/web sample-match` | rigenera `src/blocks/sampleMatch.json` (partita d'esempio dell'anteprima); un test ne verifica la coerenza |

### Verifica visiva
Screenshot di una pagina con un Chrome headless senza installazione: `chrome-headless-shell` in una cartella temporanea
(il disco del server è quasi pieno), con le librerie mancanti estratte nella stessa cartella. Il portale deve già
rispondere all'URL indicato (demo o Docker Compose, sopra).

```bash
# --- variabili ---
CARTELLA="/tmp/sir-chrome"                       # cartella temporanea per Chrome e librerie (si cancella a fine lavoro)
URL="http://localhost:5173/"                     # pagina da fotografare (con la demo: l'URL stampato dal comando demo)
LARGHEZZA=1920                                   # larghezza della finestra in px
ALTEZZA=1080                                     # altezza della finestra in px
FILE="/tmp/sir-chrome/schermata.png"             # file PNG di uscita

# --- comandi ---
mkdir -p "$CARTELLA/librerie"
npx @puppeteer/browsers install chrome-headless-shell@stable --path "$CARTELLA"
(cd "$CARTELLA/librerie" && apt-get download libnspr4 libnss3 libasound2t64 \
  && for deb in *.deb; do dpkg-deb -x "$deb" "$CARTELLA"; done)
CHROME="$(find "$CARTELLA" -name chrome-headless-shell -type f | head -n 1)"
export LD_LIBRARY_PATH="$CARTELLA/usr/lib/x86_64-linux-gnu:$CARTELLA/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
"$CHROME" --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size="$LARGHEZZA,$ALTEZZA" --virtual-time-budget=5000 \
  --screenshot="$FILE" "$URL"
```

Il nome del pacchetto delle librerie audio cambia con la distribuzione (`libasound2` o `libasound2t64`). Le pagine
dell'area riservata chiedono il login: per queste serve una pagina pubblica o la demo.

### Collaudo del 2026-10-14
- **Compose**: `docker compose -p sirrealtime up -d --build` con `.env` da `.env.example` (`POSTGRES_PASSWORD`, `ADMIN_*`,
  `WEB_PORT=8085` perché la 8080 era occupata, `COOKIE_SECURE=false` in http locale). `postgres`, `server` e `web` healthy;
  health diretto e attraverso nginx, intestazioni di sicurezza, login, token agente e link pubblico (URL sulla porta del
  portale) funzionano.
- **Dal vivo su PostgreSQL attraverso nginx**: simulatore `play` (seed 7, 4 set, ×40, `atomic`, correzioni), agente in
  continuo e client WebSocket pubblico: 48 stati con versioni crescenti; lo stato finale pubblicato è identico a
  `computeMatchState(parseDvw(file finale))`.
- **Resistenza**: server fermato per 20 s a metà partita (simulatore `direct`): l'agente ha tenuto i dati in coda e li ha
  consegnati alla ripartenza, con stato finale identico.
- **Browser**: screenshot reali con Chromium headless pilotato via CDP: 360 px senza scroll orizzontale, 1440 px, tema
  scuro, `?tv=1` a 1920×1080, login admin. Nota pratica: `--window-size` di Chromium headless non scende sotto circa
  500 px; per il mobile serve `Emulation.setDeviceMetricsOverride`.

### Scansione DAST dello stack (`stackhawk-portale.yml`)
Come quella del solo server (`docs/server.md`), ma con host il portale (`APP_HOST`, default `http://localhost:8085`):
stessa specifica `stackhawk/openapi.yaml`, Ajax Spider con `seedPaths` `/admin` e `LIVE_PATH` (default
`/live/token-non-valido-per-la-scansione`: va dato il percorso di un link valido), token agente in `AGENT_AUTH_HEADER`,
login `admin@sir.local` / `SCAN_PASSWORD`, logout escluso, WebSocket non coperti. Nel `.env` locale vanno alzati i
`RATE_LIMIT_*` (es. 100000) e il servizio `server` ricreato. Esito: PASS, 25 URI raggiunti (API, `/admin`,
`/live/<token>`, asset), un solo risultato Low, già segnato come falso positivo (email nelle rotte autenticate), 0 errori
500 nei log.

### Da rifinire
- nella mappa di campo le frecce coprono le etichette delle zone;
- **da provare su dispositivi veri** (portale adattivo): TV 1920×1080 a 4-5 m (leggibilità, tabella e confronto non
  tagliati, ritmo della rotazione, schermo acceso); tablet verticale e orizzontale; telefono 360 px (tabellone fisso,
  sezioni, scorrimento laterale della tabella, contrasto dei gradienti in chiaro e scuro e con i colori del cliente).
  Le altezze `TV_BLOCK_MIN_REM` sono stime.
- **da provare con il modello SIR VOLLEY**: desktop/TV 1920×1080 (il mockup su una schermata), iPad verticale e orizzontale,
  telefono verticale e orizzontale (tabellone fisso, menu ☰), resa del font e del rosso del testo piccolo.

## Riferimenti
- `apps/web/src/App.tsx` (rotte), `main.tsx` (zod jitless, tema), `pages/LivePage.tsx`, `pages/admin/*`
  (`TenantsPage.tsx`: pagina «Clienti» e `TenantSelector`; `AdminApp.tsx`: barra e rotte)
- `apps/web/src/lib/liveConnection.ts` (`LiveConnection`, `applyMessage`, `applyPatchMessage`, `backoffDelay`), `frames.ts`
  (`gunzipFrame`, `supportsGzip`, `withGzip`), `pages/LivePage.tsx` (`probeShareToken`, `retryAfterMs`), `useLiveSocket.ts`, `messages.ts`, `api.ts`, `theme.ts`, `iconv-browser.ts`
- Grafica per cliente: `apps/web/src/lib/branding.ts` (`initBranding`, `writePalette`, `setTenantLook`, `useTenantLook`,
  `useBrandingRevision`, `useBrandName`), `lib/base64.ts`, `components/BrandMark.tsx`, `components/BrandingPreview.tsx`,
  `pages/admin/BrandingPage.tsx`; `packages/shared/src/colors.ts`, `assets.ts`, `tenant.ts`; API in `docs/server.md`
- Pagina pubblica a blocchi: `apps/web/src/blocks/` (`registry.tsx`: `BLOCKS`, `renderLayoutBlock`; `BrandBlocks.tsx`;
  `MatchBlocks.tsx`; `sampleMatch.ts`, `sampleMatch.json`, `env.ts`), `components/BlockLayout.tsx`,
  `pages/admin/LayoutPage.tsx`, `pages/admin/layoutEditor.ts`, `scripts/sample-match.ts`; contratto in
  `packages/shared/src/layout.ts` (`docs/architettura.md`), API in `docs/server.md`, classifica in `docs/statistiche.md`
- Pause della partita: `apps/web/src/components/Intermission.tsx` (`Intermission`), `blocks/IntermissionSlides.tsx`
  (`renderSlide`, `SLIDE_LABELS`), `lib/intermission.ts` (`phaseOf`, `describePause`, `activePause`, `visibleSlides`,
  `pauseTitle`, `previewState`), `lib/branding.ts` (`useTenantIntermissions`), `pages/admin/IntermissionsPage.tsx`,
  `pages/admin/intermissionEditor.ts`, `pages/admin/StatOptionsFields.tsx`, `blocks/StatSlides.tsx`, `milestoneStep`,
  `milestonePause`, `statPeriod`, `duelRoles` in `lib/intermission.ts`; contratto in `packages/shared/src/intermissions.ts` (`docs/architettura.md`), fase e
  riepiloghi in `packages/volley-stats/src/phase.ts`, `recap.ts` (`docs/statistiche.md`), API in `docs/server.md`
- Avvisi sugli eventi: `apps/web/src/components/Overlay.tsx` (`Overlay`, `OverlayBanner`), `lib/overlay.ts`
  (`overlayFor`, `unseenEvents`, `enqueue`, `nextOverlay`, `sampleEvent`), `lib/branding.ts` (`useTenantOverlays`),
  `lib/liveConnection.ts` (`live`), `pages/admin/OverlaysPage.tsx`, `styles/index.css` (`.sir-overlay`); contratto in
  `packages/shared/src/overlays.ts` (`docs/architettura.md`), eventi in `packages/volley-stats/src/events.ts`
  (`docs/statistiche.md`), API in `docs/server.md`; test `Overlay.test.tsx`, `OverlaysPage.test.tsx`
- Agente scaricabile: `apps/web/src/pages/admin/AgentsPage.tsx` (`AgentDownload`, `AGENT_DOWNLOAD_PATH`), test
  `AgentsPage.test.tsx`; `AgentDownloadInfoSchema` in `packages/shared/src/agentDownload.ts`; server in `docs/server.md`
- Portale adattivo: `apps/web/src/lib/layout.ts` (`deviceFor`, `tvModeOf`, `defaultLayouts`, `blocksFor`, `packRows`, `tvGroups`, `rotationIndex`),
  `lib/useLayout.ts` (`useStickyOffset`), `lib/tvScreen.ts` (`useWakeLock`, `useIdle`), `components/BlockLayout.tsx`,
  `components/ui.tsx` (`CardCollapseContext`), `styles/index.css`
- Modelli grafici: `apps/web/src/lib/branding.ts` (`applyTemplate`, `initTemplate`, `useTemplate`, `useOurTeamColors`),
  `lib/teamColors.ts` (`teamColorVars`), `lib/theme.ts` (`forcedTheme`, `useForcedTheme`), `lib/layout.ts` (`viewportClass`,
  `templateLayouts`), `MenuButton.tsx`, `BrandMark.tsx`, `BrandingPreview.tsx`,
  `styles/tokens.css` (`[data-template='sir-volley']`), `styles/fonts.css`, `scripts/trim-logo.ts`, `public/templates/sir-volley/`;
  contratti in `packages/shared/src/templates.ts`, `ourTeam.ts` (`docs/architettura.md`); originali in `docs/grafica/`
- Link breve e QR: `apps/web/src/qr/` (`qrImage.ts`, `qrCanvas.ts`, `ShareQr.tsx`), `pages/admin/ShareLinksPage.tsx`;
  `packages/shared/src/admin.ts` (`SHARE_TOKEN_PATTERN`, `formatShortCode`); server in `docs/server.md`
- `apps/web/src/components/` (`MatchView`, `LiveMatch`, `Scoreboard`, `MomentumChart`, `TeamComparison`, `PlayerTable`, `CourtMap`, `Rotations`)
- `apps/web/src/charts/` (trasformazioni pure, `theme.ts` con `buildEchartsTheme` e `richSafe`), `src/styles/tokens.css`
- `apps/web/vite.config.ts`, `apps/web/scripts/demo.ts`
- `docker/web.Dockerfile`, `docker/web.nginx.conf`, `docker/web.security-headers.conf`, `docker-compose.yml`, `.env.example`
- Contratti: `ServerMessageSchema`, `MatchStateSchema`, `MatchDetailSchema` in `packages/shared` (`docs/architettura.md`)
- `docs/server.md` (WebSocket, accessi, Docker), `docs/agente.md` (`serverUrl`), `docs/infrastruttura.md`, `docs/statistiche.md`, `docs/decisioni.md`
- Regole di interfaccia: `docs/regole/interfaccia.md`
