"""Regression checks for Android R+ resource storage and native alignment."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    'apk_builder', ROOT/'android/lsposed-progress-capture/build-recovered-apk.py')
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def write_aligned(z, name, data, alignment, compression=zipfile.ZIP_STORED):
    entry = zipfile.ZipInfo(name)
    entry.compress_type = compression
    start = z.fp.tell() + 30 + len(name.encode('utf-8'))
    padding = (-start) % alignment
    if padding:
        if padding < 4:
            padding += alignment
        entry.extra = struct.pack('<HH', 0xFFFF, padding - 4) + bytes(padding - 4)
    z.writestr(entry, data)


class ApkPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_preserves_aapt2_resource_storage_and_recovered_payloads(self):
        base = self.root/'base.apk'
        manifest = self.root/'manifest.apk'
        native = self.root/'native.so'
        result = self.root/'unsigned.apk'
        native.write_bytes(b'native-payload')
        with zipfile.ZipFile(base, 'w') as z:
            z.writestr('classes.dex', b'recovered-dex')
            z.writestr('META-INF/xposed/module.prop', b'xposed-metadata')
            z.writestr('META-INF/OLD.RSA', b'obsolete-signature')
        with zipfile.ZipFile(manifest, 'w') as z:
            z.writestr('resources.arsc', b'resource-table', compress_type=zipfile.ZIP_STORED)
            z.writestr('AndroidManifest.xml', b'manifest', compress_type=zipfile.ZIP_DEFLATED)
        builder.package_apk(base, manifest, native, result)
        with zipfile.ZipFile(result) as z:
            self.assertEqual(z.getinfo('resources.arsc').compress_type, zipfile.ZIP_STORED)
            self.assertEqual(z.read('resources.arsc'), b'resource-table')
            self.assertEqual(z.getinfo('AndroidManifest.xml').compress_type, zipfile.ZIP_DEFLATED)
            self.assertEqual(z.read('classes.dex'), b'recovered-dex')
            self.assertEqual(z.read('META-INF/xposed/module.prop'), b'xposed-metadata')
            self.assertEqual(z.read(builder.NATIVE_ENTRY), b'native-payload')
            self.assertEqual(z.getinfo(builder.NATIVE_ENTRY).compress_type, zipfile.ZIP_STORED)
            self.assertNotIn('META-INF/OLD.RSA', z.namelist())

    def test_packaging_rejects_compressed_aapt2_resources(self):
        base = self.root/'base.apk'
        manifest = self.root/'manifest.apk'
        with zipfile.ZipFile(base, 'w'):
            pass
        with zipfile.ZipFile(manifest, 'w') as z:
            z.writestr('resources.arsc', b'table', compress_type=zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(ValueError, 'must be uncompressed'):
            builder.package_apk(base, manifest, self.root/'unused.so', self.root/'result.apk')

    def fixture(self, resource_compression=zipfile.ZIP_STORED, misalign=None):
        apk = self.root/'fixture.apk'
        with zipfile.ZipFile(apk, 'w') as z:
            write_aligned(z, 'resources.arsc', b'table', 4, resource_compression)
            if misalign == 'native':
                z.writestr(builder.NATIVE_ENTRY, b'library')
            else:
                write_aligned(z, builder.NATIVE_ENTRY, b'library', 16384)
        return apk

    def test_verifies_actual_aligned_data_offsets(self):
        report = builder.verify_apk_layout(self.fixture())
        self.assertEqual(report['resources.arsc']['dataOffset'] % 4, 0)
        self.assertEqual(report[builder.NATIVE_ENTRY]['dataOffset'] % 16384, 0)

    def test_rejects_compressed_resources_even_at_aligned_offset(self):
        apk = self.fixture(resource_compression=zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(ValueError, 'resources.arsc must be uncompressed'):
            builder.verify_apk_layout(apk)

    def test_rejects_misaligned_resources(self):
        apk = self.root/'misaligned.apk'
        with zipfile.ZipFile(apk, 'w') as z:
            z.writestr('a', b'')  # resource payload starts at offset 75
            z.writestr('resources.arsc', b'table')
            write_aligned(z, builder.NATIVE_ENTRY, b'library', 16384)
        with self.assertRaisesRegex(ValueError, 'resources.arsc.*not aligned'):
            builder.verify_apk_layout(apk)

    def test_rejects_misaligned_native_library(self):
        with self.assertRaisesRegex(ValueError, 'libgakumas_progress_capture.so.*not aligned'):
            builder.verify_apk_layout(self.fixture(misalign='native'))


if __name__ == '__main__':
    unittest.main()
