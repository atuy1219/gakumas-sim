#!/usr/bin/env python3
"""Restore Gakumas 3.4.1 XOR-obfuscated IL2CPP global-metadata.dat.

Evidence: 128-byte repeating XOR mask; decoded metadata magic AF 1B B1 FA,
version 31, 31 in-range header offset/length pairs, intact UTF-8 method strings.
Never assume the same key applies to another release.
"""
import argparse
from hashlib import sha256
from pathlib import Path
from struct import unpack_from

KEY = bytes.fromhex("""
09 6a b3 b5 a3 3b ab 5d b9 3c a3 bb 37 74 38 2b
e8 8e a4 fd 14 98 7d 91 99 d8 3b b3 a2 d6 95 47
b1 da b8 22 a8 c2 b9 73 72 2e 6b de cc ea ff b9
d6 6c f3 fc 91 b8 de 70 ec 22 1b cb ff f7 bb e3
a6 5c 0a 5d bc 15 82 25 d4 31 8b e6 2d 9e c5 ae
d8 82 dc 35 e2 99 b5 f8 fc 47 36 86 a6 ee 73 7a
72 87 38 70 e0 a2 fc c1 e9 ce 28 5f 2d f8 43 4d
5d 6d f2 7d 1a 85 01 0d a6 11 61 74 df fb 7e e5
""")
MAGIC = 0xFAB11BAF
KNOWN_INPUT_SHA256 = "aaff4137984cbfbc58aeabe48c0d3abf4d586923c2355e43c5908dd890ca29dc"

def decode(data: bytes) -> bytes:
    out = bytearray(len(data))
    for offset in range(0, len(data), 128):
        for i, value in enumerate(data[offset:offset + 128]):
            out[offset + i] = value ^ KEY[i]
    return bytes(out)

def validate(data: bytes) -> dict:
    if len(data) < 256:
        raise ValueError("metadata header shorter than 256 bytes")
    magic, version = unpack_from("<II", data)
    if magic != MAGIC or version != 31:
        raise ValueError("decoded header failed: magic/version mismatch")
    sections = []
    for header_offset in range(8, 256, 8):
        offset, length = unpack_from("<II", data, header_offset)
        if offset < 256 or offset % 4 or length % 4 or offset + length > len(data):
            raise ValueError("invalid section at header offset " + hex(header_offset))
        sections.append((offset, length))
    if max(off + size for off, size in sections if size) != len(data):
        raise ValueError("metadata sections do not extend to EOF")
    if b"get_HttpResponse\x00" not in data or b"get_SerializationContext\x00" not in data:
        raise ValueError("expected method-name evidence absent")
    # Validate the pure UTF-8 string table in the supplied IL2CPP v31 image.
    string_offset, string_length = sections[2]
    data[string_offset : string_offset + string_length].decode("utf-8")
    return {"version": version, "sections": len(sections),
            "bytes": len(data), "sha256": sha256(data).hexdigest()}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("global-metadata.decrypted.dat"))
    args = ap.parse_args()
    source = args.input.read_bytes()
    original_sha = sha256(source).hexdigest()
    decoded = decode(source)
    result = validate(decoded)
    args.output.write_bytes(decoded)
    print("Input SHA-256:", original_sha)
    print("Restored:", args.output)
    for label, value in result.items():
        print(label, value)
    if original_sha != KNOWN_INPUT_SHA256:
        print("WARNING: original differs from the verified Gakumas 3.4.1 metadata.")

if __name__ == "__main__":
    main()
