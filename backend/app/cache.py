import threading
from datetime import datetime
from pathlib import Path
from typing import Optional, List

import duckdb
import structlog

log = structlog.get_logger()

_lock = threading.Lock()
_conn: Optional[duckdb.DuckDBPyConnection] = None
_last_refresh: Optional[datetime] = None
_status: str = "initializing"
_last_modified_files: List[str] = []


def _get_conn() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        db_path = Path(__file__).parent.parent / "data" / "cache.duckdb"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(str(db_path))
    return _conn


def build(stats_data: dict, ads_data: dict, targets_df) -> None:
    global _last_refresh, _status, _last_modified_files

    with _lock:
        conn = _get_conn()
        try:
            _create_tables(conn, stats_data, ads_data, targets_df)
            _last_refresh = datetime.now()
            _status = "ok"
            log.info("cache_built", at=_last_refresh.isoformat())
        except Exception as e:
            _status = "error"
            log.error("cache_build_error", error=str(e))
            raise


def build_external(ac_data: dict, ic_data: dict) -> None:
    """Load ActiveCampaign + iClosed data into DuckDB tables."""
    with _lock:
        conn = _get_conn()
        try:
            tables = {
                "ac_campaigns": ac_data.get("campaigns"),
                "ac_lists":     ac_data.get("lists"),
                "ic_calls":     ic_data.get("calls"),
                "ic_deals":     ic_data.get("deals"),
            }
            for name, df in tables.items():
                if df is None or df.empty:
                    conn.execute(f"DROP TABLE IF EXISTS {name}")
                    continue
                conn.execute(f"DROP TABLE IF EXISTS {name}")
                conn.register(f"_tmp_{name}", df)
                conn.execute(f"CREATE TABLE {name} AS SELECT * FROM _tmp_{name}")
                conn.unregister(f"_tmp_{name}")
                log.debug("external_table_created", table=name, rows=len(df))
            log.info("external_cache_built")
        except Exception as e:
            log.error("external_cache_build_error", error=str(e))
            raise


def _create_tables(conn, stats_data, ads_data, targets_df):
    import pandas as pd

    ventes = stats_data["ventes"]
    calendly = stats_data["calendly"]
    leads = stats_data["leads"]
    new_leads = ads_data["new_leads"]
    calls_paid = ads_data["calls"]
    ventes_paid = ads_data["ventes"]
    budget = ads_data["budget"]

    tables = {
        "ventes": ventes,
        "calls": calendly,
        "leads": leads,
        "leads_paid": new_leads,
        "calls_paid": calls_paid,
        "ventes_paid": ventes_paid,
        "budget": budget,
        "targets": targets_df,
    }

    for name, df in tables.items():
        conn.execute(f"DROP TABLE IF EXISTS {name}")
        conn.register(f"_tmp_{name}", df)
        conn.execute(f"CREATE TABLE {name} AS SELECT * FROM _tmp_{name}")
        conn.unregister(f"_tmp_{name}")
        log.debug("table_created", table=name, rows=len(df))


def query(sql: str, params: Optional[list] = None):
    with _lock:
        conn = _get_conn()
        if params:
            return conn.execute(sql, params).fetchdf()
        return conn.execute(sql).fetchdf()


def query_one(sql: str, params: Optional[list] = None):
    df = query(sql, params)
    if df.empty:
        return None
    val = df.iloc[0, 0]
    # Convert numpy scalars to Python native types for JSON serialization
    if hasattr(val, "item"):
        return val.item()
    return val


def execute(sql: str, params: Optional[list] = None) -> None:
    with _lock:
        conn = _get_conn()
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)


def get_status() -> dict:
    return {
        "last_refresh": _last_refresh.isoformat() if _last_refresh else None,
        "last_modified_files": _last_modified_files,
        "status": _status,
        "drive_sync_ok": _status == "ok",
    }


def set_modified_files(files: List[str]) -> None:
    global _last_modified_files
    _last_modified_files = files
