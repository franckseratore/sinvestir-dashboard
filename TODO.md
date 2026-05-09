# TODO

## Dette technique

### Responsive mobile (priorité basse)
Le dashboard n'a pas de design responsive global. En viewport mobile (375-390 px), la sidebar gauche reste visible et écrase le contenu principal. Identifié le 2026-05-09 lors de l'implémentation de l'axe 1 (Comparaison KPIs vs Objectifs). Décision : ne pas traiter dans le sprint axe 1, le dashboard est utilisé à 95 %+ en desktop. À traiter dans un sprint dédié ou intégrer à l'axe 5 (refonte esthétique).

Fix attendu :
- Sidebar en menu burger sur viewport < 768 px
- Layout des grilles KPIs adaptatif (2 colonnes < 1024 px, 1 colonne < 640 px)
- Widget Score : version compacte sur mobile
