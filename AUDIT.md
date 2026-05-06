# AUDIT — Dashboard S'investir V0
**Date** : 2026-05-04  
**Fichiers lus** : `S'investir Statistiques - 2026.xlsx` (7,3 Mo) + `Statistiques Publicités S'investir.xlsx` (1,2 Mo)  
**Statut** : ✅ Données lisibles — anomalies à valider avant Étape 2

---

## 1. Google Drive Desktop

| Critère | Statut | Détail |
|---|---|---|
| App installée | ✅ OK | `/Applications/Google Drive.app` |
| Compte connecté | ✅ OK | `franck@sinvestir.fr` |
| Mode Mirror | ⚠️ Non | Drive en mode Stream — fichiers copiés localement en `data/` pour l'audit |
| Fichiers lisibles | ✅ OK | Lecture pandas OK, aucune erreur de lock |

> Le watcher Drive sera configuré à l'Étape 2. Pour l'instant les fichiers sont dans `sinvestir-dashboard/data/`.

---

## 2. STATS FILE — `S'investir Statistiques - 2026.xlsx`

**Onglets détectés** : STATS, VENTES, TRACK VENTES, TRACK CAL, SySi, FORM, CLOSERS, CALENDLY, Analyse Source Calendly, Analyse Source, LEADS, Stats Livre, SEPA, Performances Séq Mail  
**Onglets V0 utilisés** : VENTES, CALENDLY, LEADS

### Onglet VENTES
| Critère | Valeur |
|---|---|
| Lignes | 5 785 |
| Colonnes | 25 |
| Période | 2021-11-24 → 2026-05-04 |
| Colonnes trouvées | Date, Mail, From du Tally (lk), Moyen du Tally (el), First AC action, **Source initiale**, **Last Source**, **Heure Calendly**, Date création, Affilié, **Produit**, **Prix**, **TOTAL HT**, **CLOSER**, **Event Calendly**, Commentaire, Unique, N°Commande, Paiement, Produit.1, Coupons, Livre?, Source Calendly, Medium Calendly |
| Colonnes spec → trouvées | Date ✅, Mail ✅, Source initiale ✅, Last Source ✅, Heure Calendly ✅, Produit ✅, Prix ✅, TOTAL HT ✅, CLOSER ✅, Event Calendly ✅ |
| Colonnes extra (non-spec) | From du Tally, Moyen du Tally, First AC action, Date création, Affilié, N°Commande, Paiement, Coupons, Livre?, Source Calendly, Medium Calendly |

### Onglet CALENDLY
| Critère | Valeur |
|---|---|
| Lignes | 17 483 |
| Colonnes | 14 |
| Période (réservation) | 2025-01-01 → 2026-05-04 |
| Période (appels planifiés) | 2025-01-01 → 2026-05-12 |
| Colonnes trouvées | DATE, **[⚠️ voir anomalie 1]**, From du Tally, Moyen du Tally, **Heure et date Calendly**, Affilié, **Closer**, **Source**, **Last_source**, **First AC Action**, First date subscription, **Event Calendly**, Source calendly, Medium calendly |

> ⚠️ **ANOMALIE 1** : La colonne "Mail" s'affiche comme `17483` lors de la lecture pandas — probablement une cellule Excel contenant le total du nombre de lignes au lieu du label. À corriger dans le loader avec `header=None` + offset, ou en lisant la vraie ligne de headers.

### Onglet LEADS
| Critère | Valeur |
|---|---|
| Lignes | 73 357 |
| Colonnes utiles | Date, Mail, Source, First AC Action |
| Colonnes extra | 34 colonnes `Unnamed` (données de stats internes Excel, ignorées) |
| Période | **2026-01-01 → 2026-05-04 uniquement** |
| Colonnes spec → trouvées | Date ✅, Mail ✅, Source ✅, First AC Action ✅ |

> ⚠️ **ANOMALIE 2** : L'onglet LEADS ne couvre que **2026** — contrairement aux VENTES qui remontent à 2021. Les leads historiques (2024, 2025) ne sont pas dans cet onglet. Cela signifie que les KPIs basés sur les leads (volume, CPL, booking rate) ne seront fiables que sur 2026. **À valider : est-ce normal ? Y a-t-il un onglet historique ailleurs ?**

---

## 3. ADS FILE — `Statistiques Publicités S'investir.xlsx`

**Onglets détectés** : NEW LEADS, OLD LEADS, CALLS, VENTES, AGGREGATE, BUDGET, STATS, UTM  
**Onglets V0 utilisés** : NEW LEADS, CALLS, VENTES, BUDGET

### Onglet NEW LEADS
| Critère | Valeur |
|---|---|
| Lignes | 33 208 |
| Colonnes | 3 (Date, Source, First AC Action) |
| Période | 2024-01-04 → 2026-05-04 |
| Correspondance spec | ✅ |

### Onglet CALLS
| Critère | Valeur |
|---|---|
| Lignes | 2 534 |
| Colonnes | 10 |
| Période (réservation) | 2025-01-01 → 2026-05-04 |
| Colonnes trouvées | Date Calendly, Heure et date Calendly, Closer, Source, Last_source, First AC Action, First date subscription, Event Calendly, Source calendly, Medium calendly |
| Correspondance spec | ✅ (colonne "Date Calendly" = "DATE" du spec) |

### Onglet VENTES
| Critère | Valeur |
|---|---|
| Lignes | 568 |
| Colonnes | 19 |
| Période | 2024-01-19 → 2026-05-04 |
| Colonnes trouvées | Date, From du Tally, Moyen du Tally, First AC action, Source initiale, Last Source, Heure Calendly, Date création, Produit, Prix, TOTAL HT, CLOSER, Event Calendly, Livre?, Source Calendly, Medium Calendly, Produit.1, UNIQUE?, Remboursement |
| Correspondance spec | ✅ |

### Onglet BUDGET
| Critère | Valeur |
|---|---|
| Jours de données | 998 |
| Période | 2024-01-01 → **2026-09-24** |
| Nombre de créatives | 106 colonnes |
| Structure | Ligne 3 = headers (col B = Date, col C+ = noms créas), Ligne 4+ = montants |
| Budget 2026 total (YTD) | **138 905 €** |

> ⚠️ **ANOMALIE 3** : Le budget contient des données jusqu'au **2026-09-24** — ce sont vraisemblablement des budgets planifiés. Le loader devra distinguer budget réalisé (passé) vs planifié (futur) en filtrant sur `Date <= today`.

---

## 4. Cohérence croisée VENTES (STATS vs ADS)

| Métrique | STATS VENTES | ADS VENTES | Ratio |
|---|---|---|---|
| Ventes (2025+) | 3 830 | 545 | Paid = 14,2% du total |
| CA HT (2025+) | 7 176 496 € | 966 525 € | Paid = 13,5% du CA |

**Conclusion** : La cohérence est normale. ADS VENTES est bien un sous-ensemble Paid de STATS VENTES. Aucune anomalie détectée.

---

## 5. Classification des sources — État

**Sources uniques dans LEADS** : 342  
**Taux de classification initial (spec V0)** : ~87% des sources couvertes

### Sources classifiées avec règles étendues (proposées)
| Canal/Sous-canal | Sources | Règle proposée |
|---|---|---|
| Paid/Google | `googleads*`, `google-ads*`, `ads2_google_*` | Ajouter pattern `ads2_google` |
| Paid/Meta | `ads_pub_*`, `ads_retargeting` | Ajouter `ads_retargeting` |
| Organique/YouTube | `ytb*`, `chaineytb`, `post-youtube`, `linktree`, `yt-meilleurs-etf-2026` | Ajouter ces patterns |
| Organique/SEO | `seo*`, `article*`, `comparatif*`, `banniere_art_fo`, `modele_art_fo*`, `liste_etf*`, `comment-investir*`, `simulateur*`, `investir1000e` | Ajouter patterns site/blog |
| Organique/Newsletter | `substack`, `sequencelbd*`, `mail` | Nouveau sous-canal |
| Organique/Webinaire | `webi-sc-*` | Nouveau sous-canal |
| Organique/Owned | `AccueilSite*`, `TLMPREB`, `popup*`, `livre*`, `page-outils`, `commencez-ici`, `page-parrainage`, `footer`, `bio-insta`, `bio-facebook`, `page-contact`, `page-a-propos`, `page-recherche`, `chatbot`, `site` | Étendre pattern Owned |
| Organique/Social | `linkedin*`, `bio-insta`, `bio-facebook` | Nouveau sous-canal |
| Organique/Affiliation | `aff-*` | Nouveau canal (non-spec V0) |
| Direct/Direct | `pdv`, `r2`, `direct`, `menu`, `mon-compte`, `legend` | Déjà couvert |

### Sources encore inconnues après règles étendues (volume faible)
`...`, `XXX`, `axel`, `bannarti`, `detente-financiere`, `itwhiggons`, `linktre` (typo de linktree), `source-3`  
**Volume total** : < 50 leads — négligeable, loggés en console.

---

## 6. Hypothèses à valider

| # | Hypothèse | Impact | À valider |
|---|---|---|---|
| H1 | LEADS couvre uniquement 2026 — les KPIs de volume leads / CPL ne seront calculables que sur 2026 | Moyen | Est-ce normal ? Y a-t-il un onglet historique ? |
| H2 | `ads2_google_*` = Paid/Google (ancienne nomenclature) | Faible | Confirmer |
| H3 | `aff-*` = canal Affiliation (hors spec V0, classifié "Organique/Affiliation" par défaut) | Faible | OK en V0 ou ignorer ? |
| H4 | `linktree`, `chaineytb`, `post-youtube` = trafic depuis YouTube (lien dans description, posts) → Organique/YouTube | Faible | Confirmer |
| H5 | `webi-sc-*` = Webinaire "Stratégie Complète" → Organique/Webinaire | Faible | Confirmer |
| H6 | Budget futur (post-aujourd'hui) dans BUDGET = planifié, ignoré pour les calculs réels | Moyen | Confirmer |
| H7 | `TOTAL HT` = CA utilisé pour tous les calculs financiers (pas `Prix` qui est le prix catalogue) | Fort | Confirmer |
| H8 | Colonne "Heure Calendly" dans VENTES = date/heure de l'appel de closing → appels passés si < NOW | Moyen | Confirmer |

---

## 7. Points de vigilance pour l'implémentation

1. **CALENDLY header** : Lire avec `header=None` et détecter la vraie ligne de headers (chercher une cellule = "DATE" ou "Mail") pour éviter le bug `17483`.
2. **LEADS période** : Si l'utilisateur sélectionne "Année en cours" ou "30 derniers jours", les données LEADS sont disponibles. Si > 2026-01-01, afficher un message "Données disponibles depuis janv. 2026".
3. **Budget futur** : Filtrer `BUDGET.Date <= today` pour les calculs. Afficher la période de couverture dans le tooltip du KPI.
4. **VENTES historique** : Les ventes remontent à 2021. Pour les presets > 1 an, les données existent mais sans les leads correspondants.
5. **Colonne "Remboursement"** dans ADS VENTES : à exclure du CA (ou déduire si non-null).

---

## 8. Targets — À créer

Le fichier `targets_2026.xlsx` n'existe pas encore. Je le créerai en Étape 2 avec des valeurs par défaut basées sur les données observées (ex: target CA = +20% vs réalisé 2025). **Tu pourras ajuster les chiffres directement dans le fichier Excel après livraison.**

---

## Résumé des actions avant Étape 2

| Action | Responsable | Bloquant ? |
|---|---|---|
| Valider H1 : LEADS uniquement 2026, est-ce normal ? | Franck | Oui (impact KPIs) |
| Valider H7 : TOTAL HT = CA de référence | Franck | Oui |
| Valider les hypothèses H2-H6 (classification sources) | Franck | Non (valeurs par défaut OK) |
| Configurer `.env` avec les vrais chemins Drive quand Mirror activé | Franck | Non (data/ utilisé pour l'instant) |

**Dès que tu valides H1 et H7, je démarre l'Étape 2 — Backend.**
