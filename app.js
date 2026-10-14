(() => {
  'use strict';

  const L = window.PlaylistLib;
  const STORAGE_KEY = 'mv-playlist-editor:v1';
  const HISTORY_LIMIT = 100;
  const STATUS_LABEL = { planned: '기획', production: '제작 중', ready: '업로드 준비', uploaded: '업로드 완료' };

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#track-list');
  const form = $('#editor-form');

  let pl = load() || L.emptyPlaylist();
  let selectedId = null;
  let history = [];
  let editing = false; // 같은 입력창에서 이어지는 타이핑은 되돌리기 한 단계로 묶는다
  let dragId = null;
  let drop = null; // { id, after }
  let previewId; // undefined = 아직 그린 적 없음

  /* ---------- 저장 / 되돌리기 ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? L.normalizePlaylist(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = 0;
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pl));
    } catch (e) { /* 저장소를 못 쓰는 환경이면 세션 동안만 유지 */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  function pushHistory() {
    history.push(JSON.stringify(pl));
    if (history.length > HISTORY_LIMIT) history.shift();
    editing = false;
    $('#btn-undo').disabled = false;
  }

  // 같은 입력창에서 이어서 치는 동안에는 첫 변경 때 한 번만 기록한다.
  function touch() {
    if (editing) return;
    pushHistory();
    editing = true;
  }

  function undo() {
    const snap = history.pop();
    if (!snap) return;
    pl = JSON.parse(snap);
    if (!current()) selectedId = null;
    $('#btn-undo').disabled = history.length === 0;
    editing = false;
    saveNow();
    render();
  }

  function mutate(fn) {
    pushHistory();
    fn();
    save();
    render();
  }

  document.addEventListener('focusin', () => { editing = false; });

  /* ---------- 유틸 ---------- */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  const current = () => pl.tracks.find((t) => t.id === selectedId) || null;
  const indexOf = (id) => pl.tracks.findIndex((t) => t.id === id);

  let toastTimer = 0;
  function toast(msg, actionLabel, action, sticky) {
    const el = $('#toast');
    el.replaceChildren(h('span', { text: msg }));
    if (actionLabel) {
      el.append(h('button', { type: 'button', text: actionLabel, onclick: () => { hideToast(); action(); } }));
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 3500);
  }
  function hideToast() {
    $('#toast').hidden = true;
  }

  /* ---------- 렌더링 ---------- */

  function render() {
    fillHeader();
    renderStats();
    renderList();
    renderEditor();
  }

  function fillHeader() {
    $('#pl-title').value = pl.title;
    $('#pl-desc').value = pl.description;
  }

  function renderStats() {
    const { seconds, missing } = L.totalDuration(pl.tracks);
    const done = pl.tracks.filter((t) => t.status === 'uploaded').length;
    const parts = [pl.tracks.length + '곡'];
    parts.push('총 ' + L.formatDuration(seconds) + (missing ? ' (길이 미입력 ' + missing + '곡)' : ''));
    parts.push('업로드 ' + done + '/' + pl.tracks.length);
    $('#stats').textContent = parts.join(' · ');
  }

  function isFiltered() {
    return Boolean($('#q').value.trim() || $('#status-filter').value);
  }

  function visibleTracks() {
    const q = $('#q').value.trim().toLowerCase();
    const status = $('#status-filter').value;
    return pl.tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => (!status || t.status === status) && (!q || (t.title + ' ' + t.artist).toLowerCase().includes(q)));
  }

  function thumb(t) {
    const placeholder = () => h('div', { class: 'thumb', 'aria-hidden': 'true', text: '♪' });
    if (!t.videoId) return placeholder();
    const img = h('img', {
      class: 'thumb',
      src: 'https://i.ytimg.com/vi/' + t.videoId + '/mqdefault.jpg',
      alt: '',
      loading: 'lazy',
      draggable: 'false',
    });
    img.addEventListener('error', () => img.replaceWith(placeholder()));
    return img;
  }

  function rowEl(t, index, filtered) {
    const act = (name, text, title, disabled) =>
      h('button', { type: 'button', 'data-act': name, title, 'aria-label': title, text, disabled });
    return h('li',
      {
        class: 'row' + (t.id === selectedId ? ' selected' : ''),
        'data-id': t.id,
        tabindex: '0',
        draggable: filtered ? 'false' : 'true',
      },
      h('span', { class: 'handle', 'aria-hidden': 'true', title: '끌어서 순서 바꾸기', text: '⠿' }),
      h('span', { class: 'num', text: String(index + 1) }),
      thumb(t),
      h('div', { class: 'meta' },
        h('div', { class: 't' + (t.title ? '' : ' untitled'), text: t.title || '(제목 없음)' }),
        h('div', { class: 'a', text: t.artist || ' ' })),
      h('span', { class: 'dur' + (t.duration ? '' : ' missing'), text: t.duration ? L.formatDuration(t.duration) : '--:--' }),
      h('span', { class: 'badge s-' + t.status, text: STATUS_LABEL[t.status] }),
      h('div', { class: 'row-actions' },
        act('up', '↑', '위로', filtered || index === 0),
        act('down', '↓', '아래로', filtered || index === pl.tracks.length - 1),
        act('dup', '⧉', '복제'),
        act('del', '✕', '삭제')));
  }

  function renderList() {
    const filtered = isFiltered();
    const rows = visibleTracks();
    listEl.classList.toggle('filtered', filtered);
    listEl.replaceChildren(...rows.map(({ t, i }) => rowEl(t, i, filtered)));
    const empty = $('#empty');
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = pl.tracks.length
        ? '조건에 맞는 곡이 없어요.'
        : '아직 곡이 없어요. 유튜브 링크를 붙여넣거나, “📁 폴더에서 가져오기”로 영상 파일을 읽어오거나, “+ 업로드 예정 곡”으로 시작해 보세요.';
    }
  }

  function setPreview(id) {
    if (id === previewId) return;
    previewId = id;
    const box = $('#preview');
    if (!id) {
      box.replaceChildren(document.createTextNode('영상 링크를 넣으면 미리보기가 나와요'));
      return;
    }
    box.replaceChildren(h('iframe', {
      src: 'https://www.youtube-nocookie.com/embed/' + id,
      title: '미리보기',
      loading: 'lazy',
      allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture',
      referrerpolicy: 'strict-origin-when-cross-origin',
      allowfullscreen: true,
    }));
  }

  function updateOpenLink(t) {
    const a = $('#link-open');
    a.hidden = !t.videoId;
    if (t.videoId) a.href = L.videoUrl(t.videoId);
    else a.removeAttribute('href');
  }

  function renderEditor() {
    const t = current();
    $('#editor-empty').hidden = Boolean(t);
    form.hidden = !t;
    if (!t) {
      previewId = undefined;
      return;
    }
    fillEditorFields(t);
    setPreview(t.videoId);
    updateOpenLink(t);
  }

  function fillEditorFields(t) {
    const f = form.elements;
    f.title.value = t.title;
    f.artist.value = t.artist;
    f.url.value = t.url || (t.videoId ? L.videoUrl(t.videoId) : '');
    f.duration.value = t.duration ? L.formatDuration(t.duration) : '';
    f.duration.removeAttribute('aria-invalid');
    f.status.value = t.status;
    f.publishAt.value = t.publishAt;
    f.fileName.value = t.fileName;
    f.note.value = t.note;
  }

  function select(id, focusTitle) {
    selectedId = id;
    for (const row of listEl.children) row.classList.toggle('selected', row.dataset.id === id);
    renderEditor();
    if (focusTitle) form.elements.title.focus();
    else if (window.matchMedia('(max-width: 900px)').matches) {
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ---------- 곡 추가 / 편집 ---------- */

  async function fetchMeta(videoId) {
    try {
      const target = encodeURIComponent(L.videoUrl(videoId));
      const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + target);
      if (!res.ok) return null;
      const j = await res.json();
      return { title: String(j.title || ''), artist: String(j.author_name || '') };
    } catch (e) {
      return null; // 오프라인이거나 CORS가 막히면 직접 입력하면 된다
    }
  }

  // 비어 있는 칸만 채운다 (사용자가 쓴 값은 건드리지 않음)
  async function autofill(trackId, videoId) {
    const meta = await fetchMeta(videoId);
    const t = pl.tracks.find((x) => x.id === trackId);
    if (!meta || !t) return;
    if (!t.title) t.title = meta.title;
    if (!t.artist) t.artist = meta.artist;
    save();
    renderList();
    if (selectedId === trackId && !form.contains(document.activeElement)) fillEditorFields(t);
  }

  function addFromText(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const known = new Set(pl.tracks.map((t) => t.videoId).filter(Boolean));
    const added = [];
    const bad = [];
    let dup = 0;
    for (const line of lines) {
      const id = L.parseYouTubeId(line);
      if (!id) bad.push(line);
      else if (known.has(id)) dup++;
      else {
        known.add(id);
        added.push(L.newTrack({ url: L.videoUrl(id), videoId: id }));
      }
    }
    if (added.length) {
      mutate(() => pl.tracks.push(...added));
      select(added[added.length - 1].id);
      listEl.querySelector('[data-id="' + added[added.length - 1].id + '"]')?.scrollIntoView({ block: 'nearest' });
      added.forEach((t) => autofill(t.id, t.videoId));
    }
    const notes = [];
    if (added.length) notes.push(added.length + '곡 추가');
    if (dup) notes.push('이미 있는 영상 ' + dup + '개 건너뜀');
    if (bad.length) notes.push('링크를 인식하지 못한 줄 ' + bad.length + '개');
    if (notes.length) toast(notes.join(' · '));
    return bad.join('\n');
  }

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#add-input');
    if (!input.value.trim()) return;
    input.value = addFromText(input.value); // 인식 못한 줄은 남겨서 고칠 수 있게
  });
  $('#add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#add-form').requestSubmit();
    }
  });

  $('#btn-add-blank').addEventListener('click', () => {
    const t = L.newTrack({});
    mutate(() => pl.tracks.push(t));
    select(t.id, true);
  });

  /* ---------- 로컬 영상 파일 / 폴더 가져오기 ---------- */

  const VIDEO_PROBE_TIMEOUT_MS = 20000;
  const PROBE_CONCURRENCY = 3;
  let importing = false;

  // <video>가 메타데이터만 읽도록 해서 길이(초)를 얻는다. 파일은 서버로 가지 않고 메모리에 통째로 올리지도 않는다.
  function probeWithVideoElement(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), VIDEO_PROBE_TIMEOUT_MS);
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      video.onerror = () => finish(null);
      video.src = url;
    });
  }

  // MP4/MOV는 파일 머리말을 직접 읽어서(코덱과 무관) 길이를 구하고, 안 되면 <video>로 시도한다.
  async function probeDuration(file) {
    if (L.isMp4FileName(file.name)) {
      const read = async (start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer());
      const secs = await L.readMp4Duration(read, file.size);
      if (secs) return Math.round(secs);
    }
    const secs = await probeWithVideoElement(file);
    return secs ? Math.round(secs) : null;
  }

  async function importVideoFiles(fileList) {
    if (importing) return toast('이미 가져오는 중이에요. 끝난 뒤에 다시 시도해 주세요.');
    const videos = Array.from(fileList).filter((f) => (f.type || '').startsWith('video/') || L.isVideoFileName(f.name));
    if (!videos.length) return toast('영상 파일을 찾지 못했어요. (mp4, mov, mkv, webm 등)');

    const pathOf = (f) => f.webkitRelativePath || f.name;
    videos.sort((a, b) => pathOf(a).localeCompare(pathOf(b), undefined, { numeric: true, sensitivity: 'base' }));

    const known = new Set(pl.tracks.map((t) => t.fileName).filter(Boolean));
    const fresh = [];
    let dup = 0;
    for (const f of videos) {
      if (known.has(pathOf(f))) dup++;
      else {
        known.add(pathOf(f));
        fresh.push(f);
      }
    }
    if (!fresh.length) return toast('이미 목록에 있는 파일이에요. (' + dup + '개 건너뜀)');

    importing = true;
    $('#btn-add-folder').disabled = $('#btn-add-files').disabled = true;
    try {
      const durations = new Array(fresh.length).fill(null);
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < fresh.length) {
          const i = next++;
          try {
            durations[i] = await probeDuration(fresh[i]);
          } catch (e) {
            durations[i] = null;
          }
          toast('길이 읽는 중… ' + ++done + '/' + fresh.length, null, null, true);
        }
      };
      toast('길이 읽는 중… 0/' + fresh.length, null, null, true);
      await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, fresh.length) }, worker));

      const tracks = fresh.map((f, i) => {
        const { title, artist } = L.parseFileName(f.name);
        return L.newTrack({ title, artist, duration: durations[i], status: 'ready', fileName: pathOf(f) });
      });
      mutate(() => pl.tracks.push(...tracks));
      select(tracks[0].id);
      listEl.querySelector('[data-id="' + tracks[0].id + '"]')?.scrollIntoView({ block: 'nearest' });

      const unread = durations.filter((d) => d === null).length;
      const notes = [fresh.length + '곡 추가 (상태: 업로드 준비)'];
      if (unread) notes.push('길이를 못 읽은 파일 ' + unread + '개 — 직접 입력해 주세요');
      if (dup) notes.push('이미 있는 파일 ' + dup + '개 건너뜀');
      toast(notes.join(' · '), '되돌리기', undo);
    } finally {
      importing = false;
      $('#btn-add-folder').disabled = $('#btn-add-files').disabled = false;
    }
  }

  for (const [button, input] of [['#btn-add-folder', '#folder-input'], ['#btn-add-files', '#files-input']]) {
    $(button).addEventListener('click', () => $(input).click());
    $(input).addEventListener('change', (e) => {
      const files = Array.from(e.target.files); // value를 비우면 목록도 비워지므로 먼저 복사
      e.target.value = '';
      if (files.length) importVideoFiles(files);
    });
  }

  function removeTrack(id) {
    const i = indexOf(id);
    if (i < 0) return;
    const title = pl.tracks[i].title || '(제목 없음)';
    mutate(() => {
      pl.tracks.splice(i, 1);
      if (selectedId === id) selectedId = (pl.tracks[i] || pl.tracks[i - 1] || {}).id || null;
    });
    toast('“' + title + '” 삭제', '되돌리기', undo);
  }

  function duplicateTrack(id) {
    const i = indexOf(id);
    if (i < 0) return;
    const copy = L.newTrack(Object.assign({}, pl.tracks[i], { id: undefined }));
    mutate(() => pl.tracks.splice(i + 1, 0, copy));
    select(copy.id);
  }

  function moveTrack(id, delta) {
    const i = indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= pl.tracks.length) return;
    mutate(() => { pl.tracks = L.moveItem(pl.tracks, i, j); });
    // 연속으로 누를 수 있게 포커스 유지
    listEl.querySelector('[data-id="' + id + '"] [data-act="' + (delta < 0 ? 'up' : 'down') + '"]')?.focus();
  }

  /* ---------- 목록 이벤트 ---------- */

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const btn = e.target.closest('button[data-act]');
    const id = row.dataset.id;
    if (!btn) return select(id);
    ({
      up: () => moveTrack(id, -1),
      down: () => moveTrack(id, 1),
      dup: () => duplicateTrack(id),
      del: () => removeTrack(id),
    })[btn.dataset.act]();
  });

  listEl.addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(row.dataset.id);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isFiltered()) {
      e.preventDefault();
      const id = row.dataset.id;
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      moveTrack(id, delta);
      listEl.querySelector('[data-id="' + id + '"]')?.focus();
    } else if (e.key === 'Delete') {
      removeTrack(row.dataset.id);
    }
  });

  /* 드래그 앤 드롭 정렬 (터치 기기에서는 ↑↓ 버튼 사용) */
  function clearDropMarks() {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  }

  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.row');
    if (!row || isFiltered()) return e.preventDefault();
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    row.classList.add('dragging');
  });

  listEl.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
    drop = { id: row.dataset.id, after };
  });

  listEl.addEventListener('drop', (e) => {
    if (!dragId || !drop) return;
    e.preventDefault();
    const from = indexOf(dragId);
    const target = indexOf(drop.id);
    let to = drop.after ? target + 1 : target;
    if (from < to) to--;
    dragId = null;
    clearDropMarks();
    if (from !== to && from >= 0 && target >= 0) mutate(() => { pl.tracks = L.moveItem(pl.tracks, from, to); });
  });

  listEl.addEventListener('dragend', () => {
    dragId = null;
    drop = null;
    clearDropMarks();
    listEl.querySelectorAll('.dragging').forEach((r) => r.classList.remove('dragging'));
  });

  $('#q').addEventListener('input', renderList);
  $('#status-filter').addEventListener('change', renderList);

  /* ---------- 편집 패널 / 헤더 입력 ---------- */

  function setField(t, key, value) {
    if (t[key] === value) return false;
    touch();
    t[key] = value;
    return true;
  }

  form.addEventListener('input', (e) => {
    const t = current();
    const el = e.target;
    if (!t || !el.name) return;

    if (el.name === 'duration') {
      const raw = el.value.trim();
      const secs = raw ? L.parseDuration(raw) : null;
      if (raw && secs === null) return el.setAttribute('aria-invalid', 'true');
      el.removeAttribute('aria-invalid');
      setField(t, 'duration', secs || null);
    } else if (el.name === 'url') {
      setField(t, 'url', el.value.trim());
      const id = L.parseYouTubeId(el.value);
      if (setField(t, 'videoId', id)) {
        setPreview(id);
        updateOpenLink(t);
        if (id) autofill(t.id, id);
      }
    } else {
      setField(t, el.name, el.value);
    }
    save();
    renderStats();
    renderList();
  });

  // 길이 칸은 입력을 마치면 "225" → "3:45" 처럼 정리해서 보여준다
  form.elements.duration.addEventListener('change', (e) => {
    const t = current();
    if (t && !e.target.hasAttribute('aria-invalid')) e.target.value = t.duration ? L.formatDuration(t.duration) : '';
  });

  $('#btn-fetch').addEventListener('click', async () => {
    const t = current();
    if (!t || !t.videoId) return toast('먼저 유튜브 링크를 입력해 주세요.');
    const meta = await fetchMeta(t.videoId);
    if (!meta) return toast('정보를 불러오지 못했어요. (오프라인이거나 비공개 영상일 수 있어요)');
    const target = pl.tracks.find((x) => x.id === t.id);
    if (!target) return;
    mutate(() => { target.title = meta.title; target.artist = meta.artist; });
  });
  $('#btn-dup').addEventListener('click', () => selectedId && duplicateTrack(selectedId));
  $('#btn-del').addEventListener('click', () => selectedId && removeTrack(selectedId));

  $('#pl-title').addEventListener('input', (e) => {
    if (pl.title === e.target.value) return;
    touch();
    pl.title = e.target.value;
    save();
  });
  $('#pl-desc').addEventListener('input', (e) => {
    if (pl.description === e.target.value) return;
    touch();
    pl.description = e.target.value;
    save();
  });

  $('#btn-undo').addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
    }
  });

  /* ---------- 내보내기 / 가져오기 ---------- */

  const dialog = $('#export-dialog');
  const FORMATS = {
    chapters: { ext: 'txt', mime: 'text/plain', build: () => L.buildChapters(pl) },
    tracklist: { ext: 'txt', mime: 'text/plain', build: () => L.buildTracklist(pl) },
    json: { ext: 'json', mime: 'application/json', build: () => ({ text: L.toJSON(pl), warnings: [] }) },
    csv: { ext: 'csv', mime: 'text/csv', build: () => ({ text: L.toCSV(pl), warnings: [] }) },
  };

  function renderExport() {
    const { text, warnings } = FORMATS[$('#export-format').value].build();
    $('#export-text').value = text;
    $('#export-warnings').replaceChildren(...warnings.map((w) => h('li', { text: w })));
  }

  $('#btn-export').addEventListener('click', () => {
    renderExport();
    dialog.showModal();
  });
  $('#export-format').addEventListener('change', renderExport);

  $('#btn-copy').addEventListener('click', async () => {
    const ta = $('#export-text');
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch (e) {
      ta.select();
      document.execCommand('copy');
    }
    toast('복사했어요');
  });

  $('#btn-download').addEventListener('click', () => {
    const fmt = FORMATS[$('#export-format').value];
    const name = (pl.title || 'playlist').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    // CSV는 BOM이 있어야 엑셀에서 한글이 안 깨진다
    const body = (fmt.ext === 'csv' ? '﻿' : '') + $('#export-text').value;
    const url = URL.createObjectURL(new Blob([body], { type: fmt.mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: name + '.' + fmt.ext });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = L.normalizePlaylist(JSON.parse(await file.text()));
      mutate(() => { pl = next; selectedId = null; });
      toast('“' + file.name + '”에서 ' + next.tracks.length + '곡을 가져왔어요', '되돌리기', undo);
    } catch (err) {
      toast('가져오지 못했어요: ' + err.message);
    }
  });

  /* ---------- 시작 ---------- */
  render();
})();
