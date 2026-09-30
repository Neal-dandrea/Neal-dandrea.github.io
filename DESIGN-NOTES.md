# Design notes

A record of what was added to this site and why one approach was taken over
another. The README says how to edit the site. This file says why it is built
the way it is, so that a decision made once does not get quietly undone later
by someone who only sees the result.

Written 2026-09-29.

## The shape of the site

There are four pages. `index.html` is the overview and the only page most
visitors will read. `platform.html`, `robotics.html` and `models.html` are
walkthroughs, one per domain, each built to be poked at rather than described.

The split exists because the résumé and the walkthroughs want opposite things.
A résumé should be scannable in thirty seconds. A walkthrough should reward
ten minutes. Trying to do both on one page produced a page that did neither,
so the overview now carries a note near the top saying plainly that the
walkthroughs exist and where they are.

There is no build step and no framework. The pages are HTML and CSS, and the
walkthroughs add plain JavaScript with no dependencies. The reason is
durability rather than purity. A toolchain has to be maintained, and this site
gets edited a few times a year. Anything that requires remembering how to
build it will eventually stop being edited.

## Why entries collapse

Every résumé entry is a `<details>` element and every one starts closed. The
page is long, and a reader deciding whether to keep reading should be able to
see the whole shape of a career in one screen before committing to any of it.

The tradeoff is real. Collapsed content is not read by someone skimming, and
it is not visible to a plain text scrape. That is why the `<summary>` carries
the role, the employer and the dates. Everything a reader needs in order to
decide whether to open an entry is outside the fold.

Links never go inside a `<summary>`. Clicking one navigates instead of
expanding, which reads as a bug even though it is the specified behavior.

## The finance walkthrough

`platform.html` runs ten panels over a simulated market. The disclaimer at the
top is not boilerplate. The real platform is proprietary and some of it sits
under an open IP question, so nothing on the page came out of it. No vendor
names, no colleague names, no client details, no internal table or file names,
and no signal generating logic. The numbers are generated in the browser by
`platform.js` from a model written for the page.

That constraint turned out to be a feature. A model written for a page can be
made to misbehave on demand, so the panels can show an event in the front
month or a selloff on command, which real captured data would not have offered
on the day someone happens to visit.

### Making the surface honest

The volatility surface uses the Gatheral raw SVI parameterization, and the fit
is checked for calendar and butterfly arbitrage rather than merely asserted to
be arbitrage free. Three things were learned the hard way.

- **The wing parameter has to scale with maturity.** The first version produced
  a 284 percent one week wing, which is not a market, it is a bug. The fix was
  to make `b` proportional to total variance rather than to volatility.
- **Widening the smile does not fix a butterfly violation.** A quiet SPX fit
  failed Durrleman's condition at a minimum of −0.056, and the instinct to
  widen sigma made it worse. Correlation had to become less negative with
  maturity instead.
- **Spreads have to look like a liquid market.** Eight volatility point spreads
  buried the surface under its own error bars. Resized to realistic values the
  fit lands at 0.43 RMSE vega weighted with 93 percent of quotes inside the
  market.

### What was rejected

Log scaling on the breadth bars was tried and removed. It made a thin sliver of
data look like a respectable bar, and the sliver is the actual finding.
Anything that makes a weak result look strong comes out.

Expiry slices floating above the sheet were replaced by constant strike scan
lines, because the floating slices read as a rendering error rather than as a
cross section.

## The robotics walkthrough

`robotics.html` deliberately shares almost nothing visually with the finance
page beyond the left margin navigation. Two walkthroughs in the same house
style read as one template filled in twice, which undercuts the claim that
these are genuinely different bodies of work. The robotics page uses a plate
aesthetic, closer to a lab notebook than to a terminal.

The gripper is not a drawing. It was traced from the real UMI mesh files on
this machine, the STL geometry plus the URDF joint tree, using marching squares
to pull contours and Douglas and Peucker to simplify them. The output lives in
`gripper-outline.js` with the grasp point at the origin and positive X forward.
Drawing an approximation would have been faster and would have been wrong in a
way a roboticist would spot immediately.

The handover demonstration poses two arms with cyclic coordinate descent. The
first version reached for a target 408 units away with 300 units of arm, which
is the kind of error that is invisible until someone who builds arms looks at
it. Link lengths and the path were both corrected, and the handover point now
sits inside the reach of both arms.

Poses are shown as hard cuts rather than crossfades. A crossfade renders two
poses at once, which reads as a ghost rather than as motion.

## The machine learning walkthrough

`models.html` is organized by problem rather than by model, with the full model
roster stated once at the top. Organizing by model produces a list that reads
as a skills inventory. Organizing by problem forces each section to say what
was actually being solved and whether it worked.

The ablation panel plots measured values and not illustrative ones. Two feature
blocks that were expected to help both drop out of sample. Showing that is more
useful than showing a tidy result, and it matches what the work actually found.

## The three teasers on the main page

Each walkthrough is fronted on `index.html` by an animated graphic that links
to it. All three animate on their own, and two of them respond to hovering.

They are CSS only with no JavaScript on the main page. That constraint drove
every technique on them.

- **Motion is a crossfade or a flipbook, never a morph.** Morphing paths needs
  SMIL, and no media query can switch SMIL off. Anyone who asks for reduced
  motion has to actually get it, and with CSS animation they do.
- **Hover scrubbing works through transparent strips.** Strips lie over the
  drawing with one state behind each, and hovering a strip holds its state
  still. The strips have to be painted before the states, because the selector
  reaches forward from the hovered strip. The states have to ignore the pointer
  or they would sit on top and swallow the hover, since SVG hit testing follows
  paint order.
- **Touch degrades cleanly.** There is no hover on a phone, so the graphics
  keep looping rather than landing in a broken state.

The surface teaser normalizes color within each state while sharing one height
scale across all four. Sharing the color scale as well washed every state out
toward white. Sharing height is the point, since the selloff should look taller
because it is taller.

A trap worth knowing. The per teaser `grid-template-columns` rules have to come
before the mobile media query at the end of `style.css`, or the teasers never
collapse to one column on a phone. There is a comment marking this.

## Typography of the equations

The equations are MathML with a self hosted copy of Latin Modern Math under the
GUST license. An earlier version set `font-family: inherit` on the math, which
silently disables the font's MATH table and makes correct markup render badly.
The fix was to remove that rule rather than to add more rules.

Images of equations were considered and rejected. They do not scale, they do
not respond to dark mode, and they are invisible to anyone using a screen
reader.

## House style

These are preferences rather than rules of typography, and they are recorded
here so the voice stays consistent across edits.

- No colons or semicolons breaking up a sentence. Join the clauses with a word
  or start a new sentence.
- American spelling everywhere, including comments and commit messages.
- No clipped declaratives. A short punchy sentence that states a thing and
  leaves the next sentence to explain it should be joined to that next
  sentence instead. This crept in twice and was cleaned out twice, so it is
  worth watching for. Figure badges, direct instructions to the reader, and
  job title and degree lines are not prose and are exempt.
- No commas in titles or headings. Job titles and degree lines keep theirs,
  since a comma is part of how those are conventionally written.
- First person where the page is describing something learned. The earlier
  drafts read as generated text, and the fix was fewer epigrams, paragraphs of
  varying length, and saying plainly what was not understood at the time.
- No AI attribution in commit messages. This is a standing instruction and it
  applies to this repository like any other.

## Verification

Rendering is checked by driving headless Chromium and looking at the output,
not by reading the markup and assuming. Two things make that awkward here.

The browser is the snap build, so it cannot write to `/tmp` or read hidden
directories. Probe files go in a folder under the home directory and outside
this repository, and they get deleted afterward. Nothing temporary belongs in a
repository that deploys on push.

Headless Chromium also stops advancing CSS animations after about a second, so
animated states are verified by forcing each state visible and rendering it,
rather than by waiting for the animation to reach it.

## Cache busting

Every stylesheet and script link carries a hash of the file it points at, as in
`style.css?v=c7dd4110`. `tools/stamp.py` rewrites those, and it should be run
before committing any change to a `.css` or `.js` file. It is safe to run when
nothing has changed, since it rewrites nothing.

The reason is a failure that is genuinely hard to recognize. Pages serves with
`cache-control: max-age=600` and browsers routinely hold a stylesheet past that
on an ordinary reload, so a visitor can end up running new HTML against an old
stylesheet. That combination exists nowhere on the server, and it reads as a
bug in the page rather than as a caching problem. It cost a round trip once
already, with four volatility surfaces stacked on top of each other long after
the fix was live. A URL that changes with the file cannot be matched to a stale
copy, so the state stops being reachable.

## Deploying

`git push origin master` publishes. There is no staging environment, so the
push is the deploy and anything broken is broken in public.

Run `tools/stamp.py` first if any stylesheet or script changed.
