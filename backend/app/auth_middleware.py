"""
Auth middleware acceptant SOIT un JWT Cloudflare Access SOIT un X-API-Key.

Logique de la dépendance `require_auth` (utilisée comme `router.dependencies`) :

  1. Si CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD sont configurés ET qu'un header
     `Cf-Access-Jwt-Assertion` est présent → on tente la validation JWT.
     Si OK → l'email du claim est stashé dans `request.state.cf_access_email`
     et la requête passe (le X-API-Key n'est même pas regardé).

  2. Sinon (CF pas configuré, ou JWT absent/invalide) → fallback X-API-Key :
     si `BACKEND_API_KEY` est configuré, le header doit matcher. Vide en dev.

Pendant la migration Cloud Run privé → CF Pages + CF Access, les deux chemins
coexistent : le proxy Next.js actuel continue à envoyer X-API-Key + OIDC tant
que CF Access n'est pas en place ; quand on bascule, on désactive X-API-Key en
vidant simplement BACKEND_API_KEY (les anciens caller-paths plantent en 401,
c'est voulu, ça force le cleanup).
"""
from fastapi import Header, HTTPException, Request, status

from .cf_access import CFAccessError, validate_cf_jwt
from .config import settings


def require_auth(
    request: Request,
    x_api_key: str = Header(default=""),
    cf_access_jwt_assertion: str = Header(default=""),
):
    # Chemin 1 : JWT CF Access (mode production cible)
    if settings.CF_ACCESS_TEAM_DOMAIN and settings.CF_ACCESS_AUD and cf_access_jwt_assertion:
        try:
            claims = validate_cf_jwt(
                cf_access_jwt_assertion,
                team_domain=settings.CF_ACCESS_TEAM_DOMAIN,
                audience=settings.CF_ACCESS_AUD,
            )
            request.state.cf_access_email = claims.get("email", "")
            return
        except CFAccessError:
            # Token présent mais invalide → on essaie quand même le fallback.
            # En mode 100% CF Access (sans BACKEND_API_KEY), ça retombera en 401.
            pass

    # Chemin 2 : X-API-Key (mode legacy / proxy Next.js sur le Mac)
    if settings.BACKEND_API_KEY:
        if x_api_key != settings.BACKEND_API_KEY:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing auth (expected Cf-Access-Jwt-Assertion or X-API-Key)",
            )
        return

    # Mode dev : aucune auth configurée → passe.
    return


# Alias rétro-compat : le module a longtemps exporté `require_api_key`. On garde
# le nom comme alias pour ne pas casser les imports externes éventuels (scripts,
# tests). À supprimer après la migration complète.
require_api_key = require_auth
