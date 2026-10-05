#!/usr/bin/env python3
"""딸깍 영상 편집기 — 폴더 하나 → 릴스/쇼츠(9:16) + 유튜브(16:9) 영상.

사용법:
    python ddalkkak.py init  my_video          # 폴더 틀 만들기
    python ddalkkak.py build my_video          # 딸깍! (output/ 에 결과물 생성)

필요한 것: ffmpeg (필수), faster-whisper (자막 자동 생성용, 선택)
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}

FORMATS = {
    "reels": {"w": 1080, "h": 1920, "label": "릴스/쇼츠 (9:16)", "caption_margin": 520},
    "youtube": {"w": 1920, "h": 1080, "label": "유튜브 (16:9)", "caption_margin": 80},
}

DEFAULTS = {
    "formats": ["reels", "youtube"],
    "silence_cut": False,   # 말 사이 무음 구간 자동 제거
    "silence_db": -30,
    "silence_min": 0.5,     # 이 초 이상 조용하면 무음으로 판단
    "silence_pad": 0.15,    # 컷 앞뒤로 남기는 여유
    "image_seconds": 3.0,   # 사진 한 장당 길이
    "fps": 30,
    "crf": 20,
    "lufs": -14,            # 유튜브/릴스 권장 음량
    "music_volume": 0.15,
    "music": None,
    "title": None,
    "title_seconds": 2.5,
    "captions": False,      # True 면 whisper 로 자동 자막
    "srt": None,
    "language": "ko",
    "whisper_model": "small",
    "font": None,
    "reels_max_seconds": 90,
}

NUM_RE = re.compile(r"(\d+)")


def natural_key(p: Path):
    """1번, 2번, 10번 순서가 맞도록 숫자 기준 정렬."""
    return [int(t) if t.isdigit() else t.lower() for t in NUM_RE.split(p.name)]


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        tail = "\n".join(r.stderr.strip().splitlines()[-15:])
        raise RuntimeError(f"명령 실패: {' '.join(map(str, cmd[:6]))} ...\n{tail}")
    return r


def probe(path: Path):
    r = run(["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=codec_type", "-of", "json", str(path)])
    d = json.loads(r.stdout)
    has_audio = any(s.get("codec_type") == "audio" for s in d.get("streams", []))
    return float(d["format"].get("duration") or 0), has_audio


def find_font(user_font):
    if user_font:
        return user_font
    for fam in ("Noto Sans CJK KR", "Noto Sans KR", "Pretendard", "NanumGothic",
                "Malgun Gothic", "AppleSDGothicNeo", "WenQuanYi Zen Hei"):
        r = subprocess.run(["fc-list", fam, "family"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.splitlines()[0].split(",")[0].strip()
    return "Sans"


def font_file(family):
    r = subprocess.run(["fc-match", "-f", "%{file}", family], capture_output=True, text=True)
    return r.stdout.strip() or None


# ---------------------------------------------------------------- 폴더 규칙
def collect(project: Path):
    src = project / "sources"
    base = src if src.is_dir() else project
    clips = sorted((p for p in base.iterdir()
                    if p.is_file() and p.suffix.lower() in VIDEO_EXT | IMAGE_EXT
                    and not p.name.startswith(".")), key=natural_key)
    music = None
    mdir = project / "music"
    if mdir.is_dir():
        tracks = sorted(p for p in mdir.iterdir() if p.suffix.lower() in AUDIO_EXT)
        music = tracks[0] if tracks else None
    return clips, music


def load_config(project: Path, args):
    cfg = dict(DEFAULTS)
    cfg_path = project / "ddalkkak.json"
    if cfg_path.exists():
        cfg.update(json.loads(cfg_path.read_text(encoding="utf-8")))
    overrides = {
        "formats": None if args.format == "both" else [args.format],
        "silence_cut": True if args.silence_cut else None,
        "captions": True if args.captions else None,
        "title": args.title, "music": args.music, "srt": args.srt,
        "font": args.font, "crf": args.crf,
    }
    cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg


# ---------------------------------------------------------------- 무음 컷
def keep_intervals(path: Path, dur: float, cfg):
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af",
         f"silencedetect=noise={cfg['silence_db']}dB:d={cfg['silence_min']}",
         "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    if not starts:
        return [(0.0, dur)]
    if len(ends) < len(starts):
        ends.append(dur)
    pad = cfg["silence_pad"]
    keeps, cur = [], 0.0
    for s, e in zip(starts, ends):
        if s - cur > 0.3:
            keeps.append((max(0.0, cur - pad), min(dur, s + pad)))
        cur = e
    if dur - cur > 0.3:
        keeps.append((max(0.0, cur - pad), dur))
    return keeps or [(0.0, dur)]


# ---------------------------------------------------------------- 렌더
def video_filter(w, h, fps):
    """원본 비율과 상관없이 꽉 채운 흐린 배경 + 중앙 원본."""
    return (f"split=2[bg][fg];"
            f"[bg]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=25:5[b];"
            f"[fg]scale={w}:{h}:force_original_aspect_ratio=decrease[f];"
            f"[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1,fps={fps},format=yuv420p")


def render_segment(src: Path, out: Path, fmt, cfg, start=None, dur=None, is_image=False, has_audio=True):
    w, h = fmt["w"], fmt["h"]
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if is_image:
        cmd += ["-loop", "1", "-t", str(cfg["image_seconds"]), "-i", str(src)]
    else:
        if start is not None:
            cmd += ["-ss", f"{start:.3f}"]
        cmd += ["-i", str(src)]
        if dur is not None:
            cmd += ["-t", f"{dur:.3f}"]
    audio_in = has_audio and not is_image
    if not audio_in:
        cmd += ["-f", "lavfi", "-t", str(cfg["image_seconds"] if is_image else dur or 1),
                "-i", "anullsrc=r=48000:cl=stereo"]
        amap = "1:a"
    else:
        amap = "0:a:0"
    cmd += ["-filter_complex", f"[0:v]{video_filter(w, h, cfg['fps'])}[v]",
            "-map", "[v]", "-map", amap,
            "-af", "aresample=48000,aformat=channel_layouts=stereo",
            "-c:v", "libx264", "-preset", "medium", "-crf", str(cfg["crf"]),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", str(out)]
    run(cmd)


def transcribe(audio: Path, srt: Path, cfg):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("  ! 자막 자동 생성에는 faster-whisper 가 필요해요:  pip install faster-whisper")
        print("    (자막 없이 계속 진행합니다. 직접 만든 .srt 는 --srt 로 쓸 수 있어요)")
        return False

    def ts(t):
        ms = int(round(t * 1000))
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

    model = WhisperModel(cfg["whisper_model"], compute_type="int8")
    segs, _ = model.transcribe(str(audio), language=cfg["language"], vad_filter=True)
    lines = []
    for i, s in enumerate(segs, 1):
        lines.append(f"{i}\n{ts(s.start)} --> {ts(s.end)}\n{s.text.strip()}\n")
    srt.write_text("\n".join(lines), encoding="utf-8")
    return bool(lines)


def build_one(name, clips, music, cfg, project: Path, out_dir: Path):
    fmt = FORMATS[name]
    print(f"\n▶ {fmt['label']} 만드는 중…")
    with tempfile.TemporaryDirectory(prefix="ddalkkak_") as td:
        tmp = Path(td)
        segs = []
        for ci, clip in enumerate(clips):
            is_img = clip.suffix.lower() in IMAGE_EXT
            if is_img:
                p = tmp / f"s{len(segs):04}.mp4"
                render_segment(clip, p, fmt, cfg, is_image=True)
                segs.append(p)
                continue
            dur, has_audio = probe(clip)
            spans = keep_intervals(clip, dur, cfg) if cfg["silence_cut"] and has_audio else [(0.0, dur)]
            for s, e in spans:
                p = tmp / f"s{len(segs):04}.mp4"
                whole = len(spans) == 1 and s == 0.0
                render_segment(clip, p, fmt, cfg, None if whole else s, None if whole else e - s,
                               has_audio=has_audio)
                segs.append(p)
            if len(spans) > 1:
                kept = sum(e - s for s, e in spans)
                print(f"  - {clip.name}: 무음 컷 {dur:.1f}s → {kept:.1f}s")
        if not segs:
            raise RuntimeError("만들 소스가 없어요.")

        listing = tmp / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in segs), encoding="utf-8")
        joined = tmp / "joined.mp4"
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(listing), "-c", "copy", str(joined)])
        total, _ = probe(joined)

        # 자막
        srt_path = None
        if cfg["srt"]:
            srt_path = tmp / "subs.srt"
            shutil.copy(cfg["srt"], srt_path)
        elif cfg["captions"]:
            wav = tmp / "voice.wav"
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined),
                 "-vn", "-ac", "1", "-ar", "16000", str(wav)])
            print("  - 자막 인식 중…")
            srt_path = tmp / "subs.srt"
            if not transcribe(wav, srt_path, cfg):
                srt_path = None

        family = find_font(cfg["font"])
        vf = []
        if srt_path:
            # SRT 자막 스타일은 화면 높이 288 기준 좌표라 픽셀 값을 환산해서 쓴다
            k = 288 / fmt["h"]
            size_px = 72 if name == "reels" else 52
            style = (f"FontName={family},FontSize={size_px * k:.1f},Bold=1,PrimaryColour=&H00FFFFFF,"
                     f"OutlineColour=&H00000000,BorderStyle=1,Outline={4 * k:.2f},Shadow=0,"
                     f"Alignment=2,MarginV={round(fmt['caption_margin'] * k)}")
            vf.append(f"subtitles=subs.srt:force_style='{style}'")
        if cfg["title"]:
            (tmp / "title.txt").write_text(cfg["title"], encoding="utf-8")
            ff = font_file(family)
            fsz = 84 if name == "reels" else 72
            vf.append(f"drawtext=textfile=title.txt:{'fontfile=' + ff + ':' if ff else ''}"
                      f"fontsize={fsz}:fontcolor=white:borderw=6:bordercolor=black:"
                      f"x=(w-text_w)/2:y={'h*0.12' if name == 'reels' else 'h*0.08'}:"
                      f"enable='lt(t,{cfg['title_seconds']})'")

        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", "joined.mp4"]
        loud = f"loudnorm=I={cfg['lufs']}:TP=-1.5:LRA=11"
        if music:
            cmd += ["-stream_loop", "-1", "-i", str(Path(music).resolve())]
            fc = (f"[1:a]volume={cfg['music_volume']}[m];[0:a]asplit[vo][sc];"
                  f"[m][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=500[duck];"
                  f"[vo][duck]amix=inputs=2:duration=first:normalize=0,{loud}[a]")
        else:
            fc = f"[0:a]{loud}[a]"
        if vf:
            fc += f";[0:v]{','.join(vf)}[v]"
            cmd += ["-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "medium", "-crf", str(cfg["crf"])]
        else:
            cmd += ["-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy"]
        cmd += ["-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}",
                "-movflags", "+faststart", str((tmp / "final.mp4"))]
        run(cmd, cwd=tmp)

        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{project.resolve().name}_{name}.mp4"
        shutil.move(str(tmp / "final.mp4"), out)

    print(f"  ✓ {out}  ({total:.1f}초)")
    if name == "reels" and total > cfg["reels_max_seconds"]:
        print(f"  ! {total:.0f}초 — 릴스/쇼츠는 {cfg['reels_max_seconds']}초 이하를 권장해요 "
              f"(--silence-cut 으로 줄여 보세요)")
    return out


# ---------------------------------------------------------------- CLI
def cmd_init(args):
    p = Path(args.project)
    for d in ("sources", "music", "reference", "output"):
        (p / d).mkdir(parents=True, exist_ok=True)
    cfg = p / "ddalkkak.json"
    if not cfg.exists():
        cfg.write_text(json.dumps({"title": None, "silence_cut": False, "captions": False,
                                   "music_volume": 0.15}, ensure_ascii=False, indent=2),
                       encoding="utf-8")
    print(f"""폴더를 만들었어요: {p}/
  sources/    영상·사진을 넣으세요. 순서는 파일명 숫자로 (1_인트로.mp4, 2_본론.mp4 …)
  music/      배경음악 1곡 (선택)
  reference/  참고 영상 (편집에는 쓰이지 않아요)
  ddalkkak.json  내 기본 설정
다 넣었으면:  python ddalkkak.py build {p}""")


def cmd_build(args):
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} 이 필요해요. 설치: https://ffmpeg.org/download.html")
    project = Path(args.project)
    if not project.is_dir():
        sys.exit(f"폴더가 없어요: {project}  (먼저 `init` 을 실행하세요)")
    cfg = load_config(project, args)
    clips, auto_music = collect(project)
    if not clips:
        sys.exit("sources/ 폴더에 영상이나 사진이 없어요.")
    music = cfg["music"] or auto_music
    print(f"소스 {len(clips)}개:")
    for c in clips:
        print(f"  {c.name}")
    if music:
        print(f"배경음악: {Path(music).name}")
    outs = [build_one(f, clips, music, cfg, project, project / "output") for f in cfg["formats"]]
    print("\n완료!", *[f"\n  {o}" for o in outs])


def main():
    ap = argparse.ArgumentParser(description="딸깍 영상 편집기")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pi = sub.add_parser("init", help="프로젝트 폴더 틀 만들기")
    pi.add_argument("project")
    pi.set_defaults(fn=cmd_init)
    pb = sub.add_parser("build", help="영상 만들기")
    pb.add_argument("project")
    pb.add_argument("--format", choices=["both", "reels", "youtube"], default="both")
    pb.add_argument("--silence-cut", action="store_true", help="무음 구간 자동 제거")
    pb.add_argument("--captions", action="store_true", help="자막 자동 생성 (faster-whisper)")
    pb.add_argument("--srt", help="직접 만든 자막 파일")
    pb.add_argument("--title", help="첫 2.5초에 띄울 제목")
    pb.add_argument("--music", help="배경음악 파일 (없으면 music/ 폴더 사용)")
    pb.add_argument("--font", help="자막/제목 글꼴 이름")
    pb.add_argument("--crf", type=int, help="화질 (낮을수록 고화질, 기본 20)")
    pb.set_defaults(fn=cmd_build)
    args = ap.parse_args()
    try:
        args.fn(args)
    except RuntimeError as e:
        sys.exit(f"오류: {e}")


if __name__ == "__main__":
    main()
