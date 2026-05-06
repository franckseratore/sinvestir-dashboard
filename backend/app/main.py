import asyncio
import json
import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List

import numpy as np
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import cache, watcher
from .api import router
from .config import settings
from .loaders import (
    load_ads_calls,
    load_ads_new_leads,
    load_ads_ventes,
    load_budget,
    load_calendly,
    load_leads,
    load_targets,
    load_ventes,
)
from .source_classifier import get_unknown_sources

log = structlog.get_logger()

_observer = None


def _rebuild_external() -> None:
    """Load ActiveCampaign + iClosed data into DuckDB."""
    if not (settings.AC_API_KEY and settings.ICLOSED_API_KEY):
        log.warning("external_apis_skipped", reason="AC_API_KEY or ICLOSED_API_KEY not set")
        return
    try:
        from .activecampaign_client import fetch_campaigns, fetch_lists
        from .iclosed_client import fetch_event_calls, fetch_deals

        log.info("loading_external_apis")
        ac_data = {
            "campaigns": fetch_campaigns(settings.AC_API_URL, settings.AC_API_KEY, days=90),
            "lists":     fetch_lists(settings.AC_API_URL, settings.AC_API_KEY),
        }
        ic_data = {
            "calls": fetch_event_calls(settings.ICLOSED_API_KEY, days=180),
            "deals": fetch_deals(settings.ICLOSED_API_KEY, days=180),
        }
        cache.build_external(ac_data, ic_data)
        log.info("external_apis_loaded")
    except Exception as e:
        log.error("external_apis_error", error=str(e))


def _rebuild(modified_files: Optional[List[str]] = None) -> None:
    log.info("loading_data_files", source="gsheets" if settings.use_gsheets else "excel")

    errors = settings.validate_paths()
    if errors:
        for e in errors:
            log.error("path_error", detail=e)
        cache._status = "error"
        return

    if settings.use_gsheets:
        stats_src = settings.GSHEETS_STATS_ID
        ads_src = settings.GSHEETS_ADS_ID
        creds = settings.GSHEETS_CREDS_PATH
    else:
        stats_src = settings.STATS_FILE_PATH
        ads_src = settings.ADS_FILE_PATH
        creds = None

    stats_data = {
        "ventes":   load_ventes(stats_src, creds),
        "calendly": load_calendly(stats_src, creds),
        "leads":    load_leads(stats_src, creds),
    }
    ads_data = {
        "new_leads": load_ads_new_leads(ads_src, creds),
        "calls":     load_ads_calls(ads_src, creds),
        "ventes":    load_ads_ventes(ads_src, creds),
        "budget":    load_budget(ads_src, creds),
    }
    targets = load_targets(settings.TARGETS_FILE_PATH)

    cache.build(stats_data, ads_data, targets)

    unknown = get_unknown_sources()
    if unknown:
        log.warning("unknown_sources", count=len(unknown), sources=unknown[:20])

    if modified_files:
        cache.set_modified_files(modified_files)


async def _auto_refresh():
    """Background task: reload from GSheets + external APIs every REFRESH_INTERVAL_SECS."""
    interval = settings.REFRESH_INTERVAL_SECS
    log.info("auto_refresh_scheduled", interval_secs=interval)
    while True:
        await asyncio.sleep(interval)
        log.info("auto_refresh_start")
        try:
            await asyncio.to_thread(_rebuild)
            await asyncio.to_thread(_rebuild_external)
            log.info("auto_refresh_done")
        except Exception as e:
            log.error("auto_refresh_error", error=str(e))


async def _external_on_startup():
    """Load AC + iClosed in background right after startup (non-blocking)."""
    await asyncio.to_thread(_rebuild_external)


def _seconds_until_monday_10am() -> float:
    """Compute seconds until next Monday 10:00 Europe/Paris."""
    from zoneinfo import ZoneInfo
    now = datetime.datetime.now(ZoneInfo("Europe/Paris"))
    days_until_monday = (7 - now.weekday()) % 7
    candidate = now.replace(hour=10, minute=0, second=0, microsecond=0) + datetime.timedelta(days=days_until_monday)
    if candidate <= now:
        candidate += datetime.timedelta(weeks=1)
    return max(60.0, (candidate - now).total_seconds())


async def _weekly_scheduler():
    """Background task: send the weekly report every Monday at 10:00 Paris time."""
    from .weekly_report import send_weekly_report
    while True:
        secs = _seconds_until_monday_10am()
        next_dt = datetime.datetime.now() + datetime.timedelta(seconds=secs)
        log.info("weekly_report_scheduled", next_run=next_dt.strftime("%Y-%m-%d %H:%M"))
        await asyncio.sleep(secs)
        try:
            await asyncio.to_thread(send_weekly_report)
        except Exception as e:
            log.error("weekly_report_scheduler_error", error=str(e))


def _seconds_until_first_of_month_9am() -> float:
    """Compute seconds until the 1st of next month at 09:00 Europe/Paris."""
    from zoneinfo import ZoneInfo
    now = datetime.datetime.now(ZoneInfo("Europe/Paris"))
    if now.month == 12:
        first = now.replace(year=now.year + 1, month=1, day=1, hour=9, minute=0, second=0, microsecond=0)
    else:
        first = now.replace(month=now.month + 1, day=1, hour=9, minute=0, second=0, microsecond=0)
    return max(60.0, (first - now).total_seconds())


async def _monthly_scheduler():
    """Background task: send the monthly report on the 1st of each month at 09:00 Paris time."""
    from .weekly_report import send_monthly_report
    while True:
        secs = _seconds_until_first_of_month_9am()
        next_dt = datetime.datetime.now() + datetime.timedelta(seconds=secs)
        log.info("monthly_report_scheduled", next_run=next_dt.strftime("%Y-%m-%d %H:%M"))
        await asyncio.sleep(secs)
        try:
            await asyncio.to_thread(send_monthly_report)
        except Exception as e:
            log.error("monthly_report_scheduler_error", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _observer
    log.info("dashboard_startup")

    refresh_task = asyncio.create_task(_auto_refresh())
    external_task = asyncio.create_task(_external_on_startup())
    # Rebuild in background so the server starts immediately
    asyncio.create_task(asyncio.to_thread(_rebuild))
    weekly_task = asyncio.create_task(_weekly_scheduler())
    monthly_task = asyncio.create_task(_monthly_scheduler())

    # File watcher — only for Excel mode (targets file always watched)
    if not settings.use_gsheets:
        paths = [settings.STATS_FILE_PATH, settings.ADS_FILE_PATH]
        if settings.TARGETS_FILE_PATH.exists():
            paths.append(settings.TARGETS_FILE_PATH)
        _observer = watcher.start(paths, _rebuild)
    elif settings.TARGETS_FILE_PATH.exists():
        _observer = watcher.start([settings.TARGETS_FILE_PATH], _rebuild)

    yield

    for task in (refresh_task, weekly_task, monthly_task, external_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    if _observer:
        _observer.stop()
        _observer.join()

    log.info("dashboard_shutdown")


app = FastAPI(title="S'investir Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {"status": "ok", "service": "sinvestir-dashboard-api"}
