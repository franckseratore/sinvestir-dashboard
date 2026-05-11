import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _reload_config(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("ENABLE_INTERNAL_SCHEDULER", raising=False)
    else:
        monkeypatch.setenv("ENABLE_INTERNAL_SCHEDULER", value)
    from backend.app import config
    importlib.reload(config)
    return config


def test_flag_defaults_to_true(monkeypatch):
    config = _reload_config(monkeypatch, None)
    assert config.settings.ENABLE_INTERNAL_SCHEDULER is True


def test_flag_false_disables(monkeypatch):
    config = _reload_config(monkeypatch, "false")
    assert config.settings.ENABLE_INTERNAL_SCHEDULER is False


def test_flag_case_insensitive(monkeypatch):
    config = _reload_config(monkeypatch, "FALSE")
    assert config.settings.ENABLE_INTERNAL_SCHEDULER is False


def _run_lifespan_capture_tasks(monkeypatch, enable_flag: bool) -> list[str]:
    """Drive the FastAPI lifespan with mocks and return the qualnames of every coroutine scheduled."""
    from backend.app import main as main_mod
    from backend.app import config as config_mod

    monkeypatch.setattr(config_mod.settings, "ENABLE_INTERNAL_SCHEDULER", enable_flag)
    monkeypatch.setattr(main_mod, "_observer", None)
    monkeypatch.setattr(main_mod.watcher, "start", MagicMock(return_value=None))

    scheduled: list[str] = []
    real_create_task = asyncio.create_task

    def tracking_create_task(coro, *args, **kwargs):
        name = getattr(coro, "__qualname__", None) or repr(coro)
        scheduled.append(name)
        try:
            coro.close()
        except (AttributeError, ValueError):
            pass

        async def _noop():
            return None

        return real_create_task(_noop())

    monkeypatch.setattr(main_mod.asyncio, "create_task", tracking_create_task)

    async def _run():
        async with main_mod.lifespan(MagicMock()):
            pass

    asyncio.run(_run())
    return scheduled


def test_lifespan_skips_schedulers_when_disabled(monkeypatch):
    scheduled = _run_lifespan_capture_tasks(monkeypatch, enable_flag=False)
    assert not any("_weekly_scheduler" in s for s in scheduled), f"Weekly scheduler should not run, got: {scheduled}"
    assert not any("_monthly_scheduler" in s for s in scheduled), f"Monthly scheduler should not run, got: {scheduled}"


def test_lifespan_starts_schedulers_when_enabled(monkeypatch):
    scheduled = _run_lifespan_capture_tasks(monkeypatch, enable_flag=True)
    assert any("_weekly_scheduler" in s for s in scheduled), f"Weekly scheduler should run, got: {scheduled}"
    assert any("_monthly_scheduler" in s for s in scheduled), f"Monthly scheduler should run, got: {scheduled}"
