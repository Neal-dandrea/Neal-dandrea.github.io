# Images

Every mark here is the real one, taken from the organization's own site.

| File | What it is | Source |
|---|---|---|
| `uc.svg` | University of Cincinnati wordmark | inline SVG in the `uc.edu` header |
| `osu.svg` | Ohio State stacked mark, Block O in brand scarlet | `osu.edu/images/osu-logo-stacked.svg` |
| `dexcom.svg` | Dexcom wordmark | inline SVG in the `dexcom.com` header |
| `iras-logo.png` | IRAS Lab wordmark | `ceas5.uc.edu/IRAS-Lab/` |
| `eq.svg` | EQ logotype | set by hand; see below |
| `advisor-ou-ma.jpg` | Ou Ma headshot, square crop, 256px | the lab site |
| `advisor-raj-bhatnagar.jpg` | Raj K. Bhatnagar headshot, square crop, 256px | the lab site |

EQ Risk Management Consulting has no public mark, so its slot is a plain "EQ"
set in the page serif rather than an invented logo. The row prints the full
company name beside it, so the mark only has to identify, not explain.

## Dark mode

Every mark has a `-dark` twin, and `index.html` picks between them with a
`<picture>` and `media="(prefers-color-scheme: dark)"`.

This is not optional polish. The source marks are black, `currentColor`, or
carry no fill at all, and an SVG loaded through `<img>` is an independent
document: it does not inherit the page\'s `color`, so `currentColor` and unset
fills both resolve to black and the mark vanishes on a dark background. The
dark twins bake in a light ink instead. Ohio State keeps its scarlet in both,
since the brand red reads on either ground; only its grey lettering is
lightened.

To regenerate one, bake an explicit fill rather than relying on inheritance.
For the lab PNG, invert the RGB channels and leave the alpha channel alone;
inverting alpha too produces a solid block.

## Layout

The marks differ wildly in proportion: UC is roughly 5.7:1, Ohio State\'s
stacked mark roughly 1.3:1. `style.css` gives each one a fixed box
(`.crests .mark`) and scales the mark to fit inside it, pinned left, so the
text edge stays aligned down the list whatever shape the mark is. Replacing a
mark therefore needs no CSS change and no particular aspect ratio.
