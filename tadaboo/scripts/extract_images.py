"""Pull product photos out of the TadaBoo catalogue PDF into tadaboo/website/img/.

Usage:
    python3 extract_images.py <catalogue.pdf> <out_dir>

Needs poppler's `pdfimages` and Pillow. Photos on pages 3-6 appear in the same
order as the products in the catalogue, so they are named from SLUGS below.
When the catalogue changes, update SLUGS to match its new reading order.
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image

# Catalogue reading order, pages 3-6 (one photo per product).
SLUGS = [
    # p3 Pens & Highlighters
    "korean-gel-pen", "labubu-gel-pen", "butterfly-pen", "10in1-pen", "crystal-cat-pen",
    "crystal-unicorn-pen", "fountain-pen", "light-up-pen", "icecream-pen", "popup-pen",
    "popsicle-highlighter",
    # p4 Pencils, Notebooks & Notes
    "unicorn-pencils", "racing-pencils", "a7-notebook", "snoopy-diary", "clipboard-diary",
    "kuromi-diary", "donut-sticky", "space-notes", "animal-memo-pad", "magnetic-bookmark",
    # p5 Sharpeners & Erasers
    "helmet-sharpener", "shuttlecock-sharpener", "plane-sharpener", "rocket-sharpener",
    "cow-sharpener", "car-sharpener", "camera-sharpener", "toffee-eraser", "sharpener-eraser",
    "camping-eraser", "rabbit-eraser", "icecream-eraser", "donut-unicorn-eraser",
    "fast-food-eraser", "fighter-plane-eraser", "eraser-combo",
    # p6 Make, Create & Gift
    "3d-sticker", "diamond-bracelet", "activity-set", "6in1-set", "crayons-set",
    "hamburger-glue", "reward-stamps", "12pc-pencil-set", "8pc-aesthetic", "7pc-aesthetic",
    "chocolate-squishy", "dumpling-squishy", "bath-bomb",
]


def main(pdf, out):
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdfimages", "-f", "3", "-l", "6", "-j", pdf, f"{tmp}/p"], check=True)
        files = sorted(f for f in os.listdir(tmp) if f.endswith(".jpg"))
        if len(files) != len(SLUGS):
            sys.exit(f"Expected {len(SLUGS)} photos on pages 3-6, found {len(files)}. Update SLUGS.")
        for f, slug in zip(files, SLUGS):
            im = Image.open(f"{tmp}/{f}").convert("RGB")
            im.thumbnail((520, 650))
            im.save(f"{out}/{slug}.webp", "WEBP", quality=76, method=6)

        # The white TadaBoo gift bag cut-out (page 7, first image + its soft mask).
        subprocess.run(["pdfimages", "-f", "7", "-l", "7", "-png", pdf, f"{tmp}/b"], check=True)
        bag = Image.open(f"{tmp}/b-000.png").convert("RGB")
        bag.putalpha(Image.open(f"{tmp}/b-001.png").convert("L"))
        bag.thumbnail((360, 400))
        bag.save(f"{out}/tadaboo-bag.webp", "WEBP", quality=80, method=6)

        # Thank-you card and bookmark (page 10).
        subprocess.run(["pdfimages", "-f", "10", "-l", "10", "-png", pdf, f"{tmp}/t"], check=True)
        for src, name, box in (("t-000.png", "thank-you-card.webp", (900, 600)), ("t-001.png", "bookmark.webp", (240, 720))):
            im = Image.open(f"{tmp}/{src}").convert("RGB")
            im.thumbnail(box)
            im.save(f"{out}/{name}", "WEBP", quality=78, method=6)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
