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
