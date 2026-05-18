"""
Script one-shot : peuple les tables externes (ActiveCampaign + iClosed) dans Supabase.

Réutilise les clients Python existants pour fetcher les APIs, puis upsert dans
Postgres. Les tables `ac_campaigns`, `ac_lists`, `ic_calls`, `ic_deals` ont
toutes une PK naturelle (id TEXT), donc on fait un UPSERT par id.

Usage :
    cd <repo>
    export DATABASE_URL='postgresql://...'
    export AC_API_URL='...' AC_API_KEY='...' ICLOSED_API_KEY='...'
    python supabase/ingest_external.py [--days 90]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import pandas as pd  # noqa: E402
import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from backend.app import activecampaign_client as ac  # noqa: E402
from backend.app import iclosed_client as ic  # noqa: E402


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


def _upsert(conn: psycopg.Connection, table: str, columns: list[str], df: pd.DataFrame) -> int:
    if df is None or df.empty:
        print(f"   [SKIP] {table}: aucune ligne à insérer")
        return 0
    missing = [c for c in columns if c not in df.columns]
    for c in missing:
        df = df.assign(**{c: None})
    rows = [tuple(_as_native(v) for v in row) for row in df[columns].itertuples(index=False, name=None)]
    placeholders = ",".join(["%s"] * len(columns))
    cols_sql = ",".join(columns)
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c != "id")
    sql = f"""
        INSERT INTO {table} ({cols_sql}) VALUES ({placeholders})
        ON CONFLICT (id) DO UPDATE SET {update_set}
    """
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


AC_CAMPAIGNS_COLS = [
    "id", "name", "sdate", "send_amt", "uniqueopens",
    "uniquelinkclicks", "unsubscribes", "hardbounces", "type",
    "open_rate", "ctr", "ctor",
]
AC_LISTS_COLS = ["id", "name"]
IC_CALLS_COLS = [
    "id", "date", "user_id", "closer", "closer_email",
    "contact_name", "contact_email", "outcome", "no_sale_reason",
    "objection", "has_deal", "deal_value", "call_type", "duration",
]
IC_DEALS_COLS = [
    "id", "date", "user_id", "closer", "closer_email",
    "value", "transaction_type", "product_id", "event_name",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=90, help="Période de fetch en jours (défaut 90)")
    parser.add_argument("--skip-ac", action="store_true", help="Ne fetch pas ActiveCampaign")
    parser.add_argument("--skip-ic", action="store_true", help="Ne fetch pas iClosed")
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("ERREUR : DATABASE_URL manquante.")
    ac_url = os.environ.get("AC_API_URL", "")
    ac_key = os.environ.get("AC_API_KEY", "")
    ic_key = os.environ.get("ICLOSED_API_KEY", "")

    dfs: dict[str, pd.DataFrame] = {}

    if not args.skip_ac:
        if not (ac_url and ac_key):
            print("⚠️  AC_API_URL ou AC_API_KEY manquants, on skip ActiveCampaign")
        else:
            print(f"\n[1/2] Fetch ActiveCampaign (cutoff = {args.days} jours)...")
            dfs["ac_campaigns"] = ac.fetch_campaigns(ac_url, ac_key, days=args.days)
            dfs["ac_lists"] = ac.fetch_lists(ac_url, ac_key)
            print(f"   campaigns={len(dfs['ac_campaigns'])}, lists={len(dfs['ac_lists'])}")

    if not args.skip_ic:
        if not ic_key:
            print("⚠️  ICLOSED_API_KEY manquant, on skip iClosed")
        else:
            print(f"\n[2/2] Fetch iClosed (cutoff = {args.days} jours)...")
            dfs["ic_calls"] = ic.fetch_event_calls(ic_key, days=args.days)
            dfs["ic_deals"] = ic.fetch_deals(ic_key, days=args.days)
            print(f"   calls={len(dfs['ic_calls'])}, deals={len(dfs['ic_deals'])}")

    if not dfs:
        sys.exit("\nRien à pousser, sortie.")

    print(f"\n[3/3] UPSERT vers Postgres ...")
    with psycopg.connect(db_url, autocommit=False, row_factory=dict_row) as conn:
        with conn.transaction():
            counts = {}
            if "ac_campaigns" in dfs:
                counts["ac_campaigns"] = _upsert(conn, "ac_campaigns", AC_CAMPAIGNS_COLS, dfs["ac_campaigns"])
            if "ac_lists" in dfs:
                counts["ac_lists"] = _upsert(conn, "ac_lists", AC_LISTS_COLS, dfs["ac_lists"])
            if "ic_calls" in dfs:
                counts["ic_calls"] = _upsert(conn, "ic_calls", IC_CALLS_COLS, dfs["ic_calls"])
            if "ic_deals" in dfs:
                counts["ic_deals"] = _upsert(conn, "ic_deals", IC_DEALS_COLS, dfs["ic_deals"])

        with conn.cursor() as cur:
            for table in counts:
                cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
                actual = cur.fetchone()["c"]
                print(f"   [OK] {table:14s} upserted={counts[table]:5d} total_in_db={actual}")


if __name__ == "__main__":
    main()
