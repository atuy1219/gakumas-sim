from __future__ import annotations


def read_varint(buf: bytes, index: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while index < len(buf):
        byte = buf[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, index
        shift += 7
        if shift > 70:
            raise ValueError("protobuf varint is too large")
    raise ValueError("truncated protobuf varint")


def decode_wire(buf: bytes) -> list[tuple[int, int, object]]:
    """Decode the protobuf wire types used by master rows."""
    result: list[tuple[int, int, object]] = []
    index = 0
    while index < len(buf):
        key, index = read_varint(buf, index)
        field = key >> 3
        wire = key & 7
        if field <= 0 or wire not in (0, 1, 2, 5):
            raise ValueError((index, key, field, wire))
        if wire == 0:
            value, index = read_varint(buf, index)
        elif wire == 1:
            value = buf[index:index + 8]
            index += 8
        elif wire == 5:
            value = buf[index:index + 4]
            index += 4
        else:
            size, index = read_varint(buf, index)
            value = buf[index:index + size]
            index += size
            if len(value) != size:
                raise ValueError("truncated protobuf length-delimited field")
        result.append((field, wire, value))
    return result
