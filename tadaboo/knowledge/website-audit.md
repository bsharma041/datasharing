# TadaBoo website audit: 13 Oct 2026

**Tools used:** Lighthouse 12.2.1 in headless Chromium (mobile with simulated slow 4G, and desktop); a Playwright click-through of every flow; the WebsitePublisher AI Schema.org integration for structured data. No dedicated "website auditor" connector is installed on the account.

## Scores

| | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Mobile, before | 76 | 92 | 96 | 100 |
| Mobile, after | **80** | **96** | **100** | 100 |
| Desktop, before | 98 | 92 | 96 | 100 |
| Desktop, after | 97 | **96** | **100** | 100 |

| Mobile metric | Before | After |
|---|---|---|
| Page weight | 898 KiB | 633 KiB |
| Largest Contentful Paint | 4.5 s | 3.9 s |
| First Contentful Paint | 3.0 s | 3.0 s |
| Layout shift (CLS) | 0 | 0 |

## Fixed

1. **Colour contrast (WCAG AA).** Brand orange `#FF6B2C` measured 2.8:1 as text and under white button text; the minimum is 4.5:1. The brand orange stays as the fill colour. Prices and other orange text now use `#B83A0A` (5.7:1). Button and pill text is now navy (5.1:1 on orange, the same pairing the Stockroom uses). Teal labels now use `#0C7268` (5.0:1).
2. **The bag drawer was hidden from screen readers but still reachable by keyboard.** It is now a proper dialog: the rest of the page is locked while it is open, and focus returns to the Bag button when it closes.
3. **The disabled "Send order on WhatsApp" link could still be opened with the Enter key.** Under ₹299 it is now a real disabled button.
4. **The logo link and Bag button had spoken names that didn't match their visible text.** Fixed.
5. **Missing favicon (404 error).** Added an inline star icon.
6. **Images.** All 53 images converted to WebP (−26%). Below-the-fold images load lazily, the hero bag is preloaded, and explicit sizes are set. This also fixed a stretched hero-bag image the new size attributes would otherwise have caused.
7. **Rendering cost.** Off-screen sections skip layout until they scroll into view.
8. **Search and sharing.** Added Organization and FAQ structured data (generated with the WebsitePublisher Schema.org integration), Open Graph and Twitter tags, and a theme colour.
9. **Caching.** Added `_headers` (Netlify and Cloudflare Pages) so photos cache for 30 days and the page and catalogue update immediately.

## Remaining

| Item | Why it remains | What fixes it |
|---|---|---|
| TADA✦BOO wordmark is below 4.5:1 | It is a logo, and WCAG exempts logotypes. | Nothing needed. |
| Mobile first paint is 3.0 s | Google Fonts block rendering. | Self-host the two fonts as WOFF2 files when deploying. |
| Text compression and cache headers | They depend on the host, not the page. | Deploy on Netlify, Vercel or Cloudflare Pages (compression is automatic; `_headers` covers caching). |
| No `og:image` | WhatsApp and Instagram previews need a full image URL, which needs the live domain. | Add a 1200×630 share image and absolute URLs once the domain is chosen. |

## Beyond the technical audit (business quality)

1. **Orders can exceed stock.** The site lets a customer order 20 Return Gift · Classic bags, but crayon stock allows 4. Either show "made to order, 5–7 days" for bulk orders, or connect stock from the Stockroom.
2. **Policy pages are missing.** Indian payment gateways (Razorpay, Cashfree, PayU) require Privacy, Terms, Refund/Cancellation, Shipping and Contact pages before they approve a merchant.
3. **No social proof or brand story.** There are no Instagram link, customer photos, reviews or "who we are" section. For a new gifting brand these drive trust more than any technical fix.
4. **Delivery charge is undefined.** "Extra, confirmed on WhatsApp" adds friction. A simple table (for example local, metro, rest of India) would let customers see the full cost.
5. **Single pencils** (₹15) are mentioned in the FAQ but cannot be added to the bag.

---

# Full-stack audit (round 2): 13 Oct 2026

**Method.** Read every function in `index.html`. Ran a 33-check Playwright suite against the untouched copy and the fixed site, a layout and axe-core sweep (320, 375, 414, 768, 1024 and 1440 px, plus a landscape phone, in light and dark), html-validate on the static and JS-rendered DOM, a catalogue integrity script, Lighthouse 12.2.1 (mobile and desktop), a local server that applies `_headers` to test the CSP, and subfolder and `file://` loads. Before the fixes, 11 of 33 behavioural checks passed. After them, 33 of 33 pass. The scripts are in the session scratchpad (`fullaudit/checks.js`, `layout.js`, `targets.js`, `misc.js`, `deploy.js`, `csp_check.js`).

Round-1 fixes still hold: brand contrast tokens, the drawer as a dialog, the disabled Send button under ₹299, image sizes and lazy loading, and the `_headers` caching.

## Findings and fixes

| # | Sev | Area | Defect | Fix | Verified |
|---|---|---|---|---|---|
| 1 | High | JS / storage | A saved category that no longer exists (e.g. after a catalogue rename) crashed start-up. The shop rendered 0 products for that returning visitor. | The saved category is used only if it is still in `catalog.js`. | `stale-category`: 0 cards and a TypeError before; 50 cards after |
| 2 | High | A11y / keyboard | Every Add, +/− and chip press re-renders the list. Keyboard focus dropped to the top of the page after each press. | `keep()` puts focus back on the matching control: Add moves to its stepper, a stepper at 0 moves back to Add, a chip stays on the same chip. | `focus-grid-add`, `focus-grid-dec-to-zero`, `focus-chips`: focus was on BODY before, on the right control after |
| 3 | Med | JS / storage | Corrupt or old cart data broke the cart. A non-object stopped the cart from saving. `b:constructor` crashed the drawer. Quantities like `"3"` were concatenated as text (the bag count showed "031.51e999"). | The cart is loaded only if it is a plain object. It keeps only real product or bag ids (own keys) and whole-number quantities of 1 or more. The form is loaded the same way. | `corrupt-cart-number`, `proto-keys`, `qty-normalise` |
| 4 | Med | Business rule | "Copy order text" still worked when the custom bag was ₹299 or less, which bypassed the more-than-₹299 rule. | Copy is now disabled under the same condition as Send. Exactly ₹299 is blocked; ₹300 is allowed. | `rule-299-send-blocked`, `rule-299-copy-blocked`, `rule-300-allowed` |
| 5 | Med | JS / WhatsApp | Half an emoji (a lone surrogate, e.g. from a cut-off paste) in any form field made `encodeURIComponent` throw. The WhatsApp link then stopped updating for the rest of the session. | Encoding falls back to a well-formed string. | `wa-lone-surrogate`: "URI malformed" before; clean after. `wa-encoding` checks that `& # + % ₹` and emoji round-trip exactly. |
| 6 | Med | A11y / screen reader | The toast was the only live region, and it was `hidden` at rest, so its messages were often not read. Adding from the grid and using the steppers announced nothing. The finder results were a live region that re-announced on every cart change. | One always-present `#live` status region (`announce()`) is used for adds, quantity changes, the hero pick, finder matches and search counts. The visual toast is `aria-hidden`, and `aria-live` is removed from the finder results. | `live-region`, `finder-no-chatter`, `search-announced` |
| 7 | Med | A11y | All steppers were named just "One more" or "One less". | The names now include the item, e.g. "One more Vroom Vroom · Boys". | `stepper-names`: 1 unique name before, 3 of 3 after |
| 8 | Med | A11y / contrast | The focus ring used brand orange: 2.8:1 on the page, 1.0:1 on the orange call-out, and the search field's focus border was 2.8:1 (3:1 is needed). In dark mode the "Gift finder" eyebrow was yellow on cream and failed contrast. | The ring uses `--accent-ink`, with navy inside the call-out and `--bg` on finder chips. Field focus borders use `--accent-ink`. A new `--yellow-ink` token is yellow in light mode and `#7A5200` in dark mode. | `focus-contrast`: 2.84, 1.11, 1.00, 2.80 before → 5.76, 14.28, 5.11, 5.67 after. axe dark: 1 violation before, 0 after. |
| 9 | Med | A11y / touch | Targets under 44 px: chips 35, small buttons 40, steppers 36 and 30, close button 40, logo links 24, nav links 35, phone link 32. | Raised to 44 px. Steppers keep their look and get an invisible 44 px hit area. | `targets.js` (measured with `elementFromPoint`) |
| 10 | Med | UX | The phone number in "How to order" was plain text, so phone users could not tap it to call. | It is now a `tel:+919730624700` link with the same styling and a non-breaking space. | `tel-link` |
| 11 | Low | Hero | Quick repeat taps on the bag stacked 2 or 3 "TADA!" reveal cards, because the earlier reveal timer still fired. | Each tap cancels the pending reveal. | `hero-rapid-taps`: 3 reveals before, 1 after |
| 12 | Low | Perf / memory | The confetti canvas kept a full-screen buffer after the burst ended (about 20 MB on a 2× phone). | The canvas is freed when the animation stops. | `confetti-released`, `misc.js` leak check |
| 13 | Low | A11y | No skip link. The drawer was an `<aside role=dialog>` (not allowed). The `.pills` div had an `aria-label` it is not allowed to carry. The finder chip groups had no group label. The mobile bar's spoken name ("Open your bag") did not match its visible text. | Added a skip link (made inert while the drawer is open). The drawer is now a `<div role=dialog>`. Removed the stray label. Added `role=group` and `aria-labelledby`. The mobile bar's label now mirrors its text. | `skip-link`, `drawer-keyboard`, `mbar-name`; axe `label-content-name-mismatch` cleared; html-validate |
| 14 | Low | UX | The page behind the open drawer still scrolled. | `html.lock` while the drawer is open; `overscroll-behavior:contain` on the drawer body. | `drawer-scroll-lock` |
| 15 | Low | Forms | Phone was not `type=tel`, and address and pincode had no autocomplete tokens. | Added `type=tel`, `street-address` and `postal-code`. | `form-autocomplete`; `form-kept` confirms values survive re-render |
| 16 | Low | Perf | The finder thumbnails (below the fold) loaded eagerly. | `loading="lazy"`. | Lighthouse mobile weight 633 → 323 KiB |
| 17 | Low | Security | No Content-Security-Policy or other security headers. | `_headers` now has a CSP that allows the inline script by SHA-256 hash, Google Fonts, `self` images and `data:` (favicon), with no connect, object, base or form actions and no framing. Also nosniff, Referrer-Policy and Permissions-Policy. `scripts/csp_hash.py` refreshes the hash. | `csp_check.js` through the `_headers` server: 0 violations, fonts, JSON-LD and favicon OK. Negative control: a stale hash blocks the shop. |
| 18 | Low | SEO / deploy | No `robots.txt`. | Added `robots.txt` (allow all). A Sitemap line is to be added once the domain exists. | Served 200 |

**Checked and sound (no change):** all interpolated catalogue data, form values and the search query are escaped (`xss-escaped`). Search is literal (no regex) and case-insensitive. Sort is correct and stable. The category survives reload. Storage that is blocked or full is handled. Event listeners are delegated, so they never duplicate on re-render. Fly-to-bag and burst elements are removed. Escape and focus return in the drawer work. Reduced motion stops the confetti, fly, marquee and ring. There is no horizontal overflow at any width, at 200% zoom, or in landscape. The mobile bar never covers the footer. The site works from a subfolder and from `file://`. There are no console errors. Every product has its image, every bag item exists, there are no duplicate ids, prices are positive integers, every `sid` is in `snapshot.json`, and every bag's price equals the sum of its items.

## Lighthouse (same machine, same run conditions)

| | Performance | Accessibility | Best practices | SEO | LCP | Weight |
|---|---|---|---|---|---|---|
| Mobile, before round 2 | 81 | 96 | 100 | 100 | 3.8 s | 633 KiB |
| Mobile, after | **85** | 96 | 100 | 100 | **3.2 s** | **323 KiB** |
| Desktop, before round 2 | 98 | 96 | 100 | 100 | 0.9 s | 1,220 KiB |
| Desktop, after | 98–100 | 96 | 100 | 100 | 0.6–0.9 s | 1,177–1,226 KiB |

Accessibility stays at 96 only because of the TADA✦BOO wordmark (a logotype, which WCAG exempts). Desktop CLS 0.007 was already present before this round.

## Left open

| Item | Why | Needs |
|---|---|---|
| Long WhatsApp orders | With the whole catalogue in the bag, the wa.me link is about 5,700 characters. Typical orders are far shorter. Some Android and desktop handoffs truncate very long links. "Copy order text" is the fallback. | Nothing now. Revisit if customers report cut-off messages. |
| CSP hash maintenance | A stale hash makes the live shop render empty (shown in testing). | Run `scripts/csp_hash.py` after editing the inline script. This is now in the agent's instructions. |
| Landscape phone drawer | At 844×390 the drawer body is about 165 px tall, which works but is cramped. | Design choice: a compact drawer footer in landscape. |
| Search stays inside the selected category | Searching "unicorn" while "Pens" is selected shows only pens, and the empty state can say "nothing matches" when other categories have matches. | Owner/UX decision: search across all categories, or keep it per category. |
| Two tabs open at once | Each tab keeps its own cart; the last one saved wins. | Low impact. A `storage` listener could sync them if it ever matters. |
| `#mbar` is a `div role=button` | It holds block content, which a `<button>` can't. It has keyboard support and an accessible name. | Nothing needed. |
| No custom 404 page or sitemap | Single-page site. A sitemap needs the live domain. | Add a sitemap and absolute `og:image` once the domain is chosen. |
| `_headers` paths assume the site is served from the domain root | `/img/*` rules won't match if it is deployed under a subfolder. | Adjust the paths if it is ever hosted in a subfolder. |

---

# Redesign + design-critic review: 13 Oct 2026

The storefront was rebuilt to the "TadaBoo Store Redesign" Claude Design canvas (boutique layout, less text, gift bags open with their items in a circle). The `tadaboo-design-critic` review scored it Not-slop 3, Accessibility 4, Interest 3, Ease of use 3 and raised 15 findings; all were fixed and re-verified with Playwright:

| Sev | Finding | Fix |
|---|---|---|
| High | Address and pincode fields showed even for "collect" (a `display:flex` rule beat `hidden`) | `[hidden]{display:none!important}` |
| High | No navigation on phones | The three section links sit in a scrollable row under the header |
| Med | Nothing above the fold said how to order | "Order on WhatsApp · Dispatch in 5–7 working days" under the hero buttons |
| Med | The shop was one wall of 50 busy photos | "All" opens with 12 and a "Show all 50 items" button; categories and search show everything they match |
| Med | After adding a gift bag the bag opened mid-form; the toast covered Send | Bag view scrolls to the top; the toast moves to the top while a drawer is open |
| Med | Search kept a category highlighted while searching the whole shop | "All" shows as selected while a search term is entered |
| Med | Phone category tiles were 60 px with 3-line labels | A sideways row of 112 px tiles with short one-line labels |
| Med | Tablet hero photo pushed gift bags ~1,700 px down; tiles wrapped 4 + 1 | Stacked hero photo capped at 58vh; tiles fixed at 5 columns |
| Low | Phone steppers 38 px wide | Back to 44 px |
| Low | Gift-bag quantity buttons named only "One more/less" | Names include the bag |
| Low | The ₹299 message appeared twice | One meter message: "Add ₹X more. Custom bags must total over ₹299." |
| Low | Disabled Send looked clickable in dark mode | Disabled buttons are outline-only in both themes |
| Low | Return Gift · Deluxe cover showed branded chocolate wrappers | Cover changed to the animal memo pad |
| Low | Footer "BOO" inherited grey | `.wm .b` uses the ink colour |
| Low | 76 px of empty footer space on desktop | That space is reserved only below 900 px, where the bag bar exists |
