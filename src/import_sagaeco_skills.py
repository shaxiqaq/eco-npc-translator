#!/usr/bin/env python3
"""Import ECO skill names from SagaECO effect.ssp."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(_DATA_DIR)
logger = setup_logger(
    "eco.import_sagaeco_skills",
    log_dir=log_dir(_DATA_DIR),
    log_file="import_sagaeco_skills.log",
)

_REPO = Path(_RES_DIR).resolve().parent
DEFAULT_SOURCE = (
    _REPO
    / "archive"
    / "SagaECO"
    / "PlutoProject"
    / "SingleSkill"
    / "effect.ssp"
)
DEFAULT_OUTPUT = Path(_DATA_DIR) / "skill_names.json"


def read_utf16z(data: bytes) -> str:
    text = data.decode("utf-16le", errors="ignore")
    return text.split("\x00", 1)[0].strip()


def parse_effect_ssp(path: Path) -> dict[str, str]:
    data = path.read_bytes()

    offsets: list[int] = []
    pos = 0
    while pos + 4 <= len(data) and len(offsets) < 30000:
        offset = int.from_bytes(data[pos : pos + 4], "little")
        pos += 4
        if offset == 0:
            break
        if offset + 122 > len(data):
            continue
        offsets.append(offset)
    if not offsets:
        raise ValueError(f"{path} does not contain an ECO effect.ssp offset table")

    names: dict[str, str] = {}
    for offset in offsets:
        skill_id = int.from_bytes(data[offset : offset + 2], "little")
        if not skill_id:
            continue
        name = read_utf16z(data[offset + 4 : offset + 4 + 116])
        if name:
            names[str(skill_id)] = name
    return dict(sorted(names.items(), key=lambda item: int(item[0])))


def main() -> int:
    parser = argparse.ArgumentParser(description="Import skill names from SagaECO effect.ssp")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Path to effect.ssp")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Path to skill_names.json")
    args = parser.parse_args()

    names = parse_effect_ssp(args.source)
    args.output.write_text(
        json.dumps(names, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    logger.info("Imported %s skill names", len(names))
    logger.info("Source: %s", args.source)
    logger.info("Output: %s", args.output)
    for skill_id in ("3001", "7505", "7512"):
        if skill_id in names:
            logger.info("%s: %s", skill_id, names[skill_id])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
