"""Refresh the script hash in website/_headers after editing the inline <script> in index.html.

The Content-Security-Policy allows exactly one inline script, identified by its SHA-256 hash.
If the script changes and the hash is not refreshed, browsers on the live site block it and
the shop stops working. Run:  python3 tadaboo/scripts/csp_hash.py   (add --check to only verify)
"""
import base64, hashlib, pathlib, re, sys

site = pathlib.Path(__file__).resolve().parent.parent / "website"
html = (site / "index.html").read_text(encoding="utf-8")
inline = [m.group(2) for m in re.finditer(r"<script(\s[^>]*)?>(.*?)</script>", html, re.S)
          if m.group(2).strip() and "src=" not in (m.group(1) or "") and "ld+json" not in (m.group(1) or "")]
if len(inline) != 1:
    sys.exit(f"expected one inline script, found {len(inline)}")
digest = "sha256-" + base64.b64encode(hashlib.sha256(inline[0].encode("utf-8")).digest()).decode()
headers = site / "_headers"
text = headers.read_text(encoding="utf-8")
current = re.search(r"'sha256-[A-Za-z0-9+/=]+'", text)
if "--check" in sys.argv:
    ok = current and current.group(0) == f"'{digest}'"
    print("CSP hash OK" if ok else f"CSP hash STALE: index.html needs '{digest}'")
    sys.exit(0 if ok else 1)
headers.write_text(re.sub(r"'sha256-[A-Za-z0-9+/=]+'", f"'{digest}'", text), encoding="utf-8")
print(f"_headers now allows '{digest}'")
