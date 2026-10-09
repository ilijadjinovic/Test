# Kontrolne table Naručioca i Isporučioca — izmene, instalacija i testiranje

## 1. Šta je novo

**Kartice (obe table)**
- Naručilac: *Čeka moju potvrdu*, *Reklamacije*, *Kasne*, *U nabavci*, *Danas završeno*, *Moje narudžbine*.
- Isporučilac: *Čeka prihvatanje*, *Reklamacije*, *Kasne*, *Aktivne isporuke*, *U nabavci*, *Danas završeno*.
- Kartice koje traže reakciju (čeka prihvatanje / potvrdu, reklamacije) kad je broj veći od nule dobijaju obojenu ivicu, znak „!“ i blago pulsiranje (isključuje se ako korisnik u sistemu ima uključeno „smanji kretanje“). Klik na karticu filtrira tabelu, drugi klik ukida filter.

**„Kasne“ (kartica zadržava naziv)**
- Hitna narudžbina kasni posle **2 sata**, standardna posle **24 sata**, računato **od trenutka dodele isporučiocu** (kalendarsko vreme).
- Ne računaju se: nedodeljene, `isporucena` (ide u *Čeka moju potvrdu*), `reklamacija` (ima svoju karticu), zatvorene i odbijene.
- U redu tabele stoji oznaka „kasni 3h 20min“. Brojke se preračunavaju lokalno na svaki minut (bez čitanja iz baze, pauzira se kad je kartica browsera u pozadini). Stanje narudžbina uvek dolazi uživo iz baze, pa čim neko na drugom uređaju promeni status, narudžbina ispadne iz „Kasne“ i na ovom uređaju.
- Ista funkcija (`isLate`) koristi se i na Admin tabli, pa „Kasne“ svuda znači isto.

**Akcije u redu tabele**
- Isporučilac: *Prihvati* / *Odbij* za narudžbine u statusu „Čeka prihvatanje“ (isti `acceptOrder`/`rejectOrder` i isto pitanje za razlog kao u detaljima).
- Naručilac: *Potvrdi prijem* za status „Isporučena“ — brza potvrda **da je sva roba primljena u celosti** (zatvara narudžbinu i potvrđuje sve lokacije isporuke). Ako nešto nedostaje, naručilac otvara detalje (unos količina, prenos manjka, reklamacija).
- Naručilac: *Ponovi narudžbinu* za odbijene — pravi **novu** narudžbinu sa istim stavkama, lokacijama, prioritetom i „ko je tražio“, dodeljenu istom isporučiocu. Originalna odbijena ostaje u istoriji i dobija link „Ponovljena: NAR-…“ (nema dupliranja).
- Odbijene narudžbine su u tabeli naručioca crvene, sa razlogom ispod statusa.
- Reklamacije se i dalje rešavaju u detaljima (traže napomenu o rešenju).

**Lista, paginacija i 30 dana**
- Podrazumevano: sve otvorene + zatvorene/odbijene iz poslednjih 30 dana (računato od zatvaranja). Otvorene narudžbine nikad ne nestaju, ma koliko stare bile.
- 25 redova odjednom, dugme **Učitaj još**; kad se iscrpi lista iz memorije, dovlače se starije zatvorene iz baze po datumu zatvaranja (po 25).
- Isporučilac: podrazumevano samo aktivne, dugme **Prikaži sve** dodaje zatvorene i odbijene.

**Pretraga cele istorije**
- Polje traži po delu reči (bez obzira na č/ć/š/ž/đ): broj narudžbine, naziv i šifra artikla, dobavljač, lokacija isporuke, naručilac, isporučilac, „ko je tražio“. Više reči = sve moraju da se poklope.
- Ispod polja su **dugmići-filteri**: statusi u dva reda, prioriteti u trećem. Klik uključuje/isključuje filter (može više njih odjednom, npr. „Zatvorena“ + „Odbijena“) i primena je automatska.
- Datum kreiranja „Od“ / „Do“ koristi isti datepicker kao ostatak aplikacije (format dd.mm.gggg., kalendar se otvara na klik ili se datum ukuca). Primena je automatska čim se datum izabere/ukuca; pored polja je i dugme **Primeni**. Ikona kalendara je sada veća i svetlija (važi za sva polja sa kalendarom u aplikaciji). **Poništi** briše tekst, dugmiće i datume.
- Pretraga čita celu istoriju tog korisnika (do 5000 narudžbina, jednom, pa se pamti 5 minuta), pa pronalazi i narudžbine starije od 30 dana.

**Isporučilac — tabela**
- Nove kolone: *Lokacija isporuke*, *Dobavljači*, *Dodeljena*. Redosled: čeka prihvatanje, reklamacije, kasne, hitne, ostalo (najstarije prve), zatvorene.
- Na telefonu tabela se skroluje levo-desno sa „zalepljenom“ prvom kolonom (broj), a dugmad za akcije su odmah u drugoj koloni i imaju veću površinu dodira.

**Ostalo**
- Potvrda prijema je sada **jedan upis** (direktno `zatvorena`) umesto dva.
- „Danas završeno“ koristi vremensku zonu Europe/Belgrade i sam se resetuje u ponoć.
- Izveštaji filtriraju period direktno u bazi (ranije su se učitavale samo poslednje 500 narudžbina, pa su stariji periodi bili nepotpuni); izvoz podataka sada obuhvata do 5000 narudžbina.
- Sve nove poruke prevedene su na srpski i engleski (`i18n/sr.json`, `i18n/en.json`).
- Kartice i redovi su dostupni tastaturom (Tab, Enter/Space); fokus se ne gubi pri osvežavanju.

## 2. Spisak fajlova

| Fajl | Izmena |
|---|---|
| `js/dash-logic.js` | **novo** — čista logika: kasne, pretraga, sortiranje |
| `js/dash-common.js` | **novo** — zajednički kontroler table (kartice, tabela, paginacija, pretraga, akcije, tajmer) |
| `js/page-dash-narucilac.js`, `js/page-dash-isporucilac.js` | prepisano preko zajedničkog modula |
| `narucilac-dashboard.html`, `isporucilac-dashboard.html` | pretraga, pager, dugme „Prikaži sve“ |
| `js/orders.js` | `assignedAt`, `closedAt` pri odbijanju, polja za pretragu, jednoprolazna potvrda prijema, `confirmReceiptFull`, `repeatOrderAfterRejection`, nove liste |
| `js/page-dash-admin.js` | samo pravilo „Kasne“ + minutni preračun |
| `js/reports.js` | period se filtrira u bazi, bez granice od 500 |
| `js/firebase-init.js` | izvezen `startAfter` |
| `firestore.indexes.json` | dva nova indeksa (`createdByUid+closedAt`, `assignedToUid+closedAt`) |
| `css/style.css` | stilovi kartica sa podsetnikom, pretrage, akcija |
| `i18n/sr.json`, `i18n/en.json` | 42 nova ključa |
| `backfill-orders.html`, `js/page-backfill.js` | **novo** — jednokratna dopuna starih narudžbina |
| `tests/dash-logic.test.mjs` | **novo** — automatski testovi logike |

## 3. Instalacija (redom)

1. **Otpremi fajlove** (Firebase Hosting ili gde god hostuješ aplikaciju). Pravila baze (`firestore.rules`) se ne menjaju.
2. **Indeksi:** `firebase deploy --only firestore:indexes` pa sačekaj da u Firebase konzoli (Firestore → Indexes) oba nova indeksa budu *Enabled* (traje od nekoliko sekundi do nekoliko minuta). Dok se ne završe, liste zatvorenih narudžbina prijavljuju grešku „potreban indeks“.
3. **Dopuna starih narudžbina:** prijavi se kao **Admin firme** i otvori `backfill-orders.html`. Prvo pokreni sa uključenim „Samo prebroj“, pa isključi i pokreni upis. Dopunjava polja za pretragu, `assignedAt` (= vreme kreiranja) i `closedAt` (= vreme potvrde/izmene). Bezbedno je pokrenuti više puta. **Bez ovog koraka** stare zatvorene i odbijene narudžbine neće biti na listama (nemaju `closedAt`), a pretraga po artiklu ih neće naći po nazivu artikla (naći će ih po broju i imenima).
4. Osveži stranicu (Ctrl+F5 / povuci za osvežavanje na telefonu) da se učitaju novi fajlovi.

Automatski testovi logike: `node tests/dash-logic.test.mjs` (Node 18+).

## 4. Scenariji za testiranje

Pripremi bar jednog naručioca, jednog isporučioca i admina. Za vremenska pravila najlakše je koristiti stare narudžbine iz baze ili privremeno u konzoli izmeniti `assignedAt`.

| # | Uloga | Koraci | Očekivano |
|---|---|---|---|
| 1 | Isporučilac | Naručilac napravi narudžbinu dodeljenu tom isporučiocu. Otvori tablu isporučioca. | Kartica „Čeka prihvatanje“ = 1, obojena i pulsira; narudžbina je prvi red; u koloni Akcije su *Prihvati* i *Odbij*. |
| 2 | Isporučilac | Klikni *Prihvati*. | Toast „Narudžbina prihvaćena“, status „U nabavci“, kartica „Čeka prihvatanje“ pada na 0, naručilac dobija notifikaciju. |
| 3 | Isporučilac | Nova narudžbina → *Odbij* → ostavi prazno / upiši razlog; probaj i „Otkaži“ u prozoru. | Sa razlogom: status „Odbijena“, nestaje iz aktivnih. Otkaži: ništa se ne menja. |
| 4 | Isporučilac | Klikni *Prikaži sve*. | Pojavljuju se zatvorene i odbijene (≤30 dana). Tekst dugmeta postaje „Samo aktivne“. |
| 5 | Naručilac | Odbijena narudžbina u tabeli. | Crven red, razlog ispod statusa, dugme *Ponovi narudžbinu*. |
| 6 | Naručilac | Klikni *Ponovi narudžbinu* → potvrdi. | Nova narudžbina (iste stavke, lokacije, prioritet, „ko je tražio“) kod istog isporučioca u „Čeka prihvatanje“; kod originala umesto dugmeta stoji „Ponovljena: NAR-…“; ponovo ne može. |
| 7 | Naručilac | Isporučilac isporuči narudžbinu (status „Isporučena“). | Kartica „Čeka moju potvrdu“ = 1 (pulsira), red je na vrhu sa dugmetom *Potvrdi prijem*; **ne** računa se u „Kasne“ čak ni ako je hitna i stara. |
| 8 | Naručilac | *Potvrdi prijem* → potvrdi pitanje. | Status „Zatvorena“ (jedan upis, bez prelaznog statusa), kartica „Danas završeno“ +1, lokacije isporuke u detaljima su potvrđene. |
| 9 | Naručilac | U detaljima otvori reklamaciju na neku narudžbinu. | Kartica „Reklamacije“ = 1 (crvena, pulsira) kod naručioca **i** isporučioca. Ne računa se u „Kasne“. |
| 10 | Oba | Hitna narudžbina dodeljena pre 1h50, sačekaj 10+ min (ili izmeni `assignedAt`). | Posle isteka 2h kartica „Kasne“ poraste za 1 bez osvežavanja stranice i u redu se pojavi „kasni X min“. Standardna: granica 24h. |
| 11 | Oba, 2 uređaja | Kasna narudžbina vidljiva na dva uređaja; na jednom je isporučilac završi (status „Isporučena“). | Na drugom uređaju odmah ispada iz „Kasne“ (bez osvežavanja). |
| 12 | Oba | Nedodeljena (admin_bira, još bez isporučioca) hitna stara narudžbina. | Ne računa se kao „kasna“ dok nije dodeljena; kad se dodeli, brojanje kreće od tog trenutka. |
| 13 | Naručilac | Imaj >25 narudžbina. | Prikazano prvih 25, „Prikazano 25 od N“, *Učitaj još* dodaje po 25; kad se iscrpi, učitava starije zatvorene po datumu; kad nema više, dugme nestaje. |
| 14 | Naručilac | Zatvorena narudžbina starija od 30 dana. | Nije na podrazumevanoj listi; pojavi se pri *Učitaj još* (naručilac) odnosno *Prikaži sve → Učitaj još* (isporučilac), i u pretrazi. Otvorena narudžbina starija od 30 dana **ostaje** na listi. |
| 15 | Oba | Pretraga: „cem“ (deo naziva artikla), pa naziv dobavljača, naziv lokacije, ime isporučioca/naručioca, „ko je tražio“, deo broja narudžbine. | Pronalazi odgovarajuće narudžbine, uključujući starije od 30 dana; unos „ćelik“ nalazi i „celik“. Statusna linija: „Pronađeno narudžbina: N“. |
| 16 | Oba | Klikni dugmiće statusa (npr. „Zatvorena“ + „Odbijena“) i prioriteta, izaberi datume „Od/Do“ iz kalendara (ikona desno u polju) ili ih ukucaj; zatim *Poništi*. | Lista se filtrira odmah, bez dodatnog klika (dugme *Primeni* radi isto na zahtev). Statusi se unutar grupe „ili“, grupe se međusobno kombinuju („i“). *Poništi* vraća običan prikaz. Klik na karticu tokom pretrage gasi pretragu. |
| 17 | Naručilac | Napravi novu narudžbinu, dodaj artikal u dozvoljenom statusu, pa ga pretraži. | Novi artikal se odmah može pronaći (polje za pretragu se osvežava pri izmeni stavki, lokacija i „ko je tražio“). |
| 18 | Admin | Admin tabla, kartica „Kasne“. | Isti broj kao zbir kasnih na tablama isporučilaca (isto pravilo). |
| 19 | Admin | Izveštaji za period stariji od ~500 narudžbina unazad. | Sve narudžbine iz izabranog perioda su uključene (ranije nepotpuno). |
| 20 | Telefon (isporučilac) | Otvori tablu na telefonu (≤700 px). | Kartice 2 u redu; tabela se skroluje levo-desno, broj narudžbine ostaje zalepljen, *Prihvati/Odbij* su odmah desno od broja i dovoljno veliki za dodir. |
| 21 | Tastatura | Tab kroz kartice i redove. | Kartica se bira Enter/Space, red se otvara sa Enter, fokus ostaje na kartici posle osvežavanja brojki. |
| 22 | Jezik | Prebaci na engleski. | Svi novi natpisi, dugmad, poruke i status linije su na engleskom. |

## 5. Poznate napomene

- **Odbijene i zatvorene pre ove izmene** nemaju `closedAt` dok se ne pokrene dopuna (korak 3 instalacije).
- Stare narudžbine nemaju trenutak dodele — za njih se kašnjenje računa od kreiranja (dopuna im upisuje `assignedAt = createdAt`).
- Dugme *Ponovi narudžbinu* pravi novu narudžbinu (novi broj); ako preferiraš da se ista narudžbina vrati na „Čeka prihvatanje“, to je mala izmena u `repeatOrderAfterRejection`.
- Pretraga čita celu istoriju korisnika jednom po pokretanju (do 5000 narudžbina). Za više od toga potrebna je serverska pretraga (npr. Algolia/Typesense) — za očekivani obim nije potrebno.
- Master Admin stranica nije menjana.
