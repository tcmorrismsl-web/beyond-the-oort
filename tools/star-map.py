# Generates real-star map positions and jump lanes (prints JSON).
# Used to build src/data/systems.json; content there is hand-edited afterwards.
# Run: python3 tools/star-map.py
"""Compute map positions and jump lanes for real nearby stars.

Positions: equatorial x/y projection of real RA/Dec/distance (light years),
so the map's layout matches reality (seen from 'above' the celestial pole).
Lanes: link stars within a jump range in 3D, plus a minimum spanning tree
so everything is connected, with a cap on links per star.
"""
import json, math, sys

# id, name, distance_ly, RA hours, Dec degrees
STARS = [
    ("sol", "Sol", 0.0, 0, 0),
    ("alpha-centauri", "Alpha Centauri", 4.37, 14.66, -60.8),
    ("barnards-star", "Barnard's Star", 5.96, 17.96, 4.7),
    ("wolf-359", "Wolf 359", 7.9, 10.94, 7.0),
    ("lalande-21185", "Lalande 21185", 8.3, 11.06, 35.97),
    ("sirius", "Sirius", 8.6, 6.75, -16.7),
    ("luyten-726-8", "Luyten 726-8", 8.7, 1.65, -17.95),
    ("ross-154", "Ross 154", 9.7, 18.83, -23.8),
    ("ross-248", "Ross 248", 10.3, 23.70, 44.2),
    ("epsilon-eridani", "Epsilon Eridani", 10.5, 3.55, -9.46),
    ("lacaille-9352", "Lacaille 9352", 10.7, 23.10, -35.85),
    ("ross-128", "Ross 128", 11.0, 11.79, 0.8),
    ("procyon", "Procyon", 11.4, 7.66, 5.2),
    ("61-cygni", "61 Cygni", 11.4, 21.12, 38.7),
    ("groombridge-34", "Groombridge 34", 11.6, 0.30, 44.0),
    ("epsilon-indi", "Epsilon Indi", 11.9, 22.05, -56.8),
    ("tau-ceti", "Tau Ceti", 11.9, 1.73, -15.9),
    ("gliese-1061", "Gliese 1061", 12.0, 3.60, -44.5),
    ("luytens-star", "Luyten's Star", 12.4, 7.46, 5.2),
    ("teegardens-star", "Teegarden's Star", 12.5, 2.88, 16.9),
    ("kapteyns-star", "Kapteyn's Star", 12.8, 5.19, -45.0),
    ("kruger-60", "Kruger 60", 13.1, 22.47, 57.7),
    ("wolf-1061", "Wolf 1061", 14.0, 16.51, -12.7),
    ("gliese-876", "Gliese 876", 15.2, 22.88, -14.3),
    ("altair", "Altair", 16.7, 19.85, 8.9),
    ("fomalhaut", "Fomalhaut", 25.1, 22.96, -29.6),
    ("vega", "Vega", 25.0, 18.62, 38.8),
]

JUMP_RANGE = 6.6   # ly: lanes between stars closer than this
MAX_LINKS = 5

def xyz(d, ra, dec):
    a = math.radians(ra * 15); b = math.radians(dec)
    return (d * math.cos(b) * math.cos(a), d * math.cos(b) * math.sin(a), d * math.sin(b))

P = {s[0]: xyz(s[2], s[3], s[4]) for s in STARS}
ids = [s[0] for s in STARS]
def dist(a, b): return math.dist(P[a], P[b])

links = {i: set() for i in ids}
# MST (Prim) for guaranteed connectivity
inside = {"sol"}
while len(inside) < len(ids):
    best = min(((dist(a, b), a, b) for a in inside for b in ids if b not in inside))
    _, a, b = best
    links[a].add(b); links[b].add(a); inside.add(b)
# Extra short lanes
pairs = sorted((dist(a, b), a, b) for i, a in enumerate(ids) for b in ids[i+1:])
for d, a, b in pairs:
    if d > JUMP_RANGE: break
    if len(links[a]) < MAX_LINKS and len(links[b]) < MAX_LINKS:
        links[a].add(b); links[b].add(a)

# 2D layout that keeps real 3D distances as well as a flat map can
# (stress minimization), starting from the top-down projection.
import random
random.seed(7)
pos = {i: [P[i][0], -P[i][1]] for i in ids}
for it in range(4000):
    lr = 0.02 * (1 - it / 4000) + 0.002
    for a in ids:
        if a == 'sol':
            continue
        gx = gy = 0.0
        for b in ids:
            if a == b: continue
            dx = pos[a][0] - pos[b][0]; dy = pos[a][1] - pos[b][1]
            cur = math.hypot(dx, dy) or 1e-6
            want = dist(a, b)
            w = 1 / (want * want)
            gx += w * (cur - want) * dx / cur
            gy += w * (cur - want) * dy / cur
        pos[a][0] -= lr * gx * 40; pos[a][1] -= lr * gy * 40
# keep Sol at the origin
ox, oy = pos['sol']
for i in ids: pos[i][0] -= ox; pos[i][1] -= oy
err = sum(abs(math.hypot(pos[a][0]-pos[b][0], pos[a][1]-pos[b][1]) - dist(a,b)) / dist(a,b) for i,a in enumerate(ids) for b in ids[i+1:]) / (len(ids)*(len(ids)-1)/2)
print('mean relative distance error', round(err*100,1), '%', file=sys.stderr)
out = []
for sid, name, d, ra, dec in STARS:
    x, y = pos[sid]
    out.append({"id": sid, "name": name, "x": round(x * 10, 1), "y": round(y * 10, 1),
                "dist_ly": d, "links": sorted(links[sid], key=lambda o: dist(sid, o)),
                "link_ly": {o: round(dist(sid, o), 1) for o in sorted(links[sid])}})
json.dump(out, sys.stdout, indent=1)
