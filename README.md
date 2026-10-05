# 딸깍 영상 편집기

폴더에 영상·사진을 넣고 명령어 한 줄이면 **릴스/쇼츠(9:16)** 와 **유튜브(16:9)** 영상이 한 번에 나옵니다.

## 준비
- Python 3.9+ 와 [ffmpeg](https://ffmpeg.org/download.html) (`ffmpeg`, `ffprobe` 가 PATH 에 있어야 함)
- (선택) 자막 자동 생성: `pip install faster-whisper`

## 사용법
```bash
python ddalkkak.py init my_video     # 폴더 틀 만들기
# sources/ 에 영상·사진을 넣기 (순서는 파일명 숫자: 1_인트로.mp4, 2_본론.mp4 …)
python ddalkkak.py build my_video    # 딸깍! → my_video/output/
```

```
my_video/
  sources/       실제로 쓸 영상·사진 (숫자 순서대로 이어 붙임)
  music/         배경음악 1곡 (선택, 말할 때 자동으로 작아짐)
  reference/     참고 영상 (편집에 쓰이지 않음)
  ddalkkak.json  내 기본 설정
  output/        결과물: <폴더명>_reels.mp4, <폴더명>_youtube.mp4
```

## 옵션
| 옵션 | 설명 |
|---|---|
| `--format reels\|youtube\|both` | 만들 형식 (기본 both) |
| `--silence-cut` | 말 사이 무음 구간 자동 제거 |
| `--captions` | 자막 자동 생성 (faster-whisper 필요, 한국어 기본) |
| `--srt 파일.srt` | 직접 만든 자막 사용 |
| `--title "문구"` | 첫 2.5초에 제목 표시 |
| `--music 파일` | 배경음악 지정 |
| `--font 글꼴이름` | 자막/제목 글꼴 |

자주 쓰는 값은 `ddalkkak.json` 에 넣어 두면 매번 안 써도 됩니다
(`silence_cut`, `captions`, `title`, `music_volume`, `lufs`, `image_seconds` 등 — 전체 목록은 `ddalkkak.py` 의 `DEFAULTS`).

## 자동으로 해 주는 일
- 가로/세로 상관없이 흐린 배경으로 꽉 채워서 9:16, 16:9 둘 다 맞춤
- 사진은 3초씩 삽입, 소리 없는 클립도 문제없이 처리
- 음량을 -14 LUFS 로 맞춤 (유튜브·릴스 권장), 배경음악은 목소리에 맞춰 자동 덕킹
- 릴스가 90초를 넘으면 경고
