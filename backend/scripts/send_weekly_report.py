#!/usr/bin/env python3
"""
Rapport hebdo S'investir — script autonome.
Lancé chaque lundi à 09h00 par launchd.
"""
import sys
import duckdb

sys.path.insert(0, "/Users/franckseratore/sinvestir-dashboard/backend")

# Patch cache en mémoire — indépendant du backend si celui-ci tourne
import app.cache as _cache_mod
_cache_mod._conn = duckdb.connect(":memory:")

from app.config import settings
from app.loaders import (
    load_ventes, load_calendly, load_leads,
    load_ads_calls, load_ads_new_leads, load_ads_ventes, load_budget, load_targets,
)
from app import cache
from app.weekly_report import send_weekly_report
import structlog

log = structlog.get_logger()

log.info("weekly_script_start")

stats_src = settings.GSHEETS_STATS_ID
ads_src   = settings.GSHEETS_ADS_ID
creds     = settings.GSHEETS_CREDS_PATH

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

send_weekly_report()
log.info("weekly_script_done")
