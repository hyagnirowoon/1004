/* 플레이리스트 편집기 핵심 로직 (DOM 의존 없음 — 브라우저/Node 양쪽에서 사용) */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.PlaylistLib = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUSES = ['planned', 'production', 'ready', 'uploaded'];
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const str = (v) => (v == null ? '' : String(v)).trim();

  let seq = 0;
  function makeId() {
    return 't' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- YouTube ---------- */

  // 링크(watch / youtu.be / shorts / embed / music.youtube.com)나 11자리 영상 ID에서 ID를 뽑는다.
  function parseYouTubeId(input) {
    const s = str(input);
    if (!s) return null;
    if (ID_RE.test(s)) return s;
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s);
    } catch (e) {
      return null;
    }
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/')[1] || '';
      return ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && ID_RE.test(v)) return v;
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
    return null;
  }

  const videoUrl = (id) => 'https://www.youtube.com/watch?v=' + id;
  const shortUrl = (id) => 'https://youtu.be/' + id;

  /* ---------- 길이 ---------- */

  // "3:45", "1:02:03", "225"(초) → 초. 해석할 수 없으면 null.
  function parseDuration(input) {
    const s = str(input);
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const parts = s.split(':');
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    if (parts.slice(1).some((p) => parseInt(p, 10) >= 60)) return null;
    return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = String(sec % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }

  function totalDuration(tracks) {
    let seconds = 0;
    let missing = 0;
    for (const t of tracks) {
      if (t.duration) seconds += t.duration;
      else missing++;
    }
    return { seconds, missing };
  }

  /* ---------- 데이터 모델 ---------- */

  function emptyPlaylist() {
    return { title: '', description: '', tracks: [] };
  }

  function normalizeTrack(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const url = str(r.url);
    const duration = Math.round(Number(r.duration));
    return {
      id: str(r.id) || makeId(),
      title: str(r.title),
      artist: str(r.artist),
      url,
      videoId: parseYouTubeId(r.videoId) || parseYouTubeId(url),
      duration: duration > 0 ? duration : null,
      status: STATUSES.includes(r.status) ? r.status : 'planned',
      publishAt: DATE_RE.test(str(r.publishAt)) ? str(r.publishAt) : '',
      note: str(r.note),
    };
  }

  // 저장본/가져온 JSON을 안전한 형태로 정리한다. 형식이 틀리면 Error.
  function normalizePlaylist(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) {
      throw new Error('플레이리스트 형식이 아니에요 (tracks 배열이 없어요)');
    }
    const seen = new Set();
    const tracks = raw.tracks.map((t) => {
      const track = normalizeTrack(t);
      if (seen.has(track.id)) track.id = makeId();
      seen.add(track.id);
      return track;
    });
    return {
      title: str(raw.title),
      description: raw.description == null ? '' : String(raw.description),
      tracks,
    };
  }

  function newTrack(partial) {
    return normalizeTrack(Object.assign({ id: makeId() }, partial));
  }

  function moveItem(arr, from, to) {
    const copy = arr.slice();
    if (from === to || from < 0 || from >= copy.length) return copy;
    const [item] = copy.splice(from, 1);
    copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
    return copy;
  }

  /* ---------- 내보내기 ---------- */

  const label = (t) => {
    const title = t.title || '(제목 없음)';
    return t.artist ? t.artist + ' - ' + title : title;
  };

  const withDescription = (pl, body) => [str(pl.description), body].filter(Boolean).join('\n\n');

  // 하나의 긴 영상(모음집)에 붙일 챕터 타임스탬프 설명문.
  // YouTube 챕터 조건: 0:00에서 시작, 3개 이상, 각 챕터 10초 이상.
  function buildChapters(pl) {
    const tracks = pl.tracks;
    const warnings = [];
    const lines = [];
    let start = 0;
    let known = true;
    let firstMissing = 0;

    tracks.forEach((t, i) => {
      lines.push((known ? formatDuration(start) : '--:--') + ' ' + label(t));
      if (!t.duration) {
        if (known) firstMissing = i + 1;
        known = false;
      } else if (known) {
        start += t.duration;
      }
    });

    if (tracks.length === 0) warnings.push('곡이 없어요.');
    else if (tracks.length < 3) warnings.push('YouTube 챕터는 타임스탬프가 3개 이상 필요해요.');
    if (firstMissing) {
      warnings.push(firstMissing + '번 곡의 길이가 없어서 그 뒤 타임스탬프(--:--)를 계산할 수 없어요.');
    }
    tracks.forEach((t, i) => {
      if (t.duration && t.duration < 10 && i < tracks.length - 1) {
        warnings.push((i + 1) + '번 곡이 10초보다 짧아요. 챕터는 최소 10초여야 해요.');
      }
    });

    return { text: withDescription(pl, lines.join('\n')), warnings };
  }

  // 개별 영상으로 올린 곡들의 번호 + 링크 목록.
  function buildTracklist(pl, opts) {
    const withLinks = !opts || opts.withLinks !== false;
    const lines = pl.tracks.map((t, i) => {
      const head = (i + 1) + '. ' + label(t);
      return withLinks && t.videoId ? head + '\n   ' + shortUrl(t.videoId) : head;
    });
    const warnings = [];
    if (withLinks) {
      const unlinked = pl.tracks.map((t, i) => (t.videoId ? 0 : i + 1)).filter(Boolean);
      if (unlinked.length) warnings.push(unlinked.join(', ') + '번 곡은 아직 영상 링크가 없어요.');
    }
    return { text: withDescription(pl, lines.join('\n')), warnings };
  }

  function toJSON(pl) {
    return JSON.stringify({ version: 1, title: pl.title, description: pl.description, tracks: pl.tracks }, null, 2);
  }

  function toCSV(pl) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['순서', '제목', '아티스트', '링크', '길이', '상태', '공개 예정일', '메모']];
    pl.tracks.forEach((t, i) => {
      rows.push([
        i + 1,
        t.title,
        t.artist,
        t.url || (t.videoId ? videoUrl(t.videoId) : ''),
        t.duration ? formatDuration(t.duration) : '',
        t.status,
        t.publishAt,
        t.note,
      ]);
    });
    return rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  return {
    STATUSES,
    parseYouTubeId,
    videoUrl,
    shortUrl,
    parseDuration,
    formatDuration,
    totalDuration,
    emptyPlaylist,
    normalizeTrack,
    normalizePlaylist,
    newTrack,
    moveItem,
    buildChapters,
    buildTracklist,
    toJSON,
    toCSV,
  };
});
