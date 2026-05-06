import json
import urllib.request
import urllib.error
import structlog

log = structlog.get_logger()


def post_webhook(webhook_url: str, payload: dict) -> bool:
    """POST a Block Kit payload to a Slack incoming webhook."""
    if not webhook_url:
        log.warning("slack_webhook_not_configured")
        return False
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(webhook_url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            ok = resp.status == 200
            if not ok:
                log.error("slack_webhook_bad_status", status=resp.status)
            return ok
    except Exception as e:
        log.error("slack_webhook_error", error=str(e))
        return False
