#!/usr/bin/env python3
"""Normalize Stalwart CLI JSON output and extract fields without leaking secrets.

The Stalwart CLI can emit JSON, NDJSON, a bare list, or an object with an
``items`` array depending on the subcommand and version. This helper accepts any
of those shapes so the shell scripts do not have to.

Usage:
  stalwart_json.py id-by-name <file> <name>   # print the id of the matching row
  stalwart_json.py first-id <file>            # print the id of the first row
  stalwart_json.py count <file>               # print the number of rows
  stalwart_json.py has-name <file> <name>     # exit 0 if a matching row exists
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load_rows(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text:
        return []
    values: list
    try:
        values = [json.loads(text)]
    except json.JSONDecodeError:
        values = [json.loads(line) for line in text.splitlines() if line.strip()]
    rows: list[dict] = []
    for value in values:
        if isinstance(value, list):
            rows.extend(value)
        elif isinstance(value, dict) and "id" in value:
            rows.append(value)
        elif isinstance(value, dict) and isinstance(value.get("items"), list):
            rows.extend(value["items"])
    return rows


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    command, path = argv[1], argv[2]
    rows = load_rows(path)
    if command == "count":
        print(len(rows))
        return 0
    if command == "first-id":
        for row in rows:
            if "id" in row:
                print(row["id"])
                return 0
        return 3
    if command in {"id-by-name", "has-name"}:
        if len(argv) < 4:
            print(f"{command} requires a name", file=sys.stderr)
            return 2
        name = argv[3]
        for row in rows:
            if row.get("name") == name:
                if command == "id-by-name":
                    print(row["id"])
                return 0
        return 3
    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
