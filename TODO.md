# TODO

## Post-mortem semaine 12-16 mai

### Rotation de la clé SA `vercel-proxy`
La clé JSON du SA `vercel-proxy@sinvestir-dashboard-2026.iam.gserviceaccount.com` (utilisée par Vercel pour signer les OIDC tokens vers le backend Cloud Run) a transité via le presse-papier le 2026-05-11 lors de la mise en place initiale. Risque R3 du plan migration Vercel : la valeur peut résider temporairement dans des historiques shell ou dans la conversation Claude. Action : régénérer une nouvelle clé via `gcloud iam service-accounts keys create`, mettre à jour l'env var Vercel `GCP_SA_KEY_B64`, puis supprimer l'ancienne clé via `gcloud iam service-accounts keys delete`. ~5 min de boulot pour fermer la fenêtre d'exposition.

### Évaluer migration Firebase Auth / Identity Platform pour SSO Google
Alternative au pattern actuel "SA JSON key Vercel → OIDC Cloud Run + X-API-Key applicative". Avec Firebase Auth / GCP Identity Platform, l'utilisateur final s'authentifie directement via SSO Google (compte sinvestir.fr), le frontend reçoit un ID token utilisateur qu'il forward au backend. Avantages : pas de clé SA à protéger, audit par utilisateur, révocation par compte Google. Inconvénients : ~2h de setup, dépendance Firebase, changement du flow login (vs middleware password actuel). À évaluer en exploration la semaine du 12-16 mai sans déclencher une migration immédiate.

### Audit défense en profondeur X-API-Key + OIDC
Actuellement le backend valide à la fois (a) un OIDC Bearer token issu par le SA `vercel-proxy` et (b) un header `X-API-Key` applicatif. Belt + suspenders volontaire pour la migration de ce soir. À auditer : est-ce que X-API-Key apporte une valeur réelle en plus d'OIDC, ou est-ce que c'est de la friction sans bénéfice ? Si redondant, simplifier en retirant la couche X-API-Key (et donc la dépendance `require_api_key` du router FastAPI). Si non redondant, documenter explicitement le modèle de menace dans `backend/app/auth_middleware.py`.

## Dette technique

### Tests unitaires sur la génération d'URLs Slack/Notion (priorité moyenne)
Aucun test unitaire ne couvre actuellement la construction des liens dans les récaps Slack et Notion. Le bug de duplication d'URL identifié le 2026-05-11 (deux fois `?period=last_week` concaténés) aurait été attrapé par un test basique. À ajouter dans la semaine du 12-16 mai. Tests proposés :
- Footer Slack "Dashboard last week" doit produire `{base}/?period=last_week` exactement (pas de doublon)
- Top alert link doit produire `{base}{href}?period=last_week` (avec gestion query si `href` contient déjà `?` ou `&`)
- Notion "Lien reporting hebdo" doit produire `{base}/?period=last_week`
- Idem pour le récap mensuel (`last_month`)

### Tests KPIs cassés depuis cf03f39 (priorité moyenne)
4 tests rouges dans `backend/tests/test_kpis.py` après le commit `cf03f39` (« enrichissement récaps Slack/Notion avec bloc Score + fix bénéfice par période »). Identifiés le 2026-05-11 lors de la mise en place du flag `ENABLE_INTERNAL_SCHEDULER`. Pas bloquant pour le déploiement (la CI `test.yml` ne lance pas pytest), mais les tests doivent être réalignés. À traiter dans la semaine du 12-16 mai.

Tests concernés et cause probable :
- `test_benefice_net` : `TypeError` — la signature de `kpis.benefice_net()` a changé (nouveau paramètre ou retour différent suite au « fix bénéfice par période »).
- `test_ca_by_produit` : `duckdb BinderException` — la query référence la colonne `produit_nom`, mais la table `ventes` expose `produit` (renommage non répercuté dans la query ou le test).
- `test_no_show_rate` et `test_closing_rate` : assertions numériques fausses (0.0 attendu 0.25, 1.0 attendu 1.33) — probable changement de logique de calcul dans `kpis.py`.

Action attendue : ouvrir chaque test, comparer aux nouvelles signatures/queries dans `backend/app/kpis.py`, et soit corriger le test (si le comportement métier a changé volontairement) soit corriger le code (si c'est une régression).

### Sécurité : endpoints admin publics (priorité haute)
Les endpoints `/api/admin/report/weekly` et `/api/admin/report/monthly` sur Cloud Run sont actuellement accessibles sans authentification (`--allow-unauthenticated` dans `.github/workflows/deploy-backend.yml`). N'importe qui qui découvre l'URL peut déclencher un spam Slack/Notion. Identifié le 2026-05-10 lors de la mise en place de Cloud Scheduler. À corriger dans la semaine du 12-16 mai. Solutions possibles :
- Header partagé `X-Admin-Token` vérifié côté FastAPI (simple)
- Auth Cloud Run IAM avec OIDC token côté Cloud Scheduler (plus propre, plus complexe)

### Responsive mobile (priorité basse)
Le dashboard n'a pas de design responsive global. En viewport mobile (375-390 px), la sidebar gauche reste visible et écrase le contenu principal. Identifié le 2026-05-09 lors de l'implémentation de l'axe 1 (Comparaison KPIs vs Objectifs). Décision : ne pas traiter dans le sprint axe 1, le dashboard est utilisé à 95 %+ en desktop. À traiter dans un sprint dédié ou intégrer à l'axe 5 (refonte esthétique).

Fix attendu :
- Sidebar en menu burger sur viewport < 768 px
- Layout des grilles KPIs adaptatif (2 colonnes < 1024 px, 1 colonne < 640 px)
- Widget Score : version compacte sur mobile

### Récap mensuel : 1er ou 2 du mois ? (à clarifier)
Le scheduler actuel (`_seconds_until_first_of_month_9am` dans `backend/app/main.py:144`) lance le récap mensuel le 1er du mois à 9h. Le brief Head of Marketing (CLAUDE.md du Project Claude S'investir, section 11.3) mentionne « le 2 de chaque mois ». Source de vérité à confirmer avec Mohammed Ali (pertinence pôle vente) ou Florian (consolidation Mathieu). Si « le 2 » est l'intention réelle : adapter le scheduler. Si « le 1er » est l'intention réelle : corriger le CLAUDE.md de la posture Head of Marketing pour rester cohérent. À traiter dans la semaine du 12-16 mai pour ne pas impacter le récap du 1er/2 juin 2026.

### Garde année hors-2026 dans `_scale_target` (effet janvier 2027)
Implémenté dans l'axe 1 : si la période active est ENTIÈREMENT hors-2026 (start.year ET end.year hors 2026, dans la même direction), `target=None` est retourné. Effet : à partir de février 2027, le récap mensuel automatique calcule janvier 2027 (entièrement hors-2026) → tous les emojis ⚪ (status=unknown) dans Slack/Notion. Mitigation à faire avant fin 2026 : créer `targets_2027.xlsx` et adapter le code pour lire le fichier targets en fonction de l'année active.
