"""
Script one-shot : migre les données Excel actuelles vers Supabase Postgres.

Usage :
    cd <repo>
    export DATABASE_URL='postgresql://postgres:...@db.xxx.supabase.co:5432/postgres'
    export STATS_FILE_PATH="data/S'investir Statistiques - 2026.xlsx"
    export ADS_FILE_PATH="data/Statistiques Publicités S'investir.xlsx"
    export TARGETS_FILE_PATH="targets_2026.xlsx"
    python supabase/migrate_data.py

Le script :
  1. TRUNCATE les tables cibles (idempotent, on peut le relancer)
  2. INSERT en bulk les DataFrames produits par `backend/app/loaders.py`
  3. UPSERT pour `targets` (clé = indicateur)
  4. Affiche les counts par table à la fin.

Les credentials iClosed / ActiveCampaign ne sont PAS utilisés ici — les tables
`ic_*` et `ac_*` seront alimentées par le Workers backend via Cron Triggers
(cf migration_path.md, Stage 3).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Permet d'importer `backend.app.*` depuis la racine du repo
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import pandas as pd  # noqa: E402
import psycopg  # noqa: E402  # psycopg3
from psycopg.types.json import Jsonb  # noqa: E402  # not used directly but keeps mypy happy
from psycopg.rows import dict_row  # noqa: E402

from backend.app import loaders  # noqa: E402


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _as_native(value):
    """Convert numpy/pandas scalars to plain Python types for psycopg."""
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if pd.isna(value):
        return None
    if hasattr(value, "to_pydatetime"):
        return value.to_pydatetime()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _df_to_records(df: pd.DataFrame, columns: list[str]) -> list[tuple]:
    """Project the DataFrame onto the given columns, returning native tuples."""
    if df is None or df.empty:
        return []
    missing = [c for c in columns if c not in df.columns]
    if missing:
        # Ajoute les colonnes manquantes en NULL pour rester tolérant
        for c in missing:
            df = df.assign(**{c: None})
    out: list[tuple] = []
    for row in df[columns].itertuples(index=False, name=None):
        out.append(tuple(_as_native(v) for v in row))
    return out


def _bulk_insert(
    conn: psycopg.Connection,
    table: str,
    columns: list[str],
    records: list[tuple],
) -> int:
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
        # CASCADE pour éviter les soucis si on rajoute des FKs plus tard.
        cur.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")


# ─── Migration ────────────────────────────────────────────────────────────────


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


def migrate(database_url: str) -> None:
    stats_path = os.environ.get("STATS_FILE_PATH")
    ads_path = os.environ.get("ADS_FILE_PATH")
    targets_path = os.environ.get(
        "TARGETS_FILE_PATH", str(_REPO_ROOT / "targets_2026.xlsx")
    )
    if not stats_path or not ads_path:
        sys.exit("ERREUR : définir STATS_FILE_PATH et ADS_FILE_PATH dans l'env.")

    print(f"→ stats   : {stats_path}")
    print(f"→ ads     : {ads_path}")
    print(f"→ targets : {targets_path}")

    print("\n[1/4] Lecture des Excel via backend/app/loaders.py ...")
    ventes        = loaders.load_ventes(Path(stats_path))
    calls         = loaders.load_calendly(Path(stats_path))
    leads         = loaders.load_leads(Path(stats_path))
    leads_paid    = loaders.load_ads_new_leads(Path(ads_path))
    calls_paid    = loaders.load_ads_calls(Path(ads_path))
    ventes_paid   = loaders.load_ads_ventes(Path(ads_path))
    budget        = loaders.load_budget(Path(ads_path))
    targets_df    = loaders.load_targets(Path(targets_path))
    print(f"   ventes={len(ventes)}, calls={len(calls)}, leads={len(leads)}")
    print(
        f"   leads_paid={len(leads_paid)}, calls_paid={len(calls_paid)}, "
        f"ventes_paid={len(ventes_paid)}, budget={len(budget)}, "
        f"targets={len(targets_df)}"
    )

    print("\n[2/4] Connexion Postgres ...")
    with psycopg.connect(database_url, autocommit=False, row_factory=dict_row) as conn:
        print("\n[3/4] TRUNCATE + INSERT en transaction ...")
        with conn.transaction():
            _truncate(
                conn,
                [
                    "ventes", "calls", "leads",
                    "leads_paid", "calls_paid", "ventes_paid", "budget",
                ],
            )
            counts = {}
            counts["ventes"]      = _bulk_insert(conn, "ventes",      VENTES_COLS,      _df_to_records(ventes, VENTES_COLS))
            counts["calls"]       = _bulk_insert(conn, "calls",       CALLS_COLS,       _df_to_records(calls, CALLS_COLS))
            counts["leads"]       = _bulk_insert(conn, "leads",       LEADS_COLS,       _df_to_records(leads, LEADS_COLS))
            counts["leads_paid"]  = _bulk_insert(conn, "leads_paid",  LEADS_PAID_COLS,  _df_to_records(leads_paid, LEADS_PAID_COLS))
            counts["calls_paid"]  = _bulk_insert(conn, "calls_paid",  CALLS_PAID_COLS,  _df_to_records(calls_paid, CALLS_PAID_COLS))
            counts["ventes_paid"] = _bulk_insert(conn, "ventes_paid", VENTES_PAID_COLS, _df_to_records(ventes_paid, VENTES_PAID_COLS))
            counts["budget"]      = _bulk_insert(conn, "budget",      BUDGET_COLS,      _df_to_records(budget, BUDGET_COLS))

            # Targets : UPSERT par indicateur (PK)
            print("   → targets (UPSERT) ...")
            with conn.cursor() as cur:
                for _, row in targets_df.iterrows():
                    cur.execute(
                        """
                        INSERT INTO targets (
                          indicateur, description, unite, sens, target_2026,
                          target_mensuelle, seuil_critique, owner, prorata
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (indicateur) DO UPDATE SET
                          description      = EXCLUDED.description,
                          unite            = EXCLUDED.unite,
                          sens             = EXCLUDED.sens,
                          target_2026      = EXCLUDED.target_2026,
                          target_mensuelle = EXCLUDED.target_mensuelle,
                          seuil_critique   = EXCLUDED.seuil_critique,
                          owner            = EXCLUDED.owner,
                          prorata          = EXCLUDED.prorata
                        """,
                        (
                            _as_native(row.get("indicateur")),
                            _as_native(row.get("description")),
                            _as_native(row.get("unite")),
                            _as_native(row.get("sens")),
                            _as_native(row.get("target_2026")),
                            _as_native(row.get("target_mensuelle")),
                            _as_native(row.get("seuil_critique")),
                            _as_native(row.get("owner")),
                            bool(_as_native(row.get("prorata"))),
                        ),
                    )
            counts["targets"] = len(targets_df)
        # Transaction committed here

        print("\n[4/4] Vérification finale ...")
        with conn.cursor() as cur:
            for table in counts:
                cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
                actual = cur.fetchone()["c"]
                expected = counts[table]
                marker = "OK" if actual == expected else "MISMATCH"
                print(f"   [{marker}] {table:14s} attendu={expected} actual={actual}")


if __name__ == "__main__":
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("ERREUR : définir DATABASE_URL (Supabase Postgres) dans l'env.")
    migrate(db_url)
