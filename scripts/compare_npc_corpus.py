# -*- coding: utf-8 -*-
"""Compare live ECO dialogue captures with an extracted SagaECO script corpus."""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


def normalize_text(text: str) -> str:
    text = (text or "").replace("\0", " ").replace("$R", " ").replace("$P", " ")
    text = unicodedata.normalize("NFKC", text).casefold()
    text = text.translate(str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'}))
    return re.sub(r"\s+", " ", text).strip()


def text_grams(text: str) -> set[str]:
    compact = re.sub(r"[^\w]+", "", text, flags=re.UNICODE)
    if not compact:
        return set()
    if len(compact) < 3:
        return {compact}
    return {compact[i:i + 3] for i in range(len(compact) - 2)}


def _script_items(record: dict) -> list[dict]:
    items = []
    for say in record.get("says", []):
        items.append({"kind": "say", "text": say.get("text", ""), "line": say.get("line")})
    for select in record.get("selects", []):
        items.append({"kind": "select_title", "text": select.get("title", ""), "line": select.get("line")})
        items.extend(
            {"kind": "select_option", "text": option, "line": select.get("line")}
            for option in select.get("options", [])
        )
    return items


def build_script_indexes(corpus: dict) -> dict:
    exact = defaultdict(list)
    by_event = defaultdict(list)
    unique_candidates = {}
    event_ids = set()
    for record in corpus.get("files", []):
        record_events = [str(value) for value in record.get("event_ids", []) if value]
        event_ids.update(record_events)
        seen_in_file = set()
        for item in _script_items(record):
            normalized = normalize_text(item["text"])
            if not normalized or normalized in seen_in_file:
                continue
            seen_in_file.add(normalized)
            candidate = {
                "text": item["text"],
                "normalized": normalized,
                "kind": item["kind"],
                "file": record.get("file"),
                "line": item.get("line"),
                "npc": record.get("npc", ""),
                "event_ids": record_events,
                "ambiguous_event_source": len(record_events) > 1,
            }
            exact[normalized].append(candidate)
            unique_candidates.setdefault(normalized, candidate)
            for event_id in record_events:
                by_event[event_id].append(candidate)

    candidates = list(unique_candidates.values())
    gram_index = defaultdict(set)
    for index, candidate in enumerate(candidates):
        for gram in text_grams(candidate["normalized"]):
            gram_index[gram].add(index)
    return {
        "exact": exact,
        "by_event": by_event,
        "event_ids": event_ids,
        "candidates": candidates,
        "gram_index": gram_index,
        "nearest_cache": {},
    }


def _candidate_summary(candidate: dict | None, score: float | None = None) -> dict | None:
    if not candidate:
        return None
    result = {key: value for key, value in candidate.items() if key != "normalized"}
    if score is not None:
        result["score"] = round(score, 6)
    return result


def nearest_match(normalized: str, indexes: dict, candidates: list[dict] | None = None) -> tuple[float, dict | None]:
    if not normalized:
        return 0.0, None
    global_search = candidates is None
    if global_search and normalized in indexes["nearest_cache"]:
        return indexes["nearest_cache"][normalized]
    if global_search:
        votes = Counter()
        for gram in text_grams(normalized):
            votes.update(indexes["gram_index"].get(gram, ()))
        if not votes:
            indexes["nearest_cache"][normalized] = (0.0, None)
            return indexes["nearest_cache"][normalized]
        candidates = [indexes["candidates"][index] for index, _ in votes.most_common(100)]
    best_score = 0.0
    best = None
    for candidate in candidates:
        other = candidate["normalized"]
        if not other:
            continue
        length_ratio = min(len(normalized), len(other)) / max(len(normalized), len(other))
        if length_ratio < 0.45:
            continue
        score = difflib.SequenceMatcher(None, normalized, other, autojunk=False).ratio()
        if score > best_score:
            best_score, best = score, candidate
    result = (best_score, best)
    if global_search:
        indexes["nearest_cache"][normalized] = result
    return result


def flatten_harvest(harvest: dict) -> list[dict]:
    merged = {}
    for raw_event_id, entry in harvest.items():
        event_id = None if raw_event_id in (None, "None", "null", "") else str(raw_event_id)
        npc = (entry.get("npc") or "").replace("\0", "").strip()
        source_items = [("say", text) for text in entry.get("says", [])]
        for select in entry.get("selects", []):
            source_items.append(("select_title", select.get("q", "")))
            source_items.extend(("select_option", option) for option in select.get("options", []))
        for kind, text in source_items:
            normalized = normalize_text(text)
            if not normalized:
                continue
            key = (event_id, normalized)
            if key not in merged:
                merged[key] = {
                    "event_id": event_id,
                    "npc": npc,
                    "kinds": [kind],
                    "text": text.replace("\0", "").strip(),
                    "normalized": normalized,
                }
            elif kind not in merged[key]["kinds"]:
                merged[key]["kinds"].append(kind)
    return list(merged.values())


def classify_live_item(item: dict, indexes: dict, near_threshold: float) -> dict:
    normalized = item["normalized"]
    event_id = item["event_id"]
    event_candidates = indexes["by_event"].get(event_id, []) if event_id else []
    event_exact = next((candidate for candidate in event_candidates if candidate["normalized"] == normalized), None)
    if event_exact:
        status, best, score = "event_exact", event_exact, 1.0
    else:
        event_score, event_best = nearest_match(normalized, indexes, event_candidates) if event_candidates else (0.0, None)
        if event_best and event_score >= near_threshold:
            status, best, score = "event_near", event_best, event_score
        elif indexes["exact"].get(normalized):
            status, best, score = "global_exact", indexes["exact"][normalized][0], 1.0
        else:
            global_score, global_best = nearest_match(normalized, indexes)
            if global_best and global_score >= near_threshold:
                status, best, score = "global_near", global_best, global_score
            elif event_id is None:
                status, best, score = "unassigned_event", global_best, global_score
            elif event_candidates:
                status, best, score = "event_text_changed", event_best, event_score
            elif event_id in indexes["event_ids"]:
                status, best, score = "script_event_no_text", global_best, global_score
            else:
                status, best, score = "script_event_missing", global_best, global_score
    result = {key: value for key, value in item.items() if key != "normalized"}
    result["status"] = status
    result["match"] = _candidate_summary(best, score) if best else None
    return result


def compare_seen(seen: list[str], indexes: dict, near_threshold: float) -> list[dict]:
    results = []
    unique_seen = {}
    for text in seen:
        normalized = normalize_text(text)
        if normalized:
            unique_seen.setdefault(normalized, text.replace("\0", "").strip())
    for normalized, text in unique_seen.items():
        if indexes["exact"].get(normalized):
            candidate, status, score = indexes["exact"][normalized][0], "exact", 1.0
        else:
            score, candidate = nearest_match(normalized, indexes)
            status = "near" if candidate and score >= near_threshold else "unmatched"
        results.append({
            "text": text,
            "status": status,
            "match": _candidate_summary(candidate, score) if candidate else None,
        })
    return results


def compare_data(corpus: dict, harvest: dict, seen: list[str], near_threshold: float = 0.88) -> dict:
    indexes = build_script_indexes(corpus)
    live_items = flatten_harvest(harvest)
    matches = [classify_live_item(item, indexes, near_threshold) for item in live_items]
    seen_matches = compare_seen(seen, indexes, near_threshold)
    harvest_events = {item["event_id"] for item in live_items if item["event_id"]}
    overlapping_events = harvest_events & indexes["event_ids"]
    script_events_with_text = set(indexes["by_event"])
    statuses = Counter(item["status"] for item in matches)
    seen_statuses = Counter(item["status"] for item in seen_matches)
    observed_script_norms = {
        item["match"]["text"] for item in matches
        if item.get("match") and item["status"] in ("event_exact", "event_near", "global_exact", "global_near")
    }
    summary = {
        "near_threshold": near_threshold,
        "script_files": len(corpus.get("files", [])),
        "script_event_ids": len(indexes["event_ids"]),
        "script_unique_texts": len(indexes["candidates"]),
        "harvest_event_ids": len(harvest_events),
        "overlapping_event_ids": len(overlapping_events),
        "overlapping_event_ids_with_text": len(harvest_events & script_events_with_text),
        "overlapping_event_ids_without_text": len(overlapping_events - script_events_with_text),
        "missing_from_script_event_ids": len(harvest_events - indexes["event_ids"]),
        "unobserved_script_event_ids": len(indexes["event_ids"] - harvest_events),
        "harvest_unique_event_texts": len(matches),
        "harvest_statuses": dict(sorted(statuses.items())),
        "seen_unique_texts": len(seen_matches),
        "seen_statuses": dict(sorted(seen_statuses.items())),
        "matched_script_texts": len(observed_script_norms),
    }
    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "summary": summary,
        "overlapping_event_ids": sorted(overlapping_events, key=int),
        "missing_from_script_event_ids": sorted(harvest_events - indexes["event_ids"], key=int),
        "unobserved_script_event_ids": sorted(indexes["event_ids"] - harvest_events, key=int),
        "harvest_matches": matches,
        "seen_matches": seen_matches,
    }


def _clip(text: str, size: int = 90) -> str:
    text = re.sub(r"\s+", " ", text or "").replace("|", "\\|")
    return text if len(text) <= size else text[:size - 1] + "…"


def write_report(comparison: dict, path: Path, corpus_path: Path, harvest_path: Path, seen_path: Path) -> None:
    summary = comparison["summary"]
    statuses = summary["harvest_statuses"]
    seen_statuses = summary["seen_statuses"]
    lines = [
        "# Current-server capture vs SagaECO script corpus",
        "",
        f"- Script corpus: `{corpus_path.resolve()}`",
        f"- Event capture: `{harvest_path.resolve()}`",
        f"- Seen-text capture: `{seen_path.resolve()}`",
        f"- Near-match threshold: {summary['near_threshold']:.2f}",
        "",
        "## Event coverage",
        "",
        "| Metric | Count |",
        "|---|---:|",
        f"| Script Event IDs | {summary['script_event_ids']} |",
        f"| Captured Event IDs | {summary['harvest_event_ids']} |",
        f"| Overlapping Event IDs | {summary['overlapping_event_ids']} |",
        f"| Overlapping IDs with comparable script text | {summary['overlapping_event_ids_with_text']} |",
        f"| Overlapping IDs without static script text | {summary['overlapping_event_ids_without_text']} |",
        f"| Captured IDs missing from script corpus | {summary['missing_from_script_event_ids']} |",
        f"| Script IDs not observed in captures | {summary['unobserved_script_event_ids']} |",
        "",
        "## Event-associated text comparison",
        "",
        "| Classification | Count |",
        "|---|---:|",
    ]
    labels = {
        "event_exact": "Same Event ID, exact text",
        "event_near": "Same Event ID, near text",
        "global_exact": "Exact text under another/no Event ID",
        "global_near": "Near text under another/no Event ID",
        "event_text_changed": "Event ID exists, text changed/language differs",
        "script_event_no_text": "Event ID exists, but script has no static text",
        "script_event_missing": "Event ID absent from script corpus",
        "unassigned_event": "Capture has no Event ID",
    }
    for key in labels:
        lines.append(f"| {labels[key]} | {statuses.get(key, 0)} |")
    lines.extend([
        "",
        "## Seen-text global comparison",
        "",
        "| Classification | Count |",
        "|---|---:|",
        f"| Exact | {seen_statuses.get('exact', 0)} |",
        f"| Near | {seen_statuses.get('near', 0)} |",
        f"| Unmatched | {seen_statuses.get('unmatched', 0)} |",
        "",
        "## Examples",
        "",
    ])
    for status in labels:
        examples = [item for item in comparison["harvest_matches"] if item["status"] == status][:5]
        if not examples:
            continue
        lines.extend([f"### {labels[status]}", "", "| Event | NPC | Live text | Closest script text | Source |", "|---|---|---|---|---|"])
        for item in examples:
            match = item.get("match") or {}
            source = match.get("file", "")
            if source and match.get("line"):
                source += f":{match['line']}"
            lines.append(
                f"| {item.get('event_id') or '-'} | {_clip(item.get('npc', ''), 30)} | "
                f"{_clip(item.get('text', ''))} | {_clip(match.get('text', ''))} | {_clip(source, 70)} |"
            )
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare live ECO NPC captures with a SagaECO script corpus")
    parser.add_argument("corpus", type=Path)
    parser.add_argument("harvest", type=Path)
    parser.add_argument("seen", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--near-threshold", type=float, default=0.88)
    args = parser.parse_args(argv)
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    harvest = json.loads(args.harvest.read_text(encoding="utf-8"))
    seen = json.loads(args.seen.read_text(encoding="utf-8"))
    comparison = compare_data(corpus, harvest, seen, args.near_threshold)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        write_report(comparison, args.report, args.corpus, args.harvest, args.seen)
    print(json.dumps(comparison["summary"], ensure_ascii=False, indent=2))
    print(f"JSON -> {args.output.resolve()}")
    if args.report:
        print(f"Report -> {args.report.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
