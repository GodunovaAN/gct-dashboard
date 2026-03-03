#!/usr/bin/env python3
"""Convert GCT workshop XLSX into JSON without third-party dependencies."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import xml.etree.ElementTree as et
import zipfile
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def col_to_num(col: str) -> int:
    value = 0
    for char in col:
        value = value * 26 + (ord(char) - 64)
    return value


def clean_header(text: str) -> str:
    compact = " ".join((text or "").split()).strip()
    return compact or "Unnamed"


def unique_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for header in headers:
        base = clean_header(header)
        count = seen.get(base, 0)
        seen[base] = count + 1
        out.append(base if count == 0 else f"{base} ({count + 1})")
    return out


def read_shared_strings(book: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in book.namelist():
        return []
    root = et.fromstring(book.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall("a:si", NS):
        text = "".join(token.text or "" for token in item.findall(".//a:t", NS))
        values.append(text)
    return values


def read_sheet_rows(book: zipfile.ZipFile, sheet_path: str, shared: list[str]) -> list[list[str]]:
    root = et.fromstring(book.read(sheet_path))
    rows: list[list[str]] = []

    for row in root.findall(".//a:sheetData/a:row", NS):
        values_by_col: dict[int, str] = {}
        for cell in row.findall("a:c", NS):
            ref = cell.attrib.get("r", "")
            match = re.match(r"([A-Z]+)", ref)
            if not match:
                continue

            col_index = col_to_num(match.group(1))
            cell_type = cell.attrib.get("t")
            value = ""

            raw = cell.find("a:v", NS)
            inline = cell.find("a:is", NS)
            if cell_type == "s" and raw is not None and raw.text is not None:
                idx = int(raw.text)
                value = shared[idx] if 0 <= idx < len(shared) else ""
            elif cell_type == "inlineStr" and inline is not None:
                value = "".join(t.text or "" for t in inline.findall(".//a:t", NS))
            elif raw is not None and raw.text is not None:
                value = raw.text

            values_by_col[col_index] = value.strip()

        if not values_by_col:
            rows.append([])
            continue

        width = max(values_by_col.keys())
        rows.append([values_by_col.get(i, "") for i in range(1, width + 1)])

    while rows and not any(rows[-1]):
        rows.pop()
    return rows


def workbook_sheets(book: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb = et.fromstring(book.read("xl/workbook.xml"))
    rels = et.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("rel:Relationship", NS)
    }

    sheets: list[tuple[str, str]] = []
    for sheet in wb.findall("a:sheets/a:sheet", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = "xl/" + rel_map[rel_id].lstrip("/")
        sheets.append((name, target))
    return sheets


def build_dataset(input_path: Path, output_path: Path, sheet_name: str | None) -> None:
    with zipfile.ZipFile(input_path) as book:
        shared = read_shared_strings(book)
        sheets = workbook_sheets(book)

        if not sheets:
            raise ValueError("Workbook does not contain sheets")

        selected_name, selected_path = sheets[0]
        if sheet_name:
            for name, path in sheets:
                if name == sheet_name:
                    selected_name, selected_path = name, path
                    break
            else:
                available = ", ".join(name for name, _ in sheets)
                raise ValueError(f"Sheet '{sheet_name}' not found. Available: {available}")

        raw_rows = read_sheet_rows(book, selected_path, shared)

    if not raw_rows:
        raise ValueError("Selected sheet is empty")

    headers = unique_headers(raw_rows[0])
    rows: list[dict[str, str]] = []

    for raw_row in raw_rows[1:]:
        values = raw_row + [""] * (len(headers) - len(raw_row))
        item = {header: values[idx].strip() for idx, header in enumerate(headers)}
        if any(item.values()):
            rows.append(item)

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "sourceFile": str(input_path),
        "sheetName": selected_name,
        "rowCount": len(rows),
        "headers": headers,
        "rows": rows,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build JSON dataset from GCT workshop XLSX.")
    parser.add_argument("input", type=Path, help="Path to .xlsx file")
    parser.add_argument("output", type=Path, help="Output .json path")
    parser.add_argument("--sheet", type=str, default=None, help="Sheet name (default: first sheet)")
    args = parser.parse_args()

    build_dataset(args.input, args.output, args.sheet)
    print(f"Saved dataset to {args.output}")


if __name__ == "__main__":
    main()
