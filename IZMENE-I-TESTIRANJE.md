# Kontrolne table Naručioca i Isporučioca — izmene, instalacija i testiranje

## 1. Šta je novo

**Kartice (obe table)**
- Naručilac: *Čeka izbor isporučioca* (status „kreirana“ — naručilac sam bira isporučioca), *Čeka moju potvrdu*, *Reklamacije*, *Kasne*, *U nabavci*, *Danas završeno*, *Moje narudžbine*.
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

**Lista, ukupan broj i paginacija (naručilac, isporučilac, admin)**
- **Y = ukupan broj narudžbina** (svi statusi, svi datumi) dolazi iz baze (brojanje po `createdByUid` / `assignedToUid`, a za admina cela firma). Ne zavisi od `closedAt` ni od backfill-a. Kartica **Moje narudžbine** i „Prikazano X od Y“ na dnu tabele prikazuju isti broj.
- Podrazumevani prikaz: ono što **zahteva pažnju** je uvek na vrhu (bez obzira na starost), ispod je ostalo po datumu kreiranja (najnovije prve), otvorene i zatvorene izmešano.
- Lista se puni u **turama od 30** po datumu kreiranja. **Učitaj još** povlači sledećih 30 iz baze i dodaje ih na kraj, do poslednje. „Prikazano“ je uvek tačan broj redova na ekranu; kad se sve učita, X = Y.
- Otvorene narudžbine se prate uživo; zatvorene u poslednja 2 dana takođe (zbog kartice *Danas završeno*). Ukupan broj se osvežava kad se pojavi nova ili nestane neka narudžbina.
- **Kad je aktivan filter** (kartica ili pretraga/filteri), Y je broj narudžbina koje odgovaraju tom kriterijumu (npr. „Prikazano 3 od 3“), a lista se otkriva po 30 iz memorije. Broj na kartici i Y uvek se slažu.
- Isporučilac: podrazumevano samo aktivne (Y = broj aktivnih), **Prikaži sve** prelazi na prikaz svih po turama (Y = ukupno dodeljenih).
- Admin: kartice (aktivne, kasne, u nabavci, danas završeno) računaju se iz otvorenih + danas zatvorenih (ranije iz poslednjih 200 narudžbina), tabela ima isti „Učitaj još“.
- **Admin pretraga** radi u bazi, po **početku** broja narudžbine (broj je oblika `NAR-20261010-37/26`): „NAR-202610“ ili samo „202610“ daje sve iz oktobra 2026, a pun broj daje tačno tu narudžbinu. Nema učitavanja istorije ni granice od 5000 (najviše 500 rezultata, uz poruku). Deo iz sredine broja (npr. samo „37“) se ne pronalazi.
- **Admin metrike su tačne za celu firmu:** *Prosečno vreme obrade* je agregacija u bazi (`average`) nad poljem `processingMs` svih zatvorenih narudžbina; *Procenat uspešne nabavke* = reklamacije (trenutno otvorene) u odnosu na ukupan broj narudžbina iz baze. Polje `processingMs` upisuje se pri potvrdi prijema (razlika `confirmedAt − createdAt`, iz vremena servera); za stare narudžbine ga dopunjuje `backfill-orders.html`. **Do backfill-a prosek obuhvata samo narudžbine zatvorene posle ove izmene.**

**Pretraga cele istorije**
- Polje traži po delu reči (bez obzira na č/ć/š/ž/đ): broj narudžbine, naziv i šifra artikla, dobavljač, lokacija isporuke, naručilac, isporučilac, „ko je tražio“. Više reči = sve moraju da se poklope.
- U panelu **Filteri** je **jedan red od 4 dugmeta**: *Aktivne · Zatvorene · Odbijene · Hitne*. Ishodi (Aktivne / Zatvorene / Odbijene) se sabiraju („ili“), a *Hitne* se kombinuju sa njima („i“). Klik uključuje/isključuje filter, primena je automatska. Statusi koje već pokrivaju kartice i blok „Zahteva pažnju“ (isporučena, reklamacija, čeka prihvatanje, u nabavci…) nisu posebni filteri.
- Dugmići, datumi i dugme „Poništi“ nalaze se u panelu koji se otvara dugmetom **Filteri** pored polja za pretragu (podrazumevano je uvučen da ne zauzima mesto). Na dugmetu je broj uključenih filtera, pa se vidi da filtriranje traje i kad je panel uvučen. Polje za tekst pretrage je stalno vidljivo.
- Datum kreiranja „Od“ / „Do“ koristi isti datepicker kao ostatak aplikacije (format dd.mm.gggg., kalendar se otvara na klik ili se datum ukuca). Primena je automatska čim se datum izabere ili ukuca (dugme „Primeni“ je uklonjeno). Pored polja su **prečice za period**: *Ovaj mesec*, *Prošli mesec*, *Poslednjih 90 dana* — klik postavlja „Od/Do“ i odmah filtrira, ponovni klik na izabranu prečicu briše period, a ručna izmena datuma gasi njeno isticanje. Ikona kalendara je velika i svetla (važi za sva polja sa kalendarom u aplikaciji).
- Pretraga čita istoriju tog korisnika (do 5000 narudžbina, jednom, pa se pamti 5 minuta), pa pronalazi i najstarije narudžbine. **Ako su zadati „Od/Do“, baza vraća samo narudžbine kreirane u tom periodu**, pa se ne učitava cela istorija (keš je vezan za period).

**Blok „Zahteva pažnju“ (obe table)**
- Narudžbine koje su na vrhu iz razloga, a ne zbog datuma, odvojene su od ostalih: oznaka „Zahteva pažnju“ iznad, žuta leva ivica i blaga pozadina na redovima, debela žuta linija ispod poslednjeg i oznaka „Ostale narudžbine“ ispod nje. Ostale su sortirane po datumu.
- Naručilac: čeka izbor isporučioca (`kreirana`), čeka potvrdu, reklamacije, kasne. Isporučilac: čeka prihvatanje, reklamacije, kasne, hitne.
- Grupisanje se ne prikazuje dok je izabrana kartica-filter ili aktivna pretraga (lista je tada jedna celina).

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
| `js/orders.js` | `assignedAt`, `closedAt` pri odbijanju, polja za pretragu, jednoprolazna potvrda prijema, `confirmReceiptFull`, `repeatOrderAfterRejection`, nove liste (`getOrdersPageBy`, `countOrdersBy`) |
| `js/page-dash-admin.js` | pravilo „Kasne“, minutni preračun, ukupan broj + ture „Učitaj još“, pretraga cele istorije |
| `js/reports.js` | period se filtrira u bazi, bez granice od 500 |
| `js/firebase-init.js` | izvezen `startAfter` |
| `firestore.indexes.json` | dva nova indeksa (`createdByUid+closedAt`, `assignedToUid+closedAt`) |
| `css/style.css` | stilovi kartica sa podsetnikom, pretrage, akcija |
| `i18n/sr.json`, `i18n/en.json` | 52 nova ključa |
| `backfill-orders.html`, `js/page-backfill.js` | **novo** — jednokratna dopuna starih narudžbina |
| `tests/dash-logic.test.mjs` | **novo** — automatski testovi logike |

## 3. Instalacija (redom)

1. **Otpremi fajlove** (Firebase Hosting ili gde god hostuješ aplikaciju). Pravila baze (`firestore.rules`) se ne menjaju.
2. **Indeksi:** `firebase deploy --only firestore:indexes` pa sačekaj da u Firebase konzoli (Firestore → Indexes) oba nova indeksa budu *Enabled* (traje od nekoliko sekundi do nekoliko minuta). Dok se ne završe, liste zatvorenih narudžbina (kartica „Danas završeno“) prijavljuju grešku „potreban indeks“.
3. **Dopuna starih narudžbina:** prijavi se kao **Admin firme** i otvori `backfill-orders.html`. Prvo pokreni sa uključenim „Samo prebroj“, pa isključi i pokreni upis. Dopunjava polja za pretragu, `assignedAt` (= vreme kreiranja), `closedAt` (= vreme potvrde/izmene) i `processingMs` (vreme obrade, za tačan prosek na Admin tabli). Bezbedno je pokrenuti više puta. **Bez ovog koraka** stare zatvorene i odbijene narudžbine neće biti na listama (nemaju `closedAt`), a pretraga po artiklu ih neće naći po nazivu artikla (naći će ih po broju i imenima).
4. Osveži stranicu (Ctrl+F5 / povuci za osvežavanje na telefonu) da se učitaju novi fajlovi.

Automatski testovi logike: `node tests/dash-logic.test.mjs` (Node 18+).

## 4. Scenariji za testiranje

Pripremi bar jednog naručioca, jednog isporučioca i admina. Za vremenska pravila najlakše je koristiti stare narudžbine iz baze ili privremeno u konzoli izmeniti `assignedAt`.

| # | Uloga | Koraci | Očekivano |
|---|---|---|---|
| 1 | Isporučilac | Naručilac napravi narudžbinu dodeljenu tom isporučiocu. Otvori tablu isporučioca. | Kartica „Čeka prihvatanje“ = 1, obojena i pulsira; narudžbina je prvi red; u koloni Akcije su *Prihvati* i *Odbij*. |
| 2 | Isporučilac | Klikni *Prihvati*. | Toast „Narudžbina prihvaćena“, status „U nabavci“, kartica „Čeka prihvatanje“ pada na 0, naručilac dobija notifikaciju. |
| 3 | Isporučilac | Nova narudžbina → *Odbij* → ostavi prazno / upiši razlog; probaj i „Otkaži“ u prozoru. | Sa razlogom: status „Odbijena“, nestaje iz aktivnih. Otkaži: ništa se ne menja. |
| 4 | Isporučilac | Klikni *Prikaži sve*. | Pojavljuju se zatvorene i odbijene, po turama od 30; „Prikazano X od Y“ prikazuje ukupan broj dodeljenih. Tekst dugmeta postaje „Samo aktivne“. |
| 5 | Naručilac | Odbijena narudžbina u tabeli. | Crven red, razlog ispod statusa, dugme *Ponovi narudžbinu*. |
| 6 | Naručilac | Klikni *Ponovi narudžbinu* → potvrdi. | Nova narudžbina (iste stavke, lokacije, prioritet, „ko je tražio“) kod istog isporučioca u „Čeka prihvatanje“; kod originala umesto dugmeta stoji „Ponovljena: NAR-…“; ponovo ne može. |
| 7 | Naručilac | Isporučilac isporuči narudžbinu (status „Isporučena“). | Kartica „Čeka moju potvrdu“ = 1 (pulsira), red je na vrhu sa dugmetom *Potvrdi prijem*; **ne** računa se u „Kasne“ čak ni ako je hitna i stara. |
| 8 | Naručilac | *Potvrdi prijem* → potvrdi pitanje. | Status „Zatvorena“ (jedan upis, bez prelaznog statusa), kartica „Danas završeno“ +1, lokacije isporuke u detaljima su potvrđene. |
| 9 | Naručilac | U detaljima otvori reklamaciju na neku narudžbinu. | Kartica „Reklamacije“ = 1 (crvena, pulsira) kod naručioca **i** isporučioca. Ne računa se u „Kasne“. |
| 10 | Oba | Hitna narudžbina dodeljena pre 1h50, sačekaj 10+ min (ili izmeni `assignedAt`). | Posle isteka 2h kartica „Kasne“ poraste za 1 bez osvežavanja stranice i u redu se pojavi „kasni X min“. Standardna: granica 24h. |
| 11 | Oba, 2 uređaja | Kasna narudžbina vidljiva na dva uređaja; na jednom je isporučilac završi (status „Isporučena“). | Na drugom uređaju odmah ispada iz „Kasne“ (bez osvežavanja). |
| 12 | Oba | Nedodeljena (admin_bira, još bez isporučioca) hitna stara narudžbina. | Ne računa se kao „kasna“ dok nije dodeljena; kad se dodeli, brojanje kreće od tog trenutka. |
| 13 | Naručilac | Imaj >30 narudžbina. | Kartica *Moje narudžbine* i „Prikazano X od Y“ imaju isti Y (ukupno kreiranih). Prvo se prikazuje pažnja na vrhu + ostalo po datumu, *Učitaj još* dodaje sledećih 30 na kraj; kad je X = Y, dugme nestaje. Klik na karticu (npr. Kasne) daje „Prikazano a od a“, jednako broju na kartici. |
| 14 | Naručilac | Stara zatvorena narudžbina. | Nije na prvoj turi; pojavi se pri *Učitaj još* (naručilac) odnosno *Prikaži sve → Učitaj još* (isporučilac), i u pretrazi. Stara otvorena narudžbina koja zahteva pažnju **uvek** ostaje na vrhu. |
| 15 | Oba | Pretraga: „cem“ (deo naziva artikla), pa naziv dobavljača, naziv lokacije, ime isporučioca/naručioca, „ko je tražio“, deo broja narudžbine. | Pronalazi odgovarajuće narudžbine, uključujući starije od 30 dana; unos „ćelik“ nalazi i „celik“. Statusna linija: „Pronađeno narudžbina: N“. |
| 16 | Oba | Otvori *Filteri*; klikni *Zatvorene* pa *Hitne*; zatim klikni prečicu *Poslednjih 90 dana* i još jednom na nju; ručno promeni datum „Od“; na kraju *Poništi*. | Lista se filtrira odmah posle svakog klika. *Hitne* se kombinuju sa ishodom, a više ishoda se sabira. Prečica postavlja „Od/Do“, ističe se i ponovnim klikom briše period; ručna izmena datuma gasi isticanje. Broj na dugmetu *Filteri* prati broj uključenih filtera. *Poništi* vraća običan prikaz. Klik na karticu tokom pretrage gasi pretragu. |
| 17 | Naručilac | Napravi novu narudžbinu, dodaj artikal u dozvoljenom statusu, pa ga pretraži. | Novi artikal se odmah može pronaći (polje za pretragu se osvežava pri izmeni stavki, lokacija i „ko je tražio“). |
| 18 | Admin | Admin tabla, kartica „Kasne“. | Isti broj kao zbir kasnih na tablama isporučilaca (isto pravilo). |
| 20 | Admin | U pretragu ukucaj „NAR-202610“, pa „202610“, pa pun broj. | Prvi i drugi unos daju sve narudžbine iz tog meseca (najviše 500), treći tačno jednu. „Prikazano X od Y“ = broj pronađenih. |
| 21 | Admin | Potvrdi prijem jedne narudžbine, pa pogledaj „Prosečno vreme obrade“. | Prosek se osveži u roku od par sekundi; nova narudžbina u Firestore-u ima polje `processingMs`. |
| 22 | Naručilac | Zadaj „Od/Do“ (npr. Ovaj mesec) i pogledaj u Network/Firestore da upit nosi `createdAt` opseg. | Čita se samo taj period, a ne cela istorija. |
| 19 | Admin | Izveštaji za period stariji od ~500 narudžbina unazad. | Sve narudžbine iz izabranog perioda su uključene (ranije nepotpuno). |
| 20 | Telefon (isporučilac) | Otvori tablu na telefonu (≤700 px). | Kartice 2 u redu; tabela se skroluje levo-desno, broj narudžbine ostaje zalepljen, *Prihvati/Odbij* su odmah desno od broja i dovoljno veliki za dodir. |
| 21 | Tastatura | Tab kroz kartice i redove. | Kartica se bira Enter/Space, red se otvara sa Enter, fokus ostaje na kartici posle osvežavanja brojki. |
| 22 | Jezik | Prebaci na engleski. | Svi novi natpisi, dugmad, poruke i status linije su na engleskom. |
| 23 | Naručilac | Firma ima način dodele „naručilac bira“. Napravi narudžbinu i ne biraj isporučioca. | Kartica „Čeka izbor isporučioca“ = 1 (pulsira), narudžbina je u bloku „Zahteva pažnju“ posle reklamacija i pre kasnih; posle izbora isporučioca nestaje iz bloka. |

## 5. Poznate napomene

- **Odbijene i zatvorene pre ove izmene** nemaju `closedAt` dok se ne pokrene dopuna (korak 3 instalacije).
- Stare narudžbine nemaju trenutak dodele — za njih se kašnjenje računa od kreiranja (dopuna im upisuje `assignedAt = createdAt`).
- Dugme *Ponovi narudžbinu* pravi novu narudžbinu (novi broj); ako preferiraš da se ista narudžbina vrati na „Čeka prihvatanje“, to je mala izmena u `repeatOrderAfterRejection`.
- Pretraga čita celu istoriju korisnika jednom po pokretanju (do 5000 narudžbina). Za više od toga potrebna je serverska pretraga (npr. Algolia/Typesense) — za očekivani obim nije potrebno.
- Master Admin stranica nije menjana.
- **„Prikazano X od Y“:** Y je pravi ukupan broj (narudžbine u memoriji + broj starijih zatvorenih koji baza izbroji, bez učitavanja dokumenata), pa je isti na svakom uređaju. Ranije je Y bio samo broj već učitanih narudžbina, pa je isti korisnik na jednom uređaju video „25 od 25“, a na drugom „25 od 36“, zavisno od toga šta je tamo prethodno otvarao.
- **Admin tabla, grafikon „Broj narudžbina kroz vreme“:** stubići nisu bili vidljivi jer su koristili boje (`--brand-500`, `--ink-300`) koje postoje samo u `css/base.css`, a stranica učitava `css/style.css`. Sada koriste `--color-primary` i `--color-text-muted`. Grafikon dobija podatke iz posebnog upita za poslednjih 14 dana (ranije iz liste od najviše 200 narudžbina), a iznad stubića je upisan broj.
