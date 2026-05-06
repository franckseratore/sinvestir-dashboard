"""ActiveCampaign API client — fetches campaign stats and list metrics."""
import json
import urllib.request
from datetime import date, timedelta

import pandas as pd
import structlog

log = structlog.get_logger()


def _get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers={"Api-Token": api_key})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_campaigns(api_url: str, api_key: str, days: int = 90) -> pd.DataFrame:
    """Fetch campaigns sent in the last `days` days with open/click stats."""
    rows = []
    offset = 0
    limit = 100
    cutoff = (date.today() - timedelta(days=days)).isoformat()

    while True:
        url = f"{api_url}/api/3/campaigns?limit={limit}&offset={offset}&orders%5Bsdate%5D=DESC"
        data = _get(url, api_key)
        campaigns = data.get("campaigns", [])
        if not campaigns:
            break

        past_cutoff = False
        for c in campaigns:
            sdate = (c.get("sdate") or "")[:10]
            if sdate and sdate < cutoff:
                past_cutoff = True
                break
            sent = int(c.get("send_amt") or 0)
            if sent == 0:
                continue
            rows.append({
                "id": c["id"],
                "name": c.get("name", ""),
                "sdate": sdate or None,
                "send_amt": sent,
                "uniqueopens": int(c.get("uniqueopens") or 0),
                "uniquelinkclicks": int(c.get("uniquelinkclicks") or 0),
                "unsubscribes": int(c.get("unsubscribes") or 0),
                "hardbounces": int(c.get("hardbounces") or 0),
                "type": c.get("type", "single"),
            })

        if past_cutoff:
            break

        offset += limit
        total = int((data.get("meta") or {}).get("total", 0))
        if offset >= total:
            break

    if not rows:
        cols = ["id", "name", "sdate", "send_amt", "uniqueopens",
                "uniquelinkclicks", "unsubscribes", "hardbounces", "type",
                "open_rate", "ctr", "ctor"]
        return pd.DataFrame(columns=cols)

    df = pd.DataFrame(rows)
    df["sdate"] = pd.to_datetime(df["sdate"], errors="coerce").dt.date
    df["open_rate"] = (df["uniqueopens"] / df["send_amt"].replace(0, float("nan"))).fillna(0)
    df["ctr"] = (df["uniquelinkclicks"] / df["send_amt"].replace(0, float("nan"))).fillna(0)
    df["ctor"] = (df["uniquelinkclicks"] / df["uniqueopens"].replace(0, float("nan"))).fillna(0)
    log.info("ac_campaigns_loaded", count=len(df))
    return df


def fetch_lists(api_url: str, api_key: str) -> pd.DataFrame:
    """Fetch all lists with names (subscriber_count not always returned)."""
    url = f"{api_url}/api/3/lists?limit=100"
    data = _get(url, api_key)
    rows = []
    for lst in data.get("lists", []):
        rows.append({
            "id": lst["id"],
            "name": lst.get("name", ""),
        })
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=["id", "name"])
    log.info("ac_lists_loaded", count=len(df))
    return df


def fetch_total_contacts(api_url: str, api_key: str) -> int:
    url = f"{api_url}/api/3/contacts?limit=1"
    data = _get(url, api_key)
    return int((data.get("meta") or {}).get("total", 0))
