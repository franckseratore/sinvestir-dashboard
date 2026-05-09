# Decisions Log

## 2026-05-09 — Axe 1 : Comparaison KPIs vs Objectifs
- **Décidé** : Affichage du % atteint sur chaque KPI principal du dashboard, comparé à `targets_2026.xlsx`.
- **Logique hybride** : bordure card = `seuil_critique` métier (par-KPI), badge = % atteint vs objectif (seuils universels 100/80).
- **Widget Score de la semaine** : remplace l'ancien banner global, intègre score + top alert + counts colorés.
- **« Plus en alerte »** : logique 2 tiers (priorité métier puis fallback universel).
- **Score global** : ratio simple `N_verts / N_avec_objectif`, cap à 100 % sur ce calcul uniquement.
- **Badge individuel** : affichage de la vraie valeur sans cap (251 % si surperformance).
- **Garde année** : appliquée uniquement si période entièrement hors-2026 (chevauchement OK).
- **Décidé par** : Franck (Head of Marketing) via brief structuré.
- **Sources** : BRIEF-axe-1-comparaison-objectifs.md
- **Statut** : implémenté et validé en desktop, dette technique mobile notée dans `TODO.md`.
