import pandas as pd
import structlog

log = structlog.get_logger()

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

_client_cache = None


def _get_client(creds_path: str = None):
    global _client_cache
    if _client_cache is None:
        import json
        import gspread
        from pathlib import Path
        from .config import settings

        adc_path = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
        client_secret_path = Path(creds_path) if creds_path else None

        if settings.GSHEETS_CREDS_B64:
            # Production (Cloud Run) — credentials JSON passé en base64 via variable d'env
            import base64
            from google.oauth2.service_account import Credentials
            raw = json.loads(base64.b64decode(settings.GSHEETS_CREDS_B64).decode())
            creds = Credentials.from_service_account_info(raw, scopes=_SCOPES)
        elif client_secret_path and client_secret_path.exists():
            raw = json.loads(client_secret_path.read_text())
            if "installed" in raw or "web" in raw:
                # OAuth client secret JSON — use with ADC refresh token
                from google.oauth2.credentials import Credentials
                from google.auth.transport.requests import Request
                adc = json.loads(adc_path.read_text())
                creds = Credentials(
                    token=None,
                    refresh_token=adc["refresh_token"],
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=adc["client_id"],
                    client_secret=adc["client_secret"],
                )
                creds.refresh(Request())
            else:
                # Service account JSON
                from google.oauth2.service_account import Credentials
                creds = Credentials.from_service_account_file(str(client_secret_path), scopes=_SCOPES)
        elif adc_path.exists():
            # Application Default Credentials
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request
            adc = json.loads(adc_path.read_text())
            creds = Credentials(
                token=None,
                refresh_token=adc["refresh_token"],
                token_uri="https://oauth2.googleapis.com/token",
                client_id=adc["client_id"],
                client_secret=adc["client_secret"],
            )
            creds.refresh(Request())
        else:
            # Cloud Run / GCE — utilise l'identité du service account attaché
            import google.auth
            creds, _ = google.auth.default(scopes=_SCOPES)

        _client_cache = gspread.authorize(creds)
    return _client_cache


def reset_client():
    """Force re-auth (e.g. after credential rotation)."""
    global _client_cache
    _client_cache = None


def _deduplicate_columns(columns: list) -> list:
    """Replicate pandas behavior for duplicate column names (Col → Col, Col.1, Col.2…)."""
    seen: dict[str, int] = {}
    result = []
    for col in columns:
        if col in seen:
            seen[col] += 1
            result.append(f"{col}.{seen[col]}")
        else:
            seen[col] = 0
            result.append(col)
    return result


def read_tab(sheet_id: str, tab_name: str, creds_path: str = None, header=0, usecols=None) -> pd.DataFrame:
    """
    Fetch a Google Sheets tab as a DataFrame.

    header=0  → first row is column names (default)
    header=None → integer column indices, raw values (for budget-style parsing)
    usecols   → list of int (positional) or str (column names) to keep
    """
    try:
        gc = _get_client(creds_path)
        ws = gc.open_by_key(sheet_id).worksheet(tab_name)
        values = ws.get_all_values()

        if not values:
            return pd.DataFrame()

        if header is None:
            df = pd.DataFrame(values)
        else:
            cols = _deduplicate_columns([str(c).strip() for c in values[0]])
            rows = [[cell if cell != "" else None for cell in row] for row in values[1:]]
            df = pd.DataFrame(rows, columns=cols)

        if usecols is not None:
            if len(usecols) > 0 and isinstance(usecols[0], int):
                df = df.iloc[:, usecols]
            else:
                available = [c for c in usecols if c in df.columns]
                df = df[available]

        log.info("gsheets_read", tab=tab_name, rows=len(df))
        return df

    except Exception as e:
        log.error("gsheets_read_error", tab=tab_name, error=str(e))
        raise
