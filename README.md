# Spawn Labeller

A small static web page for labelling satellite detections of herring spawn as **spawn**, **not spawn** or **unsure**.
Each item shows the earlier clear passes (including one from about a month before), the detection-day image and the same
image with the flagged pixels, so you can tell new milky water from tidal flats and other permanent bright spots.

- Works on desktop and phone. On phones the label buttons sit right under the images.
- Keyboard: ← → to move, 1 spawn, 2 not spawn, 3 unsure. Click an image to enlarge.
- The next few items' images preload while you label.
- Labels are saved in your browser (localStorage), per manifest. **Save labels** downloads them as JSON;
  **Load labels** restores them in another browser.
- **Export GeoJSON** writes the labelled points in OlmoEarth format (`task_name`, `observation_time`,
  `sample_true_false`); unsure items are left out. **Export CSV** writes every item with its label and note.

## Run it

Any static file server works:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/?manifest=examples/manifest.json>, or press **Open manifest…** and pick a file.
It can also be published with GitHub Pages (Settings → Pages → deploy from the main branch).

## Manifest format

```json
{
  "name": "broughton-2019",
  "title": "Spawn Labeller · Broughton 2019",
  "task_name": "herring_spawn",
  "items": [
    {
      "id": "unique-id",
      "date": "2019-03-18",
      "lat": 50.6162, "lon": -126.5829,
      "place": "Islet near Village Is.",
      "status": "candidate",
      "kind": "candidate",
      "ref":  { "date": "2019-02-13", "url": "images/x_ref.jpg" },
      "prev": [ { "date": "2019-03-08", "url": "images/x_prev1.jpg" } ],
      "det_url": "images/x_det.jpg",
      "overlay_url": "images/x_overlay.jpg",
      "note": "free text shown under the facts"
    }
  ]
}
```

Image URLs are resolved relative to the manifest. Instead of `ref`/`prev`/`det_url`/`overlay_url`, an item can give
`frames: [{ "title", "date", "src", "sub", "det" }]` to show any images in any order. Optional fields shown when
present: `area_m2`, `shsi_mean`, `shsi_max`, `dshsi_mean`, `km_station`, `dfo_match`, `sensor`, `missed_spawn`.
Items with `"kind": "negative"` appear under the *Negatives only* filter.

## Making a manifest from Earth Engine

`tools/make_manifest.py` takes points with dates (GeoJSON or CSV) and saves Sentinel-2 images for each one as local
JPGs (two previous clear passes, a month-before reference, detection, and SHSI overlay), plus `manifest.json`:

```
pip install earthengine-api
earthengine authenticate
python3 tools/make_manifest.py points.geojson data/my-batch --project YOUR_EE_PROJECT
# open http://localhost:8000/?manifest=data/my-batch/manifest.json
```

The SHSI (green² / red over clear water, with NIR, green and blue > coastal masks) follows the Spectral Herring Spawning
Index used for Sentinel-2/Landsat spawn detection.

## Example data

`examples/` holds five items from British Columbia (Sentinel-2, Copernicus data processed in Google Earth Engine):
a large Strait of Georgia spawn (Kye Bay, 2022), a DFO-recorded spawn at Crabpot Pt (2019), two unconfirmed
Broughton Archipelago candidates and one negative.
