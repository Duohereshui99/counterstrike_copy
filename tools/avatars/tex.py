# Resizes one TGA texture and saves it as WebP.  usage: python3 tex.py <src.tga> <dst.webp> <size> <quality> [keepalpha]
import sys
from PIL import Image
src, dst, size, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
alpha = len(sys.argv) > 5 and sys.argv[5] == '1'
im = Image.open(src)
im = im.convert('RGBA' if alpha else 'RGB')
if im.size[0] > size:
    im = im.resize((size, size), Image.LANCZOS)
im.save(dst, 'WEBP', quality=q, method=6)
