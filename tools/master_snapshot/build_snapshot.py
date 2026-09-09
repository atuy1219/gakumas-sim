from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from proto_raw import decode_wire


def signed(value: int) -> int:
    return value - (1 << 64) if value >= (1 << 63) else value


def table_rows(master_dir: Path, database: str):
    path = master_dir / f"{database}.sqlite"
    con = sqlite3.connect(path)
    try:
        table = con.execute(
            "select name from sqlite_master where type='table' and name not like 'sqlite_%'"
        ).fetchone()[0]
        columns = [row[1] for row in con.execute(f'pragma table_info("{table}")')]
        rows = con.execute(f'select * from "{table}"').fetchall()
        return columns, rows
    finally:
        con.close()


def decode_fields(blob: bytes) -> dict[int, object]:
    out: dict[int, object] = {}
    for field, wire, value in decode_wire(blob):
        if wire == 0:
            decoded: object = signed(int(value))
        elif wire == 2:
            raw = bytes(value)
            try:
                decoded = raw.decode("utf-8")
            except UnicodeDecodeError:
                decoded = {"b": base64.b64encode(raw).decode("ascii")}
        else:
            continue
        if field in out:
            current = out[field]
            if not isinstance(current, list):
                current = [current]
                out[field] = current
            current.append(decoded)
        else:
            out[field] = decoded
    return out


def decode_submessage(value: object) -> dict[int, object]:
    if isinstance(value, dict) and "b" in value:
        raw = base64.b64decode(value["b"])
    elif isinstance(value, str):
        raw = value.encode("latin1")
    else:
        return {}
    return decode_fields(raw)


def as_list(value: object) -> list[object]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def scalar_record(fields: dict[int, object], keep: range) -> dict[str, object]:
    record: dict[str, object] = {}
    for number in keep:
        value = fields.get(number)
        if value is None or isinstance(value, dict):
            continue
        if isinstance(value, list):
            compact = [x for x in value if isinstance(x, (str, int))]
            if compact:
                record[str(number)] = compact
        elif isinstance(value, (str, int)):
            record[str(number)] = value
    return record


def build_snapshot(master_dir: Path) -> dict[str, object]:
    out: dict[str, object] = {"version": 1}

    columns, rows = table_rows(master_dir, "ProduceCard")
    cards = []
    for row in rows:
        fields = decode_fields(row[columns.index("data")])
        play_effects = []
        for raw in as_list(fields.get(21)):
            sub = decode_submessage(raw)
            play_effects.append({
                "t": sub.get(1, ""),
                "e": sub.get(2, ""),
                "x3": sub.get(3, 0),
                "x4": sub.get(4, 0),
            })
        cards.append({
            "i": row[columns.index("Id")],
            "u": row[columns.index("UpgradeCount")],
            "n": fields.get(3, ""),
            "f6": fields.get(6, 0),
            "cat": fields.get(7, 0),
            "rar": fields.get(8, 0),
            "plan": fields.get(9, 0),
            "st": fields.get(10, 0),
            "fst": fields.get(11, 0),
            "ct": fields.get(12, 0),
            "cv": fields.get(13, 0),
            "pt": fields.get(17, ""),
            "pe": play_effects,
            "mv": fields.get(22, 0),
            "f23": fields.get(23, 0),
            "f24": fields.get(24, ""),
            "f26": fields.get(26, 0),
            "f28": fields.get(28, ""),
            "f30": fields.get(30, 0),
            "f31": fields.get(31, 0),
            "f39": fields.get(39, ""),
            "f40": fields.get(40, ""),
            "f41": fields.get(41, 0),
            "cu": as_list(fields.get(43)),
            "cm": fields.get(44, 0),
            "f45": fields.get(45, 0),
            "f47": fields.get(47, ""),
            "f48": fields.get(48, ""),
        })
    out["cards"] = cards

    tables = [
        ("ProduceCardCustomize", "customizes", range(1, 10)),
        ("ProduceCardGrowEffect", "growEffects", range(1, 16)),
        ("ProduceExamEffect", "effects", range(1, 30)),
        ("ProduceExamTrigger", "triggers", range(1, 16)),
        ("ProduceExamStatusEnchant", "enchants", range(1, 16)),
        ("ProduceItem", "items", range(1, 30)),
        ("ProduceItemEffect", "itemEffects", range(1, 15)),
        ("ExamSetting", "setting", range(1, 60)),
    ]
    for database, key, keep in tables:
        columns, rows = table_rows(master_dir, database)
        records = []
        for row in rows:
            fields = decode_fields(row[columns.index("data")])
            record = scalar_record(fields, keep)
            record["i"] = row[columns.index("Id")] if "Id" in columns else ""
            if "CustomizeCount" in columns:
                record["c"] = row[columns.index("CustomizeCount")]
            records.append(record)
        out[key] = records[0] if database == "ExamSetting" else records
    return out


def emit_module(snapshot_bytes: bytes, output: Path) -> None:
    compressed = gzip.compress(snapshot_bytes, compresslevel=9)
    encoded = base64.b64encode(compressed).decode("ascii")
    snapshot_sha = hashlib.sha256(snapshot_bytes).hexdigest()
    module = f'''// Generated master snapshot. Do not hand-edit.\n\
export const MASTER_SNAPSHOT_SHA256 = {json.dumps(snapshot_sha)};\n\
const DATA = {json.dumps(encoded)};\n\
let cachedPromise = null;\n\
async function gunzipBase64(base64) {{\n\
  if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream(gzip) is unavailable");\n\
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));\n\
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));\n\
  return new Response(stream).text();\n\
}}\n\
export async function loadMasterSnapshot() {{\n\
  if (!cachedPromise) cachedPromise = gunzipBase64(DATA).then((text) => JSON.parse(text));\n\
  return cachedPromise;\n\
}}\n'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(module, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compact master snapshot")
    parser.add_argument("--master-dir", type=Path, required=True, help="Directory containing master sqlite files")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON snapshot")
    parser.add_argument("--module-output", type=Path, help="Optional generated gzip/base64 browser module")
    args = parser.parse_args()

    snapshot = build_snapshot(args.master_dir)
    raw = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(raw)
    if args.module_output:
        emit_module(raw, args.module_output)

    counts = {k: len(v) for k, v in snapshot.items() if isinstance(v, list)}
    print(json.dumps({"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
