import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (2 levels up from this file)
_root = Path(__file__).parent.parent.parent
load_dotenv(_root / ".env")


class Settings:
    STATS_FILE_PATH: Path = Path(os.environ.get("STATS_FILE_PATH", ""))
    ADS_FILE_PATH: Path = Path(os.environ.get("ADS_FILE_PATH", ""))
    TARGETS_FILE_PATH: Path = Path(os.environ.get("TARGETS_FILE_PATH", str(_root / "targets_2026.xlsx")))
    COUT_AGENCE_MENSUEL: float = float(os.environ.get("COUT_AGENCE_MENSUEL", 3000))
    DEBUG: bool = os.environ.get("DEBUG", "false").lower() == "true"
    DB_PATH: Path = Path(__file__).parent.parent / "data" / "cache.duckdb"

    # Google Sheets — set these 3 vars to enable GSheets mode (Excel becomes fallback)
    GSHEETS_STATS_ID: str = os.environ.get("GSHEETS_STATS_ID", "")
    GSHEETS_ADS_ID: str = os.environ.get("GSHEETS_ADS_ID", "")
    GSHEETS_CREDS_PATH: str = os.environ.get(
        "GSHEETS_CREDS_PATH",
        str(Path(__file__).parent.parent / "credentials" / "google-service-account.json"),
    )
    # En production (Cloud Run), passer le JSON du compte de service en base64 via cette var.
    # Générer avec : base64 -i google-service-account.json | tr -d '\n'
    GSHEETS_CREDS_B64: str = os.environ.get("GSHEETS_CREDS_B64", "")
    REFRESH_INTERVAL_SECS: int = int(os.environ.get("REFRESH_INTERVAL_SECS", 1800))

    # Scheduler interne (asyncio) qui envoie les récaps hebdo/mensuels.
    # Doit être désactivé en prod (Cloud Run, min-instances=0) au profit de Cloud Scheduler externe.
    ENABLE_INTERNAL_SCHEDULER: bool = os.environ.get("ENABLE_INTERNAL_SCHEDULER", "true").lower() == "true"

    # Clé partagée vérifiée par auth_middleware.require_api_key.
    # Vide en dev local → auth désactivée. Renseignée en prod via GitHub Secret BACKEND_API_KEY.
    BACKEND_API_KEY: str = os.environ.get("BACKEND_API_KEY", "")

    # ── Rapports Slack ───────────────────────────────────────────────────────
    # SLACK_WEBHOOK_URL : webhook vers #marketing — utilisé par le récap mensuel
    # (1er du mois 9h). Audience large (toute l'équipe marketing).
    SLACK_WEBHOOK_URL: str = os.environ.get("SLACK_WEBHOOK_URL", "")
    # SLACK_WEBHOOK_INTERNAL : webhook vers le DM/groupe privé Franck+Léo —
    # utilisé par le récap hebdo (lundi 9h). Contient les perfs S vs S-1
    # plus le pacing MTD avec projection fin de mois. Audience interne pour
    # préparer la revue équipe du mardi.
    SLACK_WEBHOOK_INTERNAL: str = os.environ.get("SLACK_WEBHOOK_INTERNAL", "")
    DASHBOARD_URL: str = os.environ.get("DASHBOARD_URL", "")
    # Notion — créer une intégration sur https://www.notion.so/profile/integrations
    # puis connecter l'intégration à la database "Revues hebdo équipe"
    NOTION_API_KEY: str = os.environ.get("NOTION_API_KEY", "")
    NOTION_WEEKLY_DB_ID: str = os.environ.get("NOTION_WEEKLY_DB_ID", "f1fd691cb9ff4b8c8f50c7e76b63eab8")

    # ── Intégrations externes ────────────────────────────────────────────────
    AC_API_URL: str = os.environ.get("AC_API_URL", "")
    AC_API_KEY: str = os.environ.get("AC_API_KEY", "")
    ICLOSED_API_KEY: str = os.environ.get("ICLOSED_API_KEY", "")

    @property
    def use_gsheets(self) -> bool:
        return bool(self.GSHEETS_STATS_ID and self.GSHEETS_ADS_ID)

    def validate_paths(self) -> list[str]:
        if self.use_gsheets:
            return []
        errors = []
        for name, path in [
            ("STATS_FILE_PATH", self.STATS_FILE_PATH),
            ("ADS_FILE_PATH", self.ADS_FILE_PATH),
        ]:
            if not path or not Path(path).exists():
                errors.append(f"{name} introuvable : {path}")
        return errors


settings = Settings()
