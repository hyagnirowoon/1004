"use strict";
// 딸깍 영상 편집기 — 브라우저 Canvas + MediaRecorder로 소스를 합성한다. 서버·외부 라이브러리 없음.

const $ = (s) => document.querySelector(s);
const FONT = '"Pretendard","Noto Sans KR","Apple SD Gothic Neo",sans-serif';
const SIZES = { "9:16": [720, 1280], "16:9": [1280, 720] };
const STYLE_NAMES = { clean: "깔끔", pop: "모션" };
const INTRO_SEC = 1.5;
const FPS = 30;

let sharedAC = null; // 영상 요소의 오디오 소스는 한 번만 만들 수 있어 컨텍스트를 공유한다
const audioCtx = () => (sharedAC = sharedAC || new (window.AudioContext || window.webkitAudioContext)());

const state = { items: [], nextId: 1, lastSettings: null, runs: 0 };

/* ---------- 소스 목록 ---------- */

const collator = new Intl.Collator("ko", { numeric: true });

async function addFiles(fileList) {
  const files = Array.from(fileList); // 입력창을 비우면 FileList도 비워지므로 먼저 복사
  const added = [];
  for (const file of files) {
    const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
    if (!kind) continue;
    const url = URL.createObjectURL(file);
    const el = await loadMedia(kind, url);
    added.push({ id: state.nextId++, file, kind, url, el, duration: kind === "video" ? el.duration : 0, caption: "", note: "", use: true });
  }
  state.items.push(...added);
  state.items.sort((a, b) => collator.compare(a.file.name, b.file.name));
  renderList();
}

function loadMedia(kind, url) {
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 열 수 없습니다"));
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "auto";
      v.playsInline = true;
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error("영상을 열 수 없습니다"));
      v.src = url;
    }
  });
}

function renderList() {
  const ul = $("#list");
  ul.innerHTML = "";
  state.items.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "item" + (it.use ? "" : " off");
    const thumb = it.kind === "video" ? `<video class="thumb" src="${it.url}#t=0.1" muted preload="metadata"></video>` : `<img class="thumb" src="${it.url}" alt="">`;
    li.innerHTML = `
      <span class="badge">${i + 1}번</span>
      ${thumb}
      <div class="meta">
        <div class="name">${esc(it.file.name)} · ${it.kind === "video" ? "영상 " + it.duration.toFixed(1) + "초" : "사진"}</div>
        <input type="text" data-k="caption" placeholder="자막 (선택)" value="${esc(it.caption)}">
        <input type="text" data-k="note" placeholder="메모: 재촬영본? 말실수 있음?" value="${esc(it.note)}">
        <label class="chk"><input type="checkbox" data-k="use" ${it.use ? "checked" : ""}> 사용</label>
      </div>
      <div class="btns">
        <button class="mini" data-a="up" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="mini" data-a="down" ${i === state.items.length - 1 ? "disabled" : ""}>▼</button>
        <button class="mini" data-a="del">삭제</button>
      </div>`;
    li.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (k === "use") { it.use = e.target.checked; li.classList.toggle("off", !it.use); updateSummary(); }
      else it[k] = e.target.value;
    });
    li.addEventListener("click", (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === "del") state.items.splice(i, 1);
      else { const j = a === "up" ? i - 1 : i + 1; [state.items[i], state.items[j]] = [state.items[j], state.items[i]]; }
      renderList();
    });
    ul.append(li);
  });
  updateSummary();
}

function updateSummary() {
  const used = state.items.filter((i) => i.use);
  const v = used.filter((i) => i.kind === "video").length;
  const p = used.length - v;
  $("#summary").textContent = `사용할 소스 ${used.length}개 (영상 ${v}개 · 사진 ${p}장) — AI에게 알려 줄 파일 수와 맞는지 확인하세요.`;
  $("#go").disabled = used.length === 0;
  updatePrompt();
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- 설정과 지시문 ---------- */

function settings() {
  return {
    topic: $("#topic").value.trim(),
    title: $("#title").value.trim(),
    formats: [...document.querySelectorAll("[name=fmt]:checked")].map((x) => x.value),
    styles: [...document.querySelectorAll("[name=sty]:checked")].map((x) => x.value),
    target: Number($("#target").value),
    audio: $("#audio").checked,
    captions: state.items.filter((i) => i.use).map((i) => i.caption).join("|"),
    order: state.items.filter((i) => i.use).map((i) => i.id).join(","),
  };
}

function buildPrompt(s) {
  const topic = s.topic || "[주제]";
  const parts = [`이 폴더에 있는 영상 소스들을 활용해서 ${topic}에 대해서 소개 영상 만들어줘.`];
  if (s.styles.length > 1) parts.push(`${s.styles.length}가지 스타일로 만들어줘.`);
  const f = s.formats.map((x) => (x === "9:16" ? "쇼츠용 세로(9:16)" : "16:9 롱폼용")).join(", ");
  if (f) parts.push(`${f} 각각 만들어줘.`);
  if (s.target) parts.push(`길이는 ${s.target}초로 해줘.`);
  return parts.join(" ");
}

function updatePrompt() {
  $("#prompt").value = buildPrompt(settings());
}

/* ---------- 타임라인 ---------- */

function buildTimeline(s) {
  const used = state.items.filter((i) => i.use);
  const per = s.target ? Math.max(1, (s.target - (s.title || s.topic ? INTRO_SEC : 0)) / used.length) : 0;
  const segs = [];
  if (s.title || s.topic) segs.push({ type: "title", text: s.title || s.topic, dur: INTRO_SEC });
  for (const it of used) {
    let dur;
    if (it.kind === "image") dur = per || 3;
    else dur = Math.min(it.duration, per || 5);
    segs.push({ type: it.kind, item: it, dur, text: it.caption });
  }
  return segs;
}

/* ---------- 그리기 ---------- */

function cover(ctx, src, sw, sh, w, h, zoom = 1) {
  const sc = Math.max(w / sw, h / sh) * zoom;
  const dw = sw * sc, dh = sh * sc;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") { lines.push(cur); cur = ""; continue; }
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCaption(ctx, w, h, style, text, t) {
  if (!text) return;
  const base = Math.round(Math.min(w, h) * (style === "pop" ? 0.075 : 0.05));
  ctx.font = `800 ${base}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text, w * 0.84);
  const lh = base * 1.3;
  if (style === "clean") {
    const bh = lines.length * lh + base;
    const y0 = h - bh - h * 0.06;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, y0, w, bh);
    ctx.fillStyle = "#fff";
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + base / 2 + lh * (i + 0.5)));
  } else {
    const pop = 1 + Math.max(0, 0.25 - t) * 1.2; // 등장 시 살짝 튀어나옴
    ctx.save();
    ctx.translate(w / 2, h * 0.2);
    ctx.scale(pop, pop);
    ctx.lineJoin = "round";
    ctx.lineWidth = base * 0.28;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#ffd400";
    lines.forEach((l, i) => {
      const y = lh * (i - (lines.length - 1) / 2);
      ctx.strokeText(l, 0, y);
      ctx.fillText(l, 0, y);
    });
    ctx.restore();
  }
}

function drawTitle(ctx, w, h, style, text, t, dur) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  if (style === "pop") { g.addColorStop(0, "#111"); g.addColorStop(1, "#2b2b2b"); } else { g.addColorStop(0, "#1b5db5"); g.addColorStop(1, "#0e3c80"); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const base = Math.round(Math.min(w, h) * 0.1);
  ctx.font = `800 ${base}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = style === "pop" ? "#ffd400" : "#fff";
  const k = style === "pop" ? 0.85 + 0.15 * Math.min(1, t / 0.3) : 1;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(k, k);
  const lines = wrap(ctx, text, w * 0.8);
  lines.forEach((l, i) => ctx.fillText(l, 0, base * 1.3 * (i - (lines.length - 1) / 2)));
  ctx.restore();
}

function drawFrame(ctx, w, h, style, seg, t, total, elapsedBefore) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const fadeIn = Math.min(1, t / 0.3);
  const fadeOut = style === "clean" ? Math.min(1, (seg.dur - t) / 0.2) : 1;
  ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
  if (seg.type === "title") drawTitle(ctx, w, h, style, seg.text, t, seg.dur);
  else if (seg.type === "image") {
    const img = seg.item.el;
    cover(ctx, img, img.naturalWidth, img.naturalHeight, w, h, style === "pop" ? 1 + 0.08 * (t / seg.dur) : 1);
  } else {
    const v = seg.item.el;
    if (v.readyState >= 2) cover(ctx, v, v.videoWidth, v.videoHeight, w, h);
  }
  ctx.globalAlpha = 1;
  if (seg.type !== "title") drawCaption(ctx, w, h, style, seg.text, t);
  if (style === "pop") {
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(0, h - 8, w * Math.min(1, (elapsedBefore + t) / total), 8);
  }
}

/* ---------- 녹화 ---------- */

function pickMime() {
  const c = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

let frameHook = null;
function playFor(seg, draw) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      if (t >= seg.dur) return resolve();
      draw(t);
      if (frameHook) frameHook();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function render(fmt, style, s, onProgress) {
  const [w, h] = SIZES[fmt];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const segs = buildTimeline(s);
  const total = segs.reduce((a, b) => a + b.dur, 0);

  const ac = audioCtx();
  const dest = ac.createMediaStreamDestination();
  const stream = canvas.captureStream(0); // 프레임은 직접 요청한다(정지 화면에서도 시간이 흐르도록)
  const vtrack = stream.getVideoTracks()[0];
  dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  // 무음 소스를 계속 흘려야 영상 클립이 없는 구간(제목·사진)에서도 녹화 시간이 흐른다
  await ac.resume();
  const silence = ac.createConstantSource();
  const mute = ac.createGain();
  mute.gain.value = 0;
  silence.connect(mute).connect(dest);
  silence.start();

  const mime = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(500);

  frameHook = () => vtrack.requestFrame && vtrack.requestFrame();
  let before = 0;
  for (const seg of segs) {
    let node = null;
    if (seg.type === "video") {
      const v = seg.item.el;
      v.currentTime = 0;
      await new Promise((r) => { v.onseeked = r; if (v.readyState >= 2 && v.currentTime === 0) r(); });
      if (s.audio) {
        seg.item.src = seg.item.src || ac.createMediaElementSource(v);
        node = seg.item.src;
        node.connect(dest);
      } else v.muted = true;
      await v.play().catch(() => {});
    }
    await playFor(seg, (t) => {
      drawFrame(ctx, w, h, style, seg, t, total, before);
      onProgress((before + t) / total);
    });
    if (seg.type === "video") {
      seg.item.el.pause();
      if (node) node.disconnect(dest);
    }
    before += seg.dur;
  }
  drawFrame(ctx, w, h, style, segs[segs.length - 1], segs[segs.length - 1].dur - 0.01, total, total - segs[segs.length - 1].dur);
  await new Promise((r) => setTimeout(r, 200));
  frameHook();
  rec.stop();
  await stopped;
  frameHook = null;
  silence.stop();
  return { blob: new Blob(chunks, { type: rec.mimeType || "video/webm" }), total, mime: rec.mimeType };
}

/* ---------- 자동 검사 ---------- */

function inspect(url, fmt, expectDur) {
  const [w, h] = SIZES[fmt];
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    const out = { open: false, play: false, format: false, dur: expectDur };
    const done = () => resolve(out);
    const timer = setTimeout(done, 5000);
    v.onerror = () => { clearTimeout(timer); done(); };
    v.onloadedmetadata = () => {
      out.open = true;
      out.format = v.videoWidth === w && v.videoHeight === h;
    };
    v.onplaying = () => { out.play = true; clearTimeout(timer); v.pause(); done(); };
    v.src = url;
    v.play().catch(() => {});
  });
}

/* ---------- 실행 ---------- */

function describeChanges(prev, cur) {
  if (!prev) return [];
  const names = { topic: "주제", title: "오프닝 제목", formats: "화면 형식", styles: "스타일", target: "전체 길이", audio: "원본 소리", captions: "자막", order: "소스 순서/선택" };
  return Object.keys(names).filter((k) => String(prev[k]) !== String(cur[k])).map((k) => names[k]);
}

async function go() {
  const s = settings();
  if (!s.formats.length || !s.styles.length) return alert("화면 형식과 스타일을 하나 이상 선택하세요.");
  const changes = describeChanges(state.lastSettings, s);
  const log = $("#log");
  if (state.lastSettings) {
    if (log.querySelector(".muted")) log.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = `${state.runs + 1}차: ` + (changes.length ? changes.join(", ") + " 변경" : "변경 없음") + (changes.length > 1 ? " — 한 번에 여러 가지를 바꿨어요. 결과가 이상하면 하나씩 되돌려 보세요." : "");
    log.append(li);
  }
  state.lastSettings = s;
  state.runs++;

  const go = $("#go"), prog = $("#progress"), res = $("#results");
  go.disabled = true;
  res.innerHTML = "";
  prog.hidden = false;
  const jobs = s.formats.flatMap((f) => s.styles.map((st) => [f, st]));
  try {
    for (let i = 0; i < jobs.length; i++) {
      const [fmt, st] = jobs[i];
      const label = `${fmt === "9:16" ? "세로 쇼츠" : "가로 롱폼"} · ${STYLE_NAMES[st]}`;
      const { blob, total, mime } = await render(fmt, st, s, (p) => {
        prog.firstElementChild.style.width = ((i + p) / jobs.length) * 100 + "%";
        prog.lastElementChild.textContent = `${i + 1}/${jobs.length} 만드는 중 — ${label}`;
      });
      const url = URL.createObjectURL(blob);
      const ext = mime && mime.includes("mp4") ? "mp4" : "webm";
      const card = document.createElement("div");
      card.className = "res";
      card.innerHTML = `<h3>${label} · ${total.toFixed(1)}초</h3><video controls playsinline src="${url}"></video><ul><li class="muted">검사 중…</li></ul><a download="ttalkkak-${state.runs}-${fmt.replace(":", "x")}-${st}.${ext}" href="${url}">다운로드 (.${ext})</a>`;
      res.append(card);
      inspect(url, fmt, total).then((r) => {
        const row = (ok, t) => `<li class="${ok ? "ok" : "ng"}">${t}</li>`;
        card.querySelector("ul").innerHTML =
          row(r.open, "파일이 열린다") + row(r.play, "재생된다") + row(r.format, `형식이 ${fmt} 화면이다`) + `<li class="muted">소리·자막 내용은 직접 확인하세요</li>`;
      });
    }
  } catch (e) {
    alert("영상을 만들지 못했습니다: " + e.message);
  } finally {
    prog.hidden = true;
    go.disabled = false;
    $("#s3").scrollIntoView({ behavior: "smooth" });
  }
}

/* ---------- 이벤트 ---------- */

const drop = $("#drop");
drop.addEventListener("click", () => $("#file").click());
drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && $("#file").click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
$("#file").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
document.querySelectorAll("#s2 input, #s2 select").forEach((el) => el.addEventListener("input", updatePrompt));
$("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt").value).catch(() => {});
  $("#copy").textContent = "복사됨";
  setTimeout(() => ($("#copy").textContent = "지시문 복사"), 1200);
});
$("#go").addEventListener("click", go);
updateSummary();
