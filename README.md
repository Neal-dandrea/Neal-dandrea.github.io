# neal-site

Personal site for Neal D'Andrea — the page linked from LinkedIn and from job
applications.

## What it is

Two files. `index.html` holds the content, `style.css` holds the design. There
is no build step, no framework and no JavaScript, so the page renders as soon as
the HTML arrives and there is nothing to break in six months.

## Editing it

Open `index.html` and edit the text directly. The structure repeats:

```html
<article class="entry">
  <header>
    <h3>Role</h3>
    <p class="meta">Employer <span class="sep">·</span> Dates</p>
  </header>
  <p class="lede">One sentence framing what the work was.</p>
  <ul>
    <li>A thing that was built, and what it did.</li>
  </ul>
</article>
```

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

Colours, spacing and the text measure are variables at the top of `style.css`.
`--measure` controls line length — widen it and the page gets harder to read, so
change it cautiously. Dark mode, print and small screens all follow from those
same variables and need no separate edit.

## The background

`body::before` and `body::after` are two fixed layers behind the content: a
ruled instrument grid, which reads as a price chart and a CAD drawing at the
same time, and two soft colour washes. Both are CSS gradients, so they cost no
requests and nothing loads. The grid is masked to fade out by roughly 75rem
down, so the long prose sections are never read over ruling.

`--accent` is a scarlet that sits between UC red and Ohio State scarlet, close
enough to read as either without claiming to be an official brand colour. It
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

The site is static, so anything that serves files will host it.

- **GitHub Pages** — push to a repo, then Settings → Pages → deploy from
  `master`, root. Free, and gives `<username>.github.io/<repo>`.
- **Netlify or Cloudflare Pages** — connect the repo, no build command, publish
  directory `.`.

A custom domain points at either with a CNAME record.

## Content notes

- The résumé PDF is deliberately **not** published here. The version on file
  carries a home street address and phone number, which should not sit on a
  public URL. If a downloadable PDF is wanted, make a web copy with those two
  lines removed and add it as `resume.pdf` with a link in the masthead.
- The affiliations section uses real marks and real headshots throughout, each
  taken from the organization's own site. Every mark has a dark-mode twin,
  because an SVG loaded through `<img>` does not inherit the page's colour and
  would otherwise render black on black. `img/README.md` has the details and
  the regeneration recipe.
- Employment is ordered by relevance rather than strictly by date: the robotics
  research leads, because that is what the page is aimed at.
