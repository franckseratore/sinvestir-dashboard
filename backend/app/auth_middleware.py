"""
Vérification d'un header partagé X-API-Key sur tous les endpoints publics.

Mode dev (BACKEND_API_KEY vide dans l'env) : auth désactivée pour ne pas casser
le dev local (npm run dev contre uvicorn local).

Mode prod (BACKEND_API_KEY renseignée) : toute requête doit présenter le header.
Utilisé par le proxy Vercel (qui ajoute aussi un OIDC Bearer token Cloud Run)
et par Cloud Scheduler (--update-headers).
"""
from fastapi import Header, HTTPException, status

from .config import settings


def require_api_key(x_api_key: str = Header(default="")):
    if not settings.BACKEND_API_KEY:
        return
    if x_api_key != settings.BACKEND_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key header",
        )
