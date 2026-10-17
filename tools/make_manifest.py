"""Build a labelling manifest from points + dates using Google Earth Engine Sentinel-2.

For each input point it saves, as local JPGs (so links never expire):
  - up to two clear passes in the 30 days before the date,
  - a clear reference pass about a month before (20-45 days, closest to 30),
  - the date's true-colour image,
  - the same image with an index overlay in cyan (--overlay):
      shsi  green^2/red > threshold over clear water with NIR < 0.025, green > 0.025, blue > coastal
            (Spectral Herring Spawning Index; default threshold 0.15)
      ndwi  (green - NIR) / (green + NIR) > threshold (default 0.2)
      ndvi  (NIR - red) / (NIR + red) > threshold (default 0.4)
      none  no overlay frame

Input: a GeoJSON FeatureCollection of Points, or a CSV with id,date,lat,lon[,place,...].
Extra properties/columns are copied into the manifest items.

  pip install earthengine-api
  earthengine authenticate
  python tools/make_manifest.py points.geojson out/ --project my-ee-project --overlay ndwi \
      --task-name flooding --question 'Is there flooding?'
  # then open index.html?manifest=out/manifest.json (serve the repo folder, e.g. python -m http.server)
"""
import argparse, csv, datetime as dt, json, math, os, re, subprocess
from concurrent.futures import ThreadPoolExecutor

import ee

VIS = {'min': 0, 'max': 0.12, 'gamma': 1.3}


def read_points(path):
    if path.lower().endswith('.csv'):
        rows = list(csv.DictReader(open(path)))
    else:
        rows = [{**f['properties'], 'lon': f['geometry']['coordinates'][0], 'lat': f['geometry']['coordinates'][1]}
                for f in json.load(open(path))['features']]
    out = []
    for i, r in enumerate(rows):
        date = str(r.get('date') or r.get('observation_time', ''))[:10]
        out.append({**r, 'id': str(r.get('id') or f'pt{i:05d}_{date}'), 'date': date, 'lat': float(r['lat']), 'lon': float(r['lon'])})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('points'); ap.add_argument('out')
    ap.add_argument('--project', required=True, help='Earth Engine Cloud project')
    ap.add_argument('--half-width-m', type=float, default=2000, help='half the box width around each point')
    ap.add_argument('--task-name', default='label_task')
    ap.add_argument('--question', default='Is the target present?')
    ap.add_argument('--overlay', choices=['shsi', 'ndwi', 'ndvi', 'none'], default='shsi')
    ap.add_argument('--threshold', type=float, help='overlay threshold (defaults per index)')
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    os.makedirs(os.path.join(a.out, 'images'), exist_ok=True)

    water = ee.ImageCollection('ESA/WorldCover/v200').first().eq(80).focalMin(radius=10, units='meters')
    cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')

    def box(lon, lat):
        dl = a.half_width_m / 111320; dn = a.half_width_m / (111320 * math.cos(math.radians(lat)))
        return ee.Geometry.Rectangle([lon - dn, lat - dl, lon + dn, lat + dl])

    def col(region, d0, d1):
        return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(d0, d1).filterBounds(region).linkCollection(cs, ['cs_cdf'])

    def day(region, d):
        return col(region, d, (dt.date.fromisoformat(d) + dt.timedelta(days=1)).isoformat()).mosaic()

    thr = a.threshold if a.threshold is not None else {'shsi': 0.15, 'ndwi': 0.2, 'ndvi': 0.4}.get(a.overlay)

    def hot(img):
        r = img.select(['B1', 'B2', 'B3', 'B4', 'B8']).divide(10000)
        c, b, g, rd, n = [r.select(x) for x in ['B1', 'B2', 'B3', 'B4', 'B8']]
        clear = img.select('cs_cdf').gte(0.6)
        if a.overlay == 'shsi':
            return clear.And(water).And(n.lt(0.025)).And(g.gt(0.025)).And(b.gt(c)).And(g.multiply(g).divide(rd).gt(thr))
        if a.overlay == 'ndwi':
            return clear.And(g.subtract(n).divide(g.add(n)).gt(thr))
        return clear.And(n.subtract(rd).divide(n.add(rd)).gt(thr))

    def clear_dates(region, d0, d1):
        def f(img):
            cl = water.And(img.select('cs_cdf').gte(0.6)).And(img.select('B2').mask())
            s = ee.Image.cat([water.rename('w'), cl.rename('c')]).unmask(0).reduceRegion(ee.Reducer.sum(), region, 20, maxPixels=1e9)
            return ee.Feature(None, {'date': img.date().format('YYYY-MM-dd'), 'w': s.get('w'), 'c': s.get('c')})
        ok = set()
        for x in ee.FeatureCollection(col(region, d0, d1).map(f)).getInfo()['features']:
            p = x['properties']
            if p['w'] and p['c'] / p['w'] >= 0.7:
                ok.add(p['date'])
        return sorted(ok)

    def save(img, region, name):
        url = img.getThumbURL({'region': region, 'dimensions': 640, 'format': 'jpg'})
        subprocess.run(['curl', '-s', '-m', '120', '-o', os.path.join(a.out, 'images', name), url], check=True)
        return f'images/{name}'

    def render(p):
        iid = re.sub(r'[^A-Za-z0-9_-]+', '_', p['id'])[:80]
        region = box(p['lon'], p['lat']); D = dt.date.fromisoformat(p['date'])
        try:
            prev = clear_dates(region, (D - dt.timedelta(days=30)).isoformat(), p['date'])[-2:]
            refs = clear_dates(region, (D - dt.timedelta(days=45)).isoformat(), (D - dt.timedelta(days=20)).isoformat())
            ref = min(refs, key=lambda d: abs((D - dt.date.fromisoformat(d)).days - 30)) if refs else None
            rgb = lambda m: m.select(['B4', 'B3', 'B2']).divide(10000).visualize(**VIS)
            item = {**p, 'prev': [{'date': d, 'url': save(rgb(day(region, d)), region, f'{iid}_prev_{d}.jpg')} for d in prev], 'ref': None}
            if ref:
                item['ref'] = {'date': ref, 'url': save(rgb(day(region, ref)), region, f'{iid}_ref_{ref}.jpg')}
            m = day(region, p['date'])
            pt = ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(ee.Geometry.Point([p['lon'], p['lat']]).buffer(80))]), 1, 2).visualize(palette=['ffff00'])
            item['det_url'] = save(rgb(m), region, f'{iid}_det_{p["date"]}.jpg')
            if a.overlay != 'none':
                item['overlay_url'] = save(ee.ImageCollection([rgb(m), hot(m).selfMask().visualize(palette=['00ffff'], opacity=0.7), pt]).mosaic(),
                                           region, f'{iid}_overlay_{p["date"]}.jpg')
            print('ok', p['id'], flush=True)
            return item
        except Exception as ex:  # one bad point shouldn't stop the batch
            print('skip', p['id'], str(ex)[:150], flush=True)
            return None

    pts = read_points(a.points)
    with ThreadPoolExecutor(a.workers) as ex:
        items = [x for x in ex.map(render, pts) if x]
    name = os.path.basename(os.path.normpath(a.out))
    json.dump({'name': name, 'title': name, 'task_name': a.task_name, 'question': a.question, 'items': items},
              open(os.path.join(a.out, 'manifest.json'), 'w'), indent=1)
    print(f'{len(items)}/{len(pts)} items -> {os.path.join(a.out, "manifest.json")}')


if __name__ == '__main__':
    main()
