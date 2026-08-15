# -*- coding: utf-8 -*-
"""One-shot: turn handle_parsed if-chain into _on_* methods + dispatch table."""
from __future__ import annotations

import re
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src" / "eco_damage_meter.py"
text = path.read_text(encoding="utf-8")
marker = "    def handle_parsed(self, parsed, ts):\n"
start = text.index(marker)
rest = text[start + len(marker) :]
next_def = re.search(r"\n    def ", rest)
if not next_def:
    raise SystemExit("end of handle_parsed not found")
body = rest[: next_def.start()]
after = rest[next_def.start() :]

# Split top-level `        if typ ==` / `        if typ in` / `        if typ !=`
pattern = re.compile(
    r"\n        if typ (== \"([^\"]+)\"|in \(([^)]+)\)|!= \"attack_result\"):"
)
matches = list(pattern.finditer("\n" + body))
# body starts with typ = ...
header = body
if matches:
    header = body[: matches[0].start()]

methods = []
dispatch_entries = []

def add_method(name: str, chunk: str) -> None:
    # drop leading `        if ...:\n` and trailing `        return\n`
    lines = chunk.splitlines(True)
    if lines and lines[0].lstrip().startswith("if typ"):
        lines = lines[1:]
    # unindent 4 spaces if present
    out = []
    for line in lines:
        if line.startswith("            "):
            out.append(line[4:])
        elif line.startswith("        ") and line.strip() == "return":
            continue
        else:
            out.append(line)
    methods.append(f"    def _on_{name}(self, parsed, ts):\n{''.join(out).rstrip()}\n")


if not matches:
    raise SystemExit("no typ branches")

# first branch starts at matches[0]
chunks = []
for i, match in enumerate(matches):
    end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
    chunk = body[match.start() + 1 : end]  # drop leading newline from regex
    cond = match.group(1)
    if cond.startswith("=="):
        name = match.group(2)
        add_method(name, chunk)
        dispatch_entries.append(f'        "{name}": _on_{name},')
    elif cond.startswith("in"):
        names = re.findall(r'"([^"]+)"', match.group(3))
        method_name = "skill_cast_event"
        add_method(method_name, chunk)
        for name in names:
            dispatch_entries.append(f'        "{name}": _on_{method_name},')
    else:
        add_method("attack_result", chunk)
        dispatch_entries.append('        "attack_result": _on_attack_result,')

new_handle = (
    "    def handle_parsed(self, parsed, ts):\n"
    "        typ = parsed.get(\"type\")\n"
    "        handler = type(self)._PARSED_HANDLERS.get(typ)\n"
    "        if handler is not None:\n"
    "            return handler(self, parsed, ts)\n"
    "\n"
)

# Deduplicate method names (skill_cast_result / skill_active share one)
unique_methods = []
seen = set()
for block in methods:
    name = re.search(r"def (_on_\w+)", block).group(1)
    if name in seen:
        continue
    seen.add(name)
    unique_methods.append(block)

table = (
    "    _PARSED_HANDLERS = {\n"
    + "\n".join(dispatch_entries)
    + "\n    }\n"
)

# Fix table to use DamageMeter methods after class body... we'll assign after methods
# Use names relative to class by defining table after methods as class attr.

# Convert dispatch to use unbound methods defined below
fixed = []
for line in dispatch_entries:
    # "foo": _on_foo  -> "foo": _on_foo  (set after class as DamageMeter._PARSED_HANDLERS)
    fixed.append(line)

new_text = (
    text[:start]
    + new_handle
    + "\n".join(unique_methods)
    + "\n"
    + after
)

# Append table assignment after class... find last line of class? Easier: set on class inside handle? 
# We'll add table right after new_handle as a class-level dict using strings and getattr in handle.

# Simpler handle already uses type(self)._PARSED_HANDLERS — assign at end of file.
assign = (
    "\n\nDamageMeter._PARSED_HANDLERS = {\n"
    + "\n".join(
        re.sub(
            r": _on_(\w+),",
            lambda m: f": DamageMeter._on_{m.group(1)},",
            line,
        )
        for line in dispatch_entries
    )
    + "\n}\n"
)

# If file already ends with main, insert before if __name__
if "if __name__" in new_text:
    idx = new_text.rfind("if __name__")
    new_text = new_text[:idx] + assign + "\n" + new_text[idx:]
else:
    new_text += assign

path.write_text(new_text, encoding="utf-8")
print("methods", len(unique_methods), "dispatch", len(dispatch_entries))
