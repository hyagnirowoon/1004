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
  assert.equal(rows[0], '순서,제목,아티스트,링크,길이,상태,공개 예정일,메모,파일명');
  assert.equal(rows[1], `1,Intro,Me,https://www.youtube.com/watch?v=${ID},1:05,planned,,,`);
  assert.equal(rows[2], '2,"Song, ""Two""",Me,,3:20,planned,,,');
});

test('toJSON ↔ normalizePlaylist 왕복', () => {
  const original = L.normalizePlaylist(sample());
  const again = L.normalizePlaylist(JSON.parse(L.toJSON(original)));
  assert.deepEqual(again, original);
});

test('isVideoFileName / parseFileName', () => {
  assert.equal(L.isVideoFileName('a.MP4'), true);
  assert.equal(L.isVideoFileName('a.mkv'), true);
  assert.equal(L.isVideoFileName('cover.jpg'), false);
  assert.equal(L.isVideoFileName('notes.txt'), false);
  assert.equal(L.isVideoFileName('mp4'), false);

  const cases = [
    ['01 - Alpha Song.mp4', '', 'Alpha Song'],
    ['Band A - Alpha.mov', 'Band A', 'Alpha'],
    ['03_Charlie_Final.mkv', '', 'Charlie Final'],
    ['02. Intro.mp4', '', 'Intro'],
    ['50 Cent - In Da Club.mp4', '50 Cent', 'In Da Club'],
    ['2NE1 - Fire.mp4', '2NE1', 'Fire'],
    ['1-800-Song.mp4', '', '1-800-Song'],
    ['3.14 Pi Song.mp4', '', '3.14 Pi Song'],
    ['Artist - Title - Remix.webm', 'Artist', 'Title - Remix'],
    ['Artist – Title.mp4', 'Artist', 'Title'],
    ['Song Vol.2.mp4', '', 'Song Vol.2'],
    ['no_extension_name', '', 'no extension name'],
    ['한글 가수 - 한글 제목.mp4', '한글 가수', '한글 제목'],
  ];
  for (const [input, artist, title] of cases) {
    assert.deepEqual(L.parseFileName(input), { artist, title }, input);
  }
});

// ---- MP4 길이 읽기 ----
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};
const mvhdV0 = (timescale, duration) => box('mvhd', Buffer.alloc(4), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80));
const mvhdV1 = (timescale, duration) => {
  const dur = Buffer.alloc(8);
  dur.writeBigUInt64BE(BigInt(duration));
  const ver = Buffer.from([1, 0, 0, 0]);
  return box('mvhd', ver, Buffer.alloc(16), u32(timescale), dur, Buffer.alloc(80));
};
const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0), Buffer.from('isom', 'latin1'));
const trak = box('trak', Buffer.alloc(200));
const bufReader = (buf) => async (start, len) => new Uint8Array(buf.subarray(start, start + len));

test('readMp4Duration: moov가 앞/뒤에 있는 경우, v0/v1 mvhd', async () => {
  const front = Buffer.concat([ftyp, box('moov', mvhdV0(1000, 225500), trak), box('mdat', Buffer.alloc(500))]);
  assert.equal(await L.readMp4Duration(bufReader(front), front.length), 225.5);

  const back = Buffer.concat([ftyp, box('free', Buffer.alloc(40)), box('mdat', Buffer.alloc(5000)), box('moov', trak, mvhdV1(600, 600 * 3723))]);
  assert.equal(await L.readMp4Duration(bufReader(back), back.length), 3723);
});

test('readMp4Duration: mdat가 5GB여도 몇 번만 읽는다 (64비트 크기)', async () => {
  const mdatSize = 0x140000000; // 5GiB
  const sizeField = Buffer.alloc(8);
  sizeField.writeBigUInt64BE(BigInt(mdatSize));
  const bigMdatHeader = Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), sizeField]);
  const moov = box('moov', mvhdV0(1000, 210000));
  const moovStart = ftyp.length + mdatSize;
  const size = moovStart + moov.length;
  let reads = 0;
  let bytes = 0;
  const read = async (start, len) => {
    reads++;
    bytes += len;
    const out = Buffer.alloc(Math.max(0, Math.min(len, size - start)));
    const put = (at, data) => {
      const from = Math.max(start, at);
      const to = Math.min(start + out.length, at + data.length);
      if (to > from) data.copy(out, from - start, from - at, to - at);
    };
    put(0, ftyp);
    put(ftyp.length, bigMdatHeader);
    put(moovStart, moov);
    return new Uint8Array(out);
  };
  assert.equal(await L.readMp4Duration(read, size), 210);
  assert.ok(reads <= 10, 'reads=' + reads);
  assert.ok(bytes < 500, 'bytes=' + bytes);
});

test('readMp4Duration: 읽을 수 없으면 null', async () => {
  const none = [
    Buffer.alloc(0),
    Buffer.from('this is not an mp4 file at all, just text'),
    Buffer.concat([ftyp, box('mdat', Buffer.alloc(100))]), // moov 없음
    Buffer.concat([ftyp, box('moov', trak)]), // mvhd 없음
    Buffer.concat([ftyp, box('moov', mvhdV0(1000, 0))]), // 조각난 MP4: 길이 0
    Buffer.concat([ftyp, box('moov', mvhdV0(0, 1000))]),
    Buffer.concat([ftyp, box('moov', mvhdV0(1000, 0xffffffff))]),
    Buffer.concat([ftyp, Buffer.from([0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76])]), // 크기가 머리말보다 작은 깨진 박스
  ];
  for (const buf of none) assert.equal(await L.readMp4Duration(bufReader(buf), buf.length), null);
  assert.equal(await L.readMp4Duration(async () => { throw new Error('io'); }, 100), null);
});

test('normalizeTrack: fileName 보존', () => {
  assert.equal(L.normalizeTrack({ fileName: ' MV/01 - Intro.mp4 ' }).fileName, 'MV/01 - Intro.mp4');
  assert.equal(L.normalizeTrack({}).fileName, '');
});
