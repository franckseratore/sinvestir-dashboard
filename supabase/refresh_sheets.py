"""
Refresh quotidien des données ventes/calls/leads/ads depuis Google Sheets
→ Supabase Postgres.

Réutilise les loaders du backend Python (`backend/app/loaders.py` + `gsheets.py`)
qui supportent déjà la lecture Google Sheets via service account.

Variables d'env requises :
    DATABASE_URL        : Postgres Supabase (mode session, port 5432)
    GSHEETS_STATS_ID    : ID Google Sheets "stats" (ventes/calls/leads)
    GSHEETS_ADS_ID      : ID Google Sheets "ads" (leads_paid/calls_paid/ventes_paid/budget)
    GSHEETS_CREDS_B64   : Service account JSON encodé en base64
                          (le SA doit avoir accès Viewer aux deux Sheets)

NOTE : ne TOUCHE PAS la table `targets` (managée maintenant via l'admin du dashboard).

Usage :
    cd <repo>
    export DATABASE_URL=... GSHEETS_STATS_ID=... GSHEETS_ADS_ID=... GSHEETS_CREDS_B64=...
    python supabase/refresh_sheets.py
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import pandas as pd  # noqa: E402
import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from backend.app import loaders  # noqa: E402

# Constante non-vide passée à `_read_source` pour forcer le dispatch Google Sheets.
# Le code de `gsheets.py` utilise prioritairement `GSHEETS_CREDS_B64` env var,
# donc la valeur réelle de creds_path n'est pas utilisée pour l'auth.
_CREDS_SENTINEL = "use_env_b64"


def _as_native(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if pd.isna(v):
        return None
    if hasattr(v, "to_pydatetime"):
        return v.to_pydatetime()
    if hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            return v
    return v


def _df_to_records(df: pd.DataFrame, columns: list[str]) -> list[tuple]:
    if df is None or df.empty:
        return []
    for c in columns:
        if c not in df.columns:
            df = df.assign(**{c: None})
    return [tuple(_as_native(v) for v in row) for row in df[columns].itertuples(index=False, name=None)]


def _bulk_insert(conn: psycopg.Connection, table: str, columns: list[str], records: list[tuple]) -> int:
    if not records:
        return 0
    placeholders = ",".join(["%s"] * len(columns))
    cols_sql = ",".join(columns)
    sql = f"INSERT INTO {table} ({cols_sql}) VALUES ({placeholders})"
    with conn.cursor() as cur:
        cur.executemany(sql, records)
    return len(records)


def _truncate(conn: psycopg.Connection, tables: list[str]) -> None:
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")


VENTES_COLS = [
    "date", "mail", "source_initiale", "last_source",
    "canal", "sous_canal", "closer", "produit", "produit_nom",
    "ca_ht", "heure_calendly",
]
CALLS_COLS = [
    "date_reservation", "date_call", "closer", "source", "last_source",
    "canal", "sous_canal", "event_calendly", "is_past",
]
LEADS_COLS = ["date", "mail", "source", "canal", "sous_canal", "first_ac_action"]
LEADS_PAID_COLS = ["date", "source", "canal", "sous_canal", "first_ac_action"]
CALLS_PAID_COLS = [
    "date_reservation", "date_call", "closer", "source", "last_source",
    "canal", "sous_canal", "is_past",
]
VENTES_PAID_COLS = VENTES_COLS
BUDGET_COLS = ["date", "creative_id", "canal", "sous_canal", "spend"]


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("ERREUR : DATABASE_URL manquante.")

    stats_id = os.environ.get("GSHEETS_STATS_ID", "").strip()
    ads_id = os.environ.get("GSHEETS_ADS_ID", "").strip()
    if not (stats_id and ads_id):
        sys.exit("ERREUR : GSHEETS_STATS_ID et GSHEETS_ADS_ID requis.")
    # Auth : soit GSHEETS_CREDS_B64 (one-shot local), soit GOOGLE_APPLICATION_CREDENTIALS
    # posé par google-github-actions/auth (WIF en CI). Si aucun, on plante.
    if not (os.environ.get("GSHEETS_CREDS_B64") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")):
        sys.exit("ERREUR : GSHEETS_CREDS_B64 ou GOOGLE_APPLICATION_CREDENTIALS requis.")

    print(f"→ stats sheet ID : {stats_id}")
    print(f"→ ads sheet ID   : {ads_id}")

    t0 = time.time()
    print("\n[1/3] Fetch Google Sheets via service account ...")
    try:
        ventes        = loaders.load_ventes(stats_id, _CREDS_SENTINEL)
        calls         = loaders.load_calendly(stats_id, _CREDS_SENTINEL)
        leads         = loaders.load_leads(stats_id, _CREDS_SENTINEL)
        leads_paid    = loaders.load_ads_new_leads(ads_id, _CREDS_SENTINEL)
        calls_paid    = loaders.load_ads_calls(ads_id, _CREDS_SENTINEL)
        ventes_paid   = loaders.load_ads_ventes(ads_id, _CREDS_SENTINEL)
        budget        = loaders.load_budget(ads_id, _CREDS_SENTINEL)
    except Exception as e:
        sys.exit(f"ERREUR lecture Google Sheets : {e}")
    print(
        f"   ventes={len(ventes)}, calls={len(calls)}, leads={len(leads)}, "
        f"leads_paid={len(leads_paid)}, calls_paid={len(calls_paid)}, "
        f"ventes_paid={len(ventes_paid)}, budget={len(budget)}"
    )

    print("\n[2/3] TRUNCATE + INSERT en transaction ...")
    counts: dict[str, int] = {}
    with psycopg.connect(db_url, autocommit=False, row_factory=dict_row) as conn:
        with conn.transaction():
            _truncate(
                conn,
                ["ventes", "calls", "leads", "leads_paid", "calls_paid", "ventes_paid", "budget"],
            )
            counts["ventes"]      = _bulk_insert(conn, "ventes",      VENTES_COLS,      _df_to_records(ventes, VENTES_COLS))
            counts["calls"]       = _bulk_insert(conn, "calls",       CALLS_COLS,       _df_to_records(calls, CALLS_COLS))
            counts["leads"]       = _bulk_insert(conn, "leads",       LEADS_COLS,       _df_to_records(leads, LEADS_COLS))
            counts["leads_paid"]  = _bulk_insert(conn, "leads_paid",  LEADS_PAID_COLS,  _df_to_records(leads_paid, LEADS_PAID_COLS))
            counts["calls_paid"]  = _bulk_insert(conn, "calls_paid",  CALLS_PAID_COLS,  _df_to_records(calls_paid, CALLS_PAID_COLS))
            counts["ventes_paid"] = _bulk_insert(conn, "ventes_paid", VENTES_PAID_COLS, _df_to_records(ventes_paid, VENTES_PAID_COLS))
            counts["budget"]      = _bulk_insert(conn, "budget",      BUDGET_COLS,      _df_to_records(budget, BUDGET_COLS))

        print("\n[3/3] Vérification finale ...")
        with conn.cursor() as cur:
            for table in counts:
                cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
                actual = cur.fetchone()["c"]
                expected = counts[table]
                marker = "OK" if actual == expected else "MISMATCH"
                print(f"   [{marker}] {table:14s} inserted={expected} total_in_db={actual}")

    print(f"\n✨ Refresh terminé en {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
