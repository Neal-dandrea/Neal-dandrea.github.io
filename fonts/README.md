# Fonts

`latinmodern-math.woff2` is Latin Modern Math, the OpenType math font that TeX
sets by default. It is used on `platform.html` for the equations in the worked
trade and the no-arbitrage block.

It is here rather than loaded from a CDN so the page does not depend on anyone
else's host staying up, and it is declared with `font-display: swap`, so the
equations render in the system math font first and reflow when the 380 kB
arrives.

**Why a math font rather than the page serif.** An OpenType math font carries
a MATH table, which tells the browser how tall to draw a radical over its
contents, how far to raise a superscript, how thick a fraction bar should be and
how much space an operator needs on each side. Setting the equations in a text
serif throws that away and the browser approximates, which is exactly what made
the first version of these look like italic prose.

License: the GUST Font License, in `LICENSE-GUST.txt`. It permits redistribution
with the license attached, which is what this directory does.

Source: the web-ready build published at `fred-wang.github.io/MathFonts`, which
packages the fonts from the GUST e-foundry.
