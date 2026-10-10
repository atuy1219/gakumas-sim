#!/usr/bin/env python3
"""Map IL2CPP v31 methods to native RVAs through ELF codegen relocations.

This avoids guessing addresses from raw method-name strings. Requires the
matching, already-decoded global-metadata.dat and libil2cpp.so, never APK keys
or a running rooted process. Compatible with the known Gakumas v3.4.1 layout.
"""
import argparse
import json
import mmap
from pathlib import Path
import struct

TARGETS = {
    "Campus.InGame.Exam.ExamSequence": [
        "get_Parameter", "StartExam", "IsEndExam", "Dispose"],
    "Campus.InGame.Exam.ExamParameterModel": [
        "GetRandomInt", "SetExamEndComplete"],
    "Campus.InGame.ContestProgressData": ["StartExamBattle", "EndExamBattle"],
    "Campus.InGame.Exam.ExamData": [
        "CreateTowerExamData", "CreateContestExamData"],
    "Campus.InGame.Card.ExamCardMoveController": [
        "DrawCard", "ResetHand", "ShuffleDeck", "SetInitialCard", "MovePlayCard"],
}
READ_U32 = struct.Struct("<I")
READ_2U32 = struct.Struct("<II")
READ_7U32 = struct.Struct("<7I")
READ_REL = struct.Struct("<QQQ")


def unpack(fmt, source, off):
    return struct.unpack_from(fmt, source, off)


def map_methods(metadata):
    if unpack("<II", metadata, 0) != (0xFAB11BAF, 31):
        raise ValueError("decoded IL2CPP v31 metadata required")
    sections = [READ_2U32.unpack_from(metadata, 8 + 8 * i) for i in range(31)]
    names_off, names_len = sections[2]
    types_off, types_len = sections[19]
    methods_off, methods_len = sections[5]
    if types_len % 88 or methods_len % 36:
        raise ValueError("unexpected v31 type/method record size")
    def name(index):
        if not 0 <= index < names_len:
            return "<invalid>"
        start = names_off + index
        end = metadata.find(b"\0", start, min(start + 512, names_off + names_len))
        if end < 0:
            return "<invalid>"
        return metadata[start:end].decode("utf-8", "replace")
    types = []
    for index in range(types_len // 88):
        position = types_off + index * 88
        name_index, namespace_index = READ_2U32.unpack_from(metadata, position)
        types.append(name(namespace_index) + "." + name(name_index))
    matches = []
    for index in range(methods_len // 36):
        pos = methods_off + index * 36
        name_index, declaring, _, _, _, _, token = READ_7U32.unpack_from(metadata, pos)
        if declaring >= len(types):
            continue
        owner = types[declaring]
        method = name(name_index)
        if method not in TARGETS.get(owner, ()):
            continue
        arg_count = struct.unpack_from("<H", metadata, pos + 34)[0]
        flags = struct.unpack_from("<H", metadata, pos + 28)[0]
        matches.append({
            "type": owner, "method": method,
            "args": arg_count, "token": f"0x{token:08x}",
            "static": bool(flags & 0x10),
            "methodIndex": index,
        })
    return matches


def elf_sections(binary):
    # ELF64 LE AArch64; VA to file offsets using PT_LOAD and named sections.
    if binary[:6] != b"\x7fELF\x02\x01":
        raise ValueError("ELF64 little endian required")
    p_offset = struct.unpack_from("<Q", binary, 32)[0]
    p_entsize, p_count = struct.unpack_from("<HH", binary, 54)
    segments = []
    for i in range(p_count):
        pos = p_offset + p_entsize * i
        typ, flags, file_offset, vaddr, _, filesz, _, _ = unpack("<IIQQQQQQ", binary, pos)
        if typ == 1:
            segments.append((vaddr, vaddr + filesz, file_offset, flags))
    shoff = struct.unpack_from("<Q", binary, 40)[0]
    shentsize, shnum, shstrndx = struct.unpack_from("<HHH", binary, 58)
    def hdr(i):
        return unpack("<IIQQQQIIQQ", binary, shoff + shentsize * i)
    shstr = hdr(shstrndx)
    shstrings = binary[shstr[4]:shstr[4] + shstr[5]]
    section_map = {}
    for i in range(shnum):
        row = hdr(i)
        end = shstrings.find(b"\0", row[0])
        name = shstrings[row[0]:end].decode()
        section_map[name] = (row[4], row[5])
    return segments, section_map


def extract(binary, methods):
    segments, sections = elf_sections(binary)
    def to_file(address):
        for start, end, off, _ in segments:
            if start <= address < end:
                return off + address - start
        raise ValueError("out-of-file RVA: " + hex(address))

    module_name = b"Assembly-CSharp.dll\0"
    name_pos = binary.find(module_name)
    if name_pos < 0:
        raise ValueError("Assembly-CSharp.dll string not present")
    name_rva = None
    for start, end, off, _ in segments:
        if off <= name_pos < off + end - start:
            name_rva = start + name_pos - off
    if name_rva is None:
        raise ValueError("module name not mapped")

    rel_offset, rel_size = sections[".rela.dyn"]
    module_headers = []
    for pos in range(rel_offset, rel_offset + rel_size, 24):
        dest, r_info, addend = READ_REL.unpack_from(binary, pos)
        if r_info & 0xFFFFFFFF == 1027 and addend == name_rva:
            module_headers.append(dest)
    # Il2CppCodeGenModule is {moduleName, methodPointerCount, methodPointers...}
    selected = None
    for module_header in module_headers:
        pointer_count = struct.unpack_from("<Q", binary, to_file(module_header + 8))[0]
        if not 0 < pointer_count < 10_000_000:
            continue
        for pos in range(rel_offset, rel_offset + rel_size, 24):
            dest, r_info, addend = READ_REL.unpack_from(binary, pos)
            if dest == module_header + 16 and r_info & 0xFFFFFFFF == 1027:
                selected = (pointer_count, addend)
                break
        if selected:
            break
    if selected is None:
        raise ValueError("module method pointer table was not found")
    pointer_count, pointer_base = selected

    destinations = {}
    for method in methods:
        tok = int(method["token"], 16)
        index = (tok & 0xFFFFFF) - 1
        if (tok >> 24) != 6 or not 0 <= index < pointer_count:
            raise ValueError("token outside matching module method pointer array")
        destinations[pointer_base + 8 * index] = method
    for pos in range(rel_offset, rel_offset + rel_size, 24):
        dest, r_info, addend = READ_REL.unpack_from(binary, pos)
        if dest in destinations and r_info & 0xFFFFFFFF == 1027:
            destinations[dest]["rva"] = f"0x{addend:x}"
    for entry in methods:
        if "rva" not in entry:
            raise ValueError("no relocation-derived method address: " + repr(entry))
        target = int(entry["rva"], 16)
        if not any(start <= target < end and (flags & 1) for start, end, _, flags in segments):
            raise ValueError("target is not in an ELF executable segment: " + repr(entry))
    return sorted(methods, key=lambda m: (m["type"], m["method"], m["args"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("library", type=Path)
    parser.add_argument("-o", "--output", type=Path, default=Path("gakumas-method-rvas.json"))
    args = parser.parse_args()
    with args.metadata.open("rb") as metadata_file, args.library.open("rb") as elf_file:
        metadata = mmap.mmap(metadata_file.fileno(), 0, access=mmap.ACCESS_READ)
        binary = mmap.mmap(elf_file.fileno(), 0, access=mmap.ACCESS_READ)
        methods = extract(binary, map_methods(metadata))
    args.output.write_text(json.dumps(methods, indent=2, ensure_ascii=False) + "\n")
    for item in methods:
        print(f'{item["type"]}.{item["method"]}({item["args"]}) -> {item["rva"]}')


if __name__ == "__main__":
    main()
