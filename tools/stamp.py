#!/usr/bin/env python3
"""Stamp every local stylesheet and script link with a hash of its contents.

GitHub Pages serves with cache-control max-age=600, and browsers routinely hold
a stylesheet past that on an ordinary reload. A page can then end up running new
HTML against an old stylesheet, which is a state that exists nowhere on the
server and is very hard to recognize as a caching problem rather than a bug.

Stamping the URL with a hash of the file means the URL changes whenever the file
changes, so a stale copy can never be matched to a new page. Run this before
committing any change to a .css or .js file. Running it when nothing changed
rewrites nothing.
"""
import datetime, hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = sorted(ROOT.glob("*.html"))
PATTERN = re.compile(r'(?P<attr>href|src)="(?P<file>[\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]

TIME_TAG = re.compile(r'(<time datetime=")[\d-]+(">)[^<]*(</time>)')

def freshen_date(text):
    """Rewrite the last-updated date in the masthead to today.

    A date that has to be edited by hand goes stale without anyone noticing,
    and a stale one is worse than none at all because it tells a reader the
    work stopped. Only the element inside p.updated is touched.
    """
    m = re.search(r'<p class="updated">.*?</p>', text, re.S)
    if not m:
        return text
    today = datetime.date.today()
    pretty = "%d %s %d" % (today.day, today.strftime("%B"), today.year)
    fresh = TIME_TAG.sub(r"\g<1>" + today.isoformat() + r"\g<2>" + pretty + r"\g<3>", m.group(0))
    return text[:m.start()] + fresh + text[m.end():]

changed = []
for page in PAGES:
    text = page.read_text()
    text = freshen_date(text)
    def stamp(m):
        target = ROOT / m.group("file")
        if not target.is_file():          # leave anything off-site alone
            return m.group(0)
        return '%s="%s?v=%s"' % (m.group("attr"), m.group("file"), digest(target))
    new = PATTERN.sub(stamp, text)
    if new != page.read_text():
        page.write_text(new)
        changed.append(page.name)

print("stamped: " + (", ".join(changed) if changed else "nothing to do"))
