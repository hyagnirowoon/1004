# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A YouTube music-video playlist editor: a build-less static web app (vanilla HTML/CSS/JS, no dependencies, no bundler). The UI language is Korean. Open `index.html` directly in a browser, or run `npm start` (serves on http://localhost:8080).

## Commands

- `npm test` — unit tests for `lib.js` using Node's built-in runner (`node --test "test/*.test.js"`; the quoted glob matters on Node 22).
- Single test: `node --test --test-name-pattern="buildChapters" test/lib.test.js`
- There is no lint/build step.

## Architecture

- `lib.js` — pure logic with no DOM access (YouTube ID parsing, `m:ss` duration parse/format, track/playlist normalization, `moveItem`, local-file helpers `parseFileName` / `readMp4Duration`, and exporters: `buildChapters`, `buildTracklist`, `toJSON`, `toCSV`). It is a UMD module: `window.PlaylistLib` in the browser, `module.exports` in Node. Put anything testable here.
- `app.js` — all DOM/UI code in one IIFE. State is a single `pl` object (`{title, description, tracks[]}`) persisted to `localStorage` (`mv-playlist-editor:v1`). Structural changes go through `mutate(fn)` (snapshot → change → save → full re-render); typing in fields goes through `touch()` + `setField()` so one run of typing is one undo step.
- `index.html` / `style.css` — static markup (the editor form and export dialog are declared in HTML and filled by `app.js`) and theme tokens (light/dark via `prefers-color-scheme`).
- `test/lib.test.js` — tests for `lib.js`.

## Local video import (folder / files)

The user's videos are usually *not on YouTube yet*, so tracks can come from local files (`📁 폴더에서 가져오기`, `영상 파일 선택` → `importVideoFiles` in `app.js`). Nothing is uploaded: files are only `slice()`d / probed in the browser, so multi-GB files are fine. Duration comes from `readMp4Duration` (reads only box headers → `mvhd`; works for mp4/mov regardless of codec) and falls back to a `<video preload=metadata>` probe (webm/mkv/...). Imported tracks get `status: 'ready'`, `fileName` (relative path, for display) and `fileSize`; re-imports skip a file when `sameLocalFile` matches name + size (path only for old tracks without a size). macOS junk (`._*`, `.DS_Store`, `__MACOSX/`) is ignored via `isJunkPath`, and names are NFC-normalized (macOS may hand over NFD Korean). Never read a whole file into memory (`file.arrayBuffer()` on the full file) — that is exactly what breaks for large videos.

## Conventions and gotchas

- Always build DOM with the `h()` helper or `textContent`; never `innerHTML` with user data (track titles come from the user and from imported JSON).
- `draggable` must be set to the strings `'true'`/`'false'` — an empty attribute means "not draggable".
- The `Track` shape is defined by `normalizeTrack` in `lib.js`; imported/saved data always passes through `normalizePlaylist`. Add new fields there first.
- Title/artist auto-fill uses YouTube's oEmbed endpoint from the browser and silently does nothing if it is blocked. Duration cannot come from oEmbed, so it is entered manually.
- YouTube chapter rules (reflected in `buildChapters` warnings): first stamp at 0:00, at least 3 stamps, each chapter at least 10 seconds.
- When testing in a headless sandbox, set `LANG=C.UTF-8`; otherwise Chromium drops non-ASCII download filenames to `download`.
