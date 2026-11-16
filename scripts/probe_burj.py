import json, sys
sys.path.insert(0, "scripts")
from overpass import query
q = """[out:json][timeout:120];
(
  way(around:260,25.19725,55.27437)["building"];
  way(around:260,25.19725,55.27437)["building:part"];
  relation(around:260,25.19725,55.27437)["building"];
  relation(around:260,25.19725,55.27437)["building:part"];
);
out tags geom;"""
d = query(q)
json.dump(d, open("raw/burj_probe.json", "w"))
for e in d["elements"]:
    t = e.get("tags", {})
    keys = {k: t[k] for k in ("name", "building", "building:part", "height", "min_height", "building:levels", "building:min_level", "roof:shape") if k in t}
    n = len(e.get("geometry", [])) if "geometry" in e else len(e.get("members", []))
    print(e["type"], e["id"], n, keys)
