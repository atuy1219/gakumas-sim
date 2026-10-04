"""Preserve public battle inputs from a TowerGetLayer API dump.

Usage: python tools/build_tower_layer_snapshot.py TowerLayerExam_live.json OUTPUT.gz
The snapshot deliberately excludes commonResponse and player/ranking data.
"""

import gzip
import json
import sys


def build_snapshot(payload):
    rows = []
    keys = set()
    for layer in payload["layers"]:
        data = layer["data"]
        for exam in data["exams"]:
            row = {
                "towerId": layer["towerId"],
                "number": layer["number"],
                "maxSubMemoryCount": data["maxSubMemoryCount"],
                **{key: exam[key] for key in (
                    "examEffectType", "parameterBaseLine", "baseScore",
                    "produceExamBattleConfigId", "produceExamBattleNpcGroupId",
                    "produceExamGimmickEffectGroupId", "produceItemIds",
                )},
            }
            key = (row["towerId"], row["number"], row["examEffectType"])
            if key in keys:
                raise ValueError(f"duplicate layer exam: {key}")
            keys.add(key)
            rows.append(row)
    rows.sort(key=lambda row: (row["towerId"], row["number"], row["examEffectType"]))
    return {
        "format": "gakumas-tower-layer-config-map",
        "version": 2,
        **{key: payload[key] for key in ("generatedAt", "appVersion", "masterVersion")},
        "layerExams": rows,
    }


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as source:
        result = build_snapshot(json.load(source))
    with open(sys.argv[2], "wb") as target:
        target.write(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0))
    print(f"saved {len(result['layerExams'])} layer exams")
