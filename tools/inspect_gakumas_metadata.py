#!/usr/bin/env python3
"""Parse IL2CPP v31 type/method definitions; print tokens, not native RVAs."""
import argparse
import json
import struct
from pathlib import Path

def inventory(metadata, filters=("Exam", "Contest", "Tower", "Audition")):
    b = Path(metadata).read_bytes()
    if len(b) < 256 or struct.unpack_from("<II", b) != (0xFAB11BAF, 31):
        raise ValueError("Requires decrypted IL2CPP metadata version 31")
    ranges = [struct.unpack_from("<II", b, 8 + i*8) for i in range(31)]
    for offset, length in ranges:
        if offset < 256 or offset+length > len(b):
            raise ValueError("Invalid metadata section bounds")
    strings, strings_len = ranges[2]
    types, types_len = ranges[19]
    methods, methods_len = ranges[5]
    params, params_len = ranges[10]
    if types_len % 88 or methods_len % 36 or params_len % 12:
        raise ValueError("Unexpected v31 structure width")
    def name(index):
        if not 0 <= index < strings_len:
            raise ValueError("Invalid name index")
        start = strings + index
        end = b.find(b"\0", start, strings + strings_len)
        if end < 0:
            raise ValueError("Unterminated metadata string")
        return b[start:end].decode("utf-8")
    result = []
    for ti in range(types_len//88):
        t = struct.unpack_from("<16I8H2I", b, types+88*ti)
        owner = name(t[1])+"."+name(t[0])
        if not any(s.lower() in owner.lower() for s in filters):
            continue
        start, count = t[9], t[16]
        if count > 4096 or start+count > methods_len//36:
            raise ValueError("Invalid method range")
        for mi in range(start, start+count):
            m = struct.unpack_from("<7I4H", b, methods+36*mi)
            pstart, argc = m[4], m[10]
            if m[1] != ti or pstart+argc > params_len//12:
                raise ValueError("Invalid method reference")
            args = [name(struct.unpack_from("<I", b, params+12*(pstart+i))[0])
                    for i in range(argc)]
            result.append(dict(type=owner, method=name(m[0]),
                               token=f"0x{m[6]:08X}", definitionIndex=mi,
                               parameterNames=args, parameterCount=argc,
                               nativeRva=None))
    return result

def main():
    p = argparse.ArgumentParser()
    p.add_argument("metadata")
    p.add_argument("-o", "--output", help="Save JSON inventory")
    args = p.parse_args()
    rows = inventory(args.metadata)
    if args.output:
        Path(args.output).write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        print(len(rows), "methods saved")
    else:
        for x in rows:
            if any(k in x["method"] for k in ("StartExam", "Dispose", "SetUpExam",
                  "EndExam", "DrawCard", "GetRandomInt")):
                print(x)

if __name__ == "__main__":
    main()
