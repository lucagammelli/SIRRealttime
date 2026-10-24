/**
 * Content of the user guide («Guida»): plain data, rendered by `GuidePage`. Text only (no HTML). The words are the
 * ones the user sees on the screen (menu, buttons, fields). No technical term: `content.test.ts` checks a list of them.
 */

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; items: readonly string[] }
  | { kind: 'list'; items: readonly string[] }
  | { kind: 'note'; text: string };

/** Link to a page of the reserved area (`/admin/...`). */
export interface GuideLink {
  label: string;
  to: string;
}

export interface GuideSection {
  /** Anchor of the section (`#id`). */
  id: string;
  title: string;
  /** Only the superadmin sees it. */
  superadminOnly?: boolean;
  /** Part of it can be done only by «Lettura e scrittura»: a user «Sola lettura» reads a note. */
  needsWrite?: boolean;
  blocks: readonly GuideBlock[];
  links?: readonly GuideLink[];
}

export const READ_ONLY_NOTE =
  'Alcune cose di questa sezione le può fare solo chi ha il ruolo «Lettura e scrittura». Con «Sola lettura» puoi guardare, ma non cambiare. Se serve una modifica, chiedila a chi gestisce il club.';

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: 'primo-accesso',
    title: 'Primo accesso',
    blocks: [
      { kind: 'text', text: 'Per entrare ti serve un invito. Lo manda chi gestisce il club, per email.' },
      {
        kind: 'steps',
        items: [
          'Apri l’email di invito e premi il link.',
          'Nella pagina «Scegli la password» scrivi la password che vuoi usare. Deve avere almeno 12 caratteri.',
          'Scrivila una seconda volta in «Ripeti la password».',
          'Premi «Salva e accedi»: sei dentro.',
        ],
      },
      { kind: 'note', text: 'Il link dell’invito vale tre giorni. Se è scaduto, chiedi che te ne mandino un altro.' },
      {
        kind: 'text',
        text: 'Le volte dopo entri dalla pagina «Area riservata» con email e password, poi premi «Accedi».',
      },
      {
        kind: 'text',
        text: 'Hai dimenticato la password? Nella pagina di accesso premi «Password dimenticata?», scrivi la tua email e premi «Invia il link». Ti arriva una email: premi il link e scegli una nuova password. Il link vale un’ora e si usa una volta sola.',
      },
      {
        kind: 'text',
        text: 'Per cambiare la password quando sei già dentro, vai su «Il mio account». Lì, e in fondo al menu a sinistra, vedi anche la versione del portale.',
      },
    ],
    links: [{ label: 'Vai a Il mio account', to: '/admin/account' }],
  },
  {
    id: 'configurazione-guidata',
    title: 'Configurazione guidata',
    needsWrite: true,
    blocks: [
      {
        kind: 'text',
        text: 'La prima volta che entra chi ha «Lettura e scrittura», si apre da sola la configurazione guidata. Sono cinque passi brevi. A destra vedi subito come sta venendo la pagina.',
      },
      {
        kind: 'steps',
        items: [
          'Il logo: scegli il logo della società dalla libreria (se non c’è, prima caricalo con «Carica nella libreria» in «Immagini e video»). Compare nelle pagine pubbliche, nell’app e nei QR.',
          'La squadra: scegli la serie in cui gioca il club e poi la tua squadra. Il calendario arriva da solo dal sito della Lega.',
          'I colori: scegli un modello e, se vuoi, il colore principale e quello di risalto.',
          'La grafica: scegli un modello già pronto per le pause e gli avvisi durante la partita.',
          'Fatto: vedi il riepilogo, il link del canale del club con il suo QR e la prossima partita.',
        ],
      },
      {
        kind: 'text',
        text: 'Premi «Avanti» per andare al passo dopo e «Indietro» per tornare. Ogni passo si salva quando premi «Avanti».',
      },
      {
        kind: 'note',
        text: 'Non hai tempo? Premi «Salta per ora». In alto nella pagina resta l’avviso «Configurazione da completare» con il pulsante «Riprendi»: premilo e riparti da dove eri. Alla fine premi «Fine».',
      },
    ],
  },
  {
    id: 'club-calendario',
    title: 'Club e calendario',
    needsWrite: true,
    blocks: [
      { kind: 'text', text: 'Nella pagina «Club» dici chi siete. Nella pagina «Calendario» vedi le partite.' },
      { kind: 'text', text: 'Per impostare la squadra:' },
      {
        kind: 'steps',
        items: [
          'Apri «Club».',
          'In «Campionati» scegli il genere e la serie, poi la squadra del club.',
          'Premi «Salva». Il calendario si scarica da solo.',
        ],
      },
      {
        kind: 'text',
        text: 'Per le altre competizioni della serie (Coppa Italia, Supercoppa, Play Off…) premi «Aggiungi competizione» in «Campionati»: compare l’elenco delle competizioni della stagione sul sito della Lega. Scegline una e premi «Aggiungi»: si scarica da sola e la squadra del club si sceglie da sola (la stessa della serie). Se non la riconosciamo, sceglila tu: senza squadra non arriva nessuna partita. A inizio stagione la competizione passa da sola a quella nuova appena la Lega la pubblica.',
      },
      {
        kind: 'text',
        text: 'Sempre in «Club», nel campo «Partite trasmesse» scegli «Casa e trasferta» oppure «Solo partite in casa». Con «Solo partite in casa» le trasferte non hanno il link attivo. Nel «Calendario» ogni partita può fare eccezione.',
      },
      { kind: 'text', text: 'Nel «Calendario»:' },
      {
        kind: 'list',
        items: [
          'Se il tuo club ha i «Link e QR per singola partita», ogni partita ha il suo link e il suo QR. Altrimenti si usa il «Canale del club».',
          'Per aggiungere un’amichevole, una coppa o un’altra gara, premi «Aggiungi partita» e compila tipo, data, ora, avversario e dove si gioca. In «Competizione (facoltativa)» scrivi il nome della competizione, per esempio «Champions League»: il campo suggerisce i campionati del club e i nomi già usati. La competizione compare con la partita nel «Calendario» e nella pagina pubblica.',
          'Ogni partita mostra la sua competizione: il campionato del sito della Lega o il nome scritto a mano. Con più competizioni, in «Competizione» scegli «Tutte» oppure una sola (o «Senza competizione»).',
          'Se la data è sbagliata o è cambiata, apri la partita, premi «Cambia data e ora» e scrivi quelle giuste. La partita mostra «Modificata a mano».',
          'Per rimettere la data del sito della Lega premi «Torna alla data ufficiale».',
          'Se un file .dvw si è abbinato alla partita sbagliata (per esempio una prova fatta prima della partita vera), accanto a «File .dvw» premi «Scollega» e poi «Conferma: scollega il file»: la partita torna «Programmata» e il file non viene più abbinato da solo.',
        ],
      },
    ],
    links: [
      { label: 'Vai a Club', to: '/admin/club' },
      { label: 'Vai a Calendario', to: '/admin/calendario' },
    ],
  },
  {
    id: 'grafica',
    title: 'Grafica della pagina pubblica',
    needsWrite: true,
    blocks: [
      {
        kind: 'text',
        text: 'La pagina pubblica è quella che vedono i tifosi. La personalizzi nello «Studio grafico». Ha quattro parti:',
      },
      {
        kind: 'list',
        items: [
          '«Colori e loghi»: i colori della società e i loghi (orizzontale, quadrato e sponsor).',
          '«Pagina live»: cosa mostrare su TV, tablet e telefono durante la partita.',
          '«Pause»: cosa si vede a fine set, nei time-out e a fine partita, anche con gli sponsor.',
          '«Avvisi»: i messaggi che compaiono per ace, muro, set point e altro.',
        ],
      },
      {
        kind: 'text',
        text: 'In «Pagina live» e in «Pause» ogni blocco e ogni diapositiva ha nella sua riga il pulsante «−» (Rimuovi). Se hai scelto delle opzioni (un testo, gli sponsor) chiede prima «Conferma rimozione». Nelle «Pause» l’interruttore «Attiva» spegne una diapositiva senza perdere le sue opzioni: resta nell’elenco ma i tifosi non la vedono. Nel blocco «Rotazioni» la «Disposizione» sceglie se i grafici delle due squadre stanno «Affiancati» o «Uno sopra l’altro». Nel blocco «Mappe di campo», «Colore del campo» può essere «Automatico» (due metà con i loro colori), «Colore singolo» (le due metà uguali) o «Tricolore» (tre fasce verticali, per impostazione verde, bianco e rosso; la fascia bianca sta sulla rete).',
      },
      {
        kind: 'text',
        text: 'In «Pagina live», per ogni dispositivo (TV, Tablet, Telefono), l’interruttore «Touch: Sì/No» decide se la pagina pubblica ha qualcosa da toccare. Con «No» spariscono pulsanti, selettori, ordinamento delle colonne, link degli sponsor e pulsanti di schermo intero, tema e pause, e i grafici restano sulla vista predefinita. Su una TV senza touch la rotazione dei blocchi continua da sola.',
      },
      {
        kind: 'text',
        text: 'Nelle opzioni del blocco «Mappe di campo», alla voce «Cosa mostra senza tocco (TV)», scegli che cosa vede chi non può toccare la pagina. «Squadra»: «A turno» (la scelta iniziale: casa e ospite si alternano), «Solo la nostra squadra», «Casa» o «Ospite». «Fondamentale»: «Attacco», «Battuta» o «A turno». Con «A turno» scegli anche «Secondi per ogni vista» (da 5 a 60). Con tutti e due a turno la mappa mostra casa attacco, ospite attacco, casa battuta, ospite battuta. Il sottotitolo della mappa dice sempre di quale squadra sono le traiettorie. Su tablet e telefono con il tocco i filtri restano e partono dalla tua scelta.',
      },
      {
        kind: 'text',
        text: 'In «Pause», sotto «Come si mostra», «Dimensione a tutto schermo» decide quanto sono grandi le diapositive dove la pausa è a «Tutto schermo»: «Normale» (come sono disegnate, scorrono se non ci stanno), «Grande» (più grandi, finché stanno nello schermo) o «Riempi lo schermo» (occupano tutto lo spazio, senza scorrere). La banda in basso non cambia.',
      },
      {
        kind: 'text',
        text: 'In «Pause», nella scheda «Fine partita», la parte «Dopo la partita» mostra una foto a tutto schermo quando la partita è finita da un po’. Accendi «Mostra la foto dopo la partita», scegli la foto dalla libreria (prima caricala in «Immagini e video»; il collegamento «Carica nella libreria» ti ci porta), e scrivi i «Minuti dopo la fine della partita» (da 0 a 240, di solito 30). Passati quei minuti il link della diretta mostra la foto e, sopra, il conto alla rovescia della prossima partita del calendario, con le squadre, il giorno e l’ora; se non c’è una prossima partita resta solo la foto. Prende il posto della pausa di fine partita, non ha niente da toccare e funziona anche con «Touch: No». Con «Vedi nell’anteprima grande» la vedi a tutto schermo nell’anteprima, con una prossima partita d’esempio. Se «Dopo la partita» è spento o senza foto resta la schermata di «Fine partita». Nelle prove con la «Simulazione» la foto compare dopo 15 secondi dalla fine della partita (non dopo i minuti veri). Con «Togli foto» la togli; una foto in uso qui non si può eliminare.',
      },
      {
        kind: 'text',
        text: 'A lato c’è sempre l’anteprima. Puoi sceglierla per TV, tablet o telefono, e aprirla a tutto schermo con «Anteprima a tutto schermo». Quello che vedi lì è quello che vedranno i tifosi.',
      },
      {
        kind: 'text',
        text: 'Se in «Colori e loghi», sotto «Avanzate», scegli un altro «Modello grafico», colori e caratteri cambiano subito. Lo Studio ti chiede poi «Applicare anche la disposizione dei blocchi del modello?»: con «Sì, applica i blocchi del modello» la «Pagina live» prende i blocchi del modello su tutti i dispositivi (salvala per pubblicarli); con «No, tieni i blocchi attuali» resta com’è.',
      },
      {
        kind: 'text',
        text: 'Quando salvi una parte dello Studio, i tifosi che hanno già la pagina aperta vedono la nuova grafica entro pochi secondi, senza ricaricarla e senza perdere la partita.',
      },
      {
        kind: 'text',
        text: 'Gli sponsor si preparano nella pagina «Sponsor»: per ognuno scrivi il nome, se vuoi il sito (che inizia con https://) e dai al nome lo sponsor: le immagini si caricano in «Immagini e video» (menu «Pagina pubblica»), scegliendo lo sponsor, e qui compaiono da sole. Con ↑ e ↓ scegli l’ordine in cui ruotano. Le immagini caricate prima, senza sponsor, compaiono in «Immagini senza sponsor»: con «Assegna a» le dai a uno sponsor.',
      },
      {
        kind: 'text',
        text: 'Poi, nello «Studio grafico», nel blocco «Sponsor» della pagina live e nella diapositiva «Sponsor» delle pause spunta gli sponsor da mostrare. Con «Come mostrarli» scegli «Uno alla volta» (le immagini ruotano una dopo l’altra, ognuna per i «Secondi per immagine») oppure «Tutti in una pagina» (tutte le immagini insieme, in una griglia; nelle pause la pagina resta per i secondi della diapositiva). Se lo sponsor ha un sito, toccando l’immagine il tifoso lo apre. Uno sponsor scelto nella pagina o nelle pause non si può eliminare: prima toglilo da lì.',
      },
      {
        kind: 'text',
        text: 'Per portare tutta la grafica da un portale a un altro (colori, loghi, pagina live, pause, avvisi, sponsor scelti e immagini) apri lo «Studio grafico» e scegli la sezione «Esporta / Importa» (sotto «Avvisi»). Se hai modifiche non salvate, salvale prima di esportare: il file contiene solo la grafica già salvata. Con «Esporta configurazione» scarichi un file; con «Importa configurazione» scegli il file, controlli il riepilogo (club di origine, data, immagini, modello grafico) e confermi: la grafica attuale viene sostituita. Il file non contiene partite, utenti né link, né gli sfondi degli avvisi: quelli vanno caricati di nuovo. Un tema personalizzato lo può importare solo il superadmin.',
      },
      {
        kind: 'text',
        text: 'In «Avvisi», con «Modifica» su un avviso (per esempio «Ace»), alla voce «Sfondo» scegli «Nessuno», «Immagine» o «Video». I file si caricano nella pagina «Immagini e video» del menu (con «Carica immagine», PNG, JPEG, WebP o SVG, al massimo 2 MB, oppure «Carica video», MP4 o WebM, al massimo 15 MB; da «Avvisi» il collegamento «Carica nella libreria» ti ci porta); poi lo scegli dal menu dei file della libreria, dove ogni file compare con il suo nome, anche per altri avvisi. Per un video scegli anche «Audio» (spento di solito: se lo accendi si sente il sonoro, ma se il browser blocca l’audio il video parte muto), «Posizione del video» («Al centro», nel riquadro dell’avviso, oppure «A tutto schermo»), «Durata» (con «Secondi impostati», la scelta iniziale, l’avviso dura i secondi dell’avviso e il video riparte in ciclo; con «Quanto il video» l’avviso resta finché il video finisce, al massimo 30 secondi, e se la durata non si legge o il video non si vede dura i secondi impostati) e «Video per»: con «Solo la nostra squadra» (la scelta iniziale) gli avvisi della squadra avversaria escono senza video, con il solo testo, sia in casa sia in trasferta; con «Entrambe le squadre» il video compare per tutte e due. La nostra squadra è quella scelta in «Colori e loghi», scheda «Squadra»: se in una partita non la si riconosce, il video compare per entrambe. Un’immagine compare sempre, per entrambe le squadre. L’avviso diventa più grande, con lo sfondo dietro al testo e una velatura del colore della squadra. La pagina live scarica gli sfondi appena si apre, così il video parte subito; se non è ancora pronto l’avviso esce con il solo testo. Sul telefono il video non si mostra, e nemmeno a chi ha chiesto meno animazioni: lì l’avviso esce con il solo testo (o con lo sfondo immagine). Con «Prova» vedi l’avviso con lo sfondo nell’anteprima (l’audio si sente solo durante la prova). Un file usato come sfondo non si può eliminare: prima toglilo dall’avviso. Nella pagina «Immagini e video» (menu «Pagina pubblica»), dove carichi tutti i file, trovi tutte le immagini e i video caricati con nome, uso, misure e peso, e se sono «in uso» (loghi, sponsor, pause, sfondi degli avvisi): con «Rinomina» cambi il nome con cui compaiono negli elenchi e con «Elimina» togli quelli che non usi. I file caricati prima che si salvasse il nome compaiono con il giorno del caricamento e le misure, per esempio «Video del 23/10/2026 · 1920×1080».',
      },
    ],
    links: [
      { label: 'Vai a Studio grafico', to: '/admin/studio/colori' },
      { label: 'Vai a Sponsor', to: '/admin/sponsor' },
    ],
  },
  {
    id: 'link-qr',
    title: 'Link e QR',
    blocks: [
      { kind: 'text', text: 'Per far vedere la partita basta dare un link. Ce ne sono di due tipi:' },
      {
        kind: 'list',
        items: [
          'Il «Canale del club»: un solo link per tutte le partite. Prima della gara mostra «Prossima partita», poi la partita in diretta.',
          'Il link della singola partita: lo trovi nel «Calendario», accanto alla partita. In «Link pubblici» puoi anche creare «Una partita fissa».',
        ],
      },
      {
        kind: 'note',
        text: 'I link e i QR della singola partita ci sono solo se il superadmin li ha attivati per il tuo club. Se non sono attivi, nel «Calendario» leggi «Link per singola partita non attivi: usa il canale del club.» e resta il «Canale del club» con il suo QR. Se vengono disattivati, i link e i QR per partita già creati smettono di funzionare per sempre, anche quelli stampati.',
      },
      {
        kind: 'steps',
        items: [
          'Apri «Link pubblici» (o il «Calendario» per una partita).',
          'Premi «Copia link» e incollalo dove vuoi: messaggi, social, sito.',
          'Per la locandina o i social premi «Scarica QR (PNG)». Per la stampa in grande premi «Scarica QR (SVG)».',
        ],
      },
      {
        kind: 'note',
        text: 'Chi ha «Lettura e scrittura» può creare nuovi link e togliere quelli che non servono con «Revoca». Un link revocato smette di funzionare.',
      },
    ],
    links: [
      { label: 'Vai a Link pubblici', to: '/admin/link' },
      { label: 'Vai a Calendario', to: '/admin/calendario' },
    ],
  },
  {
    id: 'computer-datavolley',
    title: 'Il computer con DataVolley',
    needsWrite: true,
    blocks: [
      {
        kind: 'text',
        text: 'Sul computer dove si scrive la partita con DataVolley serve un piccolo programma, l’«agente». Legge la partita e la manda alla pagina pubblica. Lo si installa una volta sola.',
      },
      {
        kind: 'steps',
        items: [
          'Apri la pagina «Agenti» e premi «Scarica l’agente per Windows».',
          'Scompatta il file zip scaricato in C:\\ArenaLiveAgent. Non metterla sulla pennina.',
          'Fai doppio clic su arenalive-agent.exe: si apre la finestra dell’agente, con il nome e il logo del club.',
          'In «Nome agente» scrivi il nome del computer (per esempio «Palazzetto») e premi «Registra».',
          'Nella finestra compare un codice grande e la scritta «In attesa di abilitazione nel portale». La richiesta scade dopo un po’: la data e l’ora sono scritte lì.',
          'Su un altro schermo apri «Agenti», vai in «Richieste in attesa», controlla che il codice sia lo stesso e premi «Abilita».',
          'Dopo pochi secondi la finestra dice «Abilitato» e ti invita a premere START. L’agente si abilita da solo: non devi copiare nulla.',
          'Premi «Sfoglia…»: ti propone due scelte. «Scegli una cartella (il .dvw più recente)…» è la più comoda: indica la pennina USB o la cartella dove DataVolley salva la partita e l’agente prende da solo il file più recente. «Scegli un file .dvw…» serve se vuoi indicare una partita precisa.',
          'Premi START. Quando legge, la finestra dice «In lettura» seguito dal nome del file.',
        ],
      },
      {
        kind: 'note',
        text: 'Windows può avvisare che l’autore è sconosciuto. Non è un problema. Premi «Ulteriori informazioni» e poi «Esegui comunque».',
      },
      {
        kind: 'text',
        text: 'Se la richiesta scade o viene rifiutata, la finestra dice «Scaduta senza abilitazione: registra di nuovo» oppure «Rifiutata nel portale». Premi «Registra» e ricomincia. Con «Annulla» ritiri una richiesta in attesa.',
      },
      {
        kind: 'text',
        text: 'Se togli la pennina per sbaglio la finestra dice «In attesa del file .dvw» e l’agente riparte da solo quando la rimetti. Se manca internet la finestra dice «non raggiungibile»: le righe già scritte non si perdono e partono appena torna la connessione.',
      },
      {
        kind: 'text',
        text: 'A fine serata premi STOP. Le volte dopo basta aprire l’agente e premere START. Se chiudi la finestra mentre legge, ti chiede se vuoi davvero fermare la lettura.',
      },
      {
        kind: 'note',
        text: 'Se vuoi che l’agente parta da solo quando si accende il computer, chiedi a chi cura i computer del club: è una cosa da fare una volta sola.',
      },
    ],
    links: [{ label: 'Vai a Agenti', to: '/admin/agenti' }],
  },
  {
    id: 'prova',
    title: 'Prova prima della partita',
    needsWrite: true,
    blocks: [
      {
        kind: 'text',
        text: 'Con «Simulazione» vedi una partita finta sulla pagina pubblica, senza aspettare una gara vera. Non finisce nel calendario, nelle partite o nelle statistiche.',
      },
      {
        kind: 'steps',
        items: [
          'Apri «Simulazione».',
          'In «Nuova simulazione» scegli la partita, i set da giocare e la velocità.',
          'Premi «Avvia».',
          'In «Link della simulazione» apri il link, o inquadra il QR con il telefono.',
        ],
      },
      {
        kind: 'text',
        text: 'Per la TV: apri il link sul computer o sulla TV e premi «Schermo intero». Su tablet e telefono puoi premere «Installa come app»: la pagina si apre come un’app, a tutto schermo.',
      },
    ],
    links: [{ label: 'Vai a Simulazione', to: '/admin/simulazione' }],
  },
  {
    id: 'giorno-partita',
    title: 'Il giorno della partita',
    blocks: [
      { kind: 'text', text: 'Controlla queste cose, una dopo l’altra:' },
      {
        kind: 'steps',
        items: [
          'La partita è nel «Calendario» e il suo link è attivo (non deve dire «Link non attivo»).',
          'Il computer con DataVolley è acceso e la pennina è inserita.',
          'L’agente è aperto e hai premuto START: in «Agenti» l’«Ultimo contatto» dell’agente deve essere di pochi secondi fa.',
          'La pagina pubblica è aperta sulla TV, a schermo intero.',
          'Il link o il QR è condiviso con i tifosi.',
        ],
      },
      {
        kind: 'text',
        text: 'Quando DataVolley inizia a scrivere la partita, il punteggio compare da solo. Non devi fare altro.',
      },
    ],
    links: [
      { label: 'Vai a Partita live', to: '/admin/live' },
      { label: 'Vai a Agenti', to: '/admin/agenti' },
    ],
  },
  {
    id: 'utenti',
    title: 'Utenti',
    needsWrite: true,
    blocks: [
      { kind: 'text', text: 'Nella pagina «Utenti» scegli chi può entrare. Ci sono due ruoli:' },
      {
        kind: 'list',
        items: [
          '«Lettura e scrittura»: gestisce tutto il club.',
          '«Sola lettura»: guarda partite, calendario, «Visualizzazioni», link, club e agenti, ma non cambia nulla.',
        ],
      },
      {
        kind: 'steps',
        items: [
          'Apri «Utenti».',
          'In «Nuovo utente» scrivi l’email e scegli il ruolo. Lascia vuota la password.',
          'Premi «Crea e invita»: la persona riceve un’email con il link per scegliere la password.',
        ],
      },
      {
        kind: 'text',
        text: 'Se l’invito non è stato usato, accanto all’utente trovi «Invia di nuovo» per mandarlo ancora e «Annulla invito» per toglierlo. Per fermare l’accesso a qualcuno premi «Disattiva»; con «Riattiva» può tornare. Nel club deve restare sempre almeno una persona con «Lettura e scrittura».',
      },
    ],
    links: [{ label: 'Vai a Utenti', to: '/admin/utenti' }],
  },
  {
    id: 'statistiche',
    title: 'Statistiche delle visite',
    blocks: [
      {
        kind: 'text',
        text: 'La pagina «Visualizzazioni» dice quante persone guardano le partite. Ecco cosa significano i numeri:',
      },
      {
        kind: 'list',
        items: [
          '«Visite»: quante volte è stata aperta la pagina pubblica.',
          '«Picco spettatori»: il massimo di persone collegate nello stesso momento.',
          '«Durata media»: per quanto tempo, in media, una persona è rimasta sulla pagina.',
          '«Da QR»: le visite arrivate inquadrando un QR. Le altre sono arrivate da un link.',
          '«Maxischermo», «Tablet», «Smartphone», «App installata»: con quale dispositivo guardano.',
        ],
      },
      {
        kind: 'text',
        text: 'Con «Periodo» scegli i giorni da guardare. Le simulazioni non sono contate. Con «Esporta CSV» ottieni i numeri in un foglio da aprire con Excel.',
      },
    ],
    links: [{ label: 'Vai a Visualizzazioni', to: '/admin/statistiche' }],
  },
  {
    id: 'superadmin',
    title: 'Per chi gestisce più club (superadmin)',
    superadminOnly: true,
    blocks: [
      {
        kind: 'text',
        text: 'Il tuo menu ha solo le pagine di gestione. Per lavorare dentro un club devi prima entrarci.',
      },
      {
        kind: 'steps',
        items: [
          'Apri «Clienti».',
          'Per un nuovo club premi «Nuovo cliente» e scrivi «Nome», «Identificativo» e «Hostname» (l’indirizzo web del cliente). Se vuoi, aggiungi l’email del primo utente: riceve l’invito.',
          'Per lavorare in un club premi «Entra nel cliente». In alto compare una barra con il nome del club.',
          'Per dare a un club i link e i QR di ogni partita premi «Modifica» e, in «Link e QR per singola partita», premi «Attiva». Di base un club ha solo il «Canale del club». «Disattiva» chiede conferma: i link e i QR per partita già creati vengono revocati per sempre; se li riattivi, ogni partita riceve un link e un QR nuovi.',
          'Quando hai finito premi «Esci dal cliente».',
        ],
      },
      {
        kind: 'list',
        items: [
          '«Campionati»: i campionati della Lega, uguali per tutti i club. Si aggiornano da soli.',
          '«Posta»: l’indirizzo da cui partono le email di invito e di recupero password. Con «Invia una mail di prova» controlli che funzioni.',
          '«Loghi di sistema»: due loghi della piattaforma, uno a sinistra e uno a destra, ciascuno in due versioni: «Positivo · per sfondi chiari» e «Negativo · per sfondi scuri». Il portale sceglie da solo la versione adatta allo sfondo (colori del club, modello grafico, tema chiaro o scuro) e, se ne manca una, usa l’altra. Il logo a sinistra compare in alto nel menu dell’area riservata, al posto del logo del club; entrambi compaiono in alto nella pagina live di tutti i club. Con «Carica logo» scegli l’immagine (PNG, JPEG, WebP o SVG, al massimo 150×50 px: una più grande viene rifiutata), con «Sostituisci logo» la cambi e con «Rimuovi» la togli. I club non li possono cambiare; senza loghi le testate restano come sono.',
          'Temi personalizzati: entra nel cliente, apri «Studio grafico», poi «Colori e loghi» e «Avanzate». In «Modello grafico» vedi anche i temi personalizzati e scegli quello da dare al club. I club normali non li vedono.',
          '«Il mio account»: cambi la tua password, anche senza entrare in un club.',
        ],
      },
    ],
    links: [
      { label: 'Vai a Clienti', to: '/admin/clienti' },
      { label: 'Vai a Campionati', to: '/admin/campionati' },
      { label: 'Vai a Posta', to: '/admin/posta' },
      { label: 'Vai a Loghi di sistema', to: '/admin/loghi-di-sistema' },
      { label: 'Vai a Il mio account', to: '/admin/account' },
    ],
  },
  {
    id: 'domande',
    title: 'Domande frequenti e problemi comuni',
    blocks: [
      { kind: 'text', text: 'La pagina non si aggiorna.' },
      {
        kind: 'list',
        items: [
          'Guarda il segno in alto: durante la partita deve dire «In diretta». Se dice «Riconnessione…» aspetta qualche secondo.',
          'Se resta così, controlla che il telefono o la TV abbiano internet e ricarica la pagina.',
          'Controlla che l’agente sia aperto e con START premuto.',
        ],
      },
      { kind: 'text', text: 'L’agente risulta offline.' },
      {
        kind: 'list',
        items: [
          'Apri «Agenti» e guarda l’«Ultimo contatto»: se è vecchio, l’agente non sta parlando. Controlla che il computer con DataVolley sia acceso e abbia internet.',
          'Controlla che la pennina sia inserita.',
          'Apri l’agente e premi START. Le righe già scritte non si perdono: partono appena torna la connessione.',
        ],
      },
      { kind: 'text', text: 'La data della partita è sbagliata.' },
      {
        kind: 'list',
        items: [
          'Nel «Calendario» apri la partita e cambia data e ora a mano.',
          'Per tornare a quella del sito della Lega premi «Torna alla data ufficiale».',
        ],
      },
      { kind: 'text', text: 'Non arriva l’email di invito.' },
      {
        kind: 'list',
        items: [
          'Guarda tra la posta indesiderata.',
          'Controlla che l’email sia scritta giusta in «Utenti».',
          'Premi «Invia di nuovo». Se l’email non parte, compare un link da copiare: mandalo alla persona a mano.',
        ],
      },
      { kind: 'text', text: 'Non trovo una pagina del menu.' },
      {
        kind: 'list',
        items: [
          'Con il ruolo «Sola lettura» alcune pagine (come «Studio grafico», «Simulazione» e «Utenti») non ci sono. Chiedi a chi ha «Lettura e scrittura».',
        ],
      },
    ],
  },
];

/** Words of a text without accents, in lower case: to compare what the user types with the guide. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Every text of a section (title, paragraphs, steps, notes, link names) as one string. */
export function sectionText(section: GuideSection): string {
  const parts: string[] = [section.title];
  for (const b of section.blocks) {
    if (b.kind === 'steps' || b.kind === 'list') parts.push(...b.items);
    else parts.push(b.text);
  }
  for (const l of section.links ?? []) parts.push(l.label);
  return parts.join(' ');
}

/**
 * Pure: the sections where every word of `query` appears (accents and case ignored). An empty query gives all of
 * them. The superadmin section is left out unless `superadmin`.
 */
export function filterSections(sections: readonly GuideSection[], query: string, superadmin: boolean): GuideSection[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return sections.filter((s) => {
    if (s.superadminOnly && !superadmin) return false;
    const text = normalize(sectionText(s));
    return words.every((w) => text.includes(w));
  });
}
