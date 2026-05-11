# TODO

## Post-mortem semaine 12-16 mai

### Solution pérenne d'accès dashboard pour l'équipe (priorité haute, bloquant lundi 18 mai)
Cloudflare Tunnel mis en place le 11 mai à 15h comme solution temporaire après échec du sprint WIF (blocker : Vercel Hobby sans OIDC Federation + org policy GCP `iam.disableServiceAccountKeyCreation` et `iam.allowedPolicyMemberDomains`). Tunnel dépendant du Mac de Franck allumé + URL `*.trycloudflare.com` non stable entre redémarrages du tunnel. À résoudre la semaine du 12-16 mai. 3 options à arbitrer :

**Option 1 : IAP Cloud Run + custom domain (recommandée pour pérennité, ~2-3h)**
- Load Balancer + IAP devant Cloud Run, custom domain `dashboard.sinvestir.fr`
- SSO Google natif, restreint au domaine `sinvestir.fr`
- Coût ~16€/mois (Load Balancer)
- Pas besoin de Mac allumé, totalement managé
- Bonus : règle aussi la question du backend qui peut redevenir IAM-strict sans X-API-Key applicative

**Option 2 : Firebase Hosting + Firebase Auth (~2h, gratuit)**
- Frontend déployé sur Firebase Hosting
- Firebase Auth pour SSO Google (domaine sinvestir.fr)
- Refactor frontend pour intégrer Firebase SDK
- Cohérent avec écosystème GCP

**Option 3 : Upgrade Vercel Pro ($20/mois) + reprise du sprint WIF**
- Reprendre le travail Phase 2 commencé le 11 mai (proxy Vercel + WIF GCP)
- Sur Vercel Pro, OIDC Federation devient disponible → ExternalAccountClient + WIF Pool dans GCP
- ~1-2h de boulot, code déjà partiellement écrit (proxy adapté pour Cloud Run, à pivoter de gcloud CLI vers ExternalAccountClient)
- Estimé en termes d'effort : doc Vercel + GCP est claire (cf. session du 11 mai), confiance ~85 %

### Rotation des secrets transités via la conversation Claude
Trois valeurs sensibles ont transité par la conversation Claude le 2026-05-11 :
- `BACKEND_API_KEY` (48 chars base64, env var Cloud Run + GitHub Secret)
- Token Vercel (vcp_...) 24h scope Full Account — devrait être expiré naturellement le 12 mai matin
- `AUTH_PASSWORD` frontend (`dashboardsinvestir2026!*`)

Rotation recommandée après la revue de mardi 14h :
- BACKEND_API_KEY : nouvelle valeur via `openssl rand -base64 36`, update GitHub Secret + Cloud Scheduler headers + redeploy backend + .env.local frontend
- Token Vercel : déjà expiré, rien à faire si pas re-créé
- AUTH_PASSWORD : nouvelle valeur, update GitHub Secret + .env.local frontend
- Coût total ~10 min, à programmer la semaine du 12-16 mai

### Audit défense en profondeur X-API-Key + OIDC
Actuellement le backend valide à la fois (a) un OIDC Bearer token issu par l'identité de Franck (`franck@sinvestir.fr` → `domain:sinvestir.fr` → `run.invoker`) et (b) un header `X-API-Key` applicatif. Belt + suspenders volontaire pour la migration du 11 mai. À auditer : est-ce que X-API-Key apporte une valeur réelle en plus d'OIDC, ou est-ce que c'est de la friction sans bénéfice ? Si redondant, simplifier en retirant la couche X-API-Key (et donc la dépendance `require_api_key` du router FastAPI). Si non redondant, documenter explicitement le modèle de menace dans `backend/app/auth_middleware.py`.

### Code Phase 2 (proxy Vercel) à arbitrer
Le fichier `frontend/app/api/proxy/[...path]/route.ts` est actuellement en working tree (pas commité) avec deux variantes possibles :
- **Variante actuelle (Cloudflare Tunnel)** : utilise `child_process.execFileSync('gcloud auth print-identity-token')` — tourne uniquement sur le Mac de Franck
- **Variante WIF future (post Vercel Pro upgrade)** : utiliserait `ExternalAccountClient` de `google-auth-library` avec `getVercelOidcToken` du package `@vercel/oidc`

Décision à prendre en post-mortem : laquelle on garde en main ? Probablement la variante WIF (plus propre, plus pérenne). Le code Cloudflare Tunnel peut rester un fichier séparé ou être supprimé une fois la solution pérenne déployée.

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
