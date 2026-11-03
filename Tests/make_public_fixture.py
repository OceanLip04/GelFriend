"""Generate a deterministic synthetic SGD; contains no experimental pixels.

Only Python standard library is required. The dimensions exercise a large
regular CFB stream while make_fixture.py separately covers mini streams.
"""
from pathlib import Path
import array
import math
import struct
import sys

width, height = 1392, 1040
pixels = array.array('H')
centres = [170, 380, 590, 800, 1010, 1220]
for y in range(height):
    for x in range(width):
        value = 100 + (x * 17 + y * 31) % 37
        for lane in centres:
            if abs(x - lane - 0.04 * (y - height / 2)) < 22:
                for band in [180, 340, 520, 700, 860]:
                    value += int(2400 * math.exp(-((y - band) / 9) ** 2))
        pixels.append(min(4095, value))
pixels[0] = 0
pixels[-1] = 4095
if sys.byteorder != 'little':
    pixels.byteswap()
raw = pixels.tobytes()
payload = struct.pack('<H6I', 1, width, height, 1, 1, 1, 4) + raw
capture = b'\0\0GeneSnap version SYNTHETIC PUBLIC FIXTURE\r\nDeterministic artificial lanes; no experimental data.\r\n'
END, FREE, FAT = 0xfffffffe, 0xffffffff, 0xfffffffd
pixel_sectors = (len(payload) + 511) // 512
fat_sectors = 1
while fat_sectors * 128 < 4 + pixel_sectors + fat_sectors:
    fat_sectors += 1
fat_start = 4 + pixel_sectors
header = bytearray(512); header[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
for pos, value in [(24, 0x3e), (26, 3), (28, 0xfffe), (30, 9), (32, 6)]:
    struct.pack_into('<H', header, pos, value)
for pos, value in [(44, fat_sectors), (48, 0), (56, 4096), (60, 2), (64, 1), (68, END)]:
    struct.pack_into('<I', header, pos, value)
for i in range(109):
    struct.pack_into('<I', header, 76 + i * 4, fat_start + i if i < fat_sectors else FREE)

def entry(name, kind, child=FREE, right=FREE, start=END, size=0):
    result = bytearray(128); text = (name + '\0').encode('utf-16le'); result[:len(text)] = text
    struct.pack_into('<HBBIII', result, 64, len(text), kind, 1, FREE, right, child)
    struct.pack_into('<IQ', result, 116, start, size)
    return result

mini_count = (len(capture) + 63) // 64
directory = b''.join([
    entry('Root Entry', 5, child=1, start=3, size=mini_count * 64),
    entry('Detector', 1, child=2), entry('GeneSnap', 1, child=3), entry('RawData', 1, child=4),
    entry('PixelData', 2, right=5, start=4, size=len(payload)),
    entry('Capture', 2, start=0, size=len(capture)),
]).ljust(1024, b'\0')
mini_table = list(range(1, mini_count)) + [END] + [FREE] * (128 - mini_count)
table = [1, END, END, END]
table += list(range(5, 4 + pixel_sectors)) + [END]
table += [FAT] * fat_sectors
table += [FREE] * (fat_sectors * 128 - len(table))
result = (header + directory + struct.pack('<128I', *mini_table) + capture.ljust(512, b'\0') +
          payload.ljust(pixel_sectors * 512, b'\0') + struct.pack('<' + str(len(table)) + 'I', *table))
Path(sys.argv[1]).write_bytes(result)
