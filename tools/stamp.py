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
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = sorted(ROOT.glob("*.html"))
PATTERN = re.compile(r'(?P<attr>href|src)="(?P<file>[\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]

changed = []
for page in PAGES:
    text = page.read_text()
    def stamp(m):
        target = ROOT / m.group("file")
        if not target.is_file():          # leave anything off-site alone
            return m.group(0)
        return '%s="%s?v=%s"' % (m.group("attr"), m.group("file"), digest(target))
    new = PATTERN.sub(stamp, text)
    if new != text:
        page.write_text(new)
        changed.append(page.name)

print("stamped: " + (", ".join(changed) if changed else "nothing to do"))
