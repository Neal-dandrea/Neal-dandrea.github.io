# Images

## Real assets

| File | What it is | Source |
|---|---|---|
| `iras-logo.png` | IRAS Lab wordmark, black on transparency | the lab site, `ceas5.uc.edu/IRAS-Lab/` |
| `iras-logo-dark.png` | the same wordmark inverted to white | generated from the above |
| `advisor-ou-ma.jpg` | Ou Ma headshot, square crop, 256px | the lab site's people page |
| `advisor-raj-bhatnagar.jpg` | Raj K. Bhatnagar headshot, square crop, 256px | the lab site's people page |

The wordmark has a transparent background and is black, so it disappears on a
dark background. `index.html` uses a `<picture>` with a
`media="(prefers-color-scheme: dark)"` source to swap in the inverted copy.
Regenerate that copy by inverting the RGB channels and keeping the alpha
channel untouched; inverting alpha too produces a solid block.

## Still placeholders

`uc.svg`, `osu.svg`, `eq.svg` and `dexcom.svg` are plain monogram tiles I drew,
not real logos. Replace each by dropping a file with the same name in place;
nothing in `index.html` or `style.css` needs to change as long as the name stays
the same and the image is roughly square. If the extension changes, update that
tile's one `src` in `index.html`.

Note that university and company marks are trademarks. Using them to state a
factual affiliation is normally fine, but UC, Ohio State and DexCom each publish
brand guidelines covering clear space, recolouring and implied endorsement,
which are worth two minutes before the site is public. Wordmarks set as plain
text are the safe fallback and the section degrades to that cleanly.
