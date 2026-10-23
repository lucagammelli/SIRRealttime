# Portale

## A cosa serve
`@arenalive/web` (`apps/web/`) è il portale di ArenaLive: una applicazione a pagina singola (React, Vite, Tailwind 4,
ECharts) che mostra la partita in tempo reale. Ha due parti: la **pagina pubblica** `/live/:token`, raggiunta con un
link di condivisione e senza accesso, e l'**area riservata** `/admin` per chi gestisce partite, link, agenti e utenti.
Non calcola nulla: riceve dal server lo `MatchState` di `@arenalive/volley-stats` (`docs/statistiche.md`) e lo disegna.

## Come funziona

### Pagina pubblica `/live/:token` e `/l/:token` (`src/pages/LivePage.tsx`)
La stessa pagina risponde a due rotte (`src/App.tsx`): `/live/:token` (token lungo) e `/l/:token` (codice breve, come
`/l/K7M2QX9P`; accettati anche minuscole e il trattino a metà). Un valore che non rispetta `SHARE_TOKEN_PATTERN`
(`@arenalive/shared`: token di almeno 22 caratteri o codice breve) mostra subito «Link non valido o scaduto», senza aprire
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

Nell'intestazione ci sono il pulsante «Schermo intero» (diventa «Esci da schermo intero»), «Installa come app» (vedi
«App installabile») e il cambio tema.
La pagina pubblica non ha nessun collegamento all'area riservata.

**Punti in sequenza** (`src/lib/pointSequence.ts`, usata da `LivePage` con `usePointSequence`). Quando un solo
aggiornamento porta più punti (il simulatore veloce, oppure la coda dell'agente che si svuota dopo un'interruzione,
vedi `docs/agente.md`), tabellone, andamento, «Ultimo punto», avvisi e pause li mostrano **uno alla volta**, perché i due
punteggi non saltino insieme. È solo presentazione: lo stato resta quello del server e la sequenza finisce sempre su di
esso; gli stati intermedi vengono da `matchStateUntilPoint` di `@arenalive/volley-stats` (`docs/statistiche.md`), il portale
non calcola nulla.
- `planPointSequence(mostrato, nuovo, { live, reducedMotion })` decide i passi (uno per punto nuovo, l'ultimo è lo stato
  del server); `PointSequencer` li riproduce: ogni punto resta a video `POINT_STEP_MS` (600 ms) prima del successivo,
  anche tra aggiornamenti diversi, e un nuovo stato in arrivo riparte da quello a video.
- Con più di `POINT_SEQUENCE_MAX_POINTS` (5) punti nuovi in un aggiornamento, oppure se l'ultimo punto cadrebbe oltre
  `POINT_SEQUENCE_MAX_MS` (3 s) da adesso, si salta subito alla fine.
- **Subito la fine, senza attesa**: primo stato dopo il caricamento, riconnessione o `resync` (`live` falso), scout che
  ha riscritto o tolto punti (`pointsExtend` falso), nessun punto nuovo, `prefers-reduced-motion` (`useReducedMotion`),
  cambio di partita (`resetKey` = `matchId`).
- La pausa di fine set (o di fine partita) arriva dopo l'ultimo punto: gli stati intermedi hanno fase `rally`, la fase
  vera arriva con lo stato finale.
- L'andamento cresce dal punto precedente, non si ridisegna: le serie hanno id fissi (`lead-home`, `lead-away`,
  `break-point` in `src/charts/options.ts`).
- Prova: `src/lib/pointSequence.test.tsx`, `src/pages/LivePage.test.tsx`.

**Dispositivi e impaginazione** (`src/lib/layout.ts`, `useLayout.ts`, `components/BlockLayout.tsx`). `deviceFor` sceglie
tra tre impaginazioni, con gli stessi blocchi della tabella sopra:

| Dispositivo | Quando | Impaginazione |
|---|---|---|
| Telefono | larghezza fino a 767 px (`viewportClass`: `phone`); in orizzontale (più larga che alta, alta al massimo 500 px, sotto 1200 px) il telefono resta tale sotto 560 px (`PHONE_LANDSCAPE_MIN_WIDTH`) | una colonna; tabellone compatto fisso in alto con «Dettagli del set» (`ScoreFacts`); sezioni comprimibili (`Card` con `aria-expanded`), all'inizio aperta solo «Andamento del set»; grafici semplificati (legenda sotto, più bassi); tabella giocatori con le colonne essenziali (vedi «Regole del telefono») |
| Tablet | da 768 px e sotto le soglie della TV; telefono orizzontale da 560 px | **verticale** 768-899 px: una colonna; **orizzontale** 900-1199 px: griglia a 12 colonne con card a metà; **desktop** da 1200 px: la griglia a 12 colonne del layout (le soglie sono sulla larghezza della griglia, `GRID_LANDSCAPE_MIN_PX` 856 e `GRID_DESKTOP_MIN_PX` 1150, perciò l'anteprima dell'editor si comporta come la pagina vera) |
| TV | da sola con almeno 1600 × 800 px e proporzioni ≥ 16:10; sempre con `?tv=1`; mai con `?tv=0`; con «Schermo intero» solo da tablet in su (mai da telefono, anche orizzontale) | senza scorrimento, testi scalati, rotazione dei gruppi |

I breakpoint sono quelli delle specifiche grafiche (`docs/grafica/`) e valgono per **tutti** i modelli. Un monitor
desktop 4:3 o 16:10 basso resta quindi tablet/desktop e mantiene lo scorrimento. `defaultLayouts` è l'elenco predefinito dei
blocchi per dispositivo del modello standard (da `defaultDeviceBlocks` di `@arenalive/shared`, larghezze 12/8/6/4 su 12
colonne come prima); `templateLayouts` ha quelli di ogni modello e `blocksFor(layout, dispositivo, modello)` sceglie quello
giusto quando il cliente non ha un layout. Il cliente può cambiarlo nella sezione «Pagina live» dello Studio (vedi «Pagina pubblica a blocchi»). Nell'area riservata `MatchView` usa al massimo l'impaginazione tablet.

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
Senza intestazione e con partita in corso, il logo del cliente (`BrandMark`) e i pulsanti stanno nel tabellone (il logo solo
senza loghi di sistema, vedi sotto). Se la
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
| link di una partita del calendario, prima del `.dvw` | «Prossima partita» (`NextMatch.tsx`, indicatore «In attesa», vedi «Prossima partita»): la partita appare da sola appena il `.dvw` arriva |
| link revocato, scaduto o inesistente | «Link non valido o scaduto» (indicatore «Link non valido») |
| sessione admin terminata (solo area riservata) | «Sessione terminata» (indicatore «Sessione terminata») |
| errore del server sullo stato | riquadro «Aggiornamento non disponibile: …» sopra la partita |
| qualsiasi altro indirizzo | pagina principale (`HomeScreen` in `App.tsx`): il logo di sistema sinistro al centro o, se non c'è, il logo ArenaLive (`ProductLogo`, variante automatica), titolo «ArenaLive» per i lettori di schermo e «Per seguire una partita apri il link che ti è stato inviato.» |

### Area riservata `/admin` (`src/pages/admin/`)
Prima si verifica la sessione («Verifica della sessione…»); senza sessione compare il login
(logo centrato in alto, il titolo «Area riservata» resta solo per i lettori di schermo; email e password, con il link «Password dimenticata?» che porta a `/admin/password-dimenticata`, vedi «Recupero password e inviti»; si può accedere da **qualunque hostname** del portale e si lavora sempre sul cliente dell'utente), se il
server non risponde «Area riservata non disponibile» con «Riprova». Il **menu laterale**
(`AdminSidebar.tsx`; `menuGroups({ isAdmin, isSuperadmin, inTenant })` è pura e dà i gruppi in base al ruolo, quelli vuoti
spariscono) sostituisce la barra a pillole. Gruppi di un cliente (admin e viewer, e il superadmin dentro un cliente):

- «Partite»: Partita live, Partite, Calendario;
- «Club»: Club;
- «Pagina pubblica»: Studio grafico, Sponsor, Link pubblici, Simulazione. Il **viewer** ci vede solo Link pubblici (Studio
  grafico, Sponsor e Simulazione sono dell'admin);
- «Dispositivi»: Agenti;
- «Amministrazione»: Utenti (solo admin);
- «Account e aiuto» (`ACCOUNT_GROUP`, per tutti i ruoli, dentro o fuori da un cliente): «Il mio account» e «Guida».

Il **superadmin fuori da un cliente** vede solo il suo menu (`SUPERADMIN_MENU`): il gruppo «Amministrazione» con Clienti,
Campionati, Posta e Loghi di sistema, più «Account e aiuto». Per lavorare su un cliente ci entra con «Entra nel cliente» (vedi «Più clienti»).

- in cima il logo (`BrandMark`), in fondo il nome del cliente, account, tema e «Esci»; la voce attiva è
  evidenziata (`--sir-nav-active`, rosso in SIR VOLLEY);
- tutta l'area, login compreso, è in **Inter** (classe `.sir-admin-font` in `AdminApp.tsx`, vedi «Tema e stile»), con
  cifre tabulari in tabelle e campi numerici; l'elenco delle voci scorre con una barra sottile (`.sir-thin-scroll`:
  `scrollbar-width: thin` e `::-webkit-scrollbar` di 6 px, colori dei token);
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
| Calendario | `/admin/calendario` | admin e viewer (il viewer in sola lettura) | le partite del club con link, QR e stato; partite aggiunte a mano, «Trasmessa»/«Non trasmessa»; «Da confermare»; «Aggiorna calendario», vedi «Club e Calendario» |
| Club | `/admin/club` | admin e viewer (il superadmin dentro un cliente) | profilo del club, campionati e squadra, «Nostra squadra nei file .dvw», vedi «Club e Calendario» |
| Campionati | `/admin/campionati` | solo superadmin | elenco dei campionati della Lega, «Nuovo campionato della Lega», «Aggiorna ora», vedi «Club e Calendario» |
| Link pubblici | `/admin/link` | admin e viewer (il viewer in sola lettura) | «Nuovo link pubblico» (etichetta, «Cosa mostra»: «Tutte le partite del calendario (canale del club)» oppure «Una partita fissa», «Scadenza (facoltativa)»), «Link creati» (per i link attivi «Link breve», codice e QR, vedi «Link breve e QR»; i revocati stanno dietro «Mostra revocati (N)»), «Revoca» |
| Simulazione | `/admin/simulazione` | solo admin (il superadmin dentro un cliente) | «Nuova simulazione», «Avanzamento», «Link della simulazione» (con QR): una partita giocata dal server su un link a parte, vedi «Simulazione» |
| Agenti | `/admin/agenti` | admin e viewer (il viewer in sola lettura) | «Agente per Windows» (vedi sotto), «Nuovo agente» (sottotitolo «Alternativa alla registrazione dall'agente: token da incollare a mano», per chi non può registrare dalla finestra, per esempio servizio o `--once`, o la usa sotto «Avanzate»; `docs/agente.md`; «Crea token», mostrato una sola volta con «Copia config.json»), «Richieste in attesa» (vedi sotto), «Agenti» (stato «Attivo»/«Scaduto»/«Revocato», «Prolunga» con «Salva validità», «Revoca»), con la riga «N di M agenti in uso (limite dato dal superadmin)» |
| Posta | `/admin/posta` | solo superadmin (fuori da un cliente) | server di posta per inviti e recupero password, uguale per tutti i clienti, vedi «Posta» |
| Loghi di sistema | `/admin/loghi-di-sistema` | solo superadmin (fuori da un cliente) | i loghi della piattaforma (sinistro e destro, positivo e negativo), vedi «Loghi di sistema» |
| Utenti | `/admin/utenti` | solo admin | «Nuovo utente» (sottotitolo «Cliente: …»; email, «Password (facoltativa)» di almeno 12 caratteri, «Ruolo»: «Lettura e scrittura» o «Sola lettura»; «Crea e invita» se la password è vuota, altrimenti «Crea utente»), scheda «Ruoli» (cosa può fare ciascun ruolo), «Utenti» (per ognuno stato «Attivo»/«Disattivato», ruolo, data di creazione e i comandi descritti sotto), vedi «Utenti del cliente» |
| Studio grafico | `/admin/studio`, `/admin/studio/:sezione` (`colori`, `pagina`, `pause`, `avvisi`) | solo admin (il superadmin dentro un cliente) | colori e loghi, pagina live, pause e avvisi in un'unica pagina con anteprima grande, vedi «Studio grafico». Le vecchie rotte `/admin/grafica`, `/admin/pagina`, `/admin/pause`, `/admin/avvisi` rimandano alla sezione corrispondente |
| Sponsor | `/admin/sponsor` | solo admin (il superadmin dentro un cliente) | anagrafica degli sponsor, vedi «Sponsor» |
| Clienti | `/admin/clienti` | solo superadmin | «Nuovo cliente» (Nome, Identificativo, Hostname, «Agenti» = limite di agenti, predefinito 1; «Crea cliente»), «Clienti» con «Entra nel cliente» (il superadmin entra in quel cliente e apre `/admin/live`, vedi «Più clienti») e «Modifica» (nome, hostname e limite di agenti, «Salva»; il limite è mostrato come «un agente» / «fino a N agenti»); riquadro «Primo utente (facoltativo)» nel modulo («Email del primo utente» e «Password del primo utente (facoltativa)»; creato con il ruolo «Lettura e scrittura»; senza password il primo utente è invitato e sotto il modulo compare l'esito dell'invito, vedi «Utenti del cliente»); ogni cliente mostra «nessun utente», «1 utente» o «N utenti» |
| Esci | - | tutti | chiude la sessione |

**Anteprima sempre visibile**: nello «Studio grafico» (vedi sotto) l'anteprima è la colonna destra della pagina, sempre in
vista, con la propria barra di dispositivo e scena. Il pulsante «Anteprima a tutto schermo» apre `PreviewFullscreen`
(`components/PreviewDock.tsx`): un dialog modale (`role="dialog"`, `aria-modal`) che chiede la Fullscreen API e, se manca
o è rifiutata (iPhone), resta a finestra intera; si chiude con Esc o «Chiudi» e il focus torna al pulsante.
`DevicePreview` (`studio/blockEditors.tsx`) ha la prop `fit` per riempire lo spazio.

**Più clienti** (`docs/server.md`, «Clienti»). Nel menu compare il nome del cliente corrente (`user.tenant`). Un admin o
un viewer vede solo il proprio cliente, senza voce «Clienti», e accede da qualunque hostname del portale. Il **superadmin**
non ha più un selettore del cliente nella barra: lavora solo **dentro** un cliente in cui è entrato.
- **Fuori da un cliente** (al login e dopo «Esci dal cliente») vede solo il suo menu, «Clienti» (la sua prima pagina) e
  «Campionati»; le pagine di un cliente lo riportano a «Clienti». Se una chiamata arriva comunque senza cliente, il server
  risponde 409 `TENANT_REQUIRED` e la pagina mostra «Scegli prima un cliente.» (`api.ts`).
- **«Entra nel cliente»** (pulsante di ogni cliente nella pagina «Clienti», `TenantsPage.tsx`, `useChooseTenant`): invia
  `POST /api/admin/active-tenant` con l'id, salva il cliente nella sessione (vale anche per `/ws/admin`), apre
  `/admin/live` e le pagine si ricaricano (`Routes` con `key` sul cliente). Dentro il cliente il superadmin ha il menu e le
  pagine di un admin di quel cliente (senza Clienti e Campionati), sotto una **barra gialla** (`ManagedTenantBar.tsx`,
  colore `--sir-warn`) con «Stai gestendo «X» come superadmin» e il pulsante **«Esci dal cliente»**.
- **Titolo della scheda**: dentro il cliente comincia con **«[X] »** (`useTitlePrefix`, `src/lib/titlePrefix.ts`; per
  esempio «[Sir Safety] Link pubblici · Area riservata»), anche quando le pagine cambiano titolo; si toglie all'uscita.
- **«Esci dal cliente»** invia `POST /api/admin/active-tenant` con `tenantId: null` e riporta a `/admin/clienti`.
  Entrata e uscita finiscono nei log del server («superadmin entrato nel cliente», «superadmin uscito dal cliente»).

### Studio grafico (`src/pages/admin/studio/`, rotta `/admin/studio/:sezione`)
Un'unica pagina, solo per l'admin (titolo scheda «Studio grafico · Area riservata»), al posto delle vecchie pagine
«Grafica», «Pagina pubblica», «Pause» e «Avvisi», che ora sono le sue quattro sezioni. Le rotte vecchie (`/admin/grafica`,
`/admin/pagina`, `/admin/pause`, `/admin/avvisi`) rimandano alla sezione (`LEGACY_PAGES` in `model.ts`); `/admin/studio`
senza sezione apre «Colori e loghi». Entrando nello Studio il menu laterale resta come l'ha lasciato l'utente (aperto o
ridotto alle icone). Dati e rotte del server non cambiano
(`docs/server.md`): ogni sezione legge e scrive il suo documento.

**Tre colonne** (da 768 px; `StudioPage.tsx`):
- **Sezioni** (a sinistra): «Colori e loghi» (Aspetto di tutta la pagina), «Pagina live» (Blocchi di TV, tablet e
  telefono), «Pause» (Fine set, time-out, sponsor), «Avvisi» (Ace, muro, set point). Un pallino ● segna le sezioni con
  modifiche non salvate.
- **Impostazioni** (al centro): a schede brevi; le impostazioni meno usate stanno in «Avanzate», chiuso all'inizio. Passando
  il mouse (o il focus della tastiera) su un'impostazione, i suoi elementi sono evidenziati nell'anteprima; sotto ogni
  impostazione compare dove e quando si vede.
- **Anteprima** (a destra, grande, sempre in vista): barra «Dispositivo» (TV, Tablet, Telefono), barra «Scena» (In gioco,
  Fine set, Time-out, Ogni N punti, Fine partita, Avviso «<nome dell'avviso>»), il pulsante «Allarga anteprima» (stringe le
  sezioni a una colonna di nomi corti e le impostazioni; la scelta resta in `localStorage` con chiave
  `sir-studio-anteprima-larga`; non sul telefono) e «Anteprima a tutto schermo». Sotto: «Dati della partita live.»
  oppure «Partita d'esempio: nessuna partita live in questo momento.».

**Anteprima** (`StudioPreview.tsx`). Disegna la pagina del dispositivo con i componenti veri della pagina pubblica
(`MatchView` via `DevicePreview`, `Intermission`, `OverlayBanner`) e le bozze non salvate di **tutte** le sezioni.
La partita è quella live del cliente (`/ws/admin`) o la «Partita d'esempio» (`sampleMatch.json`) con la **nostra squadra
in casa** (`sampleWithOurTeam`: nome e codice di «nostra squadra»). I colori della bozza valgono anche per i grafici
ECharts dell'anteprima: l'anteprima è un ambito di colori (`data-sir-scope`, palette e tema della bozza in `BrandScope`) e
i grafici leggono la palette da lì (`PaletteScopeContext`, `usePalette` in `charts/usePalette.ts`) invece che da `<html>`.
Le pause e le diapositive usano dati d'esempio del calendario (`SAMPLE_SCHEDULE`). Avvisi sotto la barra: «Pausa
disattivata: gli spettatori non la vedono.», «Nessuna diapositiva da mostrare (uno sponsor senza immagini?): la pausa non
compare.», «Avviso spento: gli spettatori non lo vedono.», «Su <dispositivo> questo avviso non compare.».

- **Scena automatica e manuale** (`autoScene`): aprendo una sezione la scena si sceglie da sola (Colori e Pagina: «In
  gioco»; Pause: la pausa aperta; Avvisi: «Avviso»); si può sempre cambiare a mano. Cambiando scheda di pausa o di set,
  o scegliendo un avviso, la scena segue.
- **Dall'impostazione all'elemento e viceversa**: l'elemento dell'impostazione è evidenziato (`outline`); se non si vede
  nella scena corrente compare «Non si vede in questa scena. Mostra «<scena>»», un pulsante che porta alla scena giusta. Un
  clic su un elemento dell'anteprima (`pickAt`: la scatola marcata più piccola sotto il puntatore) apre la sua
  impostazione: cambia sezione e scheda se serve, la porta in vista, le dà il focus e la segna un attimo. Colori della
  squadra: in «Colori e loghi» un clic su tabellone, confronto, andamento o sfida apre «Squadra di casa». Gli elementi si
  trovano con marcatori inerti sui componenti pubblici (`data-studio-page`, `data-studio-block`, `data-studio-type`,
  `data-studio-slide`, `data-intermission`, `data-overlay`; in `BlockLayout.tsx` e `Intermission.tsx`): non hanno effetto
  sulla pagina pubblica.
- **Riga «Compare: …»**: ogni impostazione dichiara dove compare (`blockWhere`, `pauseWhere`, `overlayWhere` in `model.ts`),
  per esempio «TV, in gioco», «a tutto schermo su TV e tablet, banda in basso su telefono, a fine set», «TV e tablet, in
  alto, medio, sopra la partita». La riga è cliccabile e porta nell'anteprima alla scena giusta.
- **Un salvataggio per sezione**: «Salva» scrive solo la sezione aperta con le rotte di sempre (`PUT /api/admin/branding`,
  `/layout`, `/intermissions`, `/overlays`) e poi rilegge la grafica (`initBranding({ fresh: true })`). Testi dopo il
  salvataggio: «Grafica salvata: la pagina pubblica la usa da subito.» (Colori e loghi), «Pagina pubblica salvata: la
  vedono da subito tutti gli spettatori.», «Pause salvate: valgono da subito per tutti gli spettatori.», «Avvisi
  salvati: valgono da subito per tutti gli spettatori.». Con modifiche compare in basso la barra «N modifiche non
  salvate» con «Vedi modifiche» (elenco `brandingChanges`, `layoutChanges`, `intermissionChanges`, `overlayChanges`: cosa
  era e cosa diventa), «Annulla modifiche» (torna al salvato) e «Salva». «Salva» è disattivato se la sezione ha un valore
  non valido (blocchi con opzioni non valide, pausa attiva senza diapositive o con testo vuoto, testo di un avviso
  vuoto, troppo lungo o con segnaposto sconosciuti); il messaggio è nella barra.
- **Non perdere lavoro**: cambiando sezione con modifiche compare «Modifiche non salvate» con «Salva e continua»,
  «Continua senza salvare» (le modifiche restano in sospeso, segnate con ●) e «Resta qui» (Esc); uscendo dallo Studio da un
  link dell'area riservata, stessa domanda con «Esci senza salvare» e «Resta qui». Chiudendo la scheda del browser,
  `beforeunload` chiede conferma.
- **Telefono** (sotto 768 px, `STUDIO_PHONE_MAX`): la pagina è a passi, «Sezioni» → «Impostazioni» → «Anteprima» («←
  Indietro», pulsante «Vedi anteprima»); aprendo l'indirizzo di una sezione si parte dalle impostazioni. Le **pause** sul
  telefono sono a **banda** in basso (è il predefinito del telefono; resta modificabile per dispositivo).
- **Configurazione guidata** (`StudioWizard.tsx`): finestra a 4 passi con l'anteprima TV accanto: «Logo e colori» (3
  colori, logo orizzontale, nome visualizzato), «La tua squadra» (nostra squadra e colori delle due squadre), «La pagina»
  (quali blocchi mostrare, su tutti i dispositivi) e «Le pause» (modello e pausa a fine set). **Non si apre più da sola**
  (il primo accesso è la procedura guidata di `onboarding/`, vedi «Procedura guidata del primo accesso»): resta il
  pulsante «Configurazione guidata» per aprirla quando si vuole.
  Pulsanti «Indietro», «Avanti», «Chiudi» (le modifiche restano nelle bozze, non salvate) e, all'ultimo passo, «Fine e
  salva» (salva Colori, Pagina e Pause cambiati).
- **Modelli pronti** (`model.ts`, `applyPauseModel`, `applyOverlayModel`): in «Pause» e «Avvisi» tre modelli, «Essenziale»,
  «Completo» e «Sponsor in evidenza»; dopo un ritocco il modello attivo diventa «Personalizzato» (`activePauseModel`,
  `activeOverlayModel`). I modelli delle pause tengono le immagini sponsor e la regola «ogni N punti» e tolgono le pause
  proprie dei set; quelli degli avvisi tengono testi, dispositivi, priorità, posizione e dimensione di ogni avviso.

#### Sezione «Colori e loghi»
Ex pagina «Grafica» (`ColorsSection.tsx`), schede «Colori», «Loghi e nome», «Squadra», «Immagini», «Esporta / Importa».
- «Colori»: i cinque colori («Colore principale», «Colore di risalto», «Squadra di casa», «Squadra ospite», «Sfondo
  della pagina»), ciascuno con selettore e campo esadecimale `#rrggbb` e «Predefinito»; i colori vanno sopra quelli del
  modello. Avvisi di contrasto (`brandContrastIssues`, sotto 4,5:1), per esempio «Lo sfondo è troppo scuro per il testo
  della pagina…» o «“Colore di risalto” ha contrasto …:1 sullo sfondo (minimo 4,5:1): i testi in questo colore si
  leggono male.». In «Avanzate»: «Modello grafico» (vedi «Modelli grafici») e «Ripristina predefiniti» (colori, modello,
  nome, nostra squadra e loghi tornano quelli del portale; le immagini restano caricate).
- «Loghi e nome»: «Nome visualizzato» (facoltativo) e le tre immagini («Logo orizzontale», «Logo quadrato», «Logo dello
  sponsor») con «Carica immagine» (PNG, JPEG, WebP o SVG, al massimo 2 MB) e «Togli».
- «Squadra»: «Nostra squadra» («Codice squadra», es. PER, e «Testo nel nome della squadra», es. Perugia, entrambi
  facoltativi).
- «Immagini»: scheda «Immagini caricate» (sottotitolo «Spazio usato: … MB di … MB») con l'elenco, «in uso» e «Elimina» /
  «Conferma eliminazione»; vuota: «Nessuna immagine caricata.». Il caricamento invia il file in base64 (`fileToBase64`,
  `src/lib/base64.ts`) a `POST /api/admin/assets`; il salvataggio è `PUT /api/admin/branding`. Per le immagini sponsor
  l'elenco dice di quale sponsor sono («Sponsor: <nome>») o «Sponsor (senza sponsor)»; si caricano e si assegnano dalla
  pagina «Sponsor» (`ColorsSection.tsx`).
- **Miniature e anteprime dell'area riservata**: ogni immagine del cliente (miniature di «Immagini», dei loghi, della
  pagina «Sponsor», dei loghi delle partite in «Calendario», anteprime dello Studio e della prima configurazione) si
  carica da `GET /api/admin/assets/:id/file` (`adminAssetPath` di `packages/shared/src/tenant.ts`; `url` di
  `AssetSummary`), che serve le immagini del cliente della sessione qualunque sia l'hostname. La via pubblica
  `/api/public/assets/:id` serve solo il cliente dell'hostname: su un indirizzo IP (installazione di prova) o per il
  superadmin dentro un altro cliente l'immagine risultava rotta. Le anteprime passano `assetPath: adminAssetPath` ai
  blocchi (`BlockBrand` in `blocks/env.ts`, `blockBrandOf`); la pagina pubblica resta su `publicAssetPath`.
- «Esporta / Importa» (`GraphicsTransfer.tsx`): «Esporta configurazione» scarica `grafica-<slug>-<data>.json`
  (`GET /api/admin/branding/export`). «File della configurazione (.json)» legge il file (`readPackage`: messaggi per file
  illeggibile, non nostro, versione non supportata o danneggiato), mostra il «Riepilogo del file» (club di origine,
  esportata il, numero di immagini, modello grafico) e l'avviso «la grafica attuale … verrà sostituita»; «Sostituisci la
  grafica» invia `POST /api/admin/branding/import` e ricarica lo Studio, «Annulla» scarta il file. Con un tema
  personalizzato che il club non ha già salvato (`templateChoices`, come sceglie il server) e senza essere superadmin il
  pulsante è disabilitato con il motivo.

#### Sezione «Pagina live»
Ex pagina «Pagina pubblica» (`PageSection.tsx`, vedi «Pagina pubblica a blocchi»). Tre schede «TV», «Tablet», «Telefono»
(le stesse del dispositivo dell'anteprima: cambiare l'una cambia l'altra). Per ogni blocco: maniglia ⠿ (trascinamento),
↑ e ↓ («Sposta su», «Sposta giù»), interruttore «Visibile» e «Rimuovi» (icona «−», nome nell'aria-label e nel tooltip), tutti in una riga sotto il nome del blocco; «Rimuovi» chiede
«Conferma rimozione» (con «Annulla») solo se il blocco ha opzioni diverse da quelle predefinite del tipo
(`blockHasSettings` in `studio/model.ts`; componente `RemoveButton` di `StudioUi.tsx`, su `ConfirmButton`). Sotto
«Opzioni» (con la larghezza): «Larghezza» (non sul
telefono; i valori ammessi dipendono dal tipo, per esempio «Metà (6/12)»), «Chiuso all'apertura» (solo telefono, non per
il tabellone) e le opzioni del tipo (per lo sponsor le caselle degli sponsor, vedi «Sponsor»). In fondo «Tipo di
blocco» con «Aggiungi blocco» (in coda; il tabellone solo se manca; al massimo 24 blocchi, contatore «N di al massimo 24
blocchi.»). In «Avanzate»: «Ripristina predefinito», che rimette i blocchi predefiniti **solo del dispositivo aperto**
(quelli del modello grafico). I blocchi con opzioni non valide (per esempio testo vuoto) sono evidenziati e «Salva»
resta disattivato. Logica pura in `layoutEditor.ts` (`moveBlock`, `updateBlock`, `removeBlock`, `addBlock`,
`resetDevice`, `layoutProblems`); le opzioni dei 21 tipi di blocco sono in `studio/blockEditors.tsx`
(`BlockOptionsEditor`). Accessibilità: spostamenti, aggiunte e rimozioni sono annunciati in una regione `aria-live`
(«Messaggio in posizione 2 di 6.», «Messaggio rimosso.»); dopo uno spostamento da tastiera il focus resta sul
pulsante usato. Il trascinamento è un'aggiunta: tutto si fa anche con ↑ ↓.

#### Sezione «Pause»
Ex pagina «Pause» (`PausesSection.tsx`, vedi «Pause della partita»). In alto i «Modelli pronti»; poi le schede
«Time-out», «Fine set», «Fine partita», «Ogni N punti». Per «Fine set» una seconda fila «Tutti i set», «1° set»…«4° set»
con la casella «Pausa propria per la fine del N° set» (senza, quel set usa «Tutti i set»). «Ogni N punti» ha la scheda
«Regola» con «Ogni quanti punti» (4-25) e «Non negli ultimi punti del set» (`stopBeforeEnd`, con il traguardo da
`setTarget` di volley-stats). Per ogni pausa, «Quando e come»: «Pausa attiva» e «Come si mostra» (per TV, tablet e
telefono «Tutto schermo» o «Banda in basso»); «Diapositive»: elenco riordinabile con «Sposta su» e «Sposta giù» (niente
trascinamento); in una riga sotto il nome di ogni diapositiva l'interruttore «Attiva: <tipo>» e «Rimuovi» (icona «−»; con «Conferma rimozione» solo
se la diapositiva ha opzioni diverse da quelle predefinite, `slideHasSettings`). Una diapositiva disattivata (campo
`enabled` della diapositiva, predefinito attivo: i documenti salvati prima restano tutti attivi) resta nell'elenco con le
sue opzioni, segnata «(disattivata)», ma non compare né sulla pagina pubblica né nell'anteprima (`visibleSlides`); se
tutte sono disattivate la pausa non compare (`intermissionFor` dà null) e l'elenco lo dice («Tutte le diapositive sono
disattivate: la pausa non compare.»). Sotto «Opzioni» «Secondi sullo schermo» e le opzioni del tipo (come nei blocchi;
lo sponsor sceglie gli sponsor come il blocco); in fondo «Tipo di diapositiva» con «Aggiungi diapositiva» (al massimo 12). In «Avanzate»: «Ritardo prima della
pausa (secondi)» e «Ripristina predefinito» (solo della pausa aperta). «Salva» è disattivato se una pausa attiva non ha
diapositive o un testo è vuoto. Nella scheda «Fine partita» c'è anche la card «Dopo la partita» (`AfterMatchEditor`):
«Mostra la foto dopo la partita» (interruttore), «Foto a tutto schermo» con «Carica immagine» e «Togli foto», «Oppure
scegli un’immagine già caricata», «Minuti dopo la fine della partita» (0-240) e l'anteprima TV con la prossima partita
d'esempio. I «Modelli pronti» non la toccano. Logica pura in `intermissionEditor.ts` (`moveSlide`, `addSlide`, `removeSlide`,
`updateSlide`, `setOwnPause`, `resetPause`, `pauseProblems`); le opzioni delle statistiche in `StatOptionsFields.tsx`.
Nell'anteprima la pausa è mostrata subito con le bozze (`previewState` mette nello stato la fase della pausa aperta).

#### Sezione «Avvisi»
Ex pagina «Avvisi» (`OverlaysSection.tsx`, vedi «Avvisi sugli eventi»). In alto i «Modelli pronti»; due schede: «Quali
avvisi» e «Posizione e dimensione». «Quali avvisi» (scheda «Eventi») elenca i 12 eventi (Fine partita, Match point, Fine
set, Set point, Ace, Muro punto, Sorpasso, Pareggio, Break, Time-out, Scambio lungo, Cambio), ognuno con interruttore e
pulsante «Modifica» («In modifica» sull'avviso aperto). L'avviso aperto mostra: «Testo» (il risultato con i dati
d'esempio compare sotto, «Risultato: …», oppure il problema: vuoto, oltre 80 caratteri, segnaposto sconosciuto, `<` o
`>`), «Sfondo» (`BackgroundSetting`: «Nessuno» / «Immagine» / «Video»; un menu con i file già caricati per gli avvisi e i pulsanti
«Carica immagine» (PNG, JPEG, WebP o SVG, 2 MB) e «Carica video» (MP4 o WebM, 15 MB, controllati prima dell'invio con
`videoProblem`; `uploadVideo` in `pages/admin/imageUpload.ts` manda il file come corpo binario), con l'anteprima del file
scelto; cambiando tipo lo sfondo scelto si toglie), i «Segnaposto» ammessi (`{giocatore}`, `{numero}`, `{squadra}`, `{punteggio}`, `{set}`, `{serie}`, `{attacchi}`),
«Secondi» (2-8), i dispositivi (TV, tablet, telefono), «Posizione» e «Dimensione» (In alto / Al centro / In basso;
Piccolo / Medio / Grande; oppure «Come tutti gli avvisi»), «Prova» (lo mostra nell'anteprima con le modifiche non salvate,
per i suoi secondi, con l'animazione; la scena passa ad «Avviso»), e in «Avanzate» «Priorità» (1-10) e «Ripristina
predefinito» (solo di quell'evento). «Posizione e dimensione» è il riquadro «Posizione e dimensione di tutti gli avvisi»
(impostazioni generali). «Salva» è disattivato con un testo non valido. Logica pura: `lib/overlay.ts` (`overlayValues`,
`overlayText`, `overlayFor`, `unseenEvents`, `enqueue`, `nextOverlay`, `sampleEvent`).

**Limiti noti dello Studio**: i valori da provare su dispositivi veri sono quelli di sempre (TV a 4-5 m, telefono con la
banda); un'immagine usata come immagine singola di un blocco o di una diapositiva sponsor non si può eliminare finché non
viene tolta da lì; un layout salvato e poi non più valido si legge come predefinito; dopo il primo salvataggio il layout del
cliente resta fisso anche se cambia modello (va reimpostato con «Ripristina predefinito» per dispositivo). Test:
`studio/model.test.ts`, `studio/StudioPage.test.tsx`.

### Procedura guidata del primo accesso (`pages/admin/onboarding/`)
Lavoro «primo-accesso». Contratto `OnboardingStatus` e rotte `GET /api/admin/onboarding` e `POST /api/admin/onboarding/complete`
in `docs/server.md` e `docs/architettura.md`. `OnboardingHost` (montato in `AdminApp.tsx`) legge lo stato del cliente; il
segno «fatto» è nel DB (`tenants.onboarded_at`), non nel browser.
- **Quando si apre**: da sola, una volta per sessione, solo al primo utente «Lettura e scrittura» (admin) di un cliente non
  configurato (`opensByItself`). Mai a un viewer e mai al superadmin, nemmeno dentro un cliente. «Salta per ora» la chiude
  fino al prossimo accesso (`sessionStorage`, chiave `sir-configurazione-saltata:<idCliente>`). I clienti già configurati
  (migrazione `0012`) non la vedono.
- **Avviso «Configurazione da completare»** sopra le pagine finché non è finita (`noticeFor`): per l'admin il pulsante
  «Riprendi» (riparte dal passo raggiunto o dal primo senza dati salvati, `resumeStep`), per il superadmin dentro un cliente
  «Apri la configurazione guidata»; nulla per il viewer.
- **I 5 passi** (`ONBOARDING_STEPS`; «Indietro», «Avanti», «Salta per ora»; l'ultimo ha «Fine»; ogni «Avanti» salva ciò che
  il passo ha cambiato, e a destra c'è l'anteprima del cliente):
  1. «Il logo»: «Il logo della società compare nelle pagine pubbliche, nell’app e nei QR.» «Logo quadrato della società» e
     «Logo orizzontale (facoltativo)», salvati appena caricati.
  2. «La squadra»: «In che serie gioca il club: il calendario arriva dal sito della Lega.» «Maschile o femminile» («Femminile»
     disattivato, «Presto disponibile»), «In che serie gioca» (tendina «Scegli la serie»), «Sto scaricando il calendario…»,
     «La tua squadra in «…»» con l'elenco (A3: le squadre dei due gironi, resta il girone della squadra scelta), «La mia
     squadra non è nell’elenco» (nome a mano, le partite si aggiungono dal «Calendario») e «Nome della squadra o del club».
  3. «I colori»: «Scegli un modello e, se vuoi, i colori della società.» Modello, colore principale e accento, avvisi di
     contrasto.
  4. «La grafica»: «Un modello pronto per le pause e gli avvisi durante la partita.» Modello di pause e avvisi.
  5. «Fatto»: «Ecco il riepilogo e i prossimi passi.» Riepilogo, link del canale del club con QR («Canale del club»),
     prossima partita, «Scarica l’agente» e «Apri lo Studio grafico» (collegamento nella stessa scheda alla sezione
     «Colori» dello Studio, `studioPath('colori')`, e chiude la procedura). «Fine» chiama `POST /api/admin/onboarding/complete`.
  Il passo «I colori» offre i quattro modelli (`SELECTABLE_TEMPLATE_IDS`, vedi «Modelli grafici»), mai SIR VOLLEY.
- File: `OnboardingHost.tsx`, `OnboardingWizard.tsx`, `OnboardingPreview.tsx`, `steps.tsx`, `model.ts` (`resumeStep`,
  `noticeFor`, `opensByItself`).

### Guida e «Il mio account» (`pages/admin/guide/`, `AccountPage.tsx`)
Lavoro «guida-utente». Le due voci stanno nel gruppo di menu «Account e aiuto», per ogni ruolo.
- **«Guida»** (`GuidePage.tsx`, rotta `/admin/guida`): come preparare e usare il portale, con parole semplici. I contenuti
  sono **dati** in `guide/content.ts` (`GUIDE_SECTIONS`: 11 sezioni per tutti, da «Primo accesso» a «Domande frequenti e
  problemi comuni», più «Per chi gestisce più club (superadmin)», `superadminOnly`, visibile solo al superadmin). Ogni
  sezione ha blocchi di testo, passi, elenchi e note, e può avere link «Vai a …». A sinistra l'indice (in alto su un
  telefono), poi la ricerca «Cerca nella guida» (`filterSections`: ignora maiuscole e accenti, servono tutte le parole,
  `normalize`, `sectionText`; «Nessun risultato per «…»» se vuota).
- **Sola lettura**: legge tutta la guida; le sezioni `needsWrite` aggiungono la nota `READ_ONLY_NOTE` su ciò che può fare
  solo «Lettura e scrittura».
- **Link «Vai a …»**: `canOpen(to, groups)` li mostra solo se la pagina è nel menu dell'utente (`menuGroups`), quindi un
  viewer non vede «Vai a Studio grafico» e il superadmin fuori da un cliente non vede «Vai a Club».
- **Parole vietate**: `guide/content.test.ts` fallisce se un testo usa parole tecniche (API, token, WebSocket, server, JSON,
  `.env`, endpoint, database, `config.json`, SMTP); controlla anche che i link vadano a pagine del menu o dello Studio e
  che le parole dell'agente («Registra», «Nome agente», «START», «STOP»…) siano quelle della sua finestra.
- **Regola per chi cambia l'interfaccia**: i testi della guida citano i nomi di pulsanti, campi e voci di menu; se si
  cambiano, si aggiorna `guide/content.ts` nello stesso lavoro (e il test dei menu).
- **Dove rimanda**: l'ultimo passo della procedura guidata ha il pulsante «Leggi la guida» (`onboarding/steps.tsx`) e
  l'avviso «Configurazione da completare» ha il pulsante «Guida» (`OnboardingHost.tsx`).
- **«Il mio account»** (`AccountPage.tsx`, rotta `/admin/account`): per tutti i ruoli, anche il superadmin fuori da un
  cliente (la rotta del server non dipende dal cliente). «Chi sei» (Email, Ruolo, Cliente se c'è) e «Cambia password»:
  «Password attuale», «Nuova password» (almeno `PASSWORD_MIN_LENGTH` caratteri), «Ripeti la nuova password»; i controlli
  locali usano `ChangeOwnPasswordRequestSchema`, poi `POST /api/auth/password`. Dopo il cambio gli altri dispositivi
  devono accedere di nuovo; «Password cambiata.» conferma. Password attuale sbagliata: errore `WRONG_PASSWORD` mostrato.
- **Versione**: «Versione» in «Chi sei» (`1.0.0`; al superadmin anche il commit, `1.0.0 (85952d0)`) e, in piccolo in fondo
  al menu laterale, «ArenaLive 1.0.0» (`data-testid="app-version"`, nascosto con il menu ridotto alle icone; il commit
  sta nel `title` solo per il superadmin). Viene dal `package.json` alla radice: Vite lo inserisce al build
  (`define` `__ARENALIVE_VERSION__`/`__ARENALIVE_COMMIT__` in `vite.config.ts`, `src/lib/version.ts`); il commit è `ARENALIVE_COMMIT` nei
  build Docker o git.
- **Pagina aperta prima di un aggiornamento**: ogni build ha un id (`__ARENALIVE_BUILD__`) scritto anche in `dist/version.json`
  (`{"build": "<id>"}`, servito da nginx senza cache). Se una risposta non rispetta lo schema del portale (`apiRequest`
  in `src/lib/api.ts`), il portale rilegge `/version.json` (`newBuildAvailable` in `src/lib/version.ts`): con un altro id
  mostra «Il portale è stato aggiornato: ricarica la pagina per usare la nuova versione.» (`OUTDATED_MESSAGE`), altrimenti
  «Risposta del server non valida.». Caso tipico: un documento con un campo nuovo (come `enabled` delle diapositive) letto
  con lo schema stretto della versione vecchia. In sviluppo l'id è vuoto e il controllo non si fa. Test:
  `lib/version.test.ts`, `lib/api.test.ts`; le risposte delle rotte dello Studio lette con gli schemi del portale sono
  provate in `apps/server/test/studioResponses.test.ts`.
- Rotta del server: `docs/server.md`, «Endpoint». Test: `GuidePage.test.tsx`, `AccountPage.test.tsx`, `AdminApp.test.tsx`.

### Link breve e QR (`src/qr/`, `pages/admin/ShareLinksPage.tsx`)
Ogni link attivo ha un link breve `<base>/l/<codice>` (codice di 8 lettere, mostrato `K7M2-QX9P`; server in
`docs/server.md`, «Link breve e codice»). Nella pagina «Link pubblici»: alla creazione, sotto il link lungo (mostrato
una sola volta), compare anche «Link breve (sempre disponibile nell’elenco, con il QR)»; in «Link creati» ogni link
**attivo** mostra «Link breve», il codice e l'anteprima del QR con i pulsanti «Copia link», «Scarica QR (PNG)» e
«Scarica QR (SVG)». Un link revocato o scaduto non li mostra. I link creati dal «Calendario» compaiono qui con la nota
«Partita del calendario (creato dal «Calendario»)»; il link di tutte le partite compare con «Canale del club: tutte le
partite del calendario» (`docs/server.md`, «Profilo del club, partite del cliente e canale»). Per un viewer la pagina è in sola lettura.

**Opzione «Link e QR per singola partita»** (per cliente, la accende solo il superadmin, vedi «Pagina Clienti» e
`docs/server.md`, «Clienti»; il portale la legge da `user.tenant.matchLinksEnabled` con `useMatchLinks`,
`lib/useMatchLinks.ts`). Se è **spenta** il cliente ha solo il canale del club: «Link pubblici» non offre «Una partita
fissa» e mostra «Link per singola partita non attivi: usa il canale del club.» (`MATCH_LINKS_OFF_TEXT`); il
«Calendario» non mostra link né QR delle partite e ha la stessa nota; il dettaglio partita non ha «Crea un link
pubblico». Il QR di «Prossima partita» del calendario pubblico porta al canale.

**QR e statistiche** (`qr/ShareQr.tsx`). L'indirizzo codificato nel QR è il link con `?q=1` (`QR_QUERY_PARAM`), così le
«Statistiche» distinguono le visite da QR; «Copia link» copia il link **senza** `?q=1`.

**Creazione** (`ShareLinksPage.tsx`, `fixedChoices`; con l'opzione «Link e QR per singola partita» accesa). «Una partita fissa» propone un menu «Partita» con, prima, ciò che è in
diretta («In diretta: …», una partita del calendario o un `.dvw` live fuori calendario) e poi le **prossime partite
trasmesse del calendario** (non nascoste né finite, per data; nessuna partita passata); una partita aperta da «Partite»
(`?partita=`) resta nell'elenco. Se non c'è nulla: «Nessuna partita in programma». I link delle partite del calendario si
creano da soli a ogni aggiornamento del calendario (`ensureFixtureLinks`, `docs/server.md`), quindi scegliendone una il
pulsante «Crea link» è sostituito da **«Questa partita ha già il suo link»** con link breve, «Copia link» e QR (se il link
è revocato: «Il link di questa partita è stato revocato: non se ne crea un altro (vedi «Calendario»).»). I link **revocati**
sono nascosti: il pulsante «Mostra revocati (N)» (poi «Nascondi revocati (N)») li mostra, con N il loro numero. Il link
della simulazione non è mai in questo elenco.

### Statistiche (`pages/admin/StatsPage.tsx`, `statsText.ts`, rotta `/admin/statistiche`, admin e viewer)
Mostra quante persone guardano la pagina pubblica del cliente. Menu: gruppo **«Statistiche»** con la voce
**«Visualizzazioni»** (`AdminSidebar.tsx`), visibile anche al viewer; la pagina iniziale resta «Partita live». Titolo
della scheda: «Statistiche · Area riservata». Dati: `docs/server.md`, «Statistiche delle visite».

Schede, dall'alto:
- **«Adesso»** («Spettatori collegati in questo momento (le simulazioni non sono contate)»): numero di «spettatori
  collegati», «Partita live: …» o «Nessuna partita live in questo momento.», elenco per link; riletta ogni 10 s.
- **«Periodo»**: pulsanti «7 giorni», «30 giorni» (predefinito), «90 giorni», «1 anno» e date «Dal» / «Al» a mano
  (giorni italiani; il dettaglio resta 90 giorni, poi solo i totali); date incoerenti: «Scegli un periodo valido: la
  data iniziale non può seguire la finale.»
- **«In sintesi»**: Visite, Da QR, Picco spettatori (con l'ora), Durata media, Tempo totale; pulsante **«Esporta CSV»**.
- **«Andamento per giornata»**: grafico di visite e picco per giorno.
- **«Partite»**: per partita visite, da QR, picco, ora del picco, durata media, tempo totale; il pulsante **«Curva
  spettatori»** (poi «Nascondi curva») apre il grafico minuto per minuto (`/api/admin/stats/matches/:matchId/curve`; vuoto:
  «Nessuna curva: nessuno spettatore campionato.»). Senza visite: «Nessuna visita nel periodo.»
- **«Link e QR»**: per link tipo («Canale del club», «Partita del calendario», «Partita fissa», «Link eliminato»), visite,
  da QR, durata media.
- **«Dispositivi e app»**: «Maxischermo», «Tablet», «Smartphone» e «App installata», con la percentuale.

**CSV** (`statsCsv`): separatore `;`, a capo `\r\n`, BOM iniziale (Excel legge gli accenti), file
`statistiche-<dal>-<al>.csv`; sezioni Totali, Dispositivi, Partite, Link, Giornate. Una cella di testo che inizia con `=`,
`+`, `-`, `@`, tabulazione o ritorno a capo riceve un `'` davanti (`csvCell`), così il foglio non esegue formule.

**Lato pagina pubblica** (`lib/visit.ts`, `LivePage.tsx`, `liveConnection.ts`): a ogni apertura del WebSocket la pagina
manda `hello` con id di visita (16 byte casuali, `newVisitId`), dispositivo (`tv`, `tablet`, `phone`: il desktop conta come
tablet), provenienza (`?q=1` = `qr`, altrimenti `link`) e se è un'app installata. L'id vive **solo in memoria** (un
ricaricamento è una nuova visita). **Nessun banner dei cookie**: la pagina non usa cookie né salva nulla sul dispositivo.

### Simulazione (`pages/admin/SimulationPage.tsx`, rotta `/admin/simulazione`, solo admin; il superadmin dentro un cliente)
Serve a provare il portale (TV, tablet, telefono) senza una partita vera né l'agente: il server gioca una partita riga
per riga, come farebbe l'agente (`docs/server.md`, «Simulazione di una partita»). Titolo della scheda del browser:
«Simulazione · Area riservata». Due colonne (una sola sul telefono).

- **«Nuova simulazione»** (sottotitolo «Il server gioca la partita come farebbe l'agente, riga per riga.»):
  - gruppo **«Partita»**, scelta tra due sorgenti: «Casuale» e «Importa file .dvw» (non ci sono partite di esempio già
    pronte). *Casuale*: «Set da giocare» («3 set», «4 set», «5 set»), la casella «Usa le squadre del club» (acceso di
    default; sotto, «squadra di casa – avversario» della prossima partita del calendario, se c'è) e «Seme (facoltativo)»
    («Stesso seme, stessa partita; vuoto: una partita a caso.»). *Importa file .dvw*: campo «File .dvw» («Un file di
    DataVolley, al massimo 2 MB. Le righe non riconosciute restano, come con l'agente.»);
  - gruppo **«Tempi»**, scelta tra «Durata» e «Velocità». «Durata»: «Durata di un set (s)» (da 10 a 3600, predefinito 120)
    e «Pausa tra i set (s)» (da 0 a 1800, predefinito 20). «Velocità»: «1×», «2×», «5×» (predefinita), «10×», con la nota
    «Sul ritmo reale delle righe (gli orari del file); senza orari, un ritmo medio realistico.» (calcolo in
    `docs/simulatore.md`);
  - pulsante **«Avvia»**. Errori di compilazione: «Scegli un file .dvw.», «File troppo grande: al massimo 2 MB.»,
    «Durata di un set tra 10 e 3600 secondi, pausa tra 0 e 1800.», «Il seme è un numero intero da 1 in su.», «Controlla la
    partita scelta.». Con una simulazione in corso o in pausa il modulo è bloccato e compare «Una simulazione alla volta:
    fermala per avviarne un'altra.».
- **«Avanzamento»** (sottotitolo «La partita simulata non entra nel canale del club, nel calendario, tra le partite né
  nella partita live.»; senza simulazione «Nessuna simulazione. Scegli la partita e i tempi, poi premi «Avvia».»): stato
  («In corso», «In pausa», «Fermata», «Finita»), origine della partita, squadre, riquadri «Set», «Punteggio», «Set vinti»,
  «Righe» (inviate / totali), barra «Righe inviate», «Trascorso m:ss · rimanente m:ss» con il ritmo scelto («Velocità N×
  sul ritmo reale» oppure «Set da N s, pausa tra i set di N s»), l'avviso del server (per esempio dopo un riavvio: «La
  simulazione si è interrotta con il riavvio del server: puoi ricominciarla da capo.») e, a simulazione ferma o in pausa,
  «Partita e link si cancellano da soli il … (6 ore dopo la fine o la pausa).». Mentre è «In corso» la pagina rilegge
  l'avanzamento ogni secondo (`SIMULATION_POLL_MS`).
- **Comandi**: «Pausa» (se in corso), «Riprendi» (se in pausa), «Ferma» (se in corso o in pausa), «Ricomincia» (se i tempi
  sono ancora noti: dopo un riavvio del server no) ed «Elimina» (con conferma «Elimina partita e link»: cancella partita e
  link subito).
- **«Link della simulazione»** (sottotitolo «Aprilo sulla TV, sul tablet o sul telefono.»): link breve `/l/<codice>` con
  QR (`ShareQr`). Mostra la simulazione con la grafica del cliente (pause, avvisi, diapositive, punti in sequenza). Il
  link resta lo stesso per le simulazioni successive del cliente e si cancella con la partita; non compare in «Link
  pubblici».
- **Etichetta sulla pagina pubblica**: sul link della simulazione, in basso a sinistra, sopra a tutto (pause e diapositive
  a tutto schermo comprese), su TV, tablet e telefono, compare l'etichetta **«Simulazione»** (`SimulationLabel` in
  `components/LiveMatch.tsx`, testo `SIMULATION_LABEL`, `data-testid="simulation-label"`), mostrata quando lo stato
  ricevuto ha `simulated: true` (`liveConnection.ts` lo conserva anche nelle patch). Le partite vere non la hanno.

Il viewer non vede la voce e `/admin/simulazione` lo riporta a `/admin/live`. Test: `SimulationPage.test.tsx`.

### Club e Calendario (`pages/admin/ClubPage.tsx`, `CalendarPage.tsx`)
Server, abbinamento e rotte in `docs/server.md`, «Club, calendario e abbinamento»; contratti in `docs/architettura.md`.

**«Club»** (`/admin/club`): a sinistra la scheda del **profilo** (`ProfileForm`, «Salva profilo»; contratto
`UpdateClubProfileRequest`): «Logo quadrato del club» (`LogoPicker`), «Nome», «Genere» (solo «Maschile»; «Femminile» è
disattivato, «presto disponibile») e «Serie» a tendina dal catalogo (SuperLega, Serie A2, Serie A3; `SeriesFields`):
scegliere la serie fa partire `POST /api/admin/club/league`, mostra «Sto scaricando il calendario…» (si rilegge ogni 3 s,
`SERIES_POLL_MS`) e poi «Calendario pronto: scegli la squadra del club in «Campionati».». Un club con la serie scritta a mano
vede «Ora: «…» (testo libero)». Se il cambio di stagione notturno non ha ritrovato la squadra compare «Nuova stagione: scegli
di nuovo la squadra.» con il pulsante «Scegli la squadra della nuova stagione» (server in `docs/server.md`, «Serie del club e
catalogo»). «Nostra squadra nei file .dvw»
(«Codice squadra» e/o «Nome della squadra contiene»), «Partite trasmesse» («Casa e trasferta» o «Solo partite in casa»,
con la copertura predefinita «Casa e trasferta») e «Loghi delle squadre» («Tutti», «Solo il mio», «Nessuno»; nell'interfaccia
«Solo il mio» = `ours`). Dopo il salvataggio: «Profilo salvato: le pagine pubbliche lo mostrano subito.». A destra la scheda
«Campionati»: per ogni campionato un menu «Campionato» (nome e stagione, con lo stato dell'ultimo aggiornamento: «Mai
scaricato», «Aggiornamento in corso…», «aggiornato …») e un menu «Squadra del club»; «Togli», «Aggiungi campionato» (al
massimo 8), «Salva» (attivo solo se c'è una modifica) e «Aggiorna calendario». Un admin sceglie solo tra i campionati già
noti («Nessun campionato disponibile. Chiedi al superadmin di aggiungere il campionato del club.»); aggiungerli spetta al
superadmin nella pagina «Campionati». Sotto «Nostra squadra nei file .dvw» ci sono i pulsanti «Apri «Colori e loghi»»
(verso `/admin/studio/colori`, solo per chi può modificare) e, per il superadmin, «Apri «Campionati»». Un viewer vede la
pagina in sola lettura.

**«Campionati»** (`pages/admin/LeaguesPage.tsx`, rotta `/admin/campionati`, solo superadmin, voce «Campionati» del gruppo «Amministrazione»): «Nuovo
campionato della Lega» (`IdCampionato` e «Stagione (primo anno)», «Aggiungi e scarica»; spostato qui dalla pagina «Club»),
poi l'elenco dei campionati con lo stato dell'ultimo aggiornamento (`leagueSyncText`), il prossimo aggiornamento automatico
(`leaguePlanText`, da `LeagueSummary.plan`: ogni notte alle 04:00 oppure ogni 10 minuti nei giorni di partita; «Aggiornamenti
automatici spenti sul server (LEAGUE_SYNC=off).») e «Aggiorna ora». Durante un aggiornamento l'elenco si rilegge ogni 3 s
(`LEAGUES_REFRESH_MS`).

**«Calendario»** (`/admin/calendario`): la scheda «Calendario» elenca le partite del club per data: giornata, data e ora
italiane (`formatFixtureDate`), squadre con logo (in grassetto la nostra), risultato in set, palazzetto, un'etichetta di stato
(«Programmata», «In diretta», «Finita», «Rinviata», «Da confermare», «Non più in calendario»), il file `.dvw` abbinato
(«abbinata da sola» o «abbinata a mano») con il pulsante «Scollega» (solo per chi può modificare; chiede conferma con
«Conferma: scollega il file»: chiama `PUT /api/admin/matches/:id/fixture` con `clientFixtureId: null`, il file passa a
«nessuna» e la partita torna «Programmata»; il server non lo riabbina più da solo, solo a mano da «Da confermare» o dal
dettaglio partita) e il link breve con codice, «Copia link» e «Scarica QR» (stesso QR dei link
pubblici); un link revocato mostra «Link revocato.». Sopra, la scheda «Da confermare» compare solo se ci sono `.dvw` di
cui il server non è sicuro: per ognuno un menu con i candidati («somiglianza N%»), «Nessuna (amichevole)» e «Altre partite
del calendario», e il pulsante «Conferma». Finché non è confermata, la partita ha comunque i suoi link. «Aggiorna
calendario» chiede al server di riscaricare i campionati del club (orari e risultati arrivano in pochi minuti: ricaricare).

Partite del cliente (`docs/server.md`, «Profilo del club, partite del cliente e canale»): «Aggiungi partita» apre il modulo
«Partita aggiunta a mano» (`ManualFixtureForm`: «Tipo di partita» Amichevole, Coppa o Altro, «Data», «Ora», «Avversario»,
«Logo dell’avversario (facoltativo)», «Dove si gioca» «In casa»/«In trasferta», «Palazzetto (facoltativo)», «Città
(facoltativa)»; «Aggiungi la partita» / «Salva la partita»). Dopo il salvataggio: «Partita aggiunta: il suo link e il QR sono
qui sotto.». Link, QR e il testo «il suo link e il QR sono qui sotto» compaiono solo con l'opzione «Link e QR per singola partita»
(altrimenti «Partita aggiunta.» e la nota «Link per singola partita non attivi: usa il canale del club.»).
Una partita aggiunta a mano ha link breve e QR come le altre, si abbina ai `.dvw` allo stesso modo, e ha
«Modifica» e «Cancella» (con «Conferma cancellazione»). Una partita scaricata dal calendario si può solo «Nascondere»
(«Mostra» la rimette; le nascoste stanno in una scheda a parte, `Partite nascoste`). «Impostazioni» di ogni partita:
«Trasmissione della partita» («Come il profilo», «Trasmessa», «Non trasmessa») e due `LogoPicker` («Logo della nostra
squadra» e «Logo di …»; predefiniti: logo quadrato del profilo per la nostra squadra, logo della Lega per gli avversari).
Una partita non trasmessa ha il link non attivo e il `.dvw` non le viene abbinato. Il viewer vede tutto in sola lettura.

**Data e ora di una partita scaricata**: «Cambia data e ora» (poi «Chiudi data e ora») apre il modulo «Data e ora della
partita» (`FixtureDateForm`: «Data (ora italiana)», «Ora (ora italiana)», «Salva data e ora»). Una partita cambiata a mano
mostra l'etichetta «Modificata a mano» e «data ufficiale:» con la data della Lega barrata; il pulsante «Torna alla data
ufficiale» rimette quella della Lega. Se la Lega sposta la partita dopo la modifica compare «La Lega ha spostato la partita
al …» con la nuova data ufficiale (la data scelta a mano resta finché non si torna all'ufficiale). Date e ore del calendario e
del modulo «Partita aggiunta a mano» sono sempre in ora di Roma (`romeDateTime` e `romeToIso` in `src/lib/format.ts`, che
gestiscono l'ora legale). Le partite a mano si cambiano con «Modifica». Rotta e regole in `docs/server.md`.

**Loghi nella pagina pubblica**: il messaggio di stato porta `logos` (casa e ospite); `Scoreboard` li mostra accanto ai nomi
(`TeamLogo`, prop `logos`) e «Prossima partita», classifica e calendario usano gli stessi
(ordine e regole in `docs/server.md`). **Manifest dell'app**: `index.html` punta a `/api/public/manifest.webmanifest`, con
nome, colori e logo quadrato del cliente (rotta del server, `docs/server.md`).

### Prossima partita (`components/NextMatch.tsx`)
È la pagina pubblica di un link del calendario prima che arrivi il `.dvw` (messaggio `scheduled`, `LiveMatch.tsx`): titolo
«Prossima partita», campionato e giornata, le due squadre con il logo (le iniziali `teamInitials` se manca o non si carica),
«VS», data e ora in ora italiana («ore HH:MM»; senza data «Data da definire»), palazzetto e città, un conto alla rovescia
(`countdownTo`: giorni, ore, minuti e secondi, solo per le partite programmate), le variabili colore del club e
dell'avversario (`teamColorVars`) e una nota: «La diretta comparirà qui da sola appena inizia la partita, senza ricaricare la
pagina.», oppure «Partita rinviata: data e ora da confermare.», «Partita giocata: S-S.» o «Partita non più presente nel
calendario ufficiale.». L'indicatore di connessione mostra «In attesa» (`ConnectionBadge`, `upcoming`). Il titolo della scheda
del browser è «Squadra – Squadra · Prossima partita · Marchio». In TV occupa tutto lo schermo. Il socket resta aperto: quando
il `.dvw` arriva (o l'admin lo conferma) la pagina diventa la partita senza ricaricare.

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
il cookie di sessione, senza passare dal codice della pagina), poi i passi: scompatta lo zip in `C:\ArenaLiveAgent` (non sulla
pennina); doppio clic su `arenalive-agent.exe` (non è firmato: «Ulteriori informazioni» e «Esegui comunque»); scrivi il nome
dell'agente e premi «Registra»; abilitalo in «Richieste in attesa» controllando il codice mostrato sul PC. Se l'exe non è
pubblicato: «L’agente non è ancora stato pubblicato sul server.» con il comando `scripts/costruisci-agente.sh` (agente Node; in produzione lo
pubblica `scripts/pubblica-agente-produzione.sh`, agente C#; `docs/infrastruttura.md`). Il resto della finestra dell'agente è in `docs/agente.md`.

**Richieste in attesa** (`PendingRegistrations` in `apps/web/src/pages/admin/AgentsPage.tsx`): i PC che si sono
auto-registrati come agenti (`docs/server.md`). Ogni richiesta mostra nome, «Codice di abbinamento» (6 caratteri, in
grande), IP di provenienza, ora della richiesta e scadenza. L'admin controlla che il codice sia quello mostrato sul PC con
DataVolley, sceglie la **validità** («Validità della registrazione»: «Senza scadenza» oppure «Fino al» con un giorno,
`ValidityChoice`; «Scegli il giorno di scadenza, oppure «Senza scadenza».» se manca) e preme «Abilita» (l'agente riceve il
token da solo entro pochi secondi e compare in «Agenti»; oltre il limite di agenti del cliente il server risponde 409 con
«Limite di agenti raggiunto…») oppure
«Rifiuta», senza conferma perché la richiesta si può rifare. Senza richieste: «Nessuna richiesta in attesa.». Elenco
richieste e agenti si aggiornano ogni 5 secondi (`AGENTS_REFRESH_MS`) e si fermano a scheda nascosta.

Un **viewer** (ruolo «sola lettura») nel menu vede «Partita live», «Partite», «Calendario», «Link pubblici», «Club» e
«Agenti» (in «Pagina pubblica» solo Link pubblici); «Studio grafico», «Simulazione» e «Utenti» sono solo per l'admin, «Clienti» e «Campionati» solo per il superadmin (gli indirizzi
non permessi lo riportano a `/admin/live`: `menuGroups` e `adminOnly`/`superadminOnly` in `AdminSidebar.tsx` e
`AdminApp.tsx`). Il server fa leggere club, calendario, agenti e link al viewer (`docs/server.md`, «Ruoli»); `useCanEdit`
(`lib/useCanEdit.ts`: vero per admin e superadmin) nasconde o disabilita i comandi che scrivono e mostra `READ_ONLY_TEXT`
(«Sola lettura: chiedi a un amministratore del cliente per le modifiche.»). Il ruolo è mostrato accanto all'email («superadmin», «lettura e scrittura» o «sola lettura», `ROLE_TEXT` in `AdminApp.tsx`); la vera
protezione è sempre nel server (`docs/server.md`).

### Utenti del cliente
Pagina `UsersPage.tsx` (solo admin; il superadmin dentro un cliente, dopo «Entra nel cliente» della pagina «Clienti»). Scheda «Ruoli»: «Lettura e scrittura» (`admin`: gestisce tutto il cliente) e «Sola lettura» (`viewer`: vede
senza cambiare nulla); il cliente deve avere sempre almeno un utente attivo «Lettura e scrittura» (un utente invitato che non ha ancora scelto la password non conta). Ogni utente mostra
«Attivo», «Disattivato», «Invito in attesa» o «Invito scaduto» e ha i comandi «Cambia ruolo» (con «Salva ruolo»), «Reimposta password» (per sé «Cambia
password»; con «Salva password»), «Disattiva» (conferma «Conferma disattivazione») o «Riattiva», «Elimina» (conferma
«Conferma eliminazione»). Per il proprio utente (segnato «(tu)») resta solo «Cambia password». Messaggi dopo l'azione
come «Utente … creato.», «… disattivato.», «… riattivato.», «… eliminato.». Il server rifiuta (409) che un utente si tolga
il ruolo, si disattivi o si elimini, e le modifiche che lasciano il cliente senza un admin attivo; cambio di ruolo,
nuova password e disattivazione chiudono le sessioni dell'utente (chi cambia la propria password resta collegato). Regole e rotte: `docs/server.md`, «Utenti del cliente». Pagina «Clienti»: `TenantsPage.tsx`
(`userCountText`, `useChooseTenant`). **Pagina Clienti, link per partita**: nell'elenco ogni cliente mostra «link per
partita» o «solo canale» (`matchLinksText`); nella scheda del cliente il riquadro «Link e QR per singola partita»
(`MatchLinksSwitch`) dice «attivi» / «non attivi» e ha «Attiva» oppure «Disattiva» con conferma «Disattiva e revoca i link
per partita» (revoca per sempre, anche i QR stampati; riattivando nascono link nuovi, i revocati restano tali). Effetti:
`docs/server.md`, «Clienti».

**Inviti.** Nel modulo «Nuovo utente» la password è facoltativa (`NEW_PASSWORD_HINT`): lasciata vuota il pulsante diventa
«Crea e invita» e l'utente riceve una mail con il link per scegliere la password; se scritta, vale come prima («Crea
utente»). Dopo la creazione `InviteDeliveryBox` (`InviteDelivery.tsx`) dice «Invito inviato a …», oppure, se la mail non
parte, «La posta non è configurata: copia il link e mandalo all'utente a mano.» / «La mail non è partita (il server di
posta non l'ha accettata): copia il link e mandalo all'utente a mano.», con il link e «Copia link» (`LinkToCopy`) e la
scadenza («Il link vale fino al …» e si usa una volta sola); il link è mostrato solo in quel momento. Una riga con invito
aperto ha: «Invia di nuovo» (non se l'utente è disattivato; il vecchio link smette di valere) e «Annulla invito»
(conferma «Conferma annullamento»), che **elimina l'utente** perché non ha mai scelto una password. Finché l'invito è
aperto l'utente non può accedere. Un utente che ha già la password (e non è il proprio) ha «Link per nuova password»:
mostra un link di un'ora, monouso, da mandare a mano, con «Copia link» (utile senza posta o se la mail non arriva). Il
primo utente di un cliente si invita già dalla pagina «Clienti» (campo password lasciato vuoto).

### Loghi di sistema (`pages/admin/SystemLogosPage.tsx`, `components/SystemLogo.tsx`, `components/SystemLogosBar.tsx`, `pages/admin/AdminBrand.tsx`, `lib/backgroundTone.ts`, `lib/systemLogos.ts`)
Solo il superadmin, fuori da un cliente (`/admin/loghi-di-sistema`, voce «Loghi di sistema» di «Amministrazione»). Quattro
loghi della piattaforma, uguali per tutti i clienti: lato sinistro e destro, ciascuno in due varianti, **positivo**
(per sfondi chiari) e **negativo** (per sfondi scuri). In alto la scheda con l'anteprima della testata in due riquadri,
«Tema chiaro» e «Tema scuro» (superfici con i token chiari/scuri propri, indipendenti dal tema della pagina), oppure
«Nessun logo: le testate restano come sono.» se non ce n'è nessuno. Poi una scheda per lato («Logo a sinistra», «Logo a
destra»), con una griglia 2×2 in tutto: per ogni variante «Positivo · per sfondi chiari» / «Negativo · per sfondi
scuri», l'anteprima (o «Nessun logo») su sfondo chiaro o scuro, le misure in px, «Carica logo» / «Sostituisci logo» (PNG,
JPEG, WebP o SVG, al massimo 2 MB e 150×50 px: uno più grande è rifiutato con il messaggio del server) e «Rimuovi» con
«Conferma rimozione». Rotte e limiti: `docs/server.md` («Loghi di sistema»).

- **Scelta della variante**: automatica, dallo sfondo reale dietro al logo. `useBackgroundBehind` (`lib/backgroundTone.ts`)
  legge `background-color` calcolato dal browser sull'elemento e sui suoi antenati fino al primo opaco, fonde le
  semitrasparenze (`blendLayers`) e si ricalcola al montaggio, quando cambiano gli attributi `style`/`class`/`data-theme`/
  `data-template` di `<html>` e `<body>` (palette del cliente, modello grafico, tema), sugli eventi del tema e a fine
  transizione di `background-color`. Conta solo il colore di fondo, non le sfumature (`background-image`). Poi
  `pickSystemLogo` (`packages/shared`): luminanza < 0,5 → negativo, altrimenti positivo; se la variante voluta manca usa
  l'altra; se lo sfondo non si legge usa il positivo.
- **`SystemLogo`**: un lato (`pair`, `side`); immagine con `object-contain`, `alt` vuoto (decorativa), box al massimo
  `min(150px, 25vw)` × `min(50px, 8.33vw)` in riga (niente scorrimento orizzontale su un telefono da 360 px) oppure 150×50
  px pieni (`SYSTEM_LOGO_FULL_SIZE`). Non disegna nulla se il lato non ha loghi.
- **`SystemLogosBar`**: riga con il lato sinistro e il destro (solo pagina live e anteprima della pagina). Senza loghi non
  disegna nulla; con un solo lato l'altro resta vuoto. Con almeno un logo di sistema la pagina live non mostra più
  `BrandMark` né nell'intestazione né nel tabellone: il marchio sta solo nella barra (restano i pulsanti).
- **`AdminBrand`**: marchio dell'area riservata. Se c'è il logo di sinistra (una variante qualsiasi) lo mostra, con
  precedenza su logo del modello, logo o nome del cliente e scritta; altrimenti `BrandMark`. Con `to` è un link «Partita
  live» alla prima pagina dell'utente, senza `to` è solo decorativo.
- **Dove compare**: nella pagina live (`LivePage.tsx`) come riga sopra la testata, con entrambi i lati, su TV, tablet e
  telefono, **sempre** (anche a partita non ancora caricata); in cima alla barra laterale (`AdminSidebar.tsx`) e
  nell'intestazione mobile (`AdminApp.tsx`) dell'area riservata, che non ha più la riga dei loghi; nella pagina di
  accesso (`LoginPage.tsx`) e nelle pagine dei link account (`AccountLinkPages.tsx`: «Password dimenticata», invito,
  reimposta password), senza link.
- **Dati**: lo store `lib/systemLogos.ts` (`initSystemLogos`, `useSystemLogos`, `setSystemLogos`) legge `GET
  /api/public/system-logos` una volta all'avvio (`main.tsx`); la pagina lo aggiorna dopo ogni modifica.

#### Marchio ArenaLive (`components/ProductLogo.tsx`, `public/brand/`)
- **Loghi**: `public/brand/arenalive-positivo.png` (testo scuro, per sfondi chiari) e `arenalive-negativo.png` (testo
  bianco, per sfondi scuri), descritti in `PRODUCT_LOGO` (150×35 e 150×36 px). `ProductLogo` li mostra con `VariantLogo`
  (`components/SystemLogo.tsx`), che sceglie la variante dallo sfondo reale come per i loghi di sistema (sopra); alt
  «ArenaLive», attributo `data-product-logo`.
- **Dove compare**: `BrandMark` quando il cliente non ha né logo orizzontale né nome proprio (testate di pagina pubblica,
  area riservata e login) e la pagina principale (`HomeScreen`) quando non c'è il logo di sistema sinistro, che altrimenti
  ha la precedenza. Il modello `sir-volley` usa invece sempre il logo negativo (`navbarLogo`).
- **Icone** (`apps/web/scripts/brand-icons.ts`): dal simbolo verde del logo positivo genera `public/icons/favicon-32.png`,
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (collegate da `index.html` e usate come
  `DEFAULT_MANIFEST_ICONS`) e `arenalive-agent.ico` a 7 misure (16, 24, 32, 48, 64, 128, 256 px) per l'agente C#; copia poi
  i due loghi e l'icona negli agenti (`apps/agent-dotnet/src/ArenaLive.Agent.App/`, `apps/agent/src/gui/brand/`,
  `docs/agente.md`). Si rigenerano con `pnpm --filter @arenalive/web exec tsx scripts/brand-icons.ts`; `favicon.svg` non c'è più.

### Posta (`MailSettingsPage.tsx`)
Solo il superadmin, fuori da un cliente (`/admin/posta`, voce «Posta» di «Amministrazione»). Scheda «Posta»: «Il server
che spedisce le mail di invito e di recupero password, uguale per tutti i clienti.» Campi: «Server SMTP», «Porta»,
«Sicurezza» («Nessuna (porta 25, solo reti fidate)», «STARTTLS (di solito porta 587)», «TLS (di solito porta 465)»; la
porta usuale segue la scelta se non è stata scritta a mano), «Utente» (vuoto se il server non chiede l'accesso),
«Password», «Nome del mittente», «Indirizzo del mittente». La password salvata non si rilegge: il campo dice «Password
salvata (non si può rileggere)…» e c'è «Cancella la password salvata»; lasciato vuoto il campo tiene quella salvata.
Pulsanti «Salva» («Impostazioni salvate.») e «Invia una mail di prova», che spedisce al proprio indirizzo con le
impostazioni **già salvate** e mostra l'esito. Avvisi: «La posta non è configurata: gli inviti non partono e
l'amministratore del cliente copia il link per mandarlo a mano.» e, se manca `SETTINGS_ENCRYPTION_KEY` sul server,
«Manca la chiave SETTINGS_ENCRYPTION_KEY nel file .env del server…» (il campo password resta disattivato). Rotte e
cifratura: `docs/server.md`, «Posta, inviti e recupero password».

### Recupero password e inviti (`AccountLinkPages.tsx`)
Pagine pubbliche (senza sessione, in Inter, stile del login), raggiunte dal login e dai link nelle mail:
- `/admin/password-dimenticata` (`ForgotPasswordPage`): «Password dimenticata», campo «Email», «Invia il link»; la
  risposta è sempre «Controlla la posta» con «Se l'indirizzo è registrato, ti abbiamo mandato una mail…» (il link vale
  un'ora, una sola volta), perché non si capisca se l'email esiste; «Torna all'accesso» riporta al login;
- `/admin/invito/:token` (`SetPasswordPage kind="invite"`): «Scegli la password» («Sei stato invitato su …», «Account: …»),
  «Password» (almeno 12 caratteri) e «Ripeti la password», «Salva e accedi»: l'utente entra già collegato in `/admin`;
- `/admin/reimposta-password/:token` (`SetPasswordPage kind="reset"`): «Nuova password», «Salva la password», poi
  «Password cambiata» (le sessioni sugli altri dispositivi sono chiuse) e il ritorno al login;
- link non valido, scaduto o già usato (410): «Link non valido», con il rimando all'amministratore (invito) o a
  «Password dimenticata?» (recupero). Se il server non risponde: «Link non verificato» con «Riprova».
Rotte: `docs/server.md`, «Posta, inviti e recupero password».

### App installabile e schermo intero (`lib/pwa.ts`, `components/AppInstall.tsx`)
La pagina pubblica si può installare come app (PWA) e chiede lo schermo intero al primo tocco. Tutto è facoltativo: dove
il browser non ha l'API non succede nulla.

- **Manifest** (`GET /api/public/manifest.webmanifest`, `webManifest` di `packages/shared/src/manifest.ts`; `index.html` lo
  collega): `display` `fullscreen` con `display_override` `fullscreen` e `standalone`, `scope` `/`; nome, colori e icona
  sono quelli del cliente dell'hostname (logo quadrato per primo), seguito dalle icone generiche di `public/icons/`
  (`DEFAULT_MANIFEST_ICONS`, le sole quando manca il logo); senza cliente il nome è «ArenaLive». Il vecchio `public/manifest.webmanifest` statico è ancora nel
  repository ma non è più collegato. Non c'è `start_url`, così Chrome riapre il link da
  cui si installa. `index.html` ha il manifest, `apple-touch-icon` e i meta.
- **Service worker** (`public/sw.js`, registrato da `registerServiceWorker`): minimo, solo perché il browser consideri la
  pagina installabile. **Nessuna cache e nessuna intercettazione delle richieste**: pagine, dati e WebSocket passano sempre
  dalla rete. Se un giorno si aggiunge una cache vanno esclusi `/admin`, `/api` e `/ws`. La CSP è cambiata solo in
  `worker-src 'none'` → `worker-src 'self'` (`docker/web.security-headers.conf`).
- **«Installa come app»** (`InstallButton`, `useInstallApp`): compare quando il browser offre l'installazione
  (`beforeinstallprompt`) e non sulla TV; su iPhone e iPad (senza richiesta) mostra le istruzioni «Per installare l’app tocca
  Condividi, poi «Aggiungi a Home».» con «Chiudi». Non compare già installata o a schermo intero.
- **«Tocca per lo schermo intero»** (`FullscreenHint`, `useFullscreenOnFirstTouch`): suggerimento discreto per 8 secondi
  (`FULLSCREEN_HINT_SECONDS`); il primo tocco o tasto sulla pagina (non su pulsanti, link o campi; non Maiusc, Ctrl, Alt,
  Tab, Esc…) chiede lo schermo intero. Il suggerimento non intercetta i clic. Il pulsante «Schermo intero» resta.
- **Kiosk per le TV**: il browser non permette lo schermo intero automatico senza un gesto, quindi per una TV fissa si
  avvia il browser in modalità kiosk (script in «Come si usa / si prova»).

### Connessione WebSocket (`src/lib/liveConnection.ts`, `useLiveSocket.ts`)
- `LiveConnection` tiene aperto il socket e, a ogni (ri)connessione, il server rimanda lo stato intero.
- **Patch**: dopo lo stato intero arrivano messaggi `patch`. `applyPatchMessage` li applica con `applyPatch`
  (`@arenalive/shared`) solo se la `baseVersion` è la versione a video; se non combacia, la partita è un'altra o il patch non
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
- **Modifiche della grafica in diretta** (`createBrandingRefresh`, `lib/branding.ts`; collegato in `useLiveSocket.ts`): il
  messaggio `config` (senza dati) non tocca lo stato della partita, che continua senza interruzioni. `changed()` rilegge
  la grafica (`initBranding({ fresh: true })`) dopo un ritardo casuale di 0–3 s (`CONFIG_REFRESH_SPREAD_MS`), per non far
  chiedere la grafica a tutti gli spettatori nello stesso istante; una sola lettura alla volta, i segnali arrivati
  durante una lettura ne fanno una sola in più. Come rete di sicurezza `resume()` rilegge anche dopo una riconnessione e
  al ritorno della scheda in primo piano (`visibilitychange`), al massimo una volta al minuto
  (`CONFIG_REFRESH_MIN_INTERVAL_MS`).
- **Studio**: al cambio di «Modello grafico» compare il dialogo «Applicare anche la disposizione dei blocchi del modello?»
  («Sì, applica i blocchi del modello» / «No, tieni i blocchi attuali»); la scelta riguarda solo i blocchi della «Pagina
  live» (poi va salvata). La didascalia dell'anteprima (`StudioPreview.tsx`) dice «Partita live» con una partita in corso,
  altrimenti «Partita d’esempio».

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
grafico (vedi «Modelli grafici») può forzare il tema: con «Chiaro e pulito» è sempre chiaro, con «Scuro sportivo», «Alto
contrasto per TV» e SIR VOLLEY sempre scuro (`lib/theme.ts`: `forcedTheme`, `useForcedTheme`) e il pulsante del tema non
compare.

### Modelli grafici (template)
Il cliente sceglie il **modello grafico** nella procedura guidata (passo «I colori») e nella sezione «Colori e loghi»
dello Studio («Modello grafico», in «Avanzate»); l'elenco è chiuso in `@arenalive/shared` (`TEMPLATES`, `docs/architettura.md`).
I modelli offerti a **tutti** i clienti sono quattro, con questi testi (`TemplatePicker`, `ColorsSection.tsx`):
- «Standard»: aspetto predefinito del portale, tema chiaro o scuro a scelta;
- «Chiaro e pulito»: sempre chiaro, bianco e verde acqua, schede piatte e sobrie, leggibile anche in sala stampa;
- «Scuro sportivo»: sempre scuro, grafite con verde e arancio acceso, l'atmosfera di una partita serale;
- «Alto contrasto per TV»: sempre scuro, nero con giallo e azzurro, si legge da lontano su un maxischermo.

**SIR VOLLEY non è più un modello pubblico**: è un *tema personalizzato* (`custom: true`, documento JSON
`packages/shared/src/themes/sir-volley.json`). `TemplatePicker` lo mostra (`templateChoices`) solo al superadmin e al
cliente che lo ha già, che così può restare su di esso; nella procedura guidata (`SELECTABLE_TEMPLATE_IDS`) non compare. Il
superadmin lo assegna a un cliente nello Studio: «Entra nel cliente», poi «Colori e loghi» e «Modello grafico». Il server
rifiuta (403) il cambio a un tema personalizzato a chi non è superadmin (`docs/server.md`). I colori scelti dal cliente
valgono sopra quelli del modello. Specifiche e originali dei loghi: `docs/grafica/` (non si modificano). Dove sotto si
parla di «SIR VOLLEY» si intende questo tema personalizzato.

#### Come aggiungere un tema personalizzato per un cliente
1. Crea `packages/shared/src/themes/<id>.json` (id minuscolo con trattini, 2-32 caratteri) copiando `sir-volley.json`:
   documento di `TemplateDefinitionSchema` con `"custom": true`, colori, superfici scure, immagini e sezione `css`
   (`vars`, `media`, `tvVars`, `rules`; `docs/architettura.md`). Eventuali immagini vanno in `apps/web/public/templates/<id>/`.
2. In `packages/shared/src/templates.ts` importa il JSON, aggiungi `'<id>'` a `TEMPLATE_IDS` e la voce
   `'<id>': customTheme('<id>', <json>)` in `TEMPLATES` (lancia un errore se l'`id` del file è diverso).
3. Rigenera il CSS: `pnpm --filter @arenalive/web themes` e versiona `apps/web/src/styles/themes.generated.css`.
4. Prova con `pnpm --filter @arenalive/shared test` e `pnpm --filter @arenalive/web test` (i test controllano schema, CSS aggiornato e
   che il tema non sia tra i modelli pubblici), poi `scripts/ci_locale.sh`.
5. Il superadmin entra nel cliente e sceglie il tema in «Colori e loghi» > «Modello grafico»; il cliente non lo può cambiare
   da solo, ma lo mantiene.
6. In produzione basta pubblicare la versione nuova (nessuna migrazione: il modello è salvato come `id` nella grafica del
   cliente). Lo stesso tema si può assegnare ad altri clienti senza altri file.

### Pagina non caricata e ricarica dopo un aggiornamento
`components/ErrorBoundary.tsx` avvolge l'applicazione (`main.tsx`) e l'area riservata (`AdminApp.tsx`, con `resetKey` =
cliente e percorso, così un errore di una pagina non resta sulle altre). Se la pagina fallisce mostra «La pagina non si è
caricata. Se hai lasciato il portale aperto a lungo, è stato aggiornato: ricarica la pagina.» con il pulsante di ricarica
(`ErrorBox`). Se un file del portale non esiste più perché è uscita una versione nuova, `reloadOnceForMissingFile` ricarica
la pagina **una sola volta** per sessione (chiave `sessionStorage` `sir-ricaricata-per-file`): un guasto vero non va in
ciclo e mostra l'avviso.

- **Come si applica** (`lib/branding.ts`): `applyTemplate` scrive `data-template` su `<html>` (nessun attributo per lo
  standard) e imposta il tema forzato; `initTemplate` lo fa all'avvio leggendo la voce `localStorage` `sir-template`, così
  la pagina non mostra per un attimo l'aspetto standard; appena arriva `GET /api/public/tenant` il modello vero la
  riallinea. `useTemplate` dà la definizione del modello ai componenti. I token del modello stanno in `tokens.css` nel
  blocco `[data-template='sir-volley']` (palette e misure delle specifiche); l'anteprima dello Studio lo usa con
  `data-sir-scope`.
- **Font**: Google Sans Code self-hosted, `src/styles/fonts.css` (importato da `index.css`) con i file in
  `src/styles/fonts/google-sans-code/` (woff2 `latin` e `latin-ext`, variabile 400-700, `font-display: swap`, licenza
  `OFL.txt`). La CSP è invariata (`font-src 'self'`). Resta il font della pagina pubblica SIR VOLLEY.
- **Inter** (`src/styles/fonts.css`, file in `src/styles/fonts/inter/`: `inter-latin.woff2` e `inter-latin-ext.woff2`,
  variabile 400-700 da Google Fonts, licenza `OFL.txt` accanto e copia in `public/assets/inter-OFL.txt`): font di tutta
  l'area riservata, login compreso, qualunque sia il modello del cliente (`.sir-admin-font`, `styles/index.css`). Anche la
  pagina pubblica del modello standard, che in `tokens.css` nominava già Inter, ora lo scarica davvero.
- **Colori**: la palette si calcola con `brandPalette(colori, modello)`. Il rosso `#E30613` su `#151518` ha solo 3,7:1: il
  testo piccolo usa la variante `-ink` (`#eb515a`), il rosso pieno resta per sfondi, pulsanti e testo grande.
- **Logo**: il modello usa il **logo ArenaLive negativo** (`/brand/arenalive-negativo.png`, `navbarLogo` di
  `packages/shared/src/themes/sir-volley.json`, scuro quindi sempre il negativo), nella testata via `BrandMark`. Le vecchie
  immagini «sir real time» (cartella `public/templates/sir-volley/` e gli originali del logo in `docs/grafica/`) sono state rimosse.
  Non c'è più nessun piè di pagina «Powered by Istante®» (tolto su richiesta di Luca: `TemplateFooter` e
  `powered-by-istante.png` non esistono più). `apps/web/scripts/trim-logo.ts` (solo `node:zlib`, PNG RGBA 8 bit) ritaglia
  un logo (`<input> <output> [larghezza=1200] [margine=0] [all|top|bottom]`) ed è usato anche da `brand-icons.ts`.
- **Nostra squadra** (`lib/branding.ts` `useOurTeamColors`, `lib/teamColors.ts` `teamColorVars`): con il codice e/o il testo
  nel nome scelti in «Colori e loghi» (scheda «Squadra»; `ourTeamSide`, `docs/architettura.md`) i colori «casa» e «ospite» del portale sono puntati
  sulla **nostra** squadra (colore di casa nello standard, colore di risalto in SIR VOLLEY) e sull'avversaria (colore ospite)
  anche quando giochiamo in trasferta; vale per punteggio, grafici, mappe, tabelle, avvisi e pause. Senza corrispondenza
  (o con due) restano i colori casa/ospite del file.
- **Mappe di campo** (`CourtMap`): con SIR VOLLEY le frecce hanno il colore della squadra che attacca, spessore 1,5 px e
  opacità 85%; nello standard restano colorate per valutazione.
  Sulla TV il campo si adatta all'altezza che resta nella card dopo filtri e legenda (prop `fit`, proporzioni
  mantenute): mai una barra di scorrimento dentro la card.
  Nello Studio grafico («Pagina», opzioni del blocco «Mappe di campo», `CourtOptionsFields.tsx`) si scelgono, per la
  nostra squadra e per l'avversario: colore del fondo di ciascuna metà, colore delle linee (perimetro, 3 metri; la rete
  segue la nostra metà), colore delle traiettorie; più lo spessore delle linee e delle traiettorie (da 0,5× a 3×).
  Un colore non scelto è «Automatico» e segue il tema chiaro/scuro (e il modello per le traiettorie); senza opzioni la
  mappa è identica a prima. Un colore scelto per le traiettorie vale per ogni valutazione (stile a linea sottile).
  «Colore del campo»: «Automatico» (le due metà come sopra), «Colore singolo» (`fieldMode: single`, `fieldColor` per
  entrambe le metà) o «Tricolore» (`fieldMode: tricolor`, `tricolor` con tre colori; predefiniti `COURT_TRICOLOR_DEFAULT`
  verde #009246, bianco #ffffff, rosso #ce2b37): il campo intero in tre fasce di due colonne di zone (30 unità ciascuna), la
  centrale a cavallo della rete. In questi due modi le linee, la griglia e i numeri delle zone ancora «Automatici» usano un
  inchiostro scuro (#1f2937) o chiaro (#f9fafb) scelto in base alla luminosità del fondo, così restano leggibili anche sul
  bianco; heatmap, linee e frecce restano sopra il fondo. I layout salvati senza `fieldMode` non cambiano.
  Schema `CourtOptionsSchema` in `packages/shared/src/layout.ts`; «nostra» è `currentOurSide()` (casa se non nota).
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
  «Ripristina predefinito» in «Pagina live»); l'anteprima tablet dell'editor è a 1024 px.

### Grafica per cliente
Ogni cliente ha i suoi colori e i suoi loghi, scelti nella sezione «Colori e loghi» dello «Studio grafico» e mostrati sull'hostname del cliente (API e
controlli in `docs/server.md`, «Grafica per cliente»).

- **Caricamento all'avvio** (`src/lib/branding.ts`, `initBranding` chiamata in `main.tsx`): `GET /api/public/tenant`
  (`PublicTenantResponseSchema`). Se la richiesta fallisce, o la risposta non è valida, restano i predefiniti di
  `tokens.css`: la pagina funziona lo stesso.
- **Colori come variabili CSS**: `brandPalette` (`@arenalive/shared`, `colors.ts`) calcola dai cinque colori le variabili,
  anche le varianti per il tema scuro (colori schiariti e sfondo scurito fino al contrasto minimo 4,5:1 del WCAG,
  `ensureContrast`; il testo sui colori pieni è bianco o nero, `textColorOn`). `writePalette` le scrive su `:root` con il
  CSSOM (`style.setProperty`), consentito dalla CSP senza `unsafe-inline`, e segue il cambio tema chiaro/scuro. Valgono
  sopra `tokens.css`, che resta la fonte dei predefiniti: componenti e tema ECharts leggono le variabili, e i grafici si
  ridisegnano al cambio (`useBrandingRevision`). Nuovi token `--sir-primary` e `--sir-accent`; sopra le testate c'è una
  barra di risalto nel colore d'accento (predefinito `#c2410c`).
- **Nome e loghi**: il titolo della pagina pubblica usa il nome del cliente (`useBrandName`: «… · Diretta»); `BrandMark` (`src/components/BrandMark.tsx`, nelle
  testate di pagina pubblica, area riservata e login) mostra il logo orizzontale in un `<img>` (SVG compresi, mai
  markup in linea), altrimenti il nome, altrimenti il **logo ArenaLive** (`ProductLogo`). Il cliente predefinito senza nome
  visualizzato è mostrato come «ArenaLive» (con il suo logo). Il favicon è `public/icons/favicon-32.png` (non più
  `favicon.svg`, rimosso; vedi «Marchio ArenaLive»). La CSP resta quella di prima
  (`img-src 'self' data:`, le immagini sono servite dalla stessa origine).
- **Editor**: sezione «Colori e loghi» dello «Studio grafico» (`studio/ColorsSection.tsx`; opzioni, testi e avvisi di
  contrasto descritti lì). Lo Studio mostra la bozza nell'anteprima (che ha un proprio ambito di colori), senza cambiare
  la grafica dell'area riservata finché non si salva.
- **Limiti noti**: la testata dell'area riservata del superadmin ha la grafica del cliente dell'hostname, non quella del
  cliente attivo; un'immagine SVG non ammessa è rifiutata con un messaggio, non convertita.

### Pagina pubblica a blocchi (sezione «Pagina live» dello Studio)

- **Touch** (`touch.tv`, `touch.tablet`, `touch.phone` in `TenantLayoutSchema`, predefinito `true`; i documenti salvati senza
  il campo restano validi; si salva con lo stesso `PUT /api/admin/layout`). Nello Studio, in «Pagina live», ogni scheda
  dispositivo ha l'interruttore «Touch: Sì/No» (`PageSection.tsx`). Con «No», `TouchContext`/`useTouch()`
  (`lib/useLayout.ts`), fornito da `LivePage` e da `MatchView` (anche per l'anteprima dello Studio), nasconde tutto ciò che si
  tocca: i selettori `Segmented` (squadra, set, fondamentale, valutazione), «Giocatore» e «Altri filtri» della mappa di campo,
  «Tutte le colonne», le intestazioni ordinabili e la selezione delle righe della tabella giocatori, i titoli comprimibili
  delle card sul telefono (restano tutte aperte), i pulsanti ferma/riprendi rotazione, installazione, schermo intero e tema,
  i pulsanti delle pause (pausa/riprendi, chiudi), il link dello sponsor e quello dello short URL del calendario (restano
  contenuto senza `<a>`). I grafici restano sulla vista predefinita; la rotazione automatica della TV continua. Test:
  `components/touch.test.tsx`.
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
  giocatori, Mappe di campo, Rotazioni (i sei di prima), più (la tabella dà anche le opzioni di Rotazioni):

| Blocco | Opzioni | Comportamento |
|---|---|---|
| Logo | Orizzontale / Quadrato | logo del cliente in un `<img>`; senza logo, il nome |
| Rotazioni | «Disposizione»: «Affiancati» (predefinita) / «Uno sopra l'altro» (opzione `orientation`: `horizontal` / `vertical`; i layout salvati senza il campo restano validi) | i due grafici affiancati se la card è larga, oppure sempre uno sopra l'altro; in verticale i due grafici si dividono tutta l'altezza della card (tablet/desktop almeno 11 rem ciascuno, TV almeno 6 rem); sul telefono non cambia |
| Sponsor | gli sponsor scelti (al massimo 12; opzione `sponsors`), «Immagini singole» (opzione `images`, fino a 12, solo quelle già nei documenti salvati prima: si possono togliere, non aggiungere), «Secondi per immagine» (3-60, predefinito 8) | immagini a rotazione con dissolvenza breve (nessuna con `prefers-reduced-motion`): prima tutte le immagini degli sponsor nell'ordine della lista «Sponsor», poi le immagini singole (`sponsorItems` in `lib/sponsors.ts`); l'immagine di uno sponsor con sito è un link in una nuova scheda (`target="_blank"`, `rel="noopener noreferrer"`, `SponsorImage` in `BrandBlocks.tsx`); si ferma con «Ferma rotazione» della TV; senza immagini: «Nessuna immagine sponsor scelta.» (in una diapositiva si usa il logo sponsor della grafica, `sponsorLogo`) |
| Messaggio | testo (al massimo 280 caratteri, una riga), «Dimensione» Normale / Grande | sempre testo semplice, mai HTML |
| Codice QR | testo sopra il codice (al massimo 80 caratteri, predefinito «Segui la partita sul telefono») | QR del link della pagina aperta (origine + percorso, senza query come `?tv=1`); il codice breve sotto compare solo se la pagina è aperta con `/l/<codice>` |
| Ultimo punto | - | squadra, punteggio e come è stato vinto (`LastPointBlock`) |
| Parziali dei set | - | punteggio di ogni set (`SetScoresBlock`) |
| Migliori giocatori | «Quanti» (1-10), «Squadra» Entrambe / Casa / Ospiti | classifica a punti di `topPlayers` (`docs/statistiche.md`); tabella Giocatore, Att, Muro, Ace, Punti |
| Parziale e marcatori, Ace, Muri, Attacco, Sfida per ruolo, Squadre a confronto | periodo («Il set in corso» / «Tutta la partita»), «Marcatori per squadra» (3-8) o «Attaccanti per squadra» (1-5), «Ruolo» (predefinito «Tutti i ruoli, a rotazione»), «Righe del confronto» (nessuna scelta = tutte) | viste in stile TV dei calcoli di `period.ts` (`docs/statistiche.md`), le stesse delle diapositive delle pause; senza dati un messaggio (per esempio «Nessun dato della partita.») |
| Prossima partita | «Mostra il codice QR del link della partita» (predefinito sì) | la prossima partita del club, vedi «Blocchi del calendario» |
| Classifica | «Righe»: «Intorno alla nostra squadra (±2 posizioni)» (predefinito), «Le prime righe» (con «Quante righe», 3-16, predefinito 5), «Tutta la classifica» | la classifica del campionato del club, vedi «Blocchi del calendario» |

Le sei viste statistiche (`blocks/StatSlides.tsx`) hanno tre misure: `full` (tutto schermo, per le diapositive a tutto schermo),
`card` (riquadro dentro la pagina, per i blocchi) e `compact` (una riga per la banda). Casa sempre a sinistra, colori secondo
«nostra squadra»; barre e nomi entrano con un'animazione di 500 ms (`sir-enter-left`, `sir-enter-right`, `sir-grow`),
spenta con `prefers-reduced-motion`. I testi (nomi dei giocatori) sono sempre testo React, mai HTML. Le opzioni si modificano con
`pages/admin/StatOptionsFields.tsx`, usato sia da «Pagina live» sia da «Pause». Il registro (`registry.tsx`) disegna
queste viste anche come blocchi della pagina, con le stesse etichette di `SLIDE_LABELS`; la pagina usa il set in corso
(`statPeriod`), il confronto di `charts/compare.ts` usa `teamDuel` di `@arenalive/volley-stats` (niente più calcoli copiati).

#### Blocchi del calendario («Prossima partita» e «Classifica»)
Dati del club scelto in «Club» (`docs/portale.md`, «Club e Calendario»); rotta, regole di scelta e cache in
`docs/server.md` («Club, calendario e abbinamento», rotta pubblica per i blocchi); contratti in `docs/architettura.md`.
Sono blocchi della pagina (larghezze 4/6/8/12) e diapositive delle pause (stesse opzioni), disegnati da
`blocks/CalendarBlocks.tsx` in tre misure: `card` (blocco), `full` (diapositiva a tutto schermo), `compact` (banda).

- **Dati** (`lib/schedule.ts`): `useSchedule` legge `GET /api/public/tenant/schedule` **una volta per pagina**, ogni 60 s e a
  ogni cambio di stato o di set della partita; parte solo se la pagina ha un blocco o una diapositiva di questi tipi
  (`isScheduleType`, `intermissionsUseSchedule`). Un errore lascia a video ciò che c'è. Il blocco o la diapositiva senza dati
  (nessun club, nessuna partita in arrivo, classifica vuota: `hasScheduleData`) è **saltato**, non resta una card vuota.
- **Prossima partita** (`NextMatchView`): la prima partita del club con orario che non è live (`nextFixture`). Avversario e
  club con logo (o iniziali), «VS», «In casa» o «In trasferta», data e «ore HH:MM», palazzetto e città, nei colori di
  «nostra squadra» e dell'avversario. Con l'opzione QR e un link non revocato: il QR del link breve della partita
  (`ShareQr`, con il logo quadrato del cliente) e il testo «Inquadra il codice per seguire la partita» (a tutto schermo:
  «Inquadra il codice per seguire la partita sul telefono»). Nella banda: «Prossima partita: <avversario> · In casa/In
  trasferta · data»; **sul telefono la banda non ha il QR**, il nome dell'avversario è un link alla partita. I nomi delle
  due squadre (`NextMatch.tsx`, `CalendarBlocks.tsx`) hanno il colore di «nostra squadra» e dell'avversaria.
- **Classifica** (`StandingsView`): tabella a colonne fisse (`table-fixed`) per leggersi bene in TV: posizione, logo, squadra,
  Pt, G, V, P, SV, SP (i nomi completi nel `title` dell'abbreviazione). Le righe sono quelle di `standingsRowsToShow`
  (`docs/architettura.md`); la nostra squadra è evidenziata (`aria-current`); sotto la tabella «Aggiornata al gg/mm/aaaa».
  Nella banda una riga con la posizione, i punti, le partite e i set della nostra squadra.
- **Opzioni** (`pages/admin/CalendarOptionsFields.tsx`): in «Pagina live» e in «Pause» (stesso componente).
  Le anteprime degli editor usano dati inventati (`blocks/sampleSchedule.ts`, `SAMPLE_SCHEDULE`), mai quelli veri.
- **Predefiniti**: «Classifica» e poi «Prossima partita» stanno dopo le statistiche nelle pause di fine set e di fine
  partita. **Non** sono nel layout TV predefinito del modello `sir-volley` (la griglia è piena): si aggiungono da «Pagina
  live».
- **Limiti noti**: il flag live può essere in ritardo fino a 60 s; la partita senza orario non si vede; una partita iniziata
  da meno di 4 ore senza `.dvw` conta ancora come prossima.

- **Editor**: sezione «Pagina live» dello «Studio grafico» (`studio/PageSection.tsx`, `studio/blockEditors.tsx`; ordine,
  visibilità, larghezza, opzioni, aggiunta, rimozione e ripristino descritti lì, insieme ad accessibilità e logica pura
  `layoutEditor.ts`).
- **Anteprima**: la pagina del dispositivo scelto è disegnata alla grandezza vera (`DevicePreview`: 1920×1080,
  1024×768, 390×845) e ridotta, non interattiva (si può solo cliccare un elemento per aprirne l'impostazione), con le
  modifiche non ancora salvate. Usa la partita live del cliente (`/ws/admin`: «Dati della partita live.») oppure, se non c'è,
  la «Partita d'esempio» (`src/blocks/sampleMatch.json`, caricata solo dall'editor in un suo file separato; si rigenera con
  `pnpm --filter @arenalive/web sample-match`).
- **Limiti noti**: un'immagine singola di un blocco sponsor non si può eliminare finché non viene tolta dal blocco. Un layout salvato e poi non più valido (per esempio di versione futura) si legge come
  predefinito.

### Sponsor (`pages/admin/SponsorsPage.tsx`, rotta `/admin/sponsor`, solo admin)
Anagrafica degli sponsor del cliente, nel gruppo di menu «Pagina pubblica». Server, tabelle e limiti in `docs/server.md`
(«Sponsor»), contratti in `docs/architettura.md` (`sponsors.ts`).

- **Pagina**: scheda «Nuovo sponsor» (nome, «Sito (facoltativo)» solo `https://`, «Crea sponsor»); scheda «Sponsor» con
  l'elenco nell'ordine della rotazione, riordinabile con «Sposta su» / «Sposta giù» (`PUT /api/admin/sponsors/order`;
  `movedIds`), per ogni sponsor nome, sito e numero di immagini, «Modifica» (nome e sito), «Elimina» con conferma (anche
  le sue immagini non usate altrove), le immagini con «Togli» (l'immagine passa a «senza sponsor») ed «Elimina», e il
  caricamento «Carica un'immagine per <sponsor>» (PNG,
  JPEG, WebP o SVG, al massimo 2 MB, 12 per sponsor). Scheda «Immagini senza sponsor» (visibile solo se ce ne sono: quelle
  caricate prima dell'anagrafica o tolte a uno sponsor) con «Assegna a» e la scelta dello sponsor. Gli errori del server
  (nome già usato, sponsor in uso in pagina o pause, immagine già di un altro sponsor) sono mostrati in italiano.
- **Studio grafico**: il blocco sponsor e la diapositiva sponsor delle pause hanno una casella per ogni sponsor («Sponsor a
  rotazione (N di al massimo 12)»), l'elenco «Immagini singole» con «Togli» (compare solo se il documento ne ha: sono
  l'opzione `images` salvata prima dell'anagrafica, mantenuta per compatibilità) e il link «Gestisci sponsor» a questa
  pagina; non c'è più il caricamento diretto dal blocco. Le anteprime usano gli sponsor dell'anagrafica
  (`publicSponsorsOf` in `lib/sponsors.ts`, con le immagini da `adminAssetPath`). Le miniature della pagina «Sponsor»
  usano l'`url` di `AssetSummary` (`/api/admin/assets/:id/file`, vedi «Miniature e anteprime dell'area riservata»).
- **Pagina pubblica**: gli sponsor arrivano in `sponsors` di `GET /api/public/tenant` (solo quelli scelti); la rotazione è
  descritta in «Pagina pubblica a blocchi».
- **Caricamento**: gli helper sono in `pages/admin/imageUpload.ts` (`uploadImage`, `uploadSponsorImage`, `ACCEPT`,
  `IMAGE_TOO_LARGE`, `imageCountText`), condivisi da questa pagina e dallo Studio. Test: `SponsorsPage.test.tsx`, `SponsorBlock.test.tsx`.

### Pause della partita (schermate di time-out, fine set e fine partita)
Quando la partita ha una pausa il portale mostra una schermata con riepilogo e sponsor. Il portale non decide nulla: la
fase viene da `state.phase` (`docs/statistiche.md`, «Fase della partita»), la configurazione del cliente da
`intermissions` di `GET /api/public/tenant` (`docs/architettura.md`, «Pause della partita»; `docs/server.md`).

- **«Ogni N punti»** (`milestone`): pausa breve durante il set, non una fase. `milestoneStep` (`lib/intermission.ts`, pura) la
  apre quando `pointMilestone` dà una soglia più alta di quella già raggiunta nel set (la memoria tiene per set la soglia più
  alta, anche se non ha aperto nulla; una correzione dello scout che la abbassa non la riapre). Non si apre: al primo stato,
  dopo una riconnessione o un `resync` (solo aggiornamenti `live`), con un time-out, una fine set o una fine partita in corso
  (che hanno la precedenza e la chiudono), né vicino al traguardo del set: con `stopBeforeEnd` K (predefinito 5) niente pausa
  se una squadra è a K punti dal traguardo (25, 15 al tie-break; il traguardo viene da `@arenalive/volley-stats`). Mostra le sue
  diapositive una volta e si chiude da sola; se time-out e fine set sono disattivati resta fino al suo timer. Titolo
  (`pauseTitle`): «2° set: 9-7». È attiva di default per tutti i clienti e si spegne da «Pause».
- **Quando compare** (`components/Intermission.tsx`, montato da `LivePage.tsx` sotto la pagina): per `timeout`, `setBreak` e
  `matchEnd`, se la pausa è attiva (`intermissionFor`) e ha almeno una diapositiva da mostrare. Parte dopo il ritardo
  `delaySeconds` della pausa (il tabellone mostra prima la fine del set); **non si applica a chi apre la pagina durante
  una pausa**, che la vede subito. Si chiude da sola alla prima azione dopo (la fase torna `rally`); la fine partita
  resta finché lo spettatore non la chiude. Sotto la pausa la pagina continua ad aggiornarsi.
- **«Dopo la partita»** (`components/AfterMatchScreen.tsx`, `lib/afterMatch.ts`, montata da `LivePage.tsx`): la foto scelta
  dal cliente a tutto schermo (`object-cover`) e, sopra, squadre, data e ora e conto alla rovescia della prossima partita
  (`nextFixture`); se non c'è, la sola foto. Nessun elemento cliccabile e nessuna animazione, quindi funziona uguale con
  «Touch» = No. Parte quando la partita è `finished` e sono passati `delayMinutes` da `finishedAt` (campo del messaggio
  `state`, conservato da `liveConnection.ts` nei patch finché la partita è finita), calcolati con l'**orologio del
  dispositivo** e **un solo `setTimeout`** (`afterMatchDueAt`, `useAfterMatchImage`; niente polling; attese più lunghe di 24 ore
  si riarmano). Sostituisce la pausa di fine partita e blocca gli avvisi; resta finché la partita non è più finita (una
  correzione) o il link passa a un'altra partita. Il calendario si legge solo mentre è a video.
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
  del set»), «Risultato» (set vinti e parziali), «Miglior Realizzatore» (`matchMvp`: maglia, nome, punti, attacchi vincenti, muri, ace,
  efficienza d'attacco), «Parziali dei set», «Sponsor», «Messaggio», «Codice QR», «Logo» (gli ultimi quattro come i blocchi
  omonimi, `docs/portale.md` «Pagina pubblica a blocchi»), più le sei viste statistiche in stile TV: «Parziale e marcatori»,
  «Ace», «Muri» (titolo «Muri vincenti»), «Attacco», «Sfida per ruolo» e «Squadre a confronto» (misure e animazioni in
  «Pagina pubblica a blocchi»), e «Prossima partita» e «Classifica» (`CalendarBlocks.tsx`, vedi «Blocchi del
  calendario»; i predefiniti le mettono dopo le statistiche di fine set e di fine partita). «Sfida per ruolo» a rotazione diventa una diapositiva per ogni ruolo con un duello (id
  `<id>:<ruolo>`, ognuna per i suoi secondi). Le diapositive senza nulla da mostrare sono saltate
  (`visibleSlides`): lo sponsor senza immagini usa il logo sponsor della grafica, e se non c'è nemmeno quello è saltato;
  il riepilogo senza il set, il Miglior Realizzatore senza giocatori con punti, i parziali senza set, ace/muri/attacco senza nemmeno un punto
  o tentativo, il confronto senza righe con valori, il duello senza giocatori. **Conseguenza**: la pausa time-out di
  default (solo sponsor) non compare se il cliente non ha né immagini sponsor né logo sponsor.
- **Caricamento della grafica** (`useTenantIntermissions` in `lib/branding.ts`, stato caricamento/caricata/fallita):
  finché `GET /api/public/tenant` non risponde non si mostra nessuna pausa; se fallisce valgono i predefiniti.
- **Editor**: sezione «Pause» dello «Studio grafico» (`studio/PausesSection.tsx`; schede, diapositive, regola «ogni N
  punti», ritardo e ripristino descritti lì). La pausa è mostrata subito nell'anteprima, con le modifiche non salvate
  (`previewState` mette nello stato la fase della pausa aperta). La «Partita d'esempio» (`src/blocks/sampleMatch.json`,
  rigenerata con `pnpm --filter @arenalive/web sample-match`) è in 2° set con un set chiuso.
- **Sponsor**: la diapositiva «Sponsor» sceglie gli sponsor come il blocco (stesse opzioni e stessa rotazione, `docs/portale.md`
  «Sponsor»); un'immagine singola di una diapositiva non si può eliminare finché non viene tolta.
- **Limiti noti**: un'immagine singola di una diapositiva sponsor non si può eliminare finché non viene tolta. Da provare su dispositivi veri (TV a 4-5 m, telefono con la banda).

### Avvisi sugli eventi (messaggi rapidi sopra la pagina)
Quando succede qualcosa in partita (ace, set point, match point…) compare per pochi secondi un messaggio sopra la pagina.
Il portale non rileva nulla: gli eventi vengono da `state.events` (`docs/statistiche.md`, «Eventi della partita»), la
configurazione del cliente da `overlays` di `GET /api/public/tenant` (`docs/architettura.md`, «Avvisi sugli eventi»;
`docs/server.md`).

- **Quando compare** (`components/Overlay.tsx`, montato da `LivePage.tsx` accanto a `Intermission`): per ogni evento nuovo
  il cui avviso è acceso e ammesso sul dispositivo; testo da `overlayText` (`fillOverlayText` di `@arenalive/shared`), sempre testo
  semplice, mai HTML. Il riquadro ha il colore della squadra dell'evento (neutro senza squadra), cade dall'alto con
  l'animazione `.sir-overlay` (450 ms, spenta con `prefers-reduced-motion`) e resta per i secondi scelti.
- **Sfondo immagine o video** (`lib/overlayMedia.ts`, `useOverlayMedia`, usato da `Overlay`): all'apertura della pagina
  i file degli sfondi sono scaricati in memoria come blob (`URL.createObjectURL`, da `GET /api/public/assets/:id`), così il
  video parte subito; si precaricano solo gli sfondi degli avvisi **accesi e ammessi sul dispositivo** (`wantedBackgrounds`),
  ogni file una volta, e gli URL sono rilasciati quando lo sfondo non serve più o la pagina si chiude. **Sul telefono e con
  meno animazioni (`prefers-reduced-motion`) i video non si scaricano né si mostrano** (restano le immagini sul telefono): è
  una scelta per dati e memoria della rete mobile. Con uno sfondo il riquadro (`OverlayBanner`, `data-background`) è 16:9
  (`aspect-video`, larghezza per dispositivo), con l'immagine o il video (muto, `playsInline`, in ciclo) coperti da una velatura
  del colore della squadra al 65 %, e il testo sopra. **Se il media non è ancora pronto (o non si è potuto leggere) l'avviso
  esce con il solo testo**, come senza sfondo. La CSP ammette `blob:` (vedi «CSP rigida»).
- **Posizione e dimensione** (`position`: `top`, `center`, `bottom`, predefinito `top`; `size`: `small`, `medium`,
  `large`, predefinita `medium`; `overlayPlacement` di `@arenalive/shared`): impostazioni generali del documento e override
  facoltativo per ogni avviso. In alto al 12 % dal bordo, al centro, in basso al 14 % sopra la banda delle pause; tre
  dimensioni per dispositivo. L'avviso non intercetta mai i clic (`pointer-events-none`).
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
- **Editor**: sezione «Avvisi» dello «Studio grafico» (`studio/OverlaysSection.tsx`; i 12 eventi, il testo con i
  segnaposto, secondi, dispositivi, posizione e dimensione, «Prova», priorità e ripristino sono descritti lì). Nell'anteprima
  «Prova» fa comparire l'avviso con le modifiche non salvate, per i suoi secondi. Logica pura: `lib/overlay.ts`
  (`overlayValues`, `overlayText`, `overlayFor`, `unseenEvents`, `enqueue`, `nextOverlay`, `sampleEvent`).

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
(`script-src 'self'; style-src 'self'; worker-src 'self'`, il service worker minimo di «App installabile e schermo intero»;
`img-src 'self' data: blob:` e `media-src 'self' blob:`, perché gli sfondi degli avvisi sono letti in memoria: «Avvisi sugli eventi»), più `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (il token è
nell'URL), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` e `Permissions-Policy`. Per rispettarla:
- zod gira in modalità `jitless` (`z.config({ jitless: true })` in `src/main.tsx`), perché la modalità normale prova
  `new Function`, che sarebbe una violazione `unsafe-eval`;
- i tooltip sono nel canvas (sopra) e gli stili vengono da file della build, non da attributi `style` scritti a mano.

### Stub di `iconv-lite`
`@arenalive/shared` raggiunge il parser DVW attraverso gli schemi di ingest e il parser usa `iconv-lite`, che in un browser non
funziona (richiede il `Buffer` di Node). Il portale non legge file DVW, quindi in `vite.config.ts` l'alias `iconv-lite`
punta a `src/lib/iconv-browser.ts`, che lancia un errore se chiamato. Inoltre `treeshake.moduleSideEffects` scarta dal
bundle i pacchetti del monorepo non usati.

## Configurazione

### Sviluppo (`apps/web/vite.config.ts`)
- `vite dev` ascolta sulla porta **5173** (`strictPort`: se è occupata non ne cerca un'altra).
- Proxy verso il server: `/api` e `/ws` (con WebSocket) vanno a `ARENALIVE_SERVER_URL`, default `http://localhost:8090`. Il
  browser vede una sola origine, quindi cookie di sessione e controllo `Origin` funzionano con `CORS_ORIGIN` e
  `PUBLIC_BASE_URL` = `http://localhost:5173` (default del server, `docs/server.md`).
- `define`: `__ARENALIVE_VERSION__` e `__ARENALIVE_COMMIT__` (versione del `package.json` alla radice e commit corto, vuoto se ignoto)
  e `__ARENALIVE_BUILD__` (id casuale di ogni `vite build`, vuoto in sviluppo; il build lo scrive anche in `version.json`).
- Build: `pnpm --filter @arenalive/web build` scrive in `apps/web/dist`; ECharts ha un chunk a parte (`echarts`).

### Demo (`apps/web/scripts/demo.ts`)
Avvia in un solo processo un server con PGlite in memoria, un agente vero e il simulatore che suona una partita sintetica.
Tutto si perde con Ctrl+C. Variabili, tutte facoltative:

| Variabile | Default | Significato |
|---|---|---|
| `DEMO_SPEED` | `15` | accelerazione del simulatore (numero positivo, massimo 10000) |
| `DEMO_SEED` | `1` | seme della partita generata (intero da 0) |
| `DEMO_SETS` | `4` | numero di set: `3`, `4` o `5` |
| `DEMO_PORT` | `8090` | porta del server della demo (deve coincidere con `ARENALIVE_SERVER_URL` di vite) |
| `DEMO_ADMIN_EMAIL` | `admin@arenalive.local` | email dell'admin di prova |
| `DEMO_ADMIN_PASSWORD` | `password-demo-arenalive` | password dell'admin di prova (almeno 12 caratteri) |

L'admin di prova (`admin@arenalive.local` / `password-demo-arenalive`) esiste solo nel database in memoria della demo. La demo
usa `COOKIE_SECURE=false`, `CORS_ORIGIN` e `PUBLIC_BASE_URL` = `http://localhost:5173` e limiti di richieste molto alti.

### Docker
- `docker/web.Dockerfile`: build arg `ARENALIVE_COMMIT` (commit corto per la versione; il contesto non ha `.git`), stadio `build` (Node 24, `pnpm install --frozen-lockfile`, `pnpm --filter @arenalive/web build`),
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
DEMO_ADMIN_EMAIL="admin@arenalive.local"       # email dell'admin di prova
DEMO_ADMIN_PASSWORD="password-demo-arenalive" # password dell'admin di prova, almeno 12 caratteri

# --- comandi ---
cd "$RADICE"
corepack enable
pnpm install
DEMO_SPEED="$DEMO_SPEED" DEMO_SEED="$DEMO_SEED" DEMO_SETS="$DEMO_SETS" DEMO_PORT="$DEMO_PORT" \
  DEMO_ADMIN_EMAIL="$DEMO_ADMIN_EMAIL" DEMO_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD" \
  pnpm --filter @arenalive/web demo
```

La demo stampa l'indirizzo della pagina pubblica (`http://localhost:5173/live/<token>`), quello per il maxischermo
(`…?tv=1`) e dell'area riservata. Secondo terminale (il portale):

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DEMO_PORT="8090"                         # la stessa porta usata dalla demo

# --- comandi ---
cd "$RADICE"
ARENALIVE_SERVER_URL="http://localhost:$DEMO_PORT" pnpm --filter @arenalive/web dev
```

Poi si apre `http://localhost:5173` nel browser, con l'indirizzo stampato dalla demo.

### Con Docker Compose
Variabili e comandi di `docker compose` sono in `docs/server.md`; il portale è su `http://localhost:8080` (o
`WEB_PORT`). Controllo: `http://localhost:8080/healthz` risponde `ok`.

### Comandi del pacchetto (`apps/web/package.json`)

| Comando | Cosa fa |
|---|---|
| `pnpm --filter @arenalive/web dev` | Vite in sviluppo su 5173 |
| `pnpm --filter @arenalive/web build` | build in `apps/web/dist` |
| `pnpm --filter @arenalive/web preview` | serve la build sulla 5173 |
| `pnpm --filter @arenalive/web demo` | demo (sopra) |
| `pnpm --filter @arenalive/web test` | `vitest run` (jsdom) |
| `pnpm --filter @arenalive/web sample-match` | rigenera `src/blocks/sampleMatch.json` (partita d'esempio dell'anteprima); un test ne verifica la coerenza |

### Kiosk per le TV (Windows)
Crea nella cartella «Esecuzione automatica» di Windows un collegamento che apre il browser a schermo intero sul link
pubblico, a ogni accensione del PC. Va eseguito in PowerShell sul PC della TV, dopo aver copiato il link da «Link pubblici».

```powershell
# ---- VARIABILI (compila solo questo blocco) ----
$Browser          = "C:\Program Files\Google\Chrome\Application\chrome.exe"   # percorso di chrome.exe; per Edge: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$Url              = "<link pubblico del canale o della partita, da «Link pubblici»>"
$NomeCollegamento = "ArenaLive TV"                                          # nome del collegamento nella cartella Esecuzione automatica
# ---- FINE VARIABILI ----

$Argomenti = "--kiosk `"$Url`" --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required"
$Cartella  = [Environment]::GetFolderPath("Startup")
$Percorso  = Join-Path $Cartella "$NomeCollegamento.lnk"

if (-not (Test-Path $Browser)) {
    Write-Host "Browser non trovato: $Browser"
} else {
    $Shell = New-Object -ComObject WScript.Shell
    $Link  = $Shell.CreateShortcut($Percorso)
    $Link.TargetPath       = $Browser
    $Link.Arguments        = $Argomenti
    $Link.WorkingDirectory = Split-Path $Browser
    $Link.Save()
    Write-Host "Collegamento creato: $Percorso"
}
```

### Verifica visiva
Screenshot di una pagina con un Chrome headless senza installazione: `chrome-headless-shell` in una cartella temporanea
(il disco del server è quasi pieno), con le librerie mancanti estratte nella stessa cartella. Il portale deve già
rispondere all'URL indicato (demo o Docker Compose, sopra).
Attenzione: con `--virtual-time-budget` Chrome headless non fa avanzare le animazioni CSS, quindi pause e diapositive
restano ferme ai primi istanti della dissolvenza (sembrano trasparenti). Per controllarle si usa uno screenshot via CDP in
tempo reale (`--remote-debugging-port`, poi `Page.captureScreenshot` dopo qualche secondo).

```bash
# --- variabili ---
CARTELLA="/tmp/arenalive-chrome"                       # cartella temporanea per Chrome e librerie (si cancella a fine lavoro)
URL="http://localhost:5173/"                     # pagina da fotografare (con la demo: l'URL stampato dal comando demo)
LARGHEZZA=1920                                   # larghezza della finestra in px
ALTEZZA=1080                                     # altezza della finestra in px
FILE="/tmp/arenalive-chrome/schermata.png"             # file PNG di uscita

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
- **Compose**: `docker compose -p arenalive up -d --build` con `.env` da `.env.example` (`POSTGRES_PASSWORD`, `ADMIN_*`,
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

### Scansione DAST
Con StackHawk (2026-10-14) fu scansionato anche lo stack dietro nginx: PASS, 25 URI, un solo Low (falso positivo, email
nelle rotte autenticate), 0 errori 500. Ora la DAST è `scripts/dast_zap.sh` (OWASP ZAP, `docs/server.md`) e copre solo le
API del server: il portale non è scansionato.

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
  (`TenantsPage.tsx`: pagina «Clienti» e `useChooseTenant`; `AdminApp.tsx`: rotte e barra; `ManagedTenantBar.tsx`;
  `AdminSidebar.tsx`: `menuGroups`, `SUPERADMIN_MENU`; `ShareLinksPage.tsx`: `fixedChoices`; `SimulationPage.tsx`),
  `lib/titlePrefix.ts` (`useTitlePrefix`)
- `apps/web/src/lib/liveConnection.ts` (`LiveConnection`, `applyMessage`, `applyPatchMessage`, `backoffDelay`), `frames.ts`
  (`gunzipFrame`, `supportsGzip`, `withGzip`), `pages/LivePage.tsx` (`probeShareToken`, `retryAfterMs`), `useLiveSocket.ts`, `messages.ts`, `api.ts`, `theme.ts`, `iconv-browser.ts`
- Grafica per cliente: `apps/web/src/lib/branding.ts` (`initBranding`, `writePalette`, `setTenantLook`, `useTenantLook`,
  `useBrandingRevision`, `useBrandName`), `lib/base64.ts`, `components/BrandMark.tsx`,
  `pages/admin/studio/ColorsSection.tsx`; `packages/shared/src/colors.ts`, `assets.ts`, `tenant.ts`; API in `docs/server.md`
- Pagina pubblica a blocchi: `apps/web/src/blocks/` (`registry.tsx`: `BLOCKS`, `renderLayoutBlock`; `BrandBlocks.tsx`;
  `MatchBlocks.tsx`; `sampleMatch.ts`, `sampleMatch.json`, `env.ts`), `components/BlockLayout.tsx`,
  `pages/admin/studio/PageSection.tsx`, `pages/admin/studio/blockEditors.tsx` (`BlockOptionsEditor`, `DevicePreview`), `pages/admin/layoutEditor.ts`, `scripts/sample-match.ts`; contratto in
  `packages/shared/src/layout.ts` (`docs/architettura.md`), API in `docs/server.md`, classifica in `docs/statistiche.md`
- Pause della partita: `apps/web/src/components/Intermission.tsx` (`Intermission`), `blocks/IntermissionSlides.tsx`
  (`renderSlide`, `SLIDE_LABELS`), `lib/intermission.ts` (`phaseOf`, `describePause`, `activePause`, `visibleSlides`,
  `pauseTitle`, `previewState`), `lib/branding.ts` (`useTenantIntermissions`), `pages/admin/studio/PausesSection.tsx`,
  `pages/admin/intermissionEditor.ts`, `pages/admin/StatOptionsFields.tsx`, `blocks/StatSlides.tsx`, `milestoneStep`,
  `milestonePause`, `statPeriod`, `duelRoles` in `lib/intermission.ts`; contratto in `packages/shared/src/intermissions.ts` (`docs/architettura.md`), fase e
  riepiloghi in `packages/volley-stats/src/phase.ts`, `recap.ts` (`docs/statistiche.md`), API in `docs/server.md`
- Studio grafico: `apps/web/src/pages/admin/studio/` (`StudioPage.tsx`: `StudioPage`, `wizardSeenKey`, `PREVIEW_WIDE_KEY`,
  `STUDIO_PHONE_MAX`; `model.ts`: `STUDIO_SECTIONS`, `LEGACY_PAGES`, `studioPath`, `autoScene`, `isFirstAccess`,
  `brandingChanges`, `layoutChanges`, `intermissionChanges`, `overlayChanges`, `applyPauseModel`, `applyOverlayModel`,
  `activePauseModel`, `activeOverlayModel`, `pauseWhere`, `overlayWhere`, `blockWhere`, `pickAt`, `sampleWithOurTeam`;
  `StudioPreview.tsx`; `ColorsSection.tsx`, `PageSection.tsx`, `PausesSection.tsx`, `OverlaysSection.tsx`;
  `StudioWizard.tsx`; `StudioUi.tsx`: `Setting`, `Advanced`, `TabList`, `ModelPicker`; `blockEditors.tsx`),
  `charts/usePalette.ts` (`PaletteScopeContext`, `usePalette`), `pages/admin/AdminApp.tsx` (rotte e menu ridotto),
  marcatori `data-studio-*` in `components/BlockLayout.tsx` e `Intermission.tsx`; test `studio/model.test.ts`,
  `studio/StudioPage.test.tsx`
- Ruoli, club e calendario: `apps/web/src/lib/useCanEdit.ts` (`useCanEdit`, `READ_ONLY_TEXT`),
  `pages/admin/LeaguesPage.tsx` (`LeaguesPage`, `leagueSyncText`, `leaguePlanText`), `LogoPicker.tsx` (`LogoPicker`,
  `uploadLogo`), `CalendarPage.tsx` (`ManualFixtureForm`), `ClubPage.tsx` (`ProfileForm`, `COVERAGE_TEXT`,
  `TEAM_LOGOS_TEXT`), `AgentsPage.tsx` (`ValidityChoice`, `validityText`), `TenantsPage.tsx` (`quotaText`),
  `components/Scoreboard.tsx` (`logos`); test `pages/admin/roles.test.tsx`; API in `docs/server.md`
- Anteprima a tutto schermo, font e app: `apps/web/src/components/PreviewDock.tsx` (`PreviewDock`, `PreviewFullscreen`),
  `components/AppInstall.tsx` (`InstallButton`, `FullscreenHint`), `lib/pwa.ts` (`registerServiceWorker`, `useInstallApp`,
  `useFullscreenOnFirstTouch`), `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`, `index.html`,
  `styles/fonts.css`, `styles/fonts/inter/`, `public/assets/inter-OFL.txt`, `styles/index.css` (`.sir-admin-font`,
  `.sir-thin-scroll`)
- Avvisi sugli eventi: `apps/web/src/components/Overlay.tsx` (`Overlay`, `OverlayBanner`), `lib/overlay.ts`
  (`overlayFor`, `unseenEvents`, `enqueue`, `nextOverlay`, `sampleEvent`), `lib/branding.ts` (`useTenantOverlays`),
  `lib/liveConnection.ts` (`live`), `pages/admin/studio/OverlaysSection.tsx`, `styles/index.css` (`.sir-overlay`); contratto in
  `packages/shared/src/overlays.ts` (`docs/architettura.md`), eventi in `packages/volley-stats/src/events.ts`
  (`docs/statistiche.md`), API in `docs/server.md`; test `Overlay.test.tsx`
- Agente scaricabile: `apps/web/src/pages/admin/AgentsPage.tsx` (`AgentDownload`, `AGENT_DOWNLOAD_PATH`), test
  `AgentsPage.test.tsx`; `AgentDownloadInfoSchema` in `packages/shared/src/agentDownload.ts`; server in `docs/server.md`
- Simulazione: `apps/web/src/pages/admin/SimulationPage.tsx` (`SimulationPage`, `formatClock`, `paceText`,
  `SIMULATION_POLL_MS`), `components/LiveMatch.tsx` (`SimulationLabel`, `SIMULATION_LABEL`), `lib/liveConnection.ts`;
  contratto in `packages/shared/src/simulation.ts` (`docs/architettura.md`), API in `docs/server.md`
- Club e «Prossima partita»: `apps/web/src/pages/admin/ClubPage.tsx` (`ClubPage`, `leagueName`, `syncText`),
  `pages/admin/CalendarPage.tsx` (`CalendarPage`, `STATE_TEXT`, `fixtureChoiceText`), `pages/admin/AdminSidebar.tsx`
  (`menuGroups`), `components/NextMatch.tsx` (`NextMatch`, `countdownTo`, `teamInitials`), `components/LiveMatch.tsx`,
  `components/ConnectionBadge.tsx`, `lib/format.ts` (`formatFixtureDate`), `lib/liveConnection.ts` (`scheduled`); contratti in
  `packages/shared/src/club.ts` (`docs/architettura.md`), API e abbinamento in `docs/server.md`; test `NextMatch.test.tsx`,
  `ClubPage.test.tsx`, `CalendarPage.test.tsx`
- Portale adattivo: `apps/web/src/lib/layout.ts` (`deviceFor`, `tvModeOf`, `defaultLayouts`, `blocksFor`, `packRows`, `tvGroups`, `rotationIndex`),
  `lib/useLayout.ts` (`useStickyOffset`), `lib/tvScreen.ts` (`useWakeLock`, `useIdle`), `components/BlockLayout.tsx`,
  `components/ui.tsx` (`CardCollapseContext`), `styles/index.css`
- Modelli grafici: `apps/web/src/lib/branding.ts` (`applyTemplate`, `initTemplate`, `useTemplate`, `useOurTeamColors`),
  `lib/teamColors.ts` (`teamColorVars`), `lib/theme.ts` (`forcedTheme`, `useForcedTheme`), `lib/layout.ts` (`viewportClass`,
  `templateLayouts`), `MenuButton.tsx`, `BrandMark.tsx`,
  `styles/tokens.css` (`[data-template='sir-volley']`), `styles/fonts.css`, `scripts/trim-logo.ts`, `scripts/brand-icons.ts`, `public/brand/`, `public/icons/`, `components/ProductLogo.tsx`;
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
