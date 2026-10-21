"""Rebuild delivery assets without altering source PNGs. Requires Pillow with WebP support.
Run from the repository root: python apps/web/build/optimize-brand.py
"""
from pathlib import Path
from PIL import Image

brand = Path(__file__).resolve().parents[1] / 'public' / 'brand'
for source in sorted(brand.glob('jo-*.png')):
    image = Image.open(source)
    image.thumbnail((1024, 683))
    target = source.with_suffix('.webp')
    image.save(target, 'WEBP', quality=84, method=6)
    print(f'{source.name}: {source.stat().st_size} → {target.stat().st_size} bytes')
