#!/usr/bin/env python3
"""
Garmin -> dashboard health bridge.

Pulls your daily Garmin summaries with the unofficial `garminconnect`
library and pushes them to the health-ingest Worker. The dashboard then
pulls them in automatically (Settings -> Health bridge -> Connect Garmin,
using the SAME token as HEALTH_TOKEN below).

This uses your own Garmin credentials against Garmin's internal API. It is
NOT sanctioned by Garmin and can break when they change things; a library
version bump usually fixes it. Keep your credentials in environment
variables / secrets, never in this file or the repo.

Environment variables (all required except DAYS):
    GARMIN_EMAIL        your Garmin Connect login email
    GARMIN_PASSWORD     your Garmin Connect password
    HEALTH_INGEST_URL   e.g. https://fefe-health.fefedashboard.workers.dev
    HEALTH_TOKEN        the secret token you also entered in the dashboard
    DAYS                how many days back to sync (default 7)

Run:
    pip install -r scripts/requirements.txt
    python scripts/garmin_to_dashboard.py
"""

import os
import sys
import json
import time
import datetime as dt
from urllib import request as urlrequest, error as urlerror

# A browser-like identity: Cloudflare's bot protection rejects the default
# "Python-urllib/x.y" user agent with a 403, which is exactly what blocked the
# push before. This looks like an ordinary request instead.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("Missing dependency. Run: pip install -r scripts/requirements.txt")


def env(name, default=None, required=False):
    val = os.environ.get(name, default)
    if required and not val:
        sys.exit(f"Missing required environment variable: {name}")
    return val


def num(value):
    """Return a finite float, or None."""
    try:
        n = float(value)
        return n if n == n and n not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def build_entry(client, day):
    """Assemble one day's summary. Every metric is best-effort: a failure on
    one field must not lose the rest of the day."""
    iso = day.isoformat()
    entry = {"date": iso}

    # Daily summary carries most of what we want in one call.
    try:
        stats = client.get_stats(iso) or {}
    except Exception as exc:  # noqa: BLE001
        print(f"  {iso}: stats failed ({exc})", file=sys.stderr)
        stats = {}

    steps = num(stats.get("totalSteps"))
    if steps is not None:
        entry["steps"] = int(steps)
    rhr = num(stats.get("restingHeartRate"))
    if rhr is not None:
        entry["restingHeartRate"] = int(rhr)
    kcal = num(stats.get("activeKilocalories"))
    if kcal is not None:
        entry["activeEnergyKcal"] = int(kcal)
    stress = num(stats.get("averageStressLevel"))
    if stress is not None and stress >= 0:
        entry["stress"] = int(stress)

    # Body Battery: use the highest reading of the day when present.
    bb = num(stats.get("bodyBatteryHighestValue"))
    if bb is None:
        bb = num(stats.get("bodyBatteryMostRecentValue"))
    if bb is not None:
        entry["bodyBattery"] = int(bb)

    # Sleep (seconds -> the normaliser converts to hours).
    sleep_seconds = num(stats.get("sleepingSeconds"))
    if sleep_seconds is None:
        try:
            sleep = client.get_sleep_data(iso) or {}
            dto = sleep.get("dailySleepDTO") or {}
            sleep_seconds = num(dto.get("sleepTimeSeconds"))
        except Exception as exc:  # noqa: BLE001
            print(f"  {iso}: sleep failed ({exc})", file=sys.stderr)
    if sleep_seconds is not None and sleep_seconds > 0:
        entry["sleepSeconds"] = int(sleep_seconds)

    # HRV (last night's average, ms).
    try:
        hrv = client.get_hrv_data(iso) or {}
        summary = hrv.get("hrvSummary") or {}
        hrv_ms = num(summary.get("lastNightAvg")) or num(summary.get("weeklyAvg"))
        if hrv_ms is not None:
            entry["hrv"] = int(hrv_ms)
    except Exception as exc:  # noqa: BLE001
        print(f"  {iso}: hrv failed ({exc})", file=sys.stderr)

    # Activities/workouts for the day.
    try:
        acts = client.get_activities_by_date(iso, iso) or []
        workouts = []
        for a in acts:
            minutes = num(a.get("duration"))
            workouts.append({
                "type": (a.get("activityType") or {}).get("typeKey") or a.get("activityName") or "Workout",
                "durationMinutes": round(minutes / 60) if minutes else 0,
                "calories": int(num(a.get("calories")) or 0) or None,
            })
        workouts = [w for w in workouts if w["durationMinutes"] or w["calories"]]
        if workouts:
            entry["workouts"] = workouts
    except Exception as exc:  # noqa: BLE001
        print(f"  {iso}: activities failed ({exc})", file=sys.stderr)

    return entry


def push(url, token, days):
    body = json.dumps({"days": days}).encode("utf-8")
    req = urlrequest.Request(
        url.rstrip("/") + "/health",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Health-Token": token,
            "User-Agent": UA,
            "Accept": "application/json",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"Push failed: HTTP {exc.code} from the health store — {detail}")


def login_with_retry(email, password, attempts=4):
    """Garmin rate-limits (429) fresh logins, especially from shared cloud IPs.
    Retry a few times with growing back-off before giving up."""
    delay = 20
    for i in range(attempts):
        try:
            client = Garmin(email, password)
            client.login()
            return client
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            transient = "429" in msg or "rate" in msg or "too many" in msg or "timeout" in msg
            if i < attempts - 1 and transient:
                print(f"Login throttled, retrying in {delay}s … ({exc})", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                raise
    return None


def main():
    email = env("GARMIN_EMAIL", required=True)
    password = env("GARMIN_PASSWORD", required=True)
    ingest_url = env("HEALTH_INGEST_URL", required=True)
    token = env("HEALTH_TOKEN", required=True)
    back = int(env("DAYS", "7"))

    print(f"Logging in to Garmin as {email} …")
    client = login_with_retry(email, password)

    today = dt.date.today()
    days = []
    for i in range(back):
        day = today - dt.timedelta(days=i)
        print(f"Fetching {day.isoformat()} …")
        days.append(build_entry(client, day))

    print(f"Pushing {len(days)} day(s) to {ingest_url} …")
    result = push(ingest_url, token, days)
    print("Done:", result)


if __name__ == "__main__":
    main()
