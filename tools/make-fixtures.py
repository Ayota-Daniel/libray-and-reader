"""Generate tiny deterministic CBZs for manual native verification (stdlib only)."""
import argparse
import struct
import zlib
import zipfile
from pathlib import Path


def png(number, color, width=240, height=360):
    glyphs = {"1": ["010", "110", "010", "010", "111"],
              "2": ["111", "001", "111", "100", "111"],
              "0": ["111", "101", "101", "101", "111"]}
    glyphs.update({"3": ["111", "001", "111", "001", "111"],
                   "4": ["101", "101", "111", "001", "001"],
                   "5": ["111", "100", "111", "001", "111"],
                   "6": ["111", "100", "111", "101", "111"],
                   "7": ["111", "001", "010", "010", "010"],
                   "8": ["111", "101", "111", "101", "111"]})
    digits = str(number)
    data = bytearray()
    left = (width - (len(digits) * 4 - 1) * 16) // 2
    for y in range(height):
        data.append(0)
        for x in range(width):
            ink = False
            for i, digit in enumerate(digits):
                gx, gy = (x - left - i * 64) // 16, (y - (height - 80) // 2) // 16
                if 0 <= gx < 3 and 0 <= gy < 5:
                    ink |= glyphs[digit][gy][gx] == "1"
            data.extend((245, 245, 245) if ink else color)

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload)))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(data)) + chunk(b"IEND", b""))


def write_cbz(path, entries):
    with zipfile.ZipFile(path, "w") as archive:
        for name, data, method in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = method
            archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    output = parser.parse_args().directory
    output.mkdir(parents=True, exist_ok=True)
    pages = [png(1, (40, 60, 100)), png(2, (40, 100, 70)), png(10, (100, 50, 70))]
    write_cbz(output / "ordered.cbz", [("chapter/page10.png", pages[2], 8),
                                     ("chapter/page2.png", pages[1], 0),
                                     ("chapter/page1.png", pages[0], 8)])
    write_cbz(output / "single.cbz", [("page1.png", pages[0], 0)])
    write_cbz(output / "corrupt-middle.cbz", [("page1.png", pages[0], 0),
                                            ("page2.png", b"invalid image", 8),
                                            ("page10.png", pages[2], 0)])
    write_cbz(output / "empty.cbz", [("notes.txt", b"No pages", 0)])
    write_cbz(output / "unsafe.cbz", [("../page.png", pages[0], 0)])
    (output / "invalid.cbz").write_bytes(b"This is not a ZIP archive.")
    write_cbz(output / "viewport.cbz", [("page1.png", png(1, (40, 60, 100), 1600, 2400), 8),
                                      ("page2.png", png(2, (40, 100, 70), 2400, 1600), 8)])
    write_cbz(output / "cache.cbz", [(f"page{i}.png", png(i, (30 + i * 15, 70, 100)), 8)
                                    for i in range(1, 9)])
    write_cbz(output / "spread-odd.cbz", [(f"page{i}.png", png(i, (30 + i * 15, 70, 100)), 8)
                                         for i in range(1, 8)])
    write_cbz(output / "spread-wide.cbz", [(f"page{i}.png", png(i, (30 + i * 15, 70, 100),
                                          640 if i in (1, 4, 5, 8) else 240,
                                          360 if i != 3 else 400), 8)
                                          for i in range(1, 9)])
    print(f"Created ten synthetic fixtures in {output.resolve()}")


if __name__ == "__main__":
    main()
