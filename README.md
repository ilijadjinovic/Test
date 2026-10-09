# Sistem za naručivanje i nabavku robe

Čist **HTML / CSS / JavaScript** frontend (bez build alata, bez npm-a) sa
**Firebase** backendom (Authentication + Firestore + Storage). Odgovara
funkcionalnoj specifikaciji `Specifikacija-Sistem-za-narucivanje-i-nabavku.docx`.

## 1. Podešavanje Firebase-a

1. Idi na [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. **Authentication** → Sign-in method → uključi **Email/Password**.
3. **Firestore Database** → Create database → Native mode (npr. region `eur3`).
4. **Storage** → Get started (za priloge — fotografije, računi).
5. Project settings → General → "Your apps" → **Add app → Web** → kopiraj
   `firebaseConfig` objekat.
6. Otvori `js/firebase-config.js` u ovom projektu i nalepi svoje vrednosti.
7. U Firebase Console → Firestore → **Rules**, nalepi sadržaj fajla
   `firestore.rules` iz ovog projekta i objavi (Publish).
8. U Firebase Console → Storage → **Rules**, nalepi sadržaj `storage.rules`.
9. (Opciono, preporučeno) Firestore → Indexes → uvezi `firestore.indexes.json`
   preko Firebase CLI: `firebase deploy --only firestore:indexes` — ili
   jednostavno pokreni aplikaciju; Firestore će u konzoli logovati direktan
   link za kreiranje indeksa kad zatreba.

## 2. Pokretanje

Ovo je čist statički sajt — ali pošto koristi ES module (`type="module"`),
mora se servirati preko HTTP-a (ne `file://`). Najlakše:

```bash
cd nabavka-sistem
python3 -m http.server 8080
# otvori http://localhost:8080
```

ili bilo koji drugi statički server (VS Code "Live Server", `npx serve`, itd.),
ili upload na Firebase Hosting / Netlify / Vercel.

## 3. Prvi koraci u aplikaciji

1. Otvori `register-company.html` → registruj firmu i Admin nalog.
2. Prijavi se kao Admin (`admin-dashboard.html`) → dodaj:
   - **Lokacije** (magacini/prodavnice) — `admin-locations.html`
   - **Dobavljače** + njihove lokacije preuzimanja — `admin-suppliers.html`
   - **Katalog proizvoda** po dobavljaču — `admin-catalog.html`
   - **Korisnike** (Naručioci, Isporučioci) — `admin-users.html`
   - **Podešavanja** (način dodele isporučioca, GPS) — `admin-settings.html`
3. Prijavi se kao Naručilac → `new-order.html` → kreiraj narudžbinu.
4. Admin (ili sistem/naručilac, zavisno od podešavanja) dodeljuje isporučioca.
5. Isporučilac prihvata, obrađuje nabavku, isporučuje — sve na
   `order-detail.html`, koja je zajednička za sve uloge (prikaz se prilagođava
   ulozi i statusu).
6. Naručilac potvrđuje prijem robe ili otvara reklamaciju.

Master Admin nalog (uvid u sve firme na platformi) trenutno se mora ručno
postaviti: u Firestore konzoli otvori `users/{uid}` dokument željenog korisnika
i promeni polje `role` u `master_admin`.

## 3.1 Novododate funkcionalnosti

- **Finansijski unos po dobavljaču** — na kartici narudžbine (`order-detail.html`),
  panel "Nabavke po dobavljaču", isporučilac unosi plaćeni iznos, broj računa i
  datum računa za svakog dobavljača posebno (`js/purchases.js → setPurchasePayment`).
  Iznosi se automatski sabiraju i prikazuju u panelu **"Finansijski pregled"** kao
  ukupan iznos narudžbine.
- **PDF narudžbenica** — dugme "🖨️ Narudžbenica (PDF)" na kartici narudžbine
  generiše PDF za štampu (`js/order-print.js`): zaglavlje firme, stavke grupisane
  po dobavljaču, finansijski pregled (ako je unet) i mesta za potpis
  naručioca/isporučioca/rukovodioca + polje za overu da je narudžbina realizovana.
- **Izveštaji** — nova stranica `admin-reports.html` (meni "Izveštaji"): filteri
  po periodu, naručiocu, isporučiocu, dobavljaču i statusu; pregledi po
  narudžbenicama (detaljno), po naručiocima, po isporučiocima, po dobavljačima i
  finansijski pregled; izvoz u CSV/Excel/PDF (`js/reports.js`, `js/page-admin-reports.js`).
- **Dobavljači — izmena i dodatna polja** — `admin-suppliers.html` sada ima
  dugme "✎ Izmeni" i polja PIB, matični broj, adresa i tekući račun
  (`js/suppliers.js → updateSupplier`).

## 4. Struktura projekta

```
nabavka-sistem/
├── index.html                    Prijava
├── register-company.html         Registracija firme + Admin naloga
├── master-admin.html             Master Admin — sve firme na platformi
├── admin-dashboard.html          Dashboard Admina firme
├── admin-users.html              Korisnici i uloge
├── admin-locations.html          Lokacije firme
├── admin-suppliers.html          Dobavljači + lokacije preuzimanja
├── admin-catalog.html            Katalog proizvoda + kategorije
├── admin-import-export.html      Uvoz/izvoz (CSV/Excel/PDF)
├── admin-settings.html           Podešavanja firme
├── narucilac-dashboard.html      Dashboard Naručioca
├── new-order.html                Kreiranje narudžbine
├── templates.html                Šabloni / omiljene liste / ponavljajuće
├── isporucilac-dashboard.html    Dashboard Isporučioca
├── order-detail.html             Detalji narudžbine (zajednička za sve uloge)
├── manifest.json                 PWA manifest (naziv "Order & Supply", ikonice)
├── assets/
│   ├── icon-192.png               App ikonica (favicon, PWA, manifest)
│   └── icon-512.png               App ikonica (veća rezolucija)
├── css/
│   └── style.css                 Jedinstven stylesheet (dizajn tokeni, layout, komponente)
├── js/
│   ├── firebase-config.js        ⚠️ popuni svojim Firebase podacima
│   ├── firebase-init.js          Inicijalizacija SDK-a (CDN, ES moduli)
│   ├── utils.js                  Konstante (statusi, uloge) i pomoćne funkcije
│   ├── i18n.js                   Učitavanje prevoda
│   ├── auth.js                   Prijava/registracija/čuvar ruta
│   ├── audit.js                  Audit log
│   ├── notifications.js          In-app notifikacije (+ kuka za push)
│   ├── chat.js                   Poruke vezane za narudžbinu
│   ├── attachments.js            Upload fotografija/računa
│   ├── qrcode.js                 Generisanje QR koda narudžbine
│   ├── locations.js               ComLocations CRUD
│   ├── suppliers.js               Suppliers + SupLocations CRUD
│   ├── catalog.js                 Categories + SupProducts CRUD
│   ├── users.js                   Korisnici firme (CRUD + kreiranje naloga)
│   ├── companies.js                Master Admin funkcije
│   ├── settings.js                 Podešavanja firme
│   ├── orders.js                   Orders + OrderItems + tok statusa
│   ├── purchases.js                 Purchases (nabavka po dobavljaču)
│   ├── deliveries.js                DeliveryLocations
│   ├── claims.js                     Reklamacije
│   ├── templates.js                  Šabloni/liste/ponavljajuće
│   ├── import-export.js              CSV/Excel/PDF (CDN biblioteke)
│   ├── reports.js                    Pomoćne funkcije za izveštaje
│   ├── nav.js                        Deljena navigacija (sidebar/topbar)
│   └── page-*.js                     Logika svake pojedinačne stranice
├── i18n/
│   ├── sr.json
│   └── en.json
├── firestore.rules
├── firestore.indexes.json
└── storage.rules
```

Svaka funkcionalna celina (dobavljači, katalog, narudžbine, reklamacije...)
živi u svom fajlu — izmena jedne funkcionalnosti ne zahteva diranje ostatka
koda.

## 5. Model baze podataka (Firestore)

Firestore je NoSQL, pa je "model" implementiran kao ugnježdene kolekcije
unutar `companies/{companyId}`, u skladu sa entitetima iz specifikacije:

```
companies/{companyId}                        Company
  usersIndex/{uid}                            (indeks za listanje korisnika)
  locations/{locationId}                      ComLocations
  suppliers/{supplierId}                      Suppliers
    locations/{locId}                         SupLocations
    products/{productId}                      SupProducts
  categories/{categoryId}                     Categories
  templates/{templateId}                      (šabloni/liste/ponavljajuće)
  orders/{orderId}                            Orders
    items/{itemId}                            OrderItems
    purchases/{purchaseId}                    Purchases
    deliveryLocations/{locId}                 DeliveryLocations
    claims/{claimId}                          (Reklamacije)
    messages/{msgId}                          (Chat)
    attachments/{attId}                       Attachments
  notifications/{notifId}                     Notifications
  auditLogs/{logId}                           AuditLogs

users/{uid}                                   Users (top-level, uid = Firebase Auth uid)
platform/settings                             Settings (globalna, Master Admin)
```

Napomene u odnosu na originalnu relacionu šemu iz specifikacije:
- `OrdLocations` (lokacije preuzimanja artikala unutar narudžbine) su
  implementirane kao polje `pickupLocationId`/`pickupLocationName` direktno na
  svakom `OrderItem`-u, umesto posebne kolekcije — jednostavnije za Firestore.
- `Receipts` (fiskalni računi) su implementirani kao `attachments` sa
  `type: 'racun'` + opciono polje `receiptNumber` na `Purchase` dokumentu.
- `Roles` nisu posebna kolekcija — uloga je fiksni skup (`master_admin`,
  `admin`, `narucilac`, `isporucilac`) upisan kao string na `users/{uid}.role`.

## 6. Poznata ograničenja / šta treba doraditi za produkciju

- **Kreiranje korisnika iz Admin panela** (`js/users.js`) koristi trik sa
  sekundarnom Firebase App instancom da ne bi odjavio Admina. Za produkciju je
  čistije rešenje **Cloud Function** sa Admin SDK-om (`auth.createUser`) —
  sigurnije i omogućava i potpuno brisanje naloga.
- **Push notifikacije** (PWA) su pripremljene kao kuka
  (`notifications.js → requestPushPermission`), ali zahtevaju dodatni
  `firebase-messaging-sw.js` service worker i VAPID ključ — u aplikaciji trenutno
  rade **in-app realtime notifikacije** preko Firestore-a, što pokriva sve iz
  Poglavlja 10.1 dok je aplikacija otvorena.
- **GPS praćenje uživo** (Poglavlje 10.2) ima pripremljenu kalkulaciju ETA
  (`deliveries.js → estimateArrival`), ali stvarno očitavanje pozicije
  isporučioca (Geolocation API) treba povezati naknadno.
- **Brisanje firme** (Master Admin) trenutno briše samo glavni dokument firme;
  potpuno brisanje svih poddokumenata treba raditi preko Cloud Function batch
  brisanja (Firestore ne briše podkolekcije automatski).
- Aplikacija nije zapakovana kao instalabilna PWA (nema `manifest.json` /
  service worker za offline rad) — lako se dodaje naknadno.

## 7. Višejezičnost

Svi tekstovi u UI-ju su izdvojeni u `i18n/sr.json` i `i18n/en.json` i
učitavaju se preko `js/i18n.js`. Dodavanje novog jezika: napravi
`i18n/xx.json` sa istim ključevima i dodaj opciju u `<select id="lang-switch">`
u `js/nav.js`.
