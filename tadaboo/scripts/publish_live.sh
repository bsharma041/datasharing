#!/usr/bin/env bash
# Publish fresh stock, prices, offers, best sellers and reviews to the LIVE shop, www.tadaboo.com.
#
# The live shop is Cloudflare Pages (project tadaboo-shop), built from GitHub branch
# claude/peaceful-keller-9qmlbg, folder tadaboo/website. Pushing to that branch redeploys it in about a minute.
#
#   git clone -q --depth 1 -b claude/peaceful-keller-9qmlbg https://github.com/bsharma041/datasharing.git <dir>
#   python3 <dir>/tadaboo/scripts/sync_stock.py <stockroom_dump_dir>     # rewrites stock.json + reviews.json
#   bash <dir>/tadaboo/scripts/publish_live.sh                           # commits and pushes only those two files
#
# Exit 0 = pushed, 10 = nothing changed. Refuses if any other file in the clone changed.
set -euo pipefail
BRANCH="claude/peaceful-keller-9qmlbg"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"

[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || { echo "Not on $BRANCH: refusing."; exit 2; }
json="tadaboo/website/stock.json tadaboo/website/reviews.json"
files="$json tadaboo/website/index.html"   # index.html only changes when prerender.mjs rewrote it from the new stock
# Product pages, the Google Merchant feed and the product sitemap are rebuilt from stock.json by prerender.mjs.
gen="tadaboo/website/p tadaboo/website/bag tadaboo/website/google-feed.xml tadaboo/website/sitemap-products.xml"
other=$(git status --porcelain --untracked-files=all | awk '{print $2}' | grep -v -x -F -e tadaboo/website/stock.json -e tadaboo/website/reviews.json -e tadaboo/website/index.html -e tadaboo/website/google-feed.xml -e tadaboo/website/sitemap-products.xml | grep -v -E '^tadaboo/website/(p|bag)/[a-z0-9-]+\.html$' || true)
[ -z "$other" ] || { echo "Other files changed, refusing to publish:"; echo "$other"; exit 3; }
for f in $json; do python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f"; done   # never ship broken JSON
# Plain-HTML copy of names, prices and photos for crawlers (idempotent; the task may already have run it).
if command -v node >/dev/null; then node tadaboo/scripts/prerender.mjs; else echo "node not found: index.html not refreshed"; fi

# Only the timestamp changed? Then the shop is already up to date.
same=1
git diff --quiet -- tadaboo/website/index.html || same=0
[ -z "$(git status --porcelain --untracked-files=all -- $gen)" ] || same=0
for f in $json; do
  if ! diff -q <(git show "HEAD:$f" | python3 -c "import json,sys; d=json.load(sys.stdin); d.pop('asOf',None); print(json.dumps(d,sort_keys=True))") \
               <(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); d.pop('asOf',None); print(json.dumps(d,sort_keys=True))" "$f") >/dev/null; then same=0; fi
done
if [ "$same" = 1 ]; then git checkout -q -- $files; echo "Website already up to date."; exit 10; fi
git add -A -- $gen

git -c user.name="TadaBoo Stockroom sync" -c user.email="noreply@anthropic.com" commit -q -m "Website stock from the Stockroom ($(date -u +%Y-%m-%dT%H:%MZ))

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- $files $gen
for try in 1 2 3; do
  if git push -q origin "HEAD:$BRANCH"; then echo "Pushed to $BRANCH. www.tadaboo.com updates in about a minute."; exit 0; fi
  echo "Push refused (someone else pushed). Rebasing and retrying ($try)…"
  git pull -q --rebase --depth 50 origin "$BRANCH"
done
echo "Could not push after 3 tries."; exit 4
