# Izveštaji — izmene

## Šta je novo
- **Izveštaji i za naručioca** (stavka „Izveštaji" u meniju). Naručilac vidi **samo svoje narudžbine**: filter „Naručilac" je sakriven (zaključan na njega), a tab „Po naručiocima" se ne prikazuje. Admin firme ima sve kao pre.
- **Novi tab „Po artiklima"**: ukupna naručena količina i broj narudžbina po artiklu za izabrani period i filtere. Isti artikal u različitim jedinicama mere (kg / kom) je u odvojenim redovima. Sortirano po količini opadajuće. Izvoz: CSV, Excel, PDF.
- **„Detaljno" u tabu „Po narudžbenicama"**: ispod svakog reda izlistane su stavke po dobavljaču i finansijski pregled (kao na PDF-u pojedinačne narudžbenice).
  - **PDF (detaljno):** zaglavlje firme, naslov sa periodom / brojem narudžbina / ukupnim iznosom, pa sve narudžbenice jedna za drugom (bez nove strane za svaku, linija između), bez odobrenja i potpisa. Uvodne liste narudžbina nema.
  - **CSV / Excel (detaljno):** jedan red po stavci; iznos narudžbine je samo u prvom redu svake narudžbine.
- **Zaglavlje firme u svim PDF izveštajima** (naziv, adresa, PIB, matični broj, telefon), plus red ispod naslova: period · broj narudžbina · ukupno.

## Fajlovi
| Fajl | Izmena |
|---|---|
| `js/report-logic.js` | **novo** — čiste funkcije: `aggregateByItem`, `groupItemsBySupplier`, `parseQty`, `fmtQty` |
| `js/reports.js` | `ownerUid` filter (koristi postojeći indeks `createdByUid + createdAt`), izvezen `aggregateByItem` |
| `js/page-admin-reports.js` | uloga naručioca, tab „Po artiklima", „Detaljno", izvoz, podnaslov |
| `admin-reports.html` | tab, checkbox „Detaljno", oznaka uloge |
| `js/order-print.js` | `generateOrdersReportPdf` (detaljan zbirni PDF) |
| `js/import-export.js` | `exportPdf` prima `{ company, subtitle }` |
| `js/nav.js` | „Izveštaji" u meniju naručioca |
| `css/style.css` | stilovi detalja ispod reda |
| `i18n/sr.json`, `i18n/en.json` | 10 novih ključeva |
| `tests/report-logic.test.mjs` | **novo** — testovi (`node tests/report-logic.test.mjs`) |

## Instalacija
Nema novih indeksa niti izmena pravila baze. Otpremi fajlove i osveži stranicu (Ctrl+F5).

## Testiranje
1. Admin: Izveštaji → „Po artiklima" → provera količina na par poznatih artikala; CSV/Excel/PDF.
2. Admin: „Po narudžbenicama" → štikliraj „Detaljno" → ispod svakog reda stavke i finansije; PDF ima zaglavlje firme, narudžbenice teku jedna za drugom.
3. Naručilac: u meniju je „Izveštaji"; vidi samo svoje narudžbine; nema filtera „Naručilac" ni taba „Po naručiocima".
4. PDF svakog taba ima zaglavlje firme i red sa periodom.
