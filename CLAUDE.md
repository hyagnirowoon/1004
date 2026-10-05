# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

딸깍 영상 편집기: a single-file Python CLI (`ddalkkak.py`, stdlib only) that wraps ffmpeg to turn a folder of clips/photos into a Reels/Shorts (1080x1920) and YouTube (1920x1080) video. User docs are in `README.md` (Korean).

## Commands

- `python ddalkkak.py init <dir>` scaffolds `sources/ music/ reference/ output/ ddalkkak.json`.
- `python ddalkkak.py build <dir> [--format reels|youtube|both] [--silence-cut] [--captions|--srt f] [--title t] [--music f]`
- No test suite yet. To verify changes, generate synthetic sources with ffmpeg `lavfi` (`testsrc`, `sine`, `color`) into a scratch project and run `build`, then inspect output with `ffprobe` / extracted frames.

## Architecture

`collect` (natural-sorted files in `sources/`, first track in `music/`) → per format `build_one`: each clip (or non-silent span, via `keep_intervals`) is re-encoded to an identical-parameter segment by `render_segment` (blurred-fill background + fitted foreground) → concat-demuxer join → one final ffmpeg pass (subtitles, title drawtext, music sidechain ducking, loudnorm). Config precedence: `DEFAULTS` < `ddalkkak.json` < CLI flags.

## Gotchas

- SRT `force_style` values are in a 288px-tall coordinate space (libass default PlayRes), NOT output pixels; `build_one` converts px via `288 / height`. `original_size` does not fix this.
- When checking burned-in subtitles by extracting a frame, put `-ss` after `-i`; input-side `-ss` resets timestamps and hides the cue.
