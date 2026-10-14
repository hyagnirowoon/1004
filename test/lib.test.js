'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeId: 다양한 링크 형식', () => {
  const ok = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&list=PL123&t=30s`,
    `youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `  ${ID}  `,
  ];
  for (const input of ok) assert.equal(L.parseYouTubeId(input), ID, input);
});

test('parseYouTubeId: 영상이 아닌 입력은 null', () => {
  const bad = ['', null, undefined, 'hello', 'https://example.com/watch?v=' + ID, 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=short', 'https://youtu.be/'];
  for (const input of bad) assert.equal(L.parseYouTubeId(input), null, String(input));
});

test('parseDuration / formatDuration', () => {
  assert.equal(L.parseDuration('3:45'), 225);
  assert.equal(L.parseDuration('1:02:03'), 3723);
  assert.equal(L.parseDuration('225'), 225);
  assert.equal(L.parseDuration(' 0:09 '), 9);
  assert.equal(L.parseDuration(''), null);
  assert.equal(L.parseDuration('3:'), null);
  assert.equal(L.parseDuration('3:75'), null);
  assert.equal(L.parseDuration('a:12'), null);
  assert.equal(L.parseDuration('1:2:3:4'), null);

  assert.equal(L.formatDuration(0), '0:00');
  assert.equal(L.formatDuration(9), '0:09');
  assert.equal(L.formatDuration(225), '3:45');
  assert.equal(L.formatDuration(3723), '1:02:03');
  assert.equal(L.formatDuration(L.parseDuration('59:59')), '59:59');
});

test('moveItem: 원본을 바꾸지 않고 순서를 옮긴다', () => {
  const a = [1, 2, 3, 4];
  assert.deepEqual(L.moveItem(a, 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(L.moveItem(a, 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(L.moveItem(a, 1, 1), a);
  assert.deepEqual(L.moveItem(a, 9, 0), a);
  assert.deepEqual(a, [1, 2, 3, 4]);
});

test('normalizeTrack: 잘못된 값을 안전하게 정리', () => {
  const t = L.normalizeTrack({ title: '  곡  ', url: `https://youtu.be/${ID}`, duration: '215', status: 'bogus', publishAt: '내일' });
  assert.equal(t.title, '곡');
  assert.equal(t.videoId, ID);
  assert.equal(t.duration, 215);
  assert.equal(t.status, 'planned');
  assert.equal(t.publishAt, '');
  assert.ok(t.id);
  assert.equal(L.normalizeTrack({ duration: -5 }).duration, null);
  assert.equal(L.normalizeTrack(null).title, '');
});

test('normalizePlaylist: 형식 검증과 id 중복 제거', () => {
  assert.throws(() => L.normalizePlaylist({}), /tracks/);
  assert.throws(() => L.normalizePlaylist(null));
  const pl = L.normalizePlaylist({ title: 'A', tracks: [{ id: 'x', title: '1' }, { id: 'x', title: '2' }] });
  assert.equal(pl.tracks.length, 2);
  assert.notEqual(pl.tracks[0].id, pl.tracks[1].id);
});

const sample = () => ({
  title: '내 앨범',
  description: '신곡 모음',
  tracks: [
    L.newTrack({ title: 'Intro', artist: 'Me', duration: 65, videoId: ID }),
    L.newTrack({ title: 'Song, "Two"', artist: 'Me', duration: 200 }),
    L.newTrack({ title: 'Outro', duration: 3723 }),
  ],
});

test('buildChapters: 누적 타임스탬프', () => {
  const { text, warnings } = L.buildChapters(sample());
  assert.equal(text, '신곡 모음\n\n0:00 Me - Intro\n1:05 Me - Song, "Two"\n4:25 Outro');
  assert.deepEqual(warnings, []);
});

test('buildChapters: 경고 (3곡 미만, 길이 누락, 10초 미만)', () => {
  const two = { description: '', tracks: sample().tracks.slice(0, 2) };
  assert.match(L.buildChapters(two).warnings[0], /3개 이상/);

  const gap = sample();
  gap.tracks[1].duration = null;
  const r = L.buildChapters(gap);
  assert.match(r.text, /^신곡 모음\n\n0:00 Me - Intro\n1:05 Me - Song, "Two"\n--:-- Outro$/);
  assert.ok(r.warnings.some((w) => w.startsWith('2번 곡의 길이가 없어서')));

  const short = sample();
  short.tracks[0].duration = 5;
  assert.ok(L.buildChapters(short).warnings.some((w) => w.startsWith('1번 곡이 10초보다 짧아요')));

  assert.deepEqual(L.buildChapters({ description: '', tracks: [] }).warnings, ['곡이 없어요.']);
});

test('buildTracklist: 링크 포함/미포함', () => {
  const r = L.buildTracklist(sample());
  assert.equal(r.text, `신곡 모음\n\n1. Me - Intro\n   https://youtu.be/${ID}\n2. Me - Song, "Two"\n3. Outro`);
  assert.deepEqual(r.warnings, ['2, 3번 곡은 아직 영상 링크가 없어요.']);
  assert.equal(L.buildTracklist(sample(), { withLinks: false }).text, '신곡 모음\n\n1. Me - Intro\n2. Me - Song, "Two"\n3. Outro');
});

test('toCSV: 쉼표·따옴표 이스케이프', () => {
  const rows = L.toCSV(sample()).split('\r\n');
  assert.equal(rows[0], '순서,제목,아티스트,링크,길이,상태,공개 예정일,메모');
  assert.equal(rows[1], `1,Intro,Me,https://www.youtube.com/watch?v=${ID},1:05,planned,,`);
  assert.equal(rows[2], '2,"Song, ""Two""",Me,,3:20,planned,,');
});

test('toJSON ↔ normalizePlaylist 왕복', () => {
  const original = L.normalizePlaylist(sample());
  const again = L.normalizePlaylist(JSON.parse(L.toJSON(original)));
  assert.deepEqual(again, original);
});
