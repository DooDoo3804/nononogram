# ui/fonts — the display face, shipped with the artifact

`index.html` used to link `fonts.googleapis.com` on the first-paint path. That made the
deploy artifact incomplete without a third-party host: on a network that cannot reach
Google Fonts the page logged `net::ERR_NAME_NOT_RESOLVED` and the wordmark fell back to
Georgia without saying so (report §33.6, defect X / DOO-40). The font now lives here, so
`dist/` resolves every byte it needs from its own origin.

## What this file is

`playfair-display-v40-subset.woff2` — Playfair Display v40, **variable** on the `wght`
axis (400–900), subset to 87 codepoints / 150 glyphs. 23,964 bytes.

One file covers both weights `style.css` asks for (700 on `.screen-title`, 800 on
`.brand h1` and `.fx-card-name`), which is why there is a single `@font-face` with
`font-weight: 400 900` instead of Google's two faces pointing at the same URL.

Coverage is `A–Z a–z 0–9` plus `space ! # % & ( ) + , - . / : ; ? [ ] ³ · × — ' " …`:

```
 !#%&()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[]abcdefghijklmnopqrstuvwxyz³·×—’“”…
```

That is deliberately wider than what the UI renders today. The app only ever puts
`no-nonogram` and `Level 1`–`Level 4` through this face — 16 distinct characters, which
subsets to 5,376 bytes. The extra 18kB buys the one thing the tight subset cannot give:
any Latin string anyone writes later renders *whole*. A glyph missing from a subset does
not fall back as a word, it falls back **per character**, so one unplanned letter turns a
heading into Playfair with a Georgia letter wedged in it. `@font-face` carries no
`unicode-range` for the same reason — the range would have to be kept in sync with the
file by hand, and getting it wrong is invisible until it is shipped.

Korean never reaches this font at all. Playfair Display has no Hangul, so `레벨 선택` and
the shape names on the clear card fall through to the body stack by glyph coverage.

## Provenance

Bytes are an **unmodified** Google Fonts subset build — the subsetting was done by
Google's API, not here. Fetched 2026-10-07:

```sh
CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?-()[]/&#%+×·³…’“”—'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
#        ^ a woff2-capable UA is required; Google serves ttf/eot to a UA it does not know

ENC=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$CHARS")
curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap&text=$ENC"
# -> the returned @font-face blocks hold a fonts.gstatic.com /l/font?kit=... URL; fetch that.
```

`sha256 df8c72ba8f77b1d9777c3277684998da99bdebf1cc2d8833c807c197acb268a8`

The `kit=` token in the returned URL is derived and not stable across requests, so
re-run the `css2` request above to get a fresh one rather than reusing a recorded URL.
Re-running on a newer upstream release will produce different bytes — bump `v40` in the
filename and this hash together if that happens.

## Licence

SIL Open Font License 1.1 — `OFL.txt`, verbatim from
`google/fonts/ofl/playfairdisplay/OFL.txt`. Copyright 2017 The Playfair Display Project
Authors, Reserved Font Name "Playfair Display". The OFL requires this notice to travel
with the font, which is why the licence sits beside it in the artifact instead of only in
a commit message.

## How it is wired

`style.css` references this file with a relative `url()`, so Vite treats it as an asset,
hashes it, and emits it next to the bundled CSS. That is what keeps it correct under
`base: './'` and a subpath deploy. It is **not** in `public/` on purpose: a `public/`
path referenced from CSS resolves against the emitted stylesheet's directory
(`dist/assets/`), not the dist root, and would 404.

At 23,964 bytes it is above Vite's 4,096-byte `assetsInlineLimit`, so it stays a separate
request and is cached on its own hash instead of being re-downloaded inside the CSS on
every deploy.
