"""Download Downtown Dubai from the OSM API (Overpass is unreachable from here)
in small tiles, splitting any tile that exceeds the API's node limit."""
import os, sys, time, urllib.request, urllib.error

UA = "city-scene-builder/0.1 (three.js hobby project)"
LAT0, LON0 = 25.19725, 55.27437
HALF_LAT, HALF_LON = 0.0205, 0.0225  # about 2.3 km each way
OUT = "raw/tiles"
os.makedirs(OUT, exist_ok=True)

def fetch(minlon, minlat, maxlon, maxlat, depth=0):
    name = f"{OUT}/{minlon:.5f}_{minlat:.5f}_{maxlon:.5f}_{maxlat:.5f}.osm"
    if os.path.exists(name) and os.path.getsize(name) > 200:
        return
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={minlon:.5f},{minlat:.5f},{maxlon:.5f},{maxlat:.5f}"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            open(name, "wb").write(data)
            print(f"  ok {name.split('/')[-1]} {len(data)//1024} KB", flush=True)
            time.sleep(1.2)
            return
        except urllib.error.HTTPError as e:
            if e.code == 400 and depth < 4:  # too many nodes: split in four
                mx, my = (minlon + maxlon) / 2, (minlat + maxlat) / 2
                print(f"  split ({e.code})", flush=True)
                for a, b, c, d in [(minlon, minlat, mx, my), (mx, minlat, maxlon, my), (minlon, my, mx, maxlat), (mx, my, maxlon, maxlat)]:
                    fetch(a, b, c, d, depth + 1)
                return
            print(f"  http {e.code}, retry", flush=True)
        except Exception as e:
            print(f"  {e}, retry", flush=True)
        time.sleep(5 + attempt * 5)
    raise SystemExit(f"failed {url}")

N = 6
for j in range(N):
    for i in range(N):
        a = LON0 - HALF_LON + (2 * HALF_LON) * i / N
        b = LAT0 - HALF_LAT + (2 * HALF_LAT) * j / N
        fetch(a, b, a + 2 * HALF_LON / N, b + 2 * HALF_LAT / N)
print("done")
