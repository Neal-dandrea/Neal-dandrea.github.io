# neal-site

Personal site for Neal D'Andrea — the page linked from LinkedIn and from job
applications.

## What it is

`index.html` holds the content and `style.css` holds the design. There is no
build step and no framework, so the page renders as soon as the HTML arrives and
there is nothing to break in six months.

`platform.html`, `robotics.html` and `models.html` are three walkthrough pages,
described at the bottom of this file. They share `viz.css` and each has its own
JavaScript. The main page loads no JavaScript at all beyond the small
expand-and-collapse control, so the three animated teasers on it are CSS only.

`DESIGN-NOTES.md` records what was added and why one approach was taken over
another. Read it before undoing something that looks arbitrary.

## Editing it

Open `index.html` and edit the text directly. Entries are collapsible, so the
page can be scanned. The structure repeats:

```html
<details class="entry">
  <summary>
    <h3>Role</h3>
    <p class="meta">Employer <span class="sep">·</span> Dates</p>
  </summary>
  <p class="lede">One sentence framing what the work was.</p>
  <ul>
    <li>A thing that was built, and what it did.</li>
  </ul>
</details>
```

Everything inside `<summary>` is what shows when the entry is closed, so put
nothing there that a reader needs in order to decide whether to open it. Avoid
links inside a summary: clicking one navigates instead of expanding.

Add `class="entry compact"` instead of `class="entry"` for a shorter block with
no bullets. `.lede` is optional; use it only where a role needs framing before
the bullets make sense.

The affiliations section uses two different list structures:

```html
<ul class="crests">   <!-- institutions and companies -->
  <li>
    <img src="img/uc.svg" alt="" width="96" height="96">
    <div>
      <span class="crest-name">University of Cincinnati</span>
      <span class="crest-role">Role <span class="sep">·</span> Dates</span>
    </div>
  </li>
</ul>

<ul class="people">   <!-- advisors; same shape, but the image is cropped round -->
  <li>
    <img src="img/advisor-1.svg" alt="" width="128" height="128">
    <div>
      <span class="person-name">Name</span>
      <span class="person-role">Institution <span class="sep">·</span> Field</span>
    </div>
  </li>
</ul>
```

Wrap `.crest-name` text in an `<a>` to make an entry link out, as the lab entry
does.

Colors, spacing and the text measure are variables at the top of `style.css`.
`--measure` controls line length — widen it and the page gets harder to read, so
change it cautiously. Dark mode, print and small screens all follow from those
same variables and need no separate edit.

## The background

`body::before` and `body::after` are two fixed layers behind the content: a
ruled instrument grid, which reads as a price chart and a CAD drawing at the
same time, and two soft color washes. Both are CSS gradients, so they cost no
requests and nothing loads. The grid is masked to fade out by roughly 75rem
down, so the long prose sections are never read over ruling.

`--accent` is a scarlet that sits between UC red and Ohio State scarlet, close
enough to read as either without claiming to be an official brand color. It
appears in the hairline under the sticky nav, the tick before each section
label, and link and crest hover states. Turn the whole surface off by deleting
the `body::before, body::after` rule; nothing else depends on it.

## Previewing

```
python3 -m http.server 8080 --directory ~/neal-site
```

Then open `http://localhost:8080`, or `http://100.121.189.51:8080` from another
machine on the Tailnet.

## Publishing

Live at **<https://neal-dandrea.github.io/>**, served by GitHub Pages from the
`master` branch of `Neal-dandrea/Neal-dandrea.github.io`, root directory.

The repo name is what makes the URL a bare domain rather than
`neal-dandrea.github.io/some-repo`: GitHub treats `<username>.github.io` as the
account's one user site. Renaming the repo would change the URL, so don't.

Publishing a change is just:

```
git push
```

The build takes a minute or so. There is no build step and no Actions workflow;
Pages serves the files as they sit in the repo.

A custom domain, if one is ever wanted, is a CNAME record at the registrar plus
the domain entered under Settings → Pages.

## Link previews

`og-card.jpg` is the 1200x630 image that LinkedIn, email clients and chat apps
show when the URL is pasted. It is generated, not hand-drawn — the script that
builds it lives in this README's history, but it is simple enough to rebuild:
paper background, scarlet rule along the top, name and standfirst in the page
serif, portrait cropped to a circle on the right.

If the standfirst changes, regenerate the card so the two agree, and update the
`og:description` in `index.html` to match. Both are absolute URLs pointing at
`neal-dandrea.github.io`, which is required: relative paths do not work for
`og:image`.

## Accessibility

`--ink-faint` carries dates, job titles and the publication byline, so it is
held at or above the WCAG AA contrast minimum of 4.5:1 against `--paper`
(currently 4.70:1 in light mode, 5.98:1 in dark). It is tempting to lighten it
for a quieter look; don't, without re-checking the ratio. The other text
colors clear the bar comfortably.

## Content notes

- The résumé PDF is deliberately **not** published here. The version on file
  carries a home street address and phone number, which should not sit on a
  public URL. If a downloadable PDF is wanted, make a web copy with those two
  lines removed and add it as `resume.pdf` with a link in the masthead.
- The affiliations section uses real marks and real headshots throughout, each
  taken from the organization's own site. Every mark has a dark-mode twin,
  because an SVG loaded through `<img>` does not inherit the page's color and
  would otherwise render black on black. `img/README.md` has the details and
  the regeneration recipe.
- Employment is ordered by relevance rather than strictly by date: the robotics
  research leads, because that is what the page is aimed at.

## The platform walkthrough

`platform.html` is a standalone page showing what the market data work looks
like: capture, a forming bar, a rotatable volatility surface, an SVI fit and its
residuals, skew by maturity, a backtest gross and net of costs, the signal
ablation, and the breadth calculation.

**Nothing on it is real, and that is the point.** The production system is
proprietary. Every figure is generated in the visitor's browser by
`platform.js` from published textbook models and a seeded random number
generator, so the page is identical for every visitor and nothing leaves it.
The disclaimer at the top is not decoration; if the page ever gains a figure
that is not synthetic, the disclaimer stops being true and has to change first.

The teaser surface on the main page is a still of the same model, generated
once and baked into `index.html` as inline SVG. Its fills are fourteen buckets
of one ramp, declared in `style.css` so dark mode restates them rather than
inverting them, and each bucket strokes itself so adjacent quads do not leave
hairline gaps. Regenerating it means re-running the generator in the commit
that added it; there is no build step that does it for you.

Four things to know before editing `platform.js`:

- **The SVI wing slope has to carry a factor of T.** Total implied variance is
  roughly `T(atm + s·k)^2`, so `b` scales with time to expiry. A `b` that does
  not produced a 284% one-week wing on the first pass, and the surface still
  looked plausible at a glance.
- **Section ids and element ids share a namespace.** `renderBreadth` once
  replaced the whole section rather than its figure, because both carried
  `id="breadth"`, and the heading silently disappeared.
- **`rho` is set by the butterfly constraint, not by eye.** At `-0.72 + 0.26T`
  the index on a quiet day fails Durrleman's condition on the upside wing at
  short maturities (min g = −0.056), because total variance is small there and
  the `(w'/4)(1/w)` term dominates. `-0.86 + 0.34T` clears all 25 name-and-date
  combinations. The arbitrage panel recomputes both checks over a 40×40 grid on
  every market change, so a parameter change that breaks the surface shows up on
  the page rather than in silence.
- **The date multipliers are damped by each name's own level.** Volatility of
  volatility falls as the level rises, so a selloff roughly doubles the index
  and does much less to a name already trading at 42. Applied flat, the selloff
  date put NVDA's three-month at-the-money vol at 94%, which is the kind of
  number that discredits every other number on the page.

Colors come from `style.css` where they can, and the chart palette in
`viz.css` was checked against this site's own light and dark surfaces
rather than assumed. Light mode is below the contrast threshold for two of the
three series, which is why every series carries a direct label rather than
relying on a legend.
