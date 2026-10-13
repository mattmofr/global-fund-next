# Répartition runtime du marché

Généré le 2026-10-13 depuis `packages/game-engine/legacy/data/gameData.json` : **91 sociétés / 91 IDs uniques**. Une société compte une fois, quelle que soit sa place de cotation.

Dataset de capitalisations : consultation initiale 2026-10-06, dernière consolidation 2026-10-13; chaque émetteur conserve sa date de cap propre dans le JSON. Branche `global-fund-evolve`, HEAD `56efd220fb082ee2cc432c02b3202a40f976d839`. SHA-256 : catalogue `47cb766839a7a932`, caps `5012cac9403107d7`, script `b2daab6276d65569` (empreintes complètes dans le JSON).

## Zones du jeu — sociétés Small / Medium / Large

| Zone | Small | Medium | Large | Total |
|---|---:|---:|---:|---:|
| americas | 7 | 10 | 18 | 35 |
| europe | 5 | 9 | 10 | 24 |
| asia | 6 | 3 | 8 | 17 |
| africa | 6 | 0 | 0 | 6 |
| oceania | 7 | 2 | 0 | 9 |
| **Total** | **31** | **24** | **36** | **91** |

## Secteurs — sociétés Small / Medium / Large

| Secteur | Small | Medium | Large | Total |
|---|---:|---:|---:|---:|
| technology | 4 | 0 | 9 | 13 |
| finance | 4 | 2 | 8 | 14 |
| industry | 4 | 5 | 5 | 14 |
| health | 2 | 3 | 4 | 9 |
| energy | 3 | 4 | 4 | 11 |
| realestate | 4 | 0 | 0 | 4 |
| agrifood | 2 | 6 | 4 | 12 |
| media | 4 | 3 | 1 | 8 |
| transport | 4 | 1 | 1 | 6 |

## Matrice zone × secteur — Small / Medium / Large

Chaque cellule indique `S/M/L`.

| Zone | technology | finance | industry | health | energy | realestate | agrifood | media | transport |
|---|---|---|---|---|---|---|---|---|---|
| americas | 1/0/6 | 2/0/4 | 0/3/2 | 1/0/1 | 1/1/2 | 0/0/0 | 1/3/3 | 0/3/0 | 1/0/0 |
| europe | 1/0/0 | 0/0/2 | 1/1/3 | 1/2/3 | 0/2/1 | 0/0/0 | 0/3/1 | 1/0/0 | 1/1/0 |
| asia | 1/0/3 | 1/1/2 | 2/1/0 | 0/0/0 | 0/1/1 | 1/0/0 | 0/0/0 | 0/0/1 | 1/0/1 |
| africa | 0/0/0 | 1/0/0 | 0/0/0 | 0/0/0 | 1/0/0 | 2/0/0 | 0/0/0 | 2/0/0 | 0/0/0 |
| oceania | 1/0/0 | 0/1/0 | 1/0/0 | 0/1/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 |

Cellules occupées : **36/45**; vides : **9** — americas/realestate, europe/realestate, asia/health, asia/agrifood, africa/technology, africa/industry, africa/health, africa/agrifood, africa/transport.
Tailles des cellules occupées : 16 cellule(s) de 1 société(s), 7 cellule(s) de 2 société(s), 3 cellule(s) de 3 société(s), 4 cellule(s) de 4 société(s), 2 cellule(s) de 5 société(s), 2 cellule(s) de 6 société(s), 2 cellule(s) de 7 société(s).

## Contrôle complet avec budget de 100 M€

Au prix de base, contrôle = achat des cinq actions de chaque société de la cellule; sans choc de marché.

| Zone / secteur | Sociétés | Actions requises | Coût complet |
|---|---|---:|---:|
| africa / energy | Sasol Limited | 5 | 53.57 M€ |
| americas / transport | JetBlue Airways Corporation | 5 | 25.00 M€ |
| europe / technology | TeamViewer SE | 5 | 25.00 M€ |
| oceania / energy | Origin Energy | 5 | 72.54 M€ |
| oceania / technology | WiseTech Global Limited | 5 | 43.69 M€ |
| oceania / transport | Qantas Airways | 5 | 54.41 M€ |

## Première action avec 100 M€ et réserve de 0 M€

Prix d’une action = `basePrice / 5`. **56/91** sociétés sont achetables individuellement à l’ouverture avec 100 M€ de liquidités, réserve 0 M€. La liste et le solde résiduel par achat figurent dans le JSON.

## Prix continu, classes et volatilité

Version économie 4, scénario déclaré `continuous-progression`. Les seuils 40/200 Md$ classent les entreprises; les anciennes bandes small/medium/large ne découpent pas la courbe v4 en blocs. Formule active : `basePrice = round2(clamp(25,1500,500*ln(1+capUSD/50bn)/ln(5)))` M€ pour les cinq actions; prix d’action C/C = `basePrice/5`. Revenu C/C = `round2(basePrice*(0.10+0.04*(1-exp(-capUSD/200bn))))`.

| Classe de cap | Capitalisations observées | Prix complet C/C observé | Prix/action C/C observé | Effectif |
|---|---:|---:|---:|---:|
| small | 1.16–39.40 Md$ | 25.00 M€–180.53 M€ | 5.00 M€–36.11 M€ | 31 |
| medium | 43.00–190.00 Md$ | 192.79 M€–487.32 M€ | 38.56 M€–97.46 M€ | 24 |
| large | 200.00–4900.00 Md$ | 500.00 M€–1427.55 M€ | 100.00 M€–285.51 M€ | 36 |

Rendement revenu/prix observé, calculé des valeurs runtime arrondies : small 10.04–10.71%; medium 10.77–12.45%; large 12.53–14.00%. La courbe est continue et les seuils ne créent pas de saut :

| Seuil | 1 USD dessous | Au seuil | 1 USD dessus |
|---|---:|---:|---:|
| Small/Medium (40 Md$) | small 182.61 M€ | medium 182.61 M€ | medium 182.61 M€ |
| Medium/Large (200 Md$) | medium 500.00 M€ | large 500.00 M€ | large 500.00 M€ |

L’écart apparent du catalogue entre le Small le plus capitalisé (Qatar National Bank, 39.40 Md$) et le Medium le moins capitalisé (Mercedes-Benz Group AG, 43.00 Md$) vaut 12.26 M€ à C/C. Il vient des caps observés, pas d’une discontinuité de seuil.

| Classe | Prix/action C/C observé | Prix/action après facteur de marché 0,375–2,25 | Coût des 5 actions après facteur |
|---|---:|---:|---:|
| small | 5.00 M€–36.11 M€ | 1.8750–81.2385 M€ | 9.3750–406.1925 M€ |
| medium | 38.56 M€–97.46 M€ | 14.4593–219.2940 M€ | 72.2963–1096.4700 M€ |
| large | 100.00 M€–285.51 M€ | 37.5000–642.3975 M€ | 187.5000–3211.9875 M€ |

Les facteurs 0,375 (E/D, événements fermés) à 2,25 (A/A) appliqués aux bornes observées donnent les plages unitaires ci-dessus. Chevauchements unitaires : small/medium 14.4593–81.2385 M€; medium/large 37.5000–219.2940 M€. Les classes n’imposent donc pas trois blocs de prix à l’achat.

## Places de cotation représentatives

Les cinq zones ci-dessus sont les zones géographiques du jeu. Cette section dénombre les émetteurs par place de cotation, en choisissant au plus une ligne représentative par émetteur : jamais une occurrence par ADR. Une dual-primary reste un choix méthodologique documenté, non l’affirmation qu’il n’existe qu’une cotation primaire.

| Place | Small | Medium | Large | Total |
|---|---:|---:|---:|---:|
| [ADX](https://www.adx.ae/market-watch/) | 1 | 0 | 0 | 1 |
| [ASX](https://www.asx.com.au/markets/trade-our-cash-market/overview) | 7 | 2 | 0 | 9 |
| [B3](https://www.b3.com.br/en_us/market-data-and-indices/data-services/market-data/quotes/equities/) | 1 | 1 | 0 | 2 |
| [BME Madrid](https://www.bolsasymercados.es/bme-exchange/en/Trading/Equities/Companies) | 0 | 1 | 1 | 2 |
| [BMV](https://www.bmv.com.mx/en/issuers/listed-companies) | 0 | 2 | 0 | 2 |
| [Casablanca Stock Exchange](https://www.casablanca-bourse.com/en/live-market) | 1 | 0 | 0 | 1 |
| [DFM](https://www.dfm.ae/the-exchange/market-information/market-watch) | 1 | 0 | 0 | 1 |
| [Euronext Amsterdam](https://live.euronext.com/en/markets/amsterdam/equities/list) | 0 | 1 | 0 | 1 |
| [Euronext Brussels](https://live.euronext.com/en/markets/brussels/equities/list) | 0 | 1 | 0 | 1 |
| [Euronext Paris](https://live.euronext.com/en/markets/paris/equities/list) | 0 | 2 | 2 | 4 |
| [Hong Kong Stock Exchange](https://www.hkex.com.hk/Market-Data/Securities-Prices/Equities?sc_lang=en) | 1 | 2 | 5 | 8 |
| [JSE](https://www.jse.co.za/market-data/companies) | 2 | 0 | 0 | 2 |
| [KRX](https://global.krx.co.kr/main/main.jsp) | 0 | 0 | 1 | 1 |
| [LSE](https://www.londonstockexchange.com/stock/SHEL/shell-plc/company-page) | 1 | 3 | 3 | 7 |
| [NSE India](https://www.nseindia.com/market-data/live-equity-market) | 1 | 0 | 0 | 1 |
| [NYSE](https://www.nyse.com/listings_directory/stock?limit=100) | 2 | 6 | 14 | 22 |
| [Nasdaq](https://www.nasdaq.com/market-activity/stocks/screener) | 3 | 1 | 4 | 8 |
| [Qatar Stock Exchange](https://www.qe.com.qa/market-data/market-watch) | 1 | 0 | 0 | 1 |
| [SIX Swiss Exchange](https://www.six-group.com/en/market-data/shares/share-explorer.html) | 0 | 0 | 3 | 3 |
| [Santiago Stock Exchange](https://www.bolsadesantiago.com/) | 1 | 0 | 0 | 1 |
| [Taiwan Stock Exchange](https://www.twse.com.tw/en/) | 2 | 0 | 1 | 3 |
| [Tokyo Stock Exchange](https://www.jpx.co.jp/english/markets/statistics-equities/misc/01.html) | 2 | 1 | 1 | 4 |
| [Xetra](https://www.xetra.com/xetra-en) | 4 | 1 | 1 | 6 |
| **Total** | **31** | **24** | **36** | **91** |

Émetteurs sans place/ticker établi dans l’inventaire : **0**.
Statuts de l’inventaire : {'inferred_needs_listing-page_confirmation': 78, 'exchange_page_verified': 13}. Les entrées inférées doivent être confirmées sur une fiche de place; les nouveaux remplacements sont reliés à des références officielles d’échange. Les noms et capitalisations proviennent des entrées locales du catalogue et de l’audit société; chaque ligne du JSON conserve ces URLs et la date de capitalisation.

## Méthode et limites

La ventilation compte les entreprises runtime, non leurs 5 actions, leurs ADR, leurs filiales croisées, ni les pays de ventes. Les classifications sectorielles sont celles du jeu. Prix issus de `basePrice` runtime au moment de génération; les premiers achats supposent prix C/C et zéro réserve. Les places sont un inventaire indicatif de listings primaires/représentatifs, avec statuts inconnus explicites plutôt qu’une déduction par pays seul.
La correction de Contextes est indépendante de cette ventilation d’entreprises et n’en modifie pas les effectifs; aucun résultat de simulation n’est anticipé ici.
