import threading
from pathlib import Path
from typing import Optional, List, Callable

import structlog
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

log = structlog.get_logger()

_debounce_timer: Optional[threading.Timer] = None
_debounce_lock = threading.Lock()
_DEBOUNCE_SECONDS = 5.0

_rebuild_callback: Optional[Callable] = None
_watched_files: List[Path] = []


def _on_change(changed_path: str) -> None:
    global _debounce_timer
    log.info("file_changed", path=changed_path)

    with _debounce_lock:
        if _debounce_timer is not None:
            _debounce_timer.cancel()
        _debounce_timer = threading.Timer(_DEBOUNCE_SECONDS, _do_rebuild, args=[changed_path])
        _debounce_timer.daemon = True
        _debounce_timer.start()


def _do_rebuild(changed_path: str) -> None:
    if _rebuild_callback:
        log.info("rebuilding_cache", triggered_by=changed_path)
        try:
            _rebuild_callback([changed_path])
        except Exception as e:
            log.error("rebuild_failed", error=str(e))


class _Handler(FileSystemEventHandler):
    def __init__(self, watched: set):
        self._watched = watched

    def on_modified(self, event):
        if not event.is_directory and event.src_path in self._watched:
            _on_change(event.src_path)

    def on_created(self, event):
        if not event.is_directory and event.src_path in self._watched:
            _on_change(event.src_path)


def start(paths: List[Path], on_change: Callable) -> Observer:
    global _rebuild_callback, _watched_files
    _rebuild_callback = on_change
    _watched_files = paths

    watched_strs = {str(p) for p in paths}
    dirs_to_watch = {str(p.parent) for p in paths}

    handler = _Handler(watched_strs)
    observer = Observer()
    for d in dirs_to_watch:
        observer.schedule(handler, d, recursive=False)

    observer.start()
    log.info("watcher_started", watching=list(dirs_to_watch))
    return observer
