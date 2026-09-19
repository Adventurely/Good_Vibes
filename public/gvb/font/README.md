# Bricolage Grotesque

Served from here rather than from Google Fonts. Every other page on Good Vibes
uses the system stack in `theme.css` and fetches nothing third-party; this game
wanted its own face, and self-hosting is how it gets one without making GVB the
only page on the site that calls out to somebody else. It also means the page
renders in the right font on the first paint instead of swapping, and that it
works with no network at all.

- `bricolage-grotesque.woff2` — the **variable** font, weights 200–800, latin
  subset only. One file instead of the three static weights the Google Fonts
  stylesheet would have served, and smaller than any two of them.
- `OFL.txt` — SIL Open Font License 1.1, which is what permits all of the above
  and which requires this file to travel with the font. Do not delete it.

Copyright 2022 The Bricolage Grotesque Project Authors,
https://github.com/ateliertriay/bricolage

To update it, fetch the current variable latin subset and replace both files:

    curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" \
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap"

and take the `url(...)` from the block commented `/* latin */`.
