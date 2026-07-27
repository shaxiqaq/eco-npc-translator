# -*- coding: utf-8 -*-
"""Session grind / EXP tracker for ECO.

Protocol notes (SagaECO / official-style map packets):
  - SSMG_PLAYER_EXP (0x0235 / 565): CEXP% and JEXP% as uint32, scale ×10
    (345 → 34.5%). Absolute Exp/JExp int64 fields appear only on older
    protocol lengths (≈34-byte payload).
  - SSMG_PLAYER_LEVEL (0x023A / 570): base + job levels.

Absolute EXP is estimated from data/exp_table.json (SagaECO curve). Official
private servers may use different tables — percentage totals are always exact.
"""
from __future__ import annotations

import json
import os
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple


# Idle gap: if no EXP gain for this long, stop counting "active grind" time.
DEFAULT_IDLE_GAP_S = 120.0
# Keep samples for rolling windows (session can be long).
MAX_SAMPLES = 4000
# Soft-cap history events shown in UI.
MAX_EVENTS = 40


def load_exp_table(path: Optional[str] = None) -> Dict[str, Any]:
    candidates = []
    if path:
        candidates.append(path)
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.extend(
        [
            os.path.join(here, "..", "data", "exp_table.json"),
            os.path.join(here, "data", "exp_table.json"),
            os.path.join(here, "exp_table.json"),
        ]
    )
    env = os.environ.get("ECO_DATA_DIR")
    if env:
        candidates.insert(0, os.path.join(env, "exp_table.json"))
    for candidate in candidates:
        try:
            if candidate and os.path.isfile(candidate):
                with open(candidate, encoding="utf-8") as stream:
                    data = json.load(stream)
                if isinstance(data, dict) and isinstance(data.get("levels"), dict):
                    return data
        except Exception:
            continue
    return {"levels": {}, "source": "missing"}


def _level_entry(table: Dict[str, Any], level: int) -> Dict[str, int]:
    levels = table.get("levels") or {}
    raw = levels.get(str(int(level))) or levels.get(int(level))  # type: ignore[arg-type]
    if not isinstance(raw, dict):
        return {"c": 0, "c2": 0, "j1": 0, "j2": 0}
    return {
        "c": int(raw.get("c") or 0),
        "c2": int(raw.get("c2") or 0),
        "j1": int(raw.get("j1") or 0),
        "j2": int(raw.get("j2") or 0),
    }


def span_for_level(table: Dict[str, Any], level: int, curve: str) -> Optional[int]:
    """EXP needed to go from `level` → `level+1` on the given curve key."""
    if level is None or level <= 0:
        return None
    cur = _level_entry(table, level).get(curve, 0)
    nxt = _level_entry(table, level + 1).get(curve, 0)
    if nxt <= cur:
        return None
    return int(nxt - cur)


def pct_x10_to_fraction(pct_x10: int) -> float:
    """345 → 0.345 (34.5%). Clamped to [0, 1]."""
    try:
        v = int(pct_x10)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, v / 1000.0))


def pct_x10_delta(
    prev_level: Optional[int],
    prev_pct_x10: Optional[int],
    new_level: Optional[int],
    new_pct_x10: Optional[int],
) -> int:
    """Net gain in percentage×10 units across optional level-ups.

    Returns 0 when baselines missing or values go backwards (relog / resync).
    """
    if prev_pct_x10 is None or new_pct_x10 is None:
        return 0
    try:
        prev_p = int(prev_pct_x10)
        new_p = int(new_pct_x10)
    except (TypeError, ValueError):
        return 0

    if prev_level is None or new_level is None:
        # Level unknown: only count same-level increases.
        return max(0, new_p - prev_p)

    try:
        pl = int(prev_level)
        nl = int(new_level)
    except (TypeError, ValueError):
        return max(0, new_p - prev_p)

    if nl < pl:
        # Level down / resync — ignore.
        return 0
    if nl == pl:
        return max(0, new_p - prev_p)

    # Level-ups: finish previous bar + full intermediate levels + new partial.
    gained = max(0, 1000 - prev_p)
    gained += (nl - pl - 1) * 1000
    gained += max(0, new_p)
    return gained


def estimate_absolute_gain(
    table: Dict[str, Any],
    prev_level: Optional[int],
    prev_pct_x10: Optional[int],
    new_level: Optional[int],
    new_pct_x10: Optional[int],
    curve: str,
) -> Optional[int]:
    """Convert a level/% transition into absolute EXP using the table.

    Returns None when the table cannot estimate (missing span).
    """
    if prev_pct_x10 is None or new_pct_x10 is None:
        return None
    if prev_level is None and new_level is None:
        return None

    pl = int(prev_level) if prev_level is not None else (int(new_level) if new_level is not None else None)
    nl = int(new_level) if new_level is not None else pl
    if pl is None or nl is None:
        return None
    if nl < pl:
        return None

    try:
        prev_p = int(prev_pct_x10)
        new_p = int(new_pct_x10)
    except (TypeError, ValueError):
        return None

    total = 0
    if nl == pl:
        span = span_for_level(table, pl, curve)
        if span is None:
            return None
        total += int(round(span * max(0, new_p - prev_p) / 1000.0))
        return total

    # Finish previous level
    span0 = span_for_level(table, pl, curve)
    if span0 is None:
        return None
    total += int(round(span0 * max(0, 1000 - prev_p) / 1000.0))

    for lv in range(pl + 1, nl):
        span = span_for_level(table, lv, curve)
        if span is None:
            return None
        total += span

    span_n = span_for_level(table, nl, curve)
    if span_n is None:
        # At max level the next span may be missing — count only completed levels.
        return total
    total += int(round(span_n * max(0, new_p) / 1000.0))
    return total


def pick_job_curve(
    job_level: Optional[int] = None,
    job_level_2x: Optional[int] = None,
    job_level_2t: Optional[int] = None,
    job_level_joint: Optional[int] = None,
    rebirth: Optional[bool] = None,
) -> str:
    """Heuristic job EXP curve key: j1 (basic) or j2 (expert/tech/joint)."""
    try:
        if job_level_joint is not None and int(job_level_joint) > 1:
            return "j2"
    except (TypeError, ValueError):
        pass
    try:
        if job_level_2x is not None and int(job_level_2x) > 1:
            return "j2"
    except (TypeError, ValueError):
        pass
    try:
        if job_level_2t is not None and int(job_level_2t) > 1:
            return "j2"
    except (TypeError, ValueError):
        pass
    if rebirth:
        return "j2"
    return "j1"


def pick_base_curve(level: Optional[int], rebirth: Optional[bool] = None) -> str:
    if rebirth:
        return "c2"
    # Rebirth base levels on some forks start over; without an explicit flag
    # we use c. High levels still use c (table goes to 115).
    return "c"


class ExpTracker:
    """Accumulate session EXP gains and rolling efficiency."""

    def __init__(
        self,
        table: Optional[Dict[str, Any]] = None,
        idle_gap_s: float = DEFAULT_IDLE_GAP_S,
    ):
        self.table = table if table is not None else load_exp_table()
        self.idle_gap_s = float(idle_gap_s)
        self.reset(keep_baseline=False)

    def reset(self, keep_baseline: bool = True) -> None:
        """Clear session counters. Optionally keep current level/% as baseline."""
        baseline = None
        if keep_baseline:
            baseline = {
                "level": self.level,
                "job_level": self.job_level,
                "job_level_2x": self.job_level_2x,
                "job_level_2t": self.job_level_2t,
                "job_level_joint": self.job_level_joint,
                "cexp_pct_x10": self.cexp_pct_x10,
                "jexp_pct_x10": self.jexp_pct_x10,
                "cexp_abs": self.cexp_abs,
                "jexp_abs": self.jexp_abs,
                "rebirth": self.rebirth,
            }
        self.started = time.time()
        self.first_gain_ts: Optional[float] = None
        self.last_gain_ts: Optional[float] = None
        self.active_seconds = 0.0
        self._active_anchor: Optional[float] = None

        self.level: Optional[int] = None
        self.job_level: Optional[int] = None
        self.job_level_2x: Optional[int] = None
        self.job_level_2t: Optional[int] = None
        self.job_level_joint: Optional[int] = None
        self.cexp_pct_x10: Optional[int] = None
        self.jexp_pct_x10: Optional[int] = None
        self.cexp_abs: Optional[int] = None
        self.jexp_abs: Optional[int] = None
        self.rebirth: Optional[bool] = None

        self.session_cexp_pct_x10 = 0
        self.session_jexp_pct_x10 = 0
        self.session_cexp_abs = 0
        self.session_jexp_abs = 0
        self.session_cexp_abs_estimated = True
        self.session_jexp_abs_estimated = True
        self.level_ups = 0
        self.job_level_ups = 0
        self.exp_update_count = 0
        self.gain_events: Deque[Dict[str, Any]] = deque(maxlen=MAX_EVENTS)
        # Compact samples for rolling rates: (ts, cexp_pct_x10_cum, jexp..., cabs, jabs)
        self.samples: Deque[Tuple[float, int, int, int, int]] = deque(maxlen=MAX_SAMPLES)

        if baseline:
            for key, value in baseline.items():
                setattr(self, key, value)
            # Seed a zero sample so rate windows work immediately after reset.
            self.samples.append((self.started, 0, 0, 0, 0))

    # ------------------------------------------------------------------ levels
    def apply_level(
        self,
        level: Optional[int] = None,
        job_level: Optional[int] = None,
        job_level_2x: Optional[int] = None,
        job_level_2t: Optional[int] = None,
        job_level_joint: Optional[int] = None,
        ts: Optional[float] = None,
    ) -> None:
        now = float(ts if ts is not None else time.time())
        if level is not None:
            try:
                lv = int(level)
            except (TypeError, ValueError):
                lv = None
            if lv is not None and 0 < lv < 256:
                if self.level is not None and lv > self.level:
                    self.level_ups += lv - self.level
                    self._note_activity(now)
                self.level = lv
        for attr, value in (
            ("job_level", job_level),
            ("job_level_2x", job_level_2x),
            ("job_level_2t", job_level_2t),
            ("job_level_joint", job_level_joint),
        ):
            if value is None:
                continue
            try:
                jv = int(value)
            except (TypeError, ValueError):
                continue
            if jv < 0 or jv > 255:
                continue
            prev = getattr(self, attr)
            if prev is not None and jv > prev:
                self.job_level_ups += jv - prev
                self._note_activity(now)
            setattr(self, attr, jv)

    # -------------------------------------------------------------------- exp
    def apply_exp(
        self,
        cexp_pct_x10: Optional[int] = None,
        jexp_pct_x10: Optional[int] = None,
        cexp_abs: Optional[int] = None,
        jexp_abs: Optional[int] = None,
        level: Optional[int] = None,
        ts: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """Ingest an EXP update. Returns a gain event dict when something increased."""
        now = float(ts if ts is not None else time.time())
        if level is not None:
            self.apply_level(level=level, ts=now)

        try:
            c_pct = int(cexp_pct_x10) if cexp_pct_x10 is not None else None
        except (TypeError, ValueError):
            c_pct = None
        try:
            j_pct = int(jexp_pct_x10) if jexp_pct_x10 is not None else None
        except (TypeError, ValueError):
            j_pct = None
        if c_pct is not None and (c_pct < 0 or c_pct > 2000):
            # Guard against garbage; still allow slightly over 1000 for edge servers.
            c_pct = max(0, min(c_pct, 2000))
        if j_pct is not None and (j_pct < 0 or j_pct > 2000):
            j_pct = max(0, min(j_pct, 2000))

        prev_level = self.level
        prev_job_level = self.job_level
        prev_c_pct = self.cexp_pct_x10
        prev_j_pct = self.jexp_pct_x10
        prev_c_abs = self.cexp_abs
        prev_j_abs = self.jexp_abs

        # First observation: set baseline only, no gain.
        first = prev_c_pct is None and prev_j_pct is None and prev_c_abs is None and prev_j_abs is None

        c_pct_gain = 0
        j_pct_gain = 0
        c_abs_gain = 0
        j_abs_gain = 0
        c_abs_from_table = False
        j_abs_from_table = False

        if not first:
            if c_pct is not None and prev_c_pct is not None:
                c_pct_gain = pct_x10_delta(prev_level, prev_c_pct, self.level, c_pct)
            if j_pct is not None and prev_j_pct is not None:
                # Prefer job_level track; wrap without a level packet still counts.
                j_pct_gain = pct_x10_delta(prev_job_level, prev_j_pct, self.job_level, j_pct)
                if j_pct_gain == 0 and j_pct < prev_j_pct and (prev_j_pct - j_pct) > 500:
                    # Likely job level-up before SSMG_PLAYER_LEVEL arrives.
                    j_pct_gain = max(0, 1000 - prev_j_pct) + max(0, j_pct)

            # Prefer packet absolute values when present and increasing.
            if cexp_abs is not None and prev_c_abs is not None:
                try:
                    delta = int(cexp_abs) - int(prev_c_abs)
                    if delta > 0:
                        c_abs_gain = delta
                        self.session_cexp_abs_estimated = False
                except (TypeError, ValueError):
                    pass
            if jexp_abs is not None and prev_j_abs is not None:
                try:
                    delta = int(jexp_abs) - int(prev_j_abs)
                    if delta > 0:
                        j_abs_gain = delta
                        self.session_jexp_abs_estimated = False
                except (TypeError, ValueError):
                    pass

            # Fall back to table estimate from % deltas.
            if c_abs_gain == 0 and c_pct_gain > 0:
                est = estimate_absolute_gain(
                    self.table,
                    prev_level,
                    prev_c_pct,
                    self.level,
                    c_pct if c_pct is not None else prev_c_pct,
                    pick_base_curve(self.level, self.rebirth),
                )
                if est is not None and est > 0:
                    c_abs_gain = est
                    c_abs_from_table = True
            if j_abs_gain == 0 and j_pct_gain > 0:
                est = estimate_absolute_gain(
                    self.table,
                    self.job_level,
                    prev_j_pct,
                    self.job_level,
                    j_pct if j_pct is not None else prev_j_pct,
                    pick_job_curve(
                        self.job_level,
                        self.job_level_2x,
                        self.job_level_2t,
                        self.job_level_joint,
                        self.rebirth,
                    ),
                )
                if est is not None and est > 0:
                    j_abs_gain = est
                    j_abs_from_table = True

        # Commit current values.
        if c_pct is not None:
            self.cexp_pct_x10 = c_pct
        if j_pct is not None:
            self.jexp_pct_x10 = j_pct
        if cexp_abs is not None:
            try:
                self.cexp_abs = int(cexp_abs)
            except (TypeError, ValueError):
                pass
        if jexp_abs is not None:
            try:
                self.jexp_abs = int(jexp_abs)
            except (TypeError, ValueError):
                pass

        self.exp_update_count += 1
        if first:
            self.samples.append((now, 0, 0, 0, 0))
            return None

        if c_pct_gain == 0 and j_pct_gain == 0 and c_abs_gain == 0 and j_abs_gain == 0:
            return None

        self.session_cexp_pct_x10 += c_pct_gain
        self.session_jexp_pct_x10 += j_pct_gain
        self.session_cexp_abs += c_abs_gain
        self.session_jexp_abs += j_abs_gain
        self._note_activity(now)
        self.samples.append(
            (
                now,
                self.session_cexp_pct_x10,
                self.session_jexp_pct_x10,
                self.session_cexp_abs,
                self.session_jexp_abs,
            )
        )

        event = {
            "ts": now,
            "cexp_pct_x10": c_pct_gain,
            "jexp_pct_x10": j_pct_gain,
            "cexp_abs": c_abs_gain,
            "jexp_abs": j_abs_gain,
            "cexp_abs_estimated": c_abs_from_table or self.session_cexp_abs_estimated,
            "jexp_abs_estimated": j_abs_from_table or self.session_jexp_abs_estimated,
            "level": self.level,
            "cexp_pct_now": self.cexp_pct_x10,
            "jexp_pct_now": self.jexp_pct_x10,
        }
        self.gain_events.appendleft(event)
        return event

    def _note_activity(self, now: float) -> None:
        if self.first_gain_ts is None:
            self.first_gain_ts = now
            self._active_anchor = now
            self.last_gain_ts = now
            return
        if self.last_gain_ts is not None and self._active_anchor is not None:
            gap = now - self.last_gain_ts
            if gap <= self.idle_gap_s:
                self.active_seconds += gap
            else:
                # Idle break — do not add gap; restart anchor chain.
                pass
        self.last_gain_ts = now
        self._active_anchor = now

    def _active_now(self, now: Optional[float] = None) -> float:
        now = float(now if now is not None else time.time())
        active = self.active_seconds
        if (
            self.last_gain_ts is not None
            and (now - self.last_gain_ts) <= self.idle_gap_s
        ):
            # Include trailing open interval while still "in combat/grind".
            active += now - self.last_gain_ts
        return max(0.0, active)

    def _rate_in_window(self, window_s: float, now: Optional[float] = None) -> Dict[str, float]:
        now = float(now if now is not None else time.time())
        if not self.samples:
            return {
                "window_s": window_s,
                "cexp_pct_per_hour": 0.0,
                "jexp_pct_per_hour": 0.0,
                "cexp_per_hour": 0.0,
                "jexp_per_hour": 0.0,
                "elapsed_s": 0.0,
            }
        cutoff = now - window_s
        # Find earliest sample at or before cutoff; else first sample.
        start = self.samples[0]
        for sample in self.samples:
            if sample[0] <= cutoff:
                start = sample
            else:
                break
        end = self.samples[-1]
        elapsed = max(0.0, end[0] - start[0])
        if elapsed <= 0:
            # Fall back to wall time in window if only one sample.
            elapsed = min(window_s, max(0.0, now - self.started))
        if elapsed <= 0:
            return {
                "window_s": window_s,
                "cexp_pct_per_hour": 0.0,
                "jexp_pct_per_hour": 0.0,
                "cexp_per_hour": 0.0,
                "jexp_per_hour": 0.0,
                "elapsed_s": 0.0,
            }
        dc = end[1] - start[1]
        dj = end[2] - start[2]
        dca = end[3] - start[3]
        dja = end[4] - start[4]
        scale = 3600.0 / elapsed
        return {
            "window_s": window_s,
            "cexp_pct_per_hour": (dc / 10.0) * scale,  # percent points / hour
            "jexp_pct_per_hour": (dj / 10.0) * scale,
            "cexp_per_hour": dca * scale,
            "jexp_per_hour": dja * scale,
            "elapsed_s": elapsed,
            "cexp_pct_x10": dc,
            "jexp_pct_x10": dj,
            "cexp_abs": dca,
            "jexp_abs": dja,
        }

    def snapshot(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = float(now if now is not None else time.time())
        elapsed = max(0.0, now - self.started)
        active = self._active_now(now)
        rate_base = active if active > 1.0 else elapsed
        c_pct_total = self.session_cexp_pct_x10 / 10.0
        j_pct_total = self.session_jexp_pct_x10 / 10.0

        def per_hour(value: float) -> float:
            if rate_base <= 0:
                return 0.0
            return value * 3600.0 / rate_base

        windows = {
            "5m": self._rate_in_window(5 * 60, now),
            "15m": self._rate_in_window(15 * 60, now),
            "1h": self._rate_in_window(3600, now),
            "session": self._rate_in_window(max(elapsed, 1.0), now),
        }

        return {
            "elapsed": elapsed,
            "active": active,
            "level": self.level,
            "job_level": self.job_level,
            "job_level_2x": self.job_level_2x,
            "job_level_2t": self.job_level_2t,
            "job_level_joint": self.job_level_joint,
            "cexp_pct": None if self.cexp_pct_x10 is None else self.cexp_pct_x10 / 10.0,
            "jexp_pct": None if self.jexp_pct_x10 is None else self.jexp_pct_x10 / 10.0,
            "cexp_pct_x10": self.cexp_pct_x10,
            "jexp_pct_x10": self.jexp_pct_x10,
            "cexp_abs": self.cexp_abs,
            "jexp_abs": self.jexp_abs,
            "session_cexp_pct": c_pct_total,
            "session_jexp_pct": j_pct_total,
            "session_cexp_abs": self.session_cexp_abs,
            "session_jexp_abs": self.session_jexp_abs,
            "session_cexp_abs_estimated": self.session_cexp_abs_estimated,
            "session_jexp_abs_estimated": self.session_jexp_abs_estimated,
            "session_cexp_pct_per_hour": per_hour(c_pct_total),
            "session_jexp_pct_per_hour": per_hour(j_pct_total),
            "session_cexp_per_hour": per_hour(float(self.session_cexp_abs)),
            "session_jexp_per_hour": per_hour(float(self.session_jexp_abs)),
            "level_ups": self.level_ups,
            "job_level_ups": self.job_level_ups,
            "exp_update_count": self.exp_update_count,
            "first_gain_ts": self.first_gain_ts,
            "last_gain_ts": self.last_gain_ts,
            "windows": windows,
            "recent_gains": list(self.gain_events)[:20],
            "table_source": (self.table or {}).get("source"),
            "ready": self.cexp_pct_x10 is not None or self.jexp_pct_x10 is not None,
        }
