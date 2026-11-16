"""Small Overpass client: generic User-Agent, retries across mirrors."""
import json, sys, time, urllib.request, urllib.parse

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter"]
UA = "city-scene-builder/0.1 (three.js hobby project)"

def query(q: str, timeout=180):
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(6):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # 429/502/504 when busy
            last = e
            print(f"  overpass {url.split('/')[2]} failed: {e}; retrying", file=sys.stderr)
            time.sleep(4 + attempt * 6)
    raise RuntimeError(f"overpass failed: {last}")
