# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

딸깍 영상 편집기: a static, dependency-free web app. Upload clips/photos, enter a topic, pick formats (9:16 / 16:9) and styles, click once, and the browser composes the videos with Canvas + MediaRecorder. Based on the guidebook "AI 딸깍으로 만든 영상" (flow: source folder → one-paragraph instruction → first result → fix one thing at a time).

## Run / test

- No build step. Open `index.html` in Chromium, or serve with `python3 -m http.server`.
- No test suite. Smoke test by driving the page with Playwright (set files on `#file`, click `#go`, check `.res` cards).

## Architecture

- `index.html` / `style.css`: 4 sections mirroring the guidebook's 4 steps.
- `app.js`: `addFiles` (source list, numeric filename sort) → `settings`/`buildPrompt` (instruction text) → `buildTimeline` → `render` (canvas frames recorded in real time via `captureStream` + `MediaRecorder`) → `inspect` (open/play/format checks) → `go` (runs formats × styles, logs which settings changed between runs).

## Gotchas

- Rendering is real-time and needs the tab visible (rAF is throttled in background tabs).
- `createMediaElementSource` can only be called once per element and is bound to one AudioContext, so a single shared context (`audioCtx()`) is used.
- Always feed a silent `ConstantSource` into the recorder's audio destination and call `requestFrame()` per tick (`captureStream(0)`); otherwise segments without video-clip audio/changing pixels are dropped from the recording.
- Copy `FileList` before clearing the file input; clearing empties it.
- Output is `.mp4` if the browser's MediaRecorder supports it, otherwise `.webm`.
