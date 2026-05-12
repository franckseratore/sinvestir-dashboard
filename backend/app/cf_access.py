"""
Validation des JWT Cloudflare Access.

Architecture cible (migration en cours — voir TODO.md > "Migration Cloudflare Pages") :
  Browser → CF Access (SSO @sinvestir.fr) → CF Pages → Cloud Run API

Cloudflare Access injecte un header `Cf-Access-Jwt-Assertion` (RS256) sur chaque
requête qui traverse la barrière SSO. Ce module vérifie sa signature contre les
clés publiques CF (JWKS), valide l'audience + l'issuer, et retourne les claims.

Pour activer : poser `CF_ACCESS_TEAM_DOMAIN` (ex. `sinvestir.cloudflareaccess.com`)
et `CF_ACCESS_AUD` (l'AUD tag de l'application CF Access, copié depuis le dashboard
Zero Trust). Tant que ces deux env vars sont vides, ce module est inerte et le
middleware d'auth retombe sur le chemin X-API-Key historique.
"""
from typing import Optional
import jwt
from jwt import PyJWKClient, InvalidTokenError

import structlog

log = structlog.get_logger()


class CFAccessError(Exception):
    """JWT CF Access invalide (signature, expiration, aud, iss…)."""


# Cache module-level du PyJWKClient — il gère son propre cache des clés (~1h par
# défaut) et la rotation. On le réinstancie uniquement si le team_domain change.
_jwks_client: Optional[PyJWKClient] = None
_jwks_team_domain: Optional[str] = None


def _get_jwks_client(team_domain: str) -> PyJWKClient:
    global _jwks_client, _jwks_team_domain
    if _jwks_client is None or _jwks_team_domain != team_domain:
        certs_url = f"https://{team_domain}/cdn-cgi/access/certs"
        _jwks_client = PyJWKClient(certs_url, cache_keys=True, lifespan=3600)
        _jwks_team_domain = team_domain
    return _jwks_client


def validate_cf_jwt(token: str, team_domain: str, audience: str) -> dict:
    """Vérifie un JWT CF Access. Retourne les claims, ou lève CFAccessError.

    Le token est signé RS256, l'issuer doit être `https://{team_domain}`, et
    l'audience doit matcher l'AUD de l'application CF Access.
    """
    if not token:
        raise CFAccessError("empty token")
    if not (team_domain and audience):
        raise CFAccessError("CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD not configured")
    try:
        client = _get_jwks_client(team_domain)
        signing_key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://{team_domain}",
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
        return claims
    except InvalidTokenError as e:
        raise CFAccessError(f"invalid token: {e}") from e
    except Exception as e:
        # Erreur réseau / JWKS / clé manquante. On ne masque pas, on log et on
        # remonte — l'auth retombera sur le fallback X-API-Key côté middleware.
        log.error("cf_access_jwt_unexpected_error", error=str(e))
        raise CFAccessError(f"jwt validation error: {e}") from e
