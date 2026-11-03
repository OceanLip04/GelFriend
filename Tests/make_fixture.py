"""Small independent CFB producer for known pixels and short metadata streams."""
from pathlib import Path
import struct
import sys

END, FREE, FAT = 0xfffffffe, 0xffffffff, 0xfffffffd
header = bytearray(512)
header[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
for offset, value in [(24, 0x3e), (26, 3), (28, 0xfffe), (30, 9), (32, 6)]:
    struct.pack_into('<H', header, offset, value)
for offset, value in [(44, 1), (48, 0), (56, 4096), (60, 3), (64, 1), (68, END), (72, 0)]:
    struct.pack_into('<I', header, offset, value)
for offset in range(76, 512, 4):
    struct.pack_into('<I', header, offset, 2 if offset == 76 else FREE)
pixels = struct.pack('<H6I6H', 1, 2, 3, 1, 1, 1, 4, 0, 100, 200, 300, 400, 500)
capture = b'\x00\x00GeneSnap version Test\r\nExposure Time: 0.500 seconds\r\n'

def entry(name, kind, child=FREE, right=FREE, start=END, size=0):
    result = bytearray(128)
    encoded = (name + '\0').encode('utf-16le')
    result[:len(encoded)] = encoded
    struct.pack_into('<HBBIII', result, 64, len(encoded), kind, 1, FREE, right, child)
    struct.pack_into('<IQ', result, 116, start, size)
    return result

directory = b''.join([
    entry('Root Entry', 5, child=1, start=4, size=128),
    entry('Detector', 1, child=2),
    entry('GeneSnap', 1, child=3),
    entry('RawData', 1, child=4),
    entry('PixelData', 2, right=5, start=0, size=len(pixels)),
    entry('Capture', 2, start=1, size=len(capture)),
]).ljust(1024, b'\0')
fat = struct.pack('<128I', *([1, END, FAT, END, END] + [FREE] * 123))
mini_fat = struct.pack('<128I', *([END, END] + [FREE] * 126))
mini = (pixels.ljust(64, b'\0') + capture.ljust(64, b'\0')).ljust(512, b'\0')
Path(sys.argv[1]).write_bytes(header + directory + fat + mini_fat + mini)
