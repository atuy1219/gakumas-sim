import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "tools" / "inspect_gakumas_metadata.py"
spec = importlib.util.spec_from_file_location("metadata_inspector", MODULE)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)

class MetadataInspectorTests(unittest.TestCase):
    def sample(self):
        strings = b"\x00Campus.InGame.Exam\x00ExamSequence\x00StartExam\x00Dispose\x00"
        def ix(s):
            return strings.index(s.encode("ascii") + b"\x00")
        data = bytearray(256)
        data += strings
        while len(data) % 4:
            data.append(0)
        method_offset = len(data)
        for method, token in [("StartExam", 0x060050A9), ("Dispose", 0x060050D7)]:
            data += struct.pack("<7I4H", ix(method), 0, 0, 0, 0, 0xFFFFFFFF,
                                token, 0, 0, 0, 0)
        type_offset = len(data)
        words = [0] * 16
        words[0], words[1] = ix("ExamSequence"), ix("Campus.InGame.Exam")
        words[9] = 0
        counts = [0] * 8
        counts[0] = 2
        data += struct.pack("<16I8H2I", *words, *counts, 0, 0x02000001)
        struct.pack_into("<II", data, 0, 0xFAB11BAF, 31)
        for i in range(31):
            offset, size = (256, 0)
            if i == 2: offset, size = 256, method_offset - 256
            if i == 5: offset, size = method_offset, 72
            if i == 19: offset, size = type_offset, 88
            struct.pack_into("<II", data, 8 + i * 8, offset, size)
        return bytes(data)

    def test_recover_names_and_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "global-metadata.dat"
            path.write_bytes(self.sample())
            rows = inspector.inventory(path, ("Exam",))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["type"], "Campus.InGame.Exam.ExamSequence")
            self.assertEqual(rows[0]["token"], "0x060050A9")
            self.assertEqual(rows[1]["token"], "0x060050D7")
            self.assertEqual(rows[0]["nativeRva"], None)

    def test_invalid_header_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.dat"
            path.write_bytes(b"x" * 256)
            with self.assertRaises(ValueError):
                inspector.inventory(path)

if __name__ == "__main__":
    unittest.main()
