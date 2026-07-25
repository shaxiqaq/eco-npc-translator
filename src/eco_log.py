# -*- coding: utf-8 -*-
"""Shared lightweight logger setup for ECO toolbox scripts.

Protocol-sensitive tools (JSON-lines bridges) should pass stream=sys.stderr
so structured messages on stdout stay machine-readable.
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Optional, TextIO


_FORMAT = "%(asctime)s - %(levelname)s - %(name)s - %(message)s"


def setup_logger(
    name: str,
    *,
    log_dir: Optional[str] = None,
    log_file: Optional[str] = None,
    stream: Optional[TextIO] = None,
    level: int = logging.INFO,
) -> logging.Logger:
    """Return a configured logger; safe to call multiple times."""
    logger = logging.getLogger(name)
    if getattr(logger, "_eco_configured", False):
        return logger

    logger.setLevel(level)
    logger.propagate = False
    formatter = logging.Formatter(_FORMAT)

    out = stream if stream is not None else sys.stdout
    console = logging.StreamHandler(out)
    console.setFormatter(formatter)
    console.setLevel(level)
    logger.addHandler(console)

    if log_dir and log_file:
        try:
            os.makedirs(log_dir, exist_ok=True)
            path = os.path.join(log_dir, log_file)
            file_handler = logging.FileHandler(path, encoding="utf-8")
            file_handler.setFormatter(formatter)
            file_handler.setLevel(level)
            logger.addHandler(file_handler)
        except Exception:
            # File logging is best-effort; console still works.
            pass

    logger._eco_configured = True  # type: ignore[attr-defined]
    return logger
