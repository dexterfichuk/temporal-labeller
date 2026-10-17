// Spawn Labeller: label satellite detections as spawn / not spawn / unsure.
// Labels live in this browser (localStorage) and export as OlmoEarth GeoJSON, CSV or a labels file.
(() => {
  const PRELOAD = 4;
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let ALL = [], view = [], idx = 0, labels = {}, key = '', taskName = 'herring_spawn', manifestName = '';

  const SENSOR = { S2: 'Sentinel-2', L89: 'Landsat 8/9', L: 'Landsat 8/9', PS: 'PlanetScope' };
  const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const daysBefore = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

  // Accepts either explicit `frames` or the sat-watch manifest fields (ref, prev, det_url, overlay_url).
  function framesOf(d, base) {
    const abs = u => (u ? new URL(u, base).href : null);
    if (Array.isArray(d.frames)) return d.frames.map(f => ({ ...f, src: abs(f.src) }));
    const out = [];
    if (d.ref) out.push({ title: 'About a month before', date: d.ref.date, src: abs(d.ref.url || d.ref.src), sub: daysBefore(d.ref.date, d.date) + ' d before' });
    const prev = (d.prev || []).filter(p => !d.ref || p.date !== d.ref.date);
    if (!prev.length && !d.ref) out.push({ title: 'Previous pass', date: null, src: null });
    prev.forEach((p, i) => out.push({ title: i === prev.length - 1 ? 'Previous pass' : 'Earlier pass', date: p.date, src: abs(p.url || p.src), sub: daysBefore(p.date, d.date) + ' d before' }));
    out.push({ title: 'Detection', date: d.date, src: abs(d.det_url), sub: 'true colour', det: true });
    if (d.overlay_url) out.push({ title: 'Detection + hits', date: d.date, src: abs(d.overlay_url), sub: 'cyan = flagged, red = patch', det: true });
    return out;
  }

  async function loadManifest(json, name, base) {
    const items = Array.isArray(json) ? json : json.items;
    if (!Array.isArray(items)) throw new Error('Manifest must be a list of items or { "items": [...] }');
    taskName = (!Array.isArray(json) && json.task_name) || 'herring_spawn';
    manifestName = (!Array.isArray(json) && json.name) || name;
    ALL = items.filter(d => d && d.id && d.date && d.lat != null && d.lon != null).map(d => ({ ...d, _frames: framesOf(d, base) }));
    key = 'spawn-labeller:' + manifestName;
    labels = JSON.parse(store.get(key) || '{}');
    $('title').textContent = (!Array.isArray(json) && json.title) || 'Spawn Labeller';
    $('app').hidden = false; $('empty').hidden = true;
    const f0 = store.get(key + ':filter'); if (f0) $('filter').value = f0;
    view = ALL.slice(); idx = 0; applyFilter();
    const p0 = store.get(key + ':pos'); const k = view.findIndex(d => d.id === p0); if (k >= 0) { idx = k; render(); }
  }

  function applyFilter() {
    const f = $('filter').value, cur = view[idx] && view[idx].id;
    const lab = d => (labels[d.id] || {}).label;
    view = ALL.filter(d => f === 'all' ? true : f === 'unlabeled' ? !lab(d)
      : f === 'negative' ? d.kind === 'negative' : f === 'positive' ? d.kind !== 'negative' : lab(d) === f);
    const keep = view.findIndex(d => d.id === cur);
    idx = keep >= 0 ? keep : Math.max(0, Math.min(idx, view.length - 1));
    store.set(key + ':filter', f);
    render();
  }

  function render() {
    const d = view[idx];
    $('prev').disabled = idx <= 0; $('next').disabled = idx >= view.length - 1;
    $('pos').textContent = view.length ? `${idx + 1} of ${view.length}` : '0 of 0';
    const strip = $('strip'); strip.textContent = '';
    if (!d) { $('facts').textContent = 'Nothing left in this view.'; renderLabel(); return; }
    strip.style.setProperty('--n', Math.min(d._frames.length, 5));
    for (const f of d._frames) {
      const fig = document.createElement('figure'); fig.className = 'frame' + (f.det ? ' det' : ''); fig.tabIndex = 0;
      const box = document.createElement('div'); box.className = 'img';
      if (f.src) {
        const im = document.createElement('img'); im.src = f.src; im.alt = `${f.title}${f.date ? ', ' + f.date : ''}`; im.decoding = 'async';
        im.onerror = () => { box.textContent = ''; const m = document.createElement('div'); m.className = 'missing'; m.textContent = 'Image unavailable (link may have expired)'; box.append(m); };
        box.append(im);
        fig.onclick = fig.onkeydown = e => { if (e.type === 'click' || e.key === 'Enter') openZoom(f.src, `${f.title}${f.date ? ' · ' + fmtDate(f.date) : ''}`); };
      } else { const m = document.createElement('div'); m.className = 'missing'; m.textContent = 'No clear pass before'; box.append(m); }
      const cap = document.createElement('figcaption');
      const b = document.createElement('b');
      // Phones get short captions so the label buttons stay on screen.
      const short = f.det ? (f.title === 'Detection' ? 'Detection' : 'Hits') : (f.sub || f.title);
      b.textContent = matchMedia('(max-width: 760px)').matches ? short : (f.date ? `${f.title} · ${fmtDate(f.date)}` : f.title);
      const s = document.createElement('span'); s.textContent = f.sub || '';
      cap.append(b, s); fig.append(box, cap); strip.append(fig);
    }
    renderFacts(d); renderLabel(); preload();
    store.set(key + ':pos', d.id);
  }

  function renderFacts(d) {
    const el = $('facts'); el.textContent = '';
    const h = document.createElement('p'); h.className = 'place'; h.textContent = d.place || 'Unnamed spot'; el.append(h);
    const chips = document.createElement('div'); chips.className = 'chips';
    const add = (t, c) => { if (!t) return; const s = document.createElement('span'); s.className = 'chip' + (c ? ' ' + c : ''); s.textContent = t; chips.append(s); };
    add(d.status, d.status === 'dfo_confirmed' ? 'dfo' : '');
    if (d.kind === 'negative') add('Negative');
    if (d.missed_spawn) add('Possible missed spawn', 'miss');
    add(SENSOR[d.sensor] || d.sensor);
    el.append(chips);
    const dl = document.createElement('dl');
    const row = (k, v, link) => { if (v == null || v === '') return; const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd');
      if (link) { const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = v; dd.append(a); } else dd.textContent = v; dl.append(dt, dd); };
    row('Date', fmtDate(d.date));
    row('Location', `${(+d.lat).toFixed(4)}, ${(+d.lon).toFixed(4)}`, `https://www.google.com/maps/@${d.lat},${d.lon},14z/data=!3m1!1e3`);
    const area = d.area_m2 ?? d.hot_m2;
    if (area != null) row('Patch area', area >= 10000 ? `${(area / 10000).toFixed(1)} ha` : `${Math.round(area).toLocaleString()} m²`);
    if (d.shsi_mean != null) row('SHSI', `mean ${(+d.shsi_mean).toFixed(2)}${d.shsi_max != null ? ` · max ${(+d.shsi_max).toFixed(2)}` : ''}`);
    if (d.dshsi_mean != null) row('Change vs Feb', `+${(+d.dshsi_mean).toFixed(2)} SHSI`);
    if (d.km_station != null) row('Distance', `${d.km_station} km from station`);
    row('DFO record', d.dfo_match || 'None nearby');
    row('ID', d.id);
    el.append(dl);
    if (d.note) { const p = document.createElement('p'); p.className = 'note'; p.textContent = d.note; el.append(p); }
  }

  function renderLabel() {
    const d = view[idx], l = d && labels[d.id];
    document.querySelectorAll('.choice').forEach(b => { const on = !!l && l.label === b.dataset.v; b.classList.toggle('on', on); b.disabled = !d; b.setAttribute('aria-pressed', String(on)); });
    const note = $('note'); note.disabled = !d;
    if (document.activeElement !== note) note.value = (l && l.note) || '';
    setStatus(l && l.at ? `Saved in this browser ${new Date(l.at).toLocaleString()}` : '');
    renderProgress();
  }

  function renderProgress() {
    const n = { spawn: 0, not: 0, unsure: 0 };
    ALL.forEach(d => { const l = labels[d.id]; if (l && n[l.label] != null) n[l.label]++; });
    const bar = $('bar'); bar.textContent = '';
    [['spawn', 'var(--spawn)'], ['not', 'var(--not)'], ['unsure', 'var(--unsure)']].forEach(([k, c]) => {
      const i = document.createElement('i'); i.style.width = (100 * n[k] / Math.max(ALL.length, 1)) + '%'; i.style.background = c; bar.append(i); });
    $('counts').textContent = `${n.spawn + n.not + n.unsure}/${ALL.length} labelled · ${n.spawn} spawn · ${n.not} not · ${n.unsure} unsure`;
  }

  function preload() {
    for (let k = 1; k <= PRELOAD; k++) { const d = view[idx + k]; if (!d) break;
      d._frames.forEach(f => { if (f.src) { const im = new Image(); im.decoding = 'async'; im.src = f.src; } }); }
  }

  function setStatus(t, ok = true) { const s = $('status'); s.textContent = t; s.classList.toggle('err', !ok); }

  function save(id, patch) {
    labels[id] = { ...(labels[id] || {}), ...patch, at: Date.now() };
    store.set(key, JSON.stringify(labels));
    renderLabel();
  }

  function choose(v) {
    const d = view[idx]; if (!d) return;
    save(d.id, { label: v, note: $('note').value.trim() });
    if ($('filter').value === 'unlabeled') applyFilter();
    else if (idx < view.length - 1) setTimeout(() => { idx++; render(); }, 250);
  }

  let noteTimer;
  $('note').addEventListener('input', () => { clearTimeout(noteTimer); const d = view[idx]; if (!d) return;
    noteTimer = setTimeout(() => { if (labels[d.id] || $('note').value.trim()) save(d.id, { label: (labels[d.id] || {}).label || 'unsure', note: $('note').value.trim() }); }, 800); });

  document.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => choose(b.dataset.v)));
  $('prev').onclick = () => { if (idx > 0) { idx--; render(); } };
  $('next').onclick = () => { if (idx < view.length - 1) { idx++; render(); } };
  $('filter').onchange = applyFilter;

  function openZoom(src, cap) { $('zoomPic').src = src; $('zoomCap').textContent = cap; $('zoom').hidden = false; }
  $('zoom').onclick = () => { $('zoom').hidden = true; };

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || !ALL.length) return;
    if (!$('zoom').hidden && e.key === 'Escape') { $('zoom').hidden = true; return; }
    if (e.key === 'ArrowRight') $('next').click();
    else if (e.key === 'ArrowLeft') $('prev').click();
    else if (e.key === '1') choose('spawn');
    else if (e.key === '2') choose('not');
    else if (e.key === '3') choose('unsure');
  });

  // ---- export / import ----
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stem = () => (manifestName || 'labels').replace(/\.json$/i, '').replace(/[^\w.-]+/g, '_');

  // OlmoEarth point format: task_name, observation_time, sample_true_false. Unsure items are left out.
  $('exportGeo').onclick = () => {
    const features = ALL.filter(d => ['spawn', 'not'].includes((labels[d.id] || {}).label)).map(d => ({
      type: 'Feature',
      properties: { task_name: taskName, observation_time: `${d.date}T00:00:00Z`, sample_true_false: labels[d.id].label === 'spawn' },
      geometry: { type: 'Point', coordinates: [+(+d.lon).toFixed(5), +(+d.lat).toFixed(5)] },
    }));
    download(`${stem()}_olmoearth.geojson`, JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/geo+json');
  };
  $('exportCsv').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['id', 'date', 'lat', 'lon', 'label', 'note', 'place', 'status', 'sensor'].join(',')];
    ALL.forEach(d => { const l = labels[d.id] || {}; rows.push([d.id, d.date, d.lat, d.lon, l.label, l.note, d.place, d.status, d.sensor].map(q).join(',')); });
    download(`${stem()}_labels.csv`, rows.join('\n'), 'text/csv');
  };
  $('exportLabels').onclick = () => download(`${stem()}_labels.json`, JSON.stringify({ manifest: manifestName, labels }, null, 2), 'application/json');
  $('importLabels').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text()); const incoming = j.labels || j;
      let n = 0; for (const [id, v] of Object.entries(incoming)) if (v && v.label) { labels[id] = v; n++; }
      store.set(key, JSON.stringify(labels)); applyFilter(); setStatus(`Loaded ${n} labels`);
    } catch { setStatus('That file is not a labels file.', false); }
    e.target.value = '';
  };
  $('loadManifest').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { await loadManifest(JSON.parse(await file.text()), file.name, location.href); }
    catch (err) { alert('Could not read that manifest: ' + err.message); }
    e.target.value = '';
  };

  const url = new URLSearchParams(location.search).get('manifest');
  if (url) fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); })
    .then(j => loadManifest(j, url, new URL(url, location.href).href))
    .catch(err => { $('empty').hidden = false; $('empty').firstElementChild.textContent = `Could not load ${url}: ${err.message}`; });
})();
