"""Turn the downloaded OSM tiles into public/data/city.json for the scene.

Local frame: metres from the Burj Khalifa, x = east, z = south (so north is -z).
Outputs buildings (footprint rings + heights), the Burj Khalifa as stacked tiers
(union of its OSM building:parts, one tier per distinct height), roads, rail,
water, green areas and plazas.
"""
import glob, json, math, re, sys
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon, MultiPolygon, Point, LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree

LAT0, LON0 = 25.19725, 55.27437
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
BURJ_REL = "7584462"

def xz(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)

nodes, ways, rels = {}, {}, {}
for f in sorted(glob.glob("raw/tiles/*.osm")):
    root = ET.parse(f).getroot()
    for n in root.iter("node"):
        nodes[n.get("id")] = (float(n.get("lat")), float(n.get("lon")))
    for w in root.iter("way"):
        ways[w.get("id")] = ([nd.get("ref") for nd in w.findall("nd")], {t.get("k"): t.get("v") for t in w.findall("tag")})
    for r in root.iter("relation"):
        rels[r.get("id")] = ([(m.get("type"), m.get("ref"), m.get("role")) for m in r.findall("member")], {t.get("k"): t.get("v") for t in r.findall("tag")})
print(f"nodes {len(nodes)} ways {len(ways)} relations {len(rels)}", file=sys.stderr)

def coords(wid):
    refs = ways[wid][0]
    pts = [xz(*nodes[r]) for r in refs if r in nodes]
    return pts if len(pts) == len(refs) else None

def num(v):
    if v is None:
        return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", v.replace(",", "."))
    return float(m.group(1)) if m else None

def heights(tags, area):
    h = num(tags.get("height"))
    mh = num(tags.get("min_height")) or 0.0
    lv = num(tags.get("building:levels"))
    ml = num(tags.get("building:min_level"))
    if h is None and lv is not None:
        h = lv * 3.4 + 2
    if not tags.get("min_height") and ml is not None:
        mh = ml * 3.4
    b = tags.get("building", tags.get("building:part", "yes"))
    if b == "roof":
        return (h or 7.0), (mh or 5.0)
    if h is None:
        h = 6.0 if area < 250 else 10.0 if area < 1500 else 14.0
    if h < 15 and lv and lv > 5:  # a few parts carry a bogus 15 m with many levels
        h = lv * 3.4 + 2
    return h, min(mh, h - 1)

def ring_poly(pts, min_area=4.0):
    if len(pts) < 4:
        return None
    p = Polygon(pts)
    if not p.is_valid:
        p = p.buffer(0)
    return p if (not p.is_empty and p.area > min_area) else None

def multipolygon(rid):
    members, _ = rels[rid]
    outers, inners = [], []
    for t, ref, role in members:
        if t != "way" or ref not in ways:
            continue
        c = coords(ref)
        if not c:
            continue
        (inners if role == "inner" else outers).append(c)
    # join open outer segments into rings
    rings = []
    segs = [s for s in outers]
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur = cur + s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]: cur = cur + s[::-1][1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[0]: cur = s + cur[1:]; segs.pop(i); changed = True; break
                if s[0] == cur[0]: cur = s[::-1] + cur[1:]; segs.pop(i); changed = True; break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    polys = [Polygon(r) for r in rings]
    holes = [Polygon(r) for r in inners if len(r) >= 4]
    shape = unary_union([p.buffer(0) for p in polys]) if polys else None
    if shape is not None and holes:
        shape = shape.difference(unary_union([h.buffer(0) for h in holes]))
    return shape

def to_rings(geom, min_area=4.0, tol=0.25):
    out = []
    gs = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for g in gs:
        if g.is_empty or g.area < min_area:
            continue
        g = g.simplify(tol)
        out.append({
            "outer": [round(v, 1) for x, z in list(g.exterior.coords)[:-1] for v in (x, z)],
            "holes": [[round(v, 1) for x, z in list(h.coords)[:-1] for v in (x, z)] for h in g.interiors],
        })
    return out

# ---- the Burj Khalifa ----
burj_members, _ = rels[BURJ_REL]
burj_part_ids = {ref for t, ref, role in burj_members if t == "way" and role == "part"}
burj_outline_ids = {ref for t, ref, role in burj_members if t == "way" and role == "outline"}
parts = []
for wid in burj_part_ids:
    if wid not in ways:
        continue
    c = coords(wid)
    p = ring_poly(c, 0.01) if c else None  # the spire tip is well under a square metre
    if p is None:
        continue
    h = num(ways[wid][1].get("height")) or 0
    parts.append((h, p))
tower_parts = [(h, p) for h, p in parts if h >= 30]
podium_parts = [(h, p) for h, p in parts if h < 30]
levels = sorted({h for h, _ in tower_parts})
tiers = []
prev = 0.0
for h in levels:
    plan = unary_union([p for ph, p in tower_parts if ph >= h]).buffer(0)
    tiers.append({"h0": round(prev, 1), "h1": round(h, 1), "rings": to_rings(plan, 0.01, 0.02)})
    prev = h
print(f"burj: {len(tower_parts)} tower parts -> {len(tiers)} tiers up to {levels[-1]} m; podium parts {len(podium_parts)}", file=sys.stderr)
burj_area = unary_union([p for _, p in parts]).buffer(3)

# ---- buildings ----
parts_all, outlines = [], []
for wid, (refs, tags) in ways.items():
    if wid in burj_part_ids or wid in burj_outline_ids:
        continue
    is_part = "building:part" in tags and tags.get("building:part") != "no"
    is_bld = "building" in tags and tags.get("building") != "no"
    if not (is_part or is_bld) or refs[0] != refs[-1]:
        continue
    c = coords(wid)
    p = ring_poly(c) if c else None
    if p is None:
        continue
    (parts_all if is_part else outlines).append((p, tags, wid))
for rid, (members, tags) in rels.items():
    if rid == BURJ_REL:
        continue
    if tags.get("type") == "multipolygon" and ("building" in tags or "building:part" in tags):
        g = multipolygon(rid)
        if g is not None and not g.is_empty:
            (parts_all if "building:part" in tags else outlines).append((g, tags, "r" + rid))

part_tree = STRtree([p for p, _, _ in parts_all]) if parts_all else None
part_centroids = [p.representative_point() for p, _, _ in parts_all]
buildings = []
skipped = 0
def add(geom, tags, wid):
    if geom.intersection(burj_area).area > 0.5 * geom.area:
        return
    h, mh = heights(tags, geom.area)
    for r in to_rings(geom):
        buildings.append({"h": round(h, 1), "mh": round(mh, 1), "name": tags.get("name:en") or tags.get("name") or "", **r})
for p, tags, wid in outlines:
    # outlines that contain mapped parts are drawn as their parts instead
    has_parts = False
    if part_tree is not None:
        for i in part_tree.query(p):
            if p.contains(part_centroids[i]):
                has_parts = True
                break
    if has_parts:
        skipped += 1
        continue
    add(p, tags, wid)
for p, tags, wid in parts_all:
    add(p, tags, wid)
print(f"buildings {len(buildings)} (outlines replaced by parts: {skipped})", file=sys.stderr)

# ---- podium of the Burj ----
podium = []
for h, p in podium_parts:
    for r in to_rings(p):
        podium.append({"h": round(max(h, 8), 1), "mh": 0, **r})

# ---- roads, rail ----
WIDTH = {"motorway": 34, "motorway_link": 9, "trunk": 24, "trunk_link": 8, "primary": 16, "primary_link": 7,
         "secondary": 12, "secondary_link": 6, "tertiary": 10, "tertiary_link": 6, "unclassified": 7, "residential": 7,
         "service": 5, "living_street": 6, "pedestrian": 5, "footway": 2.5, "path": 2, "cycleway": 2.5, "steps": 2.5}
roads, rail = [], []
for wid, (refs, tags) in ways.items():
    hw = tags.get("highway")
    rw = tags.get("railway")
    if hw in WIDTH and tags.get("area") != "yes":
        c = coords(wid)
        if not c:
            continue
        lanes = num(tags.get("lanes"))
        w = WIDTH[hw]
        if lanes and hw in ("motorway", "trunk", "primary", "secondary"):
            w = max(w * 0.5, lanes * 3.6 + 2)
        roads.append({"w": round(w, 1), "k": hw, "lv": int(num(tags.get("layer")) or 0) if tags.get("bridge") or tags.get("layer") else 0,
                      "p": [round(v, 1) for x, z in c for v in (x, z)]})
    elif rw in ("subway", "light_rail", "rail", "monorail"):
        c = coords(wid)
        if c:
            rail.append({"k": rw, "elev": 1 if (tags.get("bridge") or tags.get("layer") in ("1", "2")) else 0,
                         "p": [round(v, 1) for x, z in c for v in (x, z)]})

# ---- areas ----
def area_kind(tags):
    if tags.get("natural") == "water" or tags.get("water") or tags.get("landuse") in ("basin", "reservoir") or tags.get("leisure") == "swimming_pool":
        return "water"
    if tags.get("leisure") in ("park", "garden", "pitch", "golf_course") or tags.get("landuse") in ("grass", "recreation_ground", "village_green") or tags.get("natural") in ("scrub", "grassland", "wood"):
        return "green"
    if tags.get("area:highway") or tags.get("place") == "square" or (tags.get("highway") in ("pedestrian", "footway") and tags.get("area") == "yes") or tags.get("amenity") == "parking":
        return "plaza"
    if tags.get("landuse") in ("construction", "brownfield", "greenfield"):
        return "site"
    return None
areas = []
for wid, (refs, tags) in ways.items():
    k = area_kind(tags)
    if k and refs[0] == refs[-1]:
        c = coords(wid)
        p = ring_poly(c) if c else None
        if p is not None:
            for r in to_rings(p):
                areas.append({"k": k, "name": tags.get("name:en") or tags.get("name") or "", **r})
for rid, (members, tags) in rels.items():
    k = area_kind(tags)
    if k and tags.get("type") == "multipolygon":
        g = multipolygon(rid)
        if g is not None and not g.is_empty:
            for r in to_rings(g):
                areas.append({"k": k, "name": tags.get("name:en") or tags.get("name") or "", **r})

out = {"origin": [LAT0, LON0], "tiers": tiers, "podium": podium, "buildings": buildings, "roads": roads, "rail": rail, "areas": areas}
json.dump(out, open("public/data/city.json", "w"), separators=(",", ":"))
print(f"roads {len(roads)} rail {len(rail)} areas {len(areas)} (water {sum(a['k']=='water' for a in areas)}, green {sum(a['k']=='green' for a in areas)})", file=sys.stderr)
