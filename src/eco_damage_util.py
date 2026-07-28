# -*- coding: utf-8 -*-
"""Shared small helpers for damage meter modules (avoid circular imports)."""
import datetime as _dt


def now_label():
    return _dt.datetime.now().strftime("%H:%M:%S")
