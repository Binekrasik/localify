#!/usr/bin/env bash
# Regenerates the tag-parsing fixtures in this directory. Needs ffmpeg (with libmp3lame,
# libvorbis, libopus) and python3. Every file is one second of 8 kHz mono silence.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
silence=(-f lavfi -t 1 -i anullsrc=r=8000:cl=mono)
tags=(-metadata "title=Fixture Tïtle ✓" -metadata "artist=Fixture Artist" -metadata "album=Fixture Album")

# Covers: a solid 16x16 colour as PNG and JPEG, and 130x130 noise (about 50 KB as PNG, so its
# base64 METADATA_BLOCK_PICTURE exceeds one Ogg page).
ff -f lavfi -i color=c=0xd02040:s=16x16 -frames:v 1 cover.png
ff -f lavfi -i color=c=0x2060e0:s=16x16 -frames:v 1 -q:v 2 cover.jpg
python3 -I - "$tmp/noise.png" <<'PY'
import random, struct, sys, zlib
random.seed(1)
w = h = 130
raw = b''.join(b'\0' + bytes(random.randrange(256) for _ in range(w * 3)) for _ in range(h))
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(png)
PY

# A FLAC picture block, base64-encoded, as Vorbis comments carry it.
picture_block() {
    python3 -I - "$1" "$2" <<'PY'
import base64, struct, sys
data = open(sys.argv[1], 'rb').read()
mime = sys.argv[2].encode()
block = struct.pack('>II', 3, len(mime)) + mime + struct.pack('>I', 0)
block += struct.pack('>IIIII', 0, 0, 0, 0, len(data)) + data
print(base64.b64encode(block).decode())
PY
}

cover_mp3=("${silence[@]}" -i cover.png -map 0:a -map 1:v -c:a libmp3lame -b:a 8k -c:v copy
    -disposition:v attached_pic "${tags[@]}")
ff "${cover_mp3[@]}" -id3v2_version 3 id3v23.mp3
ff "${cover_mp3[@]}" -id3v2_version 4 id3v24.mp3
ff "${silence[@]}" -i cover.jpg -map 0:a -map 1:v -c:a flac -c:v copy -disposition:v attached_pic \
    "${tags[@]}" tagged.flac
ff "${silence[@]}" -i cover.jpg -map 0:a -map 1:v -c:a aac -b:a 8k -c:v copy \
    -disposition:v attached_pic "${tags[@]}" tagged.m4a
ff "${silence[@]}" -c:a pcm_u8 "${tags[@]}" tagged.wav
ff "${silence[@]}" -c:a libvorbis -q:a 0 "${tags[@]}" \
    -metadata "METADATA_BLOCK_PICTURE=$(picture_block cover.png image/png)" tagged.ogg
ff "${silence[@]}" -c:a libopus -b:a 6k "${tags[@]}" \
    -metadata "METADATA_BLOCK_PICTURE=$(picture_block cover.jpg image/jpeg)" tagged.opus
ff "${silence[@]}" -c:a libopus -b:a 6k "${tags[@]}" \
    -metadata "METADATA_BLOCK_PICTURE=$(picture_block "$tmp/noise.png" image/png)" big-cover.opus
ff "${silence[@]}" -c:a libmp3lame -b:a 8k -map_metadata -1 -id3v2_version 0 -write_xing 0 untagged.mp3

# A FLAC stream header with three ARTISTS comments and no ARTIST, which ffmpeg can't write: the
# STREAMINFO block (8 kHz, mono, 16 bit, no samples) and a last VORBIS_COMMENT block, no frames.
python3 -I - artists.flac <<'PY'
import struct, sys
streaminfo = struct.pack('>HH', 4096, 4096) + bytes(6) + struct.pack('>Q', 8000 << 44 | 15 << 36) + bytes(16)
vendor = b'localify fixture'
comments = [b'TITLE=Fixture Title', b'ARTISTS=Alice', b'ARTISTS=Bob', b'ARTISTS=Carol']
vorbis = struct.pack('<I', len(vendor)) + vendor + struct.pack('<I', len(comments))
vorbis += b''.join(struct.pack('<I', len(c)) + c for c in comments)
block = lambda kind, data: bytes([kind]) + len(data).to_bytes(3, 'big') + data
open(sys.argv[1], 'wb').write(b'fLaC' + block(0, streaminfo) + block(0x80 | 4, vorbis))
PY
