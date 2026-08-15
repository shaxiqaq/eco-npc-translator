# -*- coding: utf-8 -*-
"""Extract static NPC dialogue from a SagaECO ``SagaScript/English`` tree.

The output is deliberately file-centric.  A single C# source file can define
many EventIDs, so forcing every line into the first EventID (as the historical
extractor did) loses provenance.  Each record retains every discovered ID and
the source line for every Say/Select call.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Iterable


CALL_RE_TEMPLATE = r"(?<![A-Za-z0-9_]){name}\s*\("
EVENT_ASSIGN_RE = re.compile(r"\bEventID\s*=\s*(\d+)\b")
EVENT_CLASS_RE = re.compile(r"\bclass\s+S(\d+)\b")
NAMESPACE_MAP_RE = re.compile(r"\bnamespace\s+SagaScript\.M(\d+)\b")
PATH_ID_RE = re.compile(r"\((\d{8})\)")
FILE_EVENT_RE = re.compile(r"\((\d{8})\)\s*\.cs$", re.IGNORECASE)


def read_source(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16"), "utf-16"
    for encoding in ("utf-8-sig", "big5", "gb18030"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", "replace"), "utf-8-replace"


def mask_comments(text: str) -> str:
    """Replace C# comments with spaces while preserving strings and offsets."""
    out = list(text)
    i = 0
    state = "code"
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if c == "/" and n == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "line_comment"
                continue
            if c == "/" and n == "*":
                out[i] = out[i + 1] = " "
                i += 2
                state = "block_comment"
                continue
            if c == "@" and n == '"':
                i += 2
                state = "verbatim_string"
                continue
            if c == '"':
                i += 1
                state = "string"
                continue
            if c == "'":
                i += 1
                state = "char"
                continue
            i += 1
            continue
        if state == "line_comment":
            if c in "\r\n":
                state = "code"
            else:
                out[i] = " "
            i += 1
            continue
        if state == "block_comment":
            if c == "*" and n == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "code"
            else:
                if c not in "\r\n":
                    out[i] = " "
                i += 1
            continue
        if state == "string":
            if c == "\\":
                i += 2
            elif c == '"':
                i += 1
                state = "code"
            else:
                i += 1
            continue
        if state == "verbatim_string":
            if c == '"' and n == '"':
                i += 2
            elif c == '"':
                i += 1
                state = "code"
            else:
                i += 1
            continue
        if state == "char":
            if c == "\\":
                i += 2
            elif c == "'":
                i += 1
                state = "code"
            else:
                i += 1
    return "".join(out)


def read_call_args(text: str, start: int) -> tuple[list[str], int]:
    """Split a C# call at top-level commas; ``start`` follows the opening ``(``."""
    args: list[str] = []
    current: list[str] = []
    depth = 0
    state = "code"
    i = start
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if state == "string":
            current.append(c)
            if c == "\\" and i + 1 < len(text):
                current.append(n)
                i += 2
            elif c == '"':
                state = "code"
                i += 1
            else:
                i += 1
            continue
        if state == "verbatim_string":
            current.append(c)
            if c == '"' and n == '"':
                current.append(n)
                i += 2
            elif c == '"':
                state = "code"
                i += 1
            else:
                i += 1
            continue
        if state == "char":
            current.append(c)
            if c == "\\" and i + 1 < len(text):
                current.append(n)
                i += 2
            elif c == "'":
                state = "code"
                i += 1
            else:
                i += 1
            continue
        if c == "@" and n == '"':
            current.extend((c, n))
            state = "verbatim_string"
            i += 2
            continue
        if c == '"':
            current.append(c)
            state = "string"
            i += 1
            continue
        if c == "'":
            current.append(c)
            state = "char"
            i += 1
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if c == ")" and depth == 0:
                args.append("".join(current).strip())
                return args, i
            depth = max(0, depth - 1)
        elif c == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
            i += 1
            continue
        current.append(c)
        i += 1
    return args, len(text)


def find_calls(text: str, name: str) -> list[tuple[int, list[str]]]:
    clean_source = mask_comments(text)
    calls: list[tuple[int, list[str]]] = []
    pattern = re.compile(CALL_RE_TEMPLATE.format(name=re.escape(name)))
    for match in pattern.finditer(clean_source):
        args, _ = read_call_args(clean_source, match.end())
        calls.append((match.start(), args))
    return calls


def _decode_escape(text: str, pos: int) -> tuple[str, int]:
    if pos >= len(text):
        return "\\", pos
    c = text[pos]
    simple = {
        "'": "'", '"': '"', "\\": "\\", "0": "\0", "a": "\a",
        "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v",
    }
    if c in simple:
        return simple[c], pos + 1
    if c in ("u", "U"):
        size = 4 if c == "u" else 8
        digits = text[pos + 1:pos + 1 + size]
        if len(digits) == size and re.fullmatch(r"[0-9A-Fa-f]+", digits):
            return chr(int(digits, 16)), pos + 1 + size
    if c == "x":
        match = re.match(r"[0-9A-Fa-f]{1,4}", text[pos + 1:])
        if match:
            return chr(int(match.group(0), 16)), pos + 1 + len(match.group(0))
    return c, pos + 1


def extract_literals(expression: str) -> tuple[str, bool]:
    """Return concatenated C# string literals and whether non-literal data remains."""
    parts: list[str] = []
    spans: list[tuple[int, int]] = []
    i = 0
    while i < len(expression):
        start = i
        verbatim = False
        if expression.startswith("$@\"", i) or expression.startswith("@$\"", i):
            verbatim = True
            i += 3
        elif expression.startswith("@\"", i):
            verbatim = True
            i += 2
        elif expression.startswith("$\"", i):
            i += 2
        elif expression[i] == '"':
            i += 1
        else:
            i += 1
            continue
        value: list[str] = []
        while i < len(expression):
            c = expression[i]
            if verbatim:
                if c == '"' and i + 1 < len(expression) and expression[i + 1] == '"':
                    value.append('"')
                    i += 2
                    continue
                if c == '"':
                    i += 1
                    break
                value.append(c)
                i += 1
                continue
            if c == "\\":
                decoded, i = _decode_escape(expression, i + 1)
                value.append(decoded)
                continue
            if c == '"':
                i += 1
                break
            value.append(c)
            i += 1
        parts.append("".join(value))
        spans.append((start, i))

    remainder = list(expression)
    for start, end in spans:
        remainder[start:end] = " " * (end - start)
    dynamic_tail = re.sub(r"[\s+()]", "", "".join(remainder))
    return "".join(parts), bool(dynamic_tail)


def clean_text(text: str) -> str:
    text = text.replace("$R", "\n").replace("$P", "\n")
    text = re.sub(r"\$[A-Za-z]", "", text)
    text = text.replace(";", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def parse_say(line: int, args: list[str]) -> dict | None:
    if len(args) < 3:
        return None
    # Known SagaECO overloads:
    # Say(pc, motion, text[, speaker])
    # Say(pc, actor, motion, text[, speaker])
    third_text, _ = extract_literals(args[2])
    actor = None
    if len(args) >= 4 and not third_text:
        actor, motion, text_index = args[1], args[2], 3
    else:
        motion, text_index = args[1], 2
    if text_index >= len(args):
        return None
    raw, dynamic = extract_literals(args[text_index])
    if not raw:
        return None
    speaker = ""
    speaker_dynamic = False
    if text_index + 1 < len(args):
        speaker, speaker_dynamic = extract_literals(args[text_index + 1])
    result = {
        "line": line,
        "actor": actor,
        "motion": motion.strip(),
        "speaker": speaker,
        "raw": raw,
        "text": clean_text(raw),
        "dynamic": bool(dynamic or speaker_dynamic),
    }
    if dynamic:
        result["text_expression"] = args[text_index]
    if speaker_dynamic:
        result["speaker_expression"] = args[text_index + 1]
    return result


def parse_select(line: int, args: list[str]) -> dict | None:
    if len(args) < 2:
        return None
    title_index = 1
    # A few scripts use Select(pc, "", "title", ...); prefer the first
    # non-empty one of the two conventional heading positions.
    title, title_dynamic = extract_literals(args[title_index])
    option_start = 3
    if not title and len(args) > 2:
        alternate, alternate_dynamic = extract_literals(args[2])
        if alternate:
            title = alternate
            title_dynamic = alternate_dynamic
            option_start = 3
    options = []
    dynamic = title_dynamic
    unresolved = []
    for expression in args[option_start:]:
        value, is_dynamic = extract_literals(expression)
        if value:
            options.append(clean_text(value))
        elif expression.strip() not in ('""', ""):
            unresolved.append(expression.strip())
        dynamic = dynamic or is_dynamic
    if not title and not options and not unresolved:
        return None
    result = {
        "line": line,
        "title": clean_text(title),
        "options": options,
        "dynamic": bool(dynamic or unresolved),
    }
    if dynamic or unresolved:
        result["arguments"] = args[1:]
    if unresolved:
        result["unresolved_options"] = unresolved
    return result


def npc_name(path: Path) -> str:
    name = path.name
    name = re.sub(r"\(\d+\)\s*\.cs$", "", name, flags=re.IGNORECASE)
    return re.sub(r"\.cs$", "", name, flags=re.IGNORECASE).strip()


def parse_file(path: Path, root: Path) -> dict:
    source, encoding = read_source(path)
    clean_source = mask_comments(source)
    relative = path.relative_to(root).as_posix()
    event_ids = unique(EVENT_ASSIGN_RE.findall(clean_source) + EVENT_CLASS_RE.findall(clean_source))
    file_match = FILE_EVENT_RE.search(path.name)
    primary_event_id = file_match.group(1) if file_match else (event_ids[0] if event_ids else None)
    namespace_maps = NAMESPACE_MAP_RE.findall(clean_source)
    path_maps = PATH_ID_RE.findall(str(path.parent))
    map_ids = unique(path_maps + namespace_maps)
    primary_map_id = path_maps[-1] if path_maps else (namespace_maps[0] if namespace_maps else None)

    says = []
    unresolved_calls = []
    for offset, args in find_calls(source, "Say"):
        line = source.count("\n", 0, offset) + 1
        parsed = parse_say(line, args)
        if parsed:
            says.append(parsed)
        else:
            unresolved_calls.append({"kind": "Say", "line": line, "arguments": args})
    selects = []
    for offset, args in find_calls(source, "Select"):
        line = source.count("\n", 0, offset) + 1
        parsed = parse_select(line, args)
        if parsed:
            selects.append(parsed)
        else:
            unresolved_calls.append({"kind": "Select", "line": line, "arguments": args})

    all_text = unique(
        [item["text"] for item in says]
        + [item["title"] for item in selects]
        + [option for item in selects for option in item["options"]]
    )
    return {
        "file": relative,
        "category": relative.split("/", 1)[0],
        "encoding": encoding,
        "npc": npc_name(path),
        "primary_event_id": primary_event_id,
        "event_ids": event_ids,
        "primary_map_id": primary_map_id,
        "map_ids": map_ids,
        "says": says,
        "selects": selects,
        "unresolved_calls": unresolved_calls,
        "all_text": all_text,
    }


def build_corpus(root: Path) -> dict:
    files = sorted(root.rglob("*.cs"), key=lambda path: path.as_posix().casefold())
    records = [parse_file(path, root) for path in files]
    categories = Counter(record["category"] for record in records)
    stats = {
        "source_files": len(records),
        "files_with_event_id": sum(bool(record["event_ids"]) for record in records),
        "files_with_multiple_event_ids": sum(len(record["event_ids"]) > 1 for record in records),
        "files_with_text": sum(bool(record["all_text"]) for record in records),
        "say_calls": sum(len(record["says"]) for record in records),
        "select_calls": sum(len(record["selects"]) for record in records),
        "unique_texts": len({text for record in records for text in record["all_text"]}),
        "dynamic_say_calls": sum(item["dynamic"] for record in records for item in record["says"]),
        "dynamic_select_calls": sum(item["dynamic"] for record in records for item in record["selects"]),
        "unresolved_say_calls": sum(
            item["kind"] == "Say" for record in records for item in record["unresolved_calls"]
        ),
        "unresolved_select_calls": sum(
            item["kind"] == "Select" for record in records for item in record["unresolved_calls"]
        ),
        "texts_with_replacement_character": sum(
            "\ufffd" in text for record in records for text in record["all_text"]
        ),
        "categories": dict(sorted(categories.items())),
    }
    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_root": str(root.resolve()),
        "stats": stats,
        "files": records,
    }


def write_report(corpus: dict, path: Path) -> None:
    stats = corpus["stats"]
    lines = [
        "# SagaECO NPC script extraction",
        "",
        f"- Source: `{corpus['source_root']}`",
        f"- C# files: {stats['source_files']}",
        f"- Files with text: {stats['files_with_text']}",
        f"- Say calls: {stats['say_calls']}",
        f"- Select calls: {stats['select_calls']}",
        f"- Unique static texts: {stats['unique_texts']}",
        f"- Files with multiple EventIDs: {stats['files_with_multiple_event_ids']}",
        f"- Dynamic Say calls: {stats['dynamic_say_calls']}",
        f"- Dynamic Select calls: {stats['dynamic_select_calls']}",
        f"- Unresolved Say calls: {stats['unresolved_say_calls']}",
        f"- Unresolved Select calls: {stats['unresolved_select_calls']}",
        f"- Texts containing U+FFFD: {stats['texts_with_replacement_character']}",
        "",
        "## Categories",
        "",
        "| Category | C# files |",
        "|---|---:|",
    ]
    lines.extend(f"| {name} | {count} |" for name, count in stats["categories"].items())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract SagaECO NPC Say/Select text from C# scripts")
    parser.add_argument("source", type=Path, help="SagaScript/English directory")
    parser.add_argument("output", type=Path, help="Output JSON path")
    parser.add_argument("--report", type=Path, help="Optional Markdown statistics report")
    args = parser.parse_args(argv)
    if not args.source.is_dir():
        parser.error(f"source directory does not exist: {args.source}")
    corpus = build_corpus(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(corpus, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        write_report(corpus, args.report)
    print(json.dumps(corpus["stats"], ensure_ascii=False, indent=2))
    print(f"JSON -> {args.output.resolve()}")
    if args.report:
        print(f"Report -> {args.report.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
