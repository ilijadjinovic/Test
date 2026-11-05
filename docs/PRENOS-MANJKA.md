# Prenos manjka u novu narudžbinu + izmena mesta preuzimanja

## Šta je novo

**Potvrda prijema (naručilac, status „isporučena“)**
- Ako neki artikal nije stigao ili je stigao delimično, umesto običnog „Da/Ne“ otvara se dijalog **„Nova narudžbina za manjak“** — nova narudžbina popunjena kao original:
  - dobavljač, šifra i artikal iz kataloga se prenose;
  - **mesto preuzimanja** je unapred izabrano kao u originalu (ako dobavljač ima više mesta, naručilac ga može promeniti iz liste; ako je original imao „bilo koja“, a dobavljač ima samo jedno mesto, bira se to mesto);
  - **mesto isporuke** po artiklu je kao u originalu (lista se prikazuje samo ako ima više lokacija isporuke);
  - količina je ono što fali (izmenljiva), svaki artikal se može isključiti;
  - prioritet je kao u originalu (izmenljiv).
- **Isporučilac se određuje prema podešavanju firme**, isto kao na formi „Nova narudžbina“:
  - *automatski* — sistem dodeljuje isporučioca sa najmanje aktivnih narudžbina, uz notifikaciju;
  - *admin bira* — narudžbina čeka admina;
  - *naručilac bira* — u dijalogu je obavezan izbor isporučioca (podrazumevano isporučilac originalne narudžbine).
- Dugmad: **Potvrdi prijem i pošalji novu narudžbinu**, **Potvrdi prijem bez nove narudžbine**, **Nazad** (ništa se ne potvrđuje).
- Nova narudžbina se kreira **pre** zatvaranja stare. Ako kreiranje padne, stara ostaje nepotvrđena i može se probati ponovo.
- Narudžbine su povezane: na novoj piše „Nastavak narudžbine NAR-…“, na staroj „Manjak prenet u NAR-…“ (oba kao link).

**Detalj narudžbine (dok nije prihvaćena)**
- U tabeli stavki **„Preuzimanje“** je sada izbor iz lokacija dobavljača (isto kao na formi), pa se mesto preuzimanja može naknadno podesiti.
- Panel „Dodaj artikal“ ima izbor mesta preuzimanja: jedna lokacija dobavljača → ona; inače ista kao kod ostalih artikala tog dobavljača; inače „bilo koja lokacija“.

**Zajednički kod**
- `orders.js → submitOrder()` — slanje narudžbine + dodela isporučioca prema podešavanju; koriste ga forma „Nova narudžbina“ i prenos manjka.
- `js/carry-over-logic.js` — čista logika (manjak, popunjavanje nacrta, finalizacija); testovi: `node tests/carry-over-logic.test.mjs`.

## Izmenjeni fajlovi
`js/orders.js`, `js/page-order-detail.js`, `js/page-new-order.js`, `i18n/sr.json`, `i18n/en.json`; novo: `js/carry-over-logic.js`, `tests/carry-over-logic.test.mjs`, `docs/PRENOS-MANJKA.md`. Pravila baze i indeksi se ne menjaju.

## Novo na narudžbinama (polja)
`carriedFromOrderId`, `carriedFromNumber` (nova narudžbina); `carriedOverAsOrderId`, `carriedOverAsNumber` (stara).

## Scenariji za testiranje
1. Podešavanje *automatski*: potvrdi prijem sa manjkom → dijalog bez izbora isporučioca → nova narudžbina je odmah dodeljena isporučiocu.
2. *Naručilac bira*: dijalog traži isporučioca; bez izbora se ne šalje; sa izborom nova narudžbina je „čeka prihvatanje“ kod izabranog.
3. *Admin bira*: nova narudžbina je nedodeljena i vidljiva adminu.
4. Dobavljač sa dva mesta preuzimanja: u dijalogu je izabrano mesto iz originala, može se promeniti.
5. Više lokacija isporuke: svaki artikal zadržava svoju; nova narudžbina ima samo korišćene lokacije.
6. „Nazad“ ne potvrđuje prijem; „bez nove narudžbine“ zatvara samo staru.
7. Nova narudžbina (dok čeka prihvatanje): u tabeli stavki promeni mesto preuzimanja; dodaj artikal i proveri predizbor mesta.
8. Greška mreže pri kreiranju: stara narudžbina ostaje u statusu „isporučena“.
