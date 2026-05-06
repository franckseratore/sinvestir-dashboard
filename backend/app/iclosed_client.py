"""iClosed API client — fetches event calls and deals."""
import json
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Optional

import pandas as pd
import structlog

log = structlog.get_logger()

BASE_URL = "https://public.api.iclosed.io"


def _get(path: str, api_key: str, params: dict = None) -> dict:
    url = f"{BASE_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _parse_call(c: dict) -> Optional[dict]:
    """Extract a flat row from a raw eventCall dict. Returns None if no date."""
    dt_str = (c.get("dateTimeUTC") or c.get("dateTime") or "")
    call_date = dt_str[:10] if dt_str else ""
    if not call_date:
        return None
    task = (c.get("task") or [{}])
    task = task[0] if task else {}
    deals = c.get("deals") or []
    user = c.get("user") or {}
    return {
        "id": c["id"],
        "date": call_date,
        "user_id": user.get("id"),
        "closer": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip(),
        "closer_email": user.get("email", ""),
        "contact_name": c.get("inviteeName", ""),
        "contact_email": c.get("inviteeEmail", ""),
        "outcome": task.get("outcome"),
        "no_sale_reason": task.get("noSaleReason"),
        "objection": task.get("objection"),
        "has_deal": len(deals) > 0,
        "deal_value": sum(float(d.get("value") or 0) for d in deals),
        "call_type": c.get("callType", ""),
        "duration": c.get("duration", 0),
    }


def fetch_event_calls(api_key: str, days: int = 90) -> pd.DataFrame:
    """Fetch past event calls with outcomes.

    The iClosed API uses page-based pagination (page=1,2,...).
    The default response (no page param) returns the most recent ~100 events
    that are not yet accessible via page pagination. Both sets are merged.
    """
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    seen_ids: set = set()
    rows: list = []

    def _add_call(c: dict) -> bool:
        """Parse and add call if within cutoff. Returns True if past cutoff."""
        if c["id"] in seen_ids:
            return False
        row = _parse_call(c)
        if row is None:
            return False
        if row["date"] < cutoff:
            return True  # past cutoff
        seen_ids.add(c["id"])
        rows.append(row)
        return False

    # Step 1 — fetch the most recent events (not yet in page-based results)
    recent = _get("/v1/eventCalls", api_key, {"eventType": "PAST", "limit": 100})
    for c in recent.get("data", {}).get("eventCalls", []):
        _add_call(c)

    # Step 2 — page-based pagination (page=1 = most recent historical, ascending page = older)
    page = 1
    while True:
        data = _get("/v1/eventCalls", api_key, {
            "eventType": "PAST",
            "limit": 100,
            "page": page,
        })
        calls = data.get("data", {}).get("eventCalls", [])
        if not calls:
            break

        past_cutoff = False
        for c in calls:
            if _add_call(c):
                past_cutoff = True
                break

        if past_cutoff:
            break
        page += 1

    _EMPTY_COLS = [
        "id", "date", "user_id", "closer", "closer_email",
        "contact_name", "contact_email", "outcome", "no_sale_reason",
        "objection", "has_deal", "deal_value", "call_type", "duration",
    ]
    if not rows:
        return pd.DataFrame(columns=_EMPTY_COLS)

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    log.info("ic_calls_loaded", count=len(df), pages=page)
    return df


def fetch_deals(api_key: str, days: int = 90) -> pd.DataFrame:
    """Fetch all WON + RECURRING + DEPOSIT deals.

    The iClosed deals API paginates via page= but returns data in a non-date
    order. We load all available pages plus the default response, deduplicate
    by ID, then apply the cutoff filter in-memory.
    """
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows: list = []
    seen_ids: set = set()

    def _add_deal(d: dict) -> None:
        if d["id"] in seen_ids:
            return
        seen_ids.add(d["id"])
        deal_date = (d.get("time") or "")[:10]
        user = d.get("user") or {}
        rows.append({
            "id": d["id"],
            "date": deal_date or None,
            "user_id": user.get("id"),
            "closer": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip(),
            "closer_email": user.get("email", ""),
            "value": float(d.get("value") or 0),
            "transaction_type": d.get("transactionType", ""),
            "product_id": d.get("productId"),
            "event_name": (d.get("event") or {}).get("name", ""),
        })

    for tx_type in ["WON", "RECURRING", "DEPOSIT"]:
        # Also fetch the "default" (no-page) response which may differ
        default = _get("/v1/deals", api_key, {"transactionType": tx_type, "limit": 100})
        for d in default.get("data", {}).get("deals", []):
            _add_deal(d)

        page = 1
        while True:
            data = _get("/v1/deals", api_key, {
                "transactionType": tx_type,
                "limit": 100,
                "page": page,
            })
            deals = data.get("data", {}).get("deals", [])
            if not deals:
                break
            for d in deals:
                _add_deal(d)
            total = data.get("data", {}).get("count", 0)
            if len(deals) < 100 or (total and page * 100 >= total):
                break
            page += 1

    _EMPTY_COLS = [
        "id", "date", "user_id", "closer", "closer_email",
        "value", "transaction_type", "product_id", "event_name",
    ]
    if not rows:
        return pd.DataFrame(columns=_EMPTY_COLS)

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    df = df[df["date"].notna() & (df["date"].astype(str) >= cutoff)]
    log.info("ic_deals_loaded", count=len(df))
    return df
