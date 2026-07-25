# -*- coding: utf-8 -*-
import csv
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(_DATA_DIR)
HERE = Path(_DATA_DIR)
DEFAULT_XLS_DIR = Path(r"F:\eco\Nekogame\Emil chronicle online\data\xls")
MOB_OUT = HERE / "mob_names.json"
SKILL_OUT = HERE / "skill_names.json"
logger = setup_logger(
    "eco.import_client_names",
    log_dir=log_dir(_DATA_DIR),
    log_file="import_client_names.log",
)

ID_KEYS = ("id", "编号", "コード", "code")
NAME_KEYS = ("name", "名称", "名字", "名前", "disp", "display")
MOB_FILE_KEYS = ("mob", "monster", "enemy", "chara", "actor")
SKILL_FILE_KEYS = ("skill", "技能", "スキル")


def load_json(path):
    try:
        data = json.load(open(path, encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_json(path, data):
    ordered = {str(k): data[k] for k in sorted(data, key=lambda x: int(x))}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ordered, f, ensure_ascii=False, indent=2)
        f.write("\n")


def read_rows(path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp932", "gbk", "big5", "utf-16"):
        try:
            text = raw.decode(enc)
        except Exception:
            continue
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except Exception:
            dialect = csv.excel_tab if "\t" in sample else csv.excel
        rows = list(csv.reader(text.splitlines(), dialect))
        if rows:
            return rows
    return []


def clean_name(value):
    if value is None:
        return ""
    name = str(value).strip().strip("\ufeff").strip("\0")
    name = re.sub(r"\s+", " ", name)
    return name


def int_id(value):
    text = clean_name(value)
    if not text:
        return None
    try:
        return int(text, 0)
    except Exception:
        return None


def column_score(header, keys):
    out = []
    for idx, name in enumerate(header):
        low = clean_name(name).lower()
        if any(key.lower() in low for key in keys):
            out.append(idx)
    return out


def parse_mapping(path):
    rows = read_rows(path)
    if not rows:
        return {}

    header = rows[0]
    has_header = any(any(key.lower() in clean_name(cell).lower() for key in ID_KEYS + NAME_KEYS)
                     for cell in header)
    data_rows = rows[1:] if has_header else rows
    id_cols = column_score(header, ID_KEYS) if has_header else []
    name_cols = column_score(header, NAME_KEYS) if has_header else []

    mapping = {}
    for row in data_rows:
        if not row:
            continue
        candidates = id_cols or range(min(4, len(row)))
        item_id = None
        for col in candidates:
            if col < len(row):
                item_id = int_id(row[col])
                if item_id is not None:
                    break
        if item_id is None:
            continue

        names = []
        if name_cols:
            names = [clean_name(row[col]) for col in name_cols if col < len(row)]
        if not names:
            for cell in row[1:8]:
                name = clean_name(cell)
                if name and not re.fullmatch(r"[-+]?\d+", name):
                    names.append(name)
        name = next((x for x in names if x), "")
        if name:
            mapping[item_id] = name
    return mapping


def collect_csvs(paths):
    files = []
    for root in paths:
        if root.exists():
            files.extend(root.rglob("*.csv"))
            files.extend(root.rglob("*.tsv"))
    return sorted(set(files))


def main():
    search_roots = [DEFAULT_XLS_DIR, HERE, HERE / "archive"]
    files = collect_csvs(search_roots)
    mob_names = {int(k): v for k, v in load_json(MOB_OUT).items() if str(k).isdigit()}
    skill_names = {int(k): v for k, v in load_json(SKILL_OUT).items() if str(k).isdigit()}

    mob_added = skill_added = 0
    seen_files = []
    for path in files:
        low = path.name.lower()
        mapping = parse_mapping(path)
        if not mapping:
            continue
        if any(key in low for key in SKILL_FILE_KEYS):
            before = len(skill_names)
            skill_names.update(mapping)
            skill_added += len(skill_names) - before
            seen_files.append(("技能", path, len(mapping)))
        elif any(key in low for key in MOB_FILE_KEYS):
            before = len(mob_names)
            mob_names.update(mapping)
            mob_added += len(mob_names) - before
            seen_files.append(("怪物", path, len(mapping)))

    save_json(MOB_OUT, mob_names)
    save_json(SKILL_OUT, skill_names)

    logger.info("客户端名称表导入完成")
    logger.info("====================")
    logger.info("怪物名称: %s 条，新导入 %s 条 -> %s", len(mob_names), mob_added, MOB_OUT)
    logger.info("技能名称: %s 条，新导入 %s 条 -> %s", len(skill_names), skill_added, SKILL_OUT)
    if seen_files:
        logger.info("使用到的 CSV:")
        for kind, path, count in seen_files:
            logger.info("  %s: %s (%s 条候选)", kind, path, count)
    else:
        logger.warning("没有找到可导入的怪物/技能 CSV。")
        logger.warning("客户端原始表在: %s", DEFAULT_XLS_DIR)
        logger.warning("那里目前只有 table.hed/table.dat，需要先用 uneco 或同类工具导出 CSV。")


if __name__ == "__main__":
    main()
