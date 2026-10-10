import sys
import unittest
from pathlib import Path
from struct import pack_into

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from decrypt_gakumas_metadata import KEY, MAGIC, decode, validate


class MetadataXorTests(unittest.TestCase):
    def test_mask_period_is_exact(self):
        self.assertEqual(len(KEY), 128)
        raw = bytes(range(128)) * 3 + b"suffix"
        self.assertEqual(decode(decode(raw)), raw)
        self.assertEqual(decode(b"\xa6\x71\x02\x4f\xbc\x3b\xab\x5d"),
                         b"\xaf\x1b\xb1\xfa\x1f\x00\x00\x00")

    def test_header_and_utf8_section_validation(self):
        names = b"get_HttpResponse\x00get_SerializationContext\x00"
        names = names.ljust((len(names) + 3) // 4 * 4, b"\x00")
        decoded = bytearray(256 + len(names))
        pack_into("<II", decoded, 0, MAGIC, 31)
        for entry in range(8, 256, 8):
            pack_into("<II", decoded, entry, 256, len(names) if entry == 24 else 0)
        decoded[256:] = names
        encoded = decode(bytes(decoded))
        restored = decode(encoded)
        self.assertEqual(restored, bytes(decoded))
        result = validate(restored)
        self.assertEqual(result["version"], 31)
        self.assertEqual(result["sections"], 31)

        corrupted = bytearray(restored)
        corrupted[0] = 0
        with self.assertRaises(ValueError):
            validate(bytes(corrupted))


if __name__ == "__main__":
    unittest.main()
