-- Fix sémantique de l'indicateur `budget_paid`.
--
-- Avant : sens='Bas' → pct_atteinte = (target / value) * 100
--   Conséquence : 14 644€ dépensés sur target 30k → pct = 205% en green,
--   alors qu'on n'a déployé que 49% du budget. Message visuel trompeur.
--
-- Après : sens='Haut' → pct_atteinte = (value / target) * 100
--   14 644 / 30k → pct = 49% en red. Cohérent avec une lecture
--   "% de budget consommé sur la fenêtre", qui matche l'attente du CEO.
--
-- Le pacing (sprint Vague 2.2) raffinera la sémantique en comparant
-- ce % à `jour_actuel / jours_dans_le_mois`. Ce fix reste valable.

UPDATE targets SET sens = 'Haut' WHERE indicateur = 'budget_paid';
