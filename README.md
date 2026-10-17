# Temporal Labeller

**Live:** <https://dexterfichuk.github.io/temporal-labeller/> · [example](https://dexterfichuk.github.io/temporal-labeller/?manifest=examples/herring-spawn/manifest.json)

A small static web tool for labelling **remote-sensing events through time**. Each item shows a short image time
series for one place: a reference from weeks earlier, the passes just before, the event date, and an optional
overlay of an index or detection mask. A single image often can't tell an event from a permanent bright feature
(tidal flats, sandbars, snow on rock, cloud shadow). Seeing the same place before the event makes that call quick.

Typical uses: validating detections from a threshold or model (algal blooms, sediment plumes, flooding, fire scars,
herring spawn), building training sets of positives and hard negatives, and reviewing change-detection output.

- **Your classes:** each manifest sets its own question and classes, e.g. *spawn / not spawn / unsure* or
  *flooded / dry*. Keys 1–9 pick a class, ← → move between items, and clicking an image enlarges it.
- **Built for time series:** any number of dated frames per item, labelled with days before the event.
- **Works on phones:** the label buttons sit right under the images and one item fits on screen. The next
  items' images preload while you label.
- **Nothing to install:** plain HTML/JS. Labels are kept in your browser per manifest. *Save labels* /
  *Load labels* move them between devices.
- **Exports:**
  - **OlmoEarth GeoJSON:** Point, `task_name`, `observation_time`, `sample_true_false`. Each class's `positive`
    flag maps to true/false, and classes with `positive: null` (e.g. unsure) are left out.
  - **CSV:** every item with its label and note.

## Run it

```
python3 -m http.server 8000
```

Open <http://localhost:8000/?manifest=examples/herring-spawn/manifest.json>, or press **Files → Open manifest…**.
It can also be hosted on GitHub Pages or any static host.

## Manifest

```json
{
  "name": "broughton-2019",
  "title": "Herring spawn · Broughton 2019",
  "task_name": "herring_spawn",
  "question": "Is this a herring spawn?",
  "classes": [
    { "value": "spawn",  "label": "Spawn",     "positive": true,  "color": "#0e8c87" },
    { "value": "not",    "label": "Not spawn", "positive": false, "color": "#c2493d" },
    { "value": "unsure", "label": "Unsure",    "positive": null,  "color": "#b7791f" }
  ],
  "items": [
    {
      "id": "unique-id",
      "date": "2019-03-18",
      "lat": 50.6162, "lon": -126.5829,
      "place": "Islet near Village Is.",
      "kind": "candidate",
      "tags": ["possible missed event"],
      "fields": { "Patch area (m²)": 70145, "Index mean": 0.40 },
      "ref":  { "date": "2019-02-13", "url": "images/x_ref.jpg" },
      "prev": [ { "date": "2019-03-08", "url": "images/x_prev1.jpg" } ],
      "det_url": "images/x_det.jpg",
      "overlay_url": "images/x_overlay.jpg",
      "note": "free text shown under the facts"
    }
  ]
}
```

- Image paths are relative to the manifest. URLs work too.
- Instead of `ref` / `prev` / `det_url` / `overlay_url`, an item can list
  `frames: [{ "title", "date", "src", "sub", "det" }]` to show any sequence.
- Without `classes`, the tool uses *Present / Absent / Unsure*.
- `kind: "negative"` items get a *Negatives only* filter.
- Other optional fields: `status`, `sensor`, `area_m2`, `km_station`, `dfo_match` (shown as a reference record).

## Building manifests from Earth Engine

`tools/make_manifest.py` takes points with dates (GeoJSON or CSV). For each point it saves Sentinel-2 images as
local JPGs, so they never expire: two clear passes in the 30 days before, a clear reference about a month before,
the event date, and an index overlay. It also writes `manifest.json`.

```
pip install earthengine-api
earthengine authenticate
python3 tools/make_manifest.py points.geojson data/my-batch --project YOUR_EE_PROJECT \
    --overlay ndwi --task-name flooding --question "Is there flooding?"
# open http://localhost:8000/?manifest=data/my-batch/manifest.json
```

Overlays: `shsi` (Spectral Herring Spawning Index, green²/red over clear water), `ndwi`, `ndvi`, or `none`.
Clear-sky checks use Cloud Score+.

## Example

`examples/herring-spawn/` holds five Sentinel-2 items from British Columbia (Copernicus data, processed in Google
Earth Engine): a large Strait of Georgia spawn (Kye Bay, 2022), a DFO-recorded spawn at Crabpot Pt (2019), two
unconfirmed Broughton Archipelago candidates, and one negative.
