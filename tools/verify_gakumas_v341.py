#!/usr/bin/env python3
"""Recheck user-supplied APK/ELF/metadata and documented v3.4.1 hook scope.

Offline, stdlib only. Writes compact evidence, never proprietary binary data.
No on-device execution or native calling-convention validation is implied.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import struct
import zipfile

from decrypt_gakumas_metadata import decode, validate, KNOWN_INPUT_SHA256
import extract_gakumas_method_rvas as mapper

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_ELF = "90a0b71d96691e41641690e57983d600c3ef1301b971d114d6a1658591e9ea17"
EXPECTED_DECODED = "4370094ac9c8949eeb8a2b57c17424fe85d0e7a29ab2de0a71510b2458740a38"
BUILD_ID = "77fda4e2a21f23954e2349b83fc113ede408f70b"


def bl_target(instruction, address):
    if instruction & 0xFC000000 != 0x94000000:
        raise ValueError(f"not an AArch64 BL at {address:#x}")
    displacement = instruction & 0x03FFFFFF
    if displacement & 0x02000000:
        displacement -= 0x04000000
    return address + 4 * displacement


class Image:
    def __init__(self, binary):
        self.binary = binary
        if struct.unpack_from("<H", binary, 18)[0] != 183:
            raise ValueError("AArch64 ELF required")
        self.segments, self.sections = mapper.elf_sections(binary)
        start, size = self.sections[".rela.dyn"]
        self.relative = {}
        for offset in range(start, start + size, 24):
            destination, info, addend = struct.unpack_from("<QQQ", binary, offset)
            if info & 0xFFFFFFFF == 1027:
                self.relative[destination] = addend

    def offset(self, address, length=1):
        for start, end, offset, _ in self.segments:
            if start <= address and address + length <= end:
                return offset + address - start
        raise ValueError(f"unmapped ELF address {address:#x}")

    def rva(self, offset):
        for start, end, file_offset, _ in self.segments:
            if file_offset <= offset < file_offset + end - start:
                return start + offset - file_offset
        raise ValueError("unmapped ELF file offset")

    def word(self, address):
        return struct.unpack_from("<I", self.binary, self.offset(address, 4))[0]

    def pointer(self, address):
        return self.relative.get(address, struct.unpack_from("<Q", self.binary, self.offset(address, 8))[0])

    def build_id(self):
        start, size = self.sections[".note.gnu.build-id"]
        namesz, descsz, kind = struct.unpack_from("<III", self.binary, start)
        if kind != 3 or self.binary[start + 12:start + 12 + namesz] != b"GNU\0":
            raise ValueError("invalid GNU Build ID note")
        begin = start + 12 + ((namesz + 3) & ~3)
        if begin + descsz > start + size:
            raise ValueError("invalid GNU Build ID bounds")
        return self.binary[begin:begin + descsz].hex()

    def metadata_registration(self, type_count):
        # v31: typesCount/types + fieldOffsetsCount/fieldOffsets +
        # typeDefinitionsSizesCount/sizes. Require one unique relocation-backed
        # candidate and both definition counts matching the actual metadata.
        start, size = self.sections[".data.rel.ro"]
        needle = struct.pack("<Q", type_count)
        found = []
        position = start
        while (position := self.binary.find(needle, position, start + size)) >= 0:
            if position >= start + 80 and position + 24 <= start + size:
                if struct.unpack_from("<Q", self.binary, position + 16)[0] == type_count:
                    base = self.rva(position - 80)
                    if all(base + delta in self.relative for delta in (56, 88, 104)):
                        found.append(base)
            position += 1
        if len(found) != 1:
            raise ValueError("metadata registration candidate is not unique")
        base = found[0]
        count = self.word(base + 48)
        if not 0 < count < 1_000_000:
            raise ValueError("invalid types count")
        return base, count, self.pointer(base + 56)


def verify(base_apk, arm64_apk, library):
    raw = library.read_bytes()
    if sha256(raw).hexdigest() != EXPECTED_ELF:
        raise ValueError("ELF SHA-256 does not match the supplied v3.4.1 sample")
    with zipfile.ZipFile(arm64_apk) as archive:
        apk_raw = archive.read("lib/arm64-v8a/libil2cpp.so")
    if apk_raw != raw:
        raise ValueError("arm64 APK ELF differs from the standalone ELF")
    with zipfile.ZipFile(base_apk) as archive:
        encrypted = archive.read("assets/bin/Data/Managed/Metadata/global-metadata.dat")
    if sha256(encrypted).hexdigest() != KNOWN_INPUT_SHA256:
        raise ValueError("APK metadata differs from the supplied v3.4.1 sample")
    metadata = decode(encrypted)
    validate(metadata)
    if sha256(metadata).hexdigest() != EXPECTED_DECODED:
        raise ValueError("decoded metadata hash mismatch")
    image = Image(raw)
    if image.build_id() != BUILD_ID:
        raise ValueError("ELF Build ID mismatch")
    scope = json.loads((ROOT / "tools/gakumas_v341_user_mode_entrypoints.json").read_text())
    lifecycle = json.loads((ROOT / "tools/gakumas_v341_lifecycle_rvas.json").read_text())
    targets = {key: list(value) for key, value in mapper.TARGETS.items()}
    for mode in scope["userModes"].values():
        for full, _, _ in mode["methods"]:
            owner, method = full.rsplit(".", 1)
            targets.setdefault(owner, []).append(method)
    targets["Campus.InGame.Exam.ExamSequence"] += ["SetUpExam"]
    targets["Campus.InGame.Exam.ExamParameterModel"] += ["get_ExamType", "get_IsReplay"]
    # Use the existing table parser, while checking inputs, APK equality,
    # declared signatures and actual instructions independently here.
    previous = mapper.TARGETS
    try:
        mapper.TARGETS = targets
        methods = mapper.extract(raw, mapper.map_methods(metadata))
    finally:
        mapper.TARGETS = previous
    by_token = {int(row["token"], 16): row for row in methods}
    checked_methods = 0
    for mode in scope["userModes"].values():
        for full, token, rva in mode["methods"]:
            row = by_token.get(int(token, 16))
            if row is None or row["type"] + "." + row["method"] != full or int(row["rva"], 16) != int(rva, 16):
                raise ValueError("documented mode method mismatch: " + full)
            checked_methods += 1
    for row in lifecycle["methods"]:
        actual = by_token.get(int(row["token"], 16))
        if not actual or any(actual[key] != row[key] for key in ("type", "method", "args")) \
                or int(actual["rva"], 16) != int(row["rva"], 16):
            raise ValueError("documented lifecycle method mismatch: " + str(row))
        if "static" in row and row["static"] != actual["static"]:
            raise ValueError("documented lifecycle method static flag mismatch")
    calls = []
    for mode in scope["userModes"].values():
        for address, target, description in mode["directCalls"]:
            address, target = int(address, 16), int(target, 16)
            if bl_target(image.word(address), address) != target:
                raise ValueError("documented direct call mismatch")
            calls.append(dict(callRva=hex(address), targetRva=hex(target), description=description))
    setup = scope["shared"]["scopedSetupProbe"]
    for returned, lane in setup["observedReturnRva"]:
        address = int(returned, 16) - 4
        if bl_target(image.word(address), address) != int(setup["rva"], 16):
            raise ValueError("documented SetUpExam caller mismatch")
        calls.append(dict(callRva=hex(address), targetRva=setup["rva"], description=lane))
    types_offset, types_length = struct.unpack_from("<II", metadata, 8 + 19 * 8)
    strings_offset, strings_length = struct.unpack_from("<II", metadata, 24)
    methods_offset, _ = struct.unpack_from("<II", metadata, 8 + 5 * 8)
    params_offset, params_length = struct.unpack_from("<II", metadata, 8 + 10 * 8)
    registration, type_count, type_array = image.metadata_registration(types_length // 88)

    def name(index):
        if not 0 <= index < strings_length:
            raise ValueError("invalid metadata name")
        start = strings_offset + index
        end = metadata.find(b"\0", start, strings_offset + strings_length)
        if end < 0:
            raise ValueError("unterminated metadata name")
        return metadata[start:end].decode("utf8", "backslashreplace")

    def type_description(index):
        if not 0 <= index < type_count:
            raise ValueError("type index outside registration")
        address = image.pointer(type_array + 8 * index)
        kind = (image.word(address + 8) >> 16) & 255
        description = {1: "void", 2: "bool", 8: "int32", 10: "int64", 14: "string"}.get(kind)
        if kind in (0x11, 0x12):
            definition = image.word(address)
            if definition >= types_length // 88:
                raise ValueError("type definition outside metadata")
            n, ns = struct.unpack_from("<II", metadata, types_offset + 88 * definition)
            description = name(ns) + "." + name(n)
        return dict(typeIndex=index, kind=hex(kind), type=description or "unresolved-generic-or-other")

    signatures = []
    for row in methods:
        method = struct.unpack_from("<7I4H", metadata, methods_offset + 36 * row["methodIndex"])
        parameters = []
        if method[10] and method[4] + method[10] > params_length // 12:
            raise ValueError("parameter range outside metadata")
        for index in range(method[10]):
            n, _, typ = struct.unpack_from("<III", metadata, params_offset + 12 * (method[4] + index))
            parameters.append(dict(name=name(n), **type_description(typ)))
        signatures.append(dict(**row, returns=type_description(method[2]), parameters=parameters))
    setup_signature = next(row for row in signatures if int(row["token"], 16) == int(setup["token"], 16))
    if setup_signature["static"] or setup_signature["returns"]["type"] != "void" \
            or [p["type"] for p in setup_signature["parameters"]] != ["Campus.InGame.Exam.ExamData"]:
        raise ValueError("SetUpExam managed signature mismatch")
    return dict(schemaVersion=1, verification="static-only", onDeviceVerified=False,
                libil2cppSha256=EXPECTED_ELF, apkElfIdentical=True, libil2cppBuildId=BUILD_ID,
                encryptedMetadataSha256=KNOWN_INPUT_SHA256, decodedMetadataSha256=EXPECTED_DECODED,
                metadataRegistrationRva=hex(registration), registeredTypeCount=type_count,
                checkedModeMethods=checked_methods, checkedDirectCalls=calls, signatures=signatures,
                limitations=["Generic value types / ARM64 hidden result and stack argument ABI still require disassembly.",
                             "Caller lanes are not proof of ExamType, rehearsal, ranking origin or live execution.",
                             "No game functions executed; no card/effect/score parity established."])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_apk", type=Path)
    parser.add_argument("arm64_apk", type=Path)
    parser.add_argument("library", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.base_apk, args.arm64_apk, args.library)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Static verification passed: {report['checkedModeMethods']} mode methods, "
          f"{len(report['checkedDirectCalls'])} BL calls; device verification pending")


if __name__ == "__main__":
    main()
