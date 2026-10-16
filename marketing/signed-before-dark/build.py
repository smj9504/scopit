"""Assemble Signed Before Dark from whatever footage exists.

Each shot in shots.json is filled from the best source on disk:
  ai shots      clips/<id>.mp4, else the placeholder card
  screen shots  screens/<R>.mp4 inside a device frame, else a card
  end card      build/graphics/endcard.png
Supers and the disclaimer are laid over the result. Run render_graphics.mjs
first, then:
  python build.py
The output is output/animatic.mp4 while any AI shot is still a card, and
output/signed-before-dark.mp4 once every AI shot has a clip.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GRAPHICS = HERE / "build" / "graphics"
SEGMENTS = HERE / "build" / "segments"
CLIPS = HERE / "clips"
SCREENS = HERE / "screens"
OUTPUT = HERE / "output"

SUPER_FADE = 0.25


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found. Install it, or run: pip install imageio-ffmpeg")


FFMPEG = find_ffmpeg()


def run(args: list[str]) -> None:
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{' '.join(cmd)}\n{result.stderr}")


def probe_duration(path: Path) -> float:
    # ffmpeg prints "Duration: HH:MM:SS.xx" on stderr when given only an input.
    result = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    for line in result.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            h, m, s = line.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    sys.exit(f"Could not read duration of {path}")


def has_audio(path: Path) -> bool:
    result = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    return "Audio:" in result.stderr


def encode_args(dur: float, fps: int) -> list[str]:
    return [
        "-t", f"{dur:.3f}", "-r", str(fps),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    ]


def silent_audio(dur: float) -> list[str]:
    return ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]


def still(png: Path, out: Path, dur: float, fps: int, fade_in: bool = False) -> None:
    vf = "format=yuv420p"
    if fade_in:
        vf = f"fade=t=in:st=0:d=0.6,{vf}"
    run(["-loop", "1", "-framerate", str(fps), "-t", f"{dur:.3f}", "-i", str(png),
         *silent_audio(dur), "-vf", vf, "-map", "0:v", "-map", "1:a", *encode_args(dur, fps), str(out)])


def cover(w: int, h: int) -> str:
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"


def screen_window(shot: dict, src: Path) -> float:
    """Where in the recording this shot starts."""
    start = shot.get("screenIn", 0)
    if start == "end":
        return max(0.0, probe_duration(src) / shot.get("speed", 1) - shot["dur"])
    return float(start)


def screen_shot(shot: dict, src: Path, out: Path, cfg: dict, devices: dict) -> None:
    d = devices[shot["device"]]
    dur, fps = shot["dur"], cfg["fps"]
    speed = shot.get("speed", 1)
    start = screen_window(shot, src)
    vf = (
        f"[0:v]setpts=PTS/{speed},trim=start={start:.3f}:duration={dur:.3f},setpts=PTS-STARTPTS,"
        f"tpad=stop_mode=clone:stop_duration={dur:.3f},trim=duration={dur:.3f},"
        f"scale={d['w']}:{d['h']},setsar=1[scr];"
        f"color=c=#0b1220:s={cfg['width']}x{cfg['height']}:r={fps}:d={dur:.3f}[bg];"
        f"[bg][scr]overlay={d['x']}:{d['y']}[base];"
        f"[base][1:v]overlay=0:0,format=yuv420p[v]"
    )
    run(["-i", str(src), "-loop", "1", "-t", f"{dur:.3f}", "-i", str(GRAPHICS / f"frame_{shot['device']}.png"),
         *silent_audio(dur), "-filter_complex", vf, "-map", "[v]", "-map", "2:a",
         *encode_args(dur, fps), str(out)])


def ai_shot(shot: dict, src: Path, out: Path, cfg: dict) -> None:
    dur, fps, w, h = shot["dur"], cfg["fps"], cfg["width"], cfg["height"]
    start = float(shot.get("clipIn", 0))
    look = ",hue=s=0" if shot.get("bw") else ""
    inputs = ["-ss", f"{start:.3f}", "-i", str(src)]
    comp = shot.get("composite") or {}
    screen = SCREENS / f"{comp.get('screen', '')}.mp4"

    if comp.get("rect") and screen.exists():
        # Key the green tablet screen out of the AI clip and lay the recording
        # underneath it. rect = [x, y, w, h] of the screen in the 1920x1080 frame.
        x, y, rw, rh = comp["rect"]
        key = comp.get("key", "0x00FF00:0.30:0.08")
        inputs += ["-i", str(screen)]
        graph = (
            f"[0:v]{cover(w, h)},trim=duration={dur:.3f},setpts=PTS-STARTPTS,chromakey={key}{look}[fg];"
            f"[1:v]tpad=stop_mode=clone:stop_duration={dur:.3f},trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
            f"scale={rw}:{rh},setsar=1[scr];"
            f"color=c=black:s={w}x{h}:r={fps}:d={dur:.3f}[bg];"
            f"[bg][scr]overlay={x}:{y}[under];[under][fg]overlay=0:0,format=yuv420p[v]"
        )
    else:
        graph = f"[0:v]{cover(w, h)},trim=duration={dur:.3f},setpts=PTS-STARTPTS{look},format=yuv420p[v]"

    if has_audio(src):
        graph += f";[0:a]atrim=duration={dur:.3f},asetpts=PTS-STARTPTS,apad=whole_dur={dur:.3f}[a]"
        audio_map = ["-map", "[a]"]
    else:
        n_inputs = inputs.count("-i")
        inputs += silent_audio(dur)
        audio_map = ["-map", f"{n_inputs}:a"]

    run([*inputs, "-filter_complex", graph, "-map", "[v]", *audio_map, *encode_args(dur, fps), str(out)])


def main() -> None:
    cfg = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
    if not (GRAPHICS / "devices.json").exists():
        sys.exit("Run `node render_graphics.mjs` first.")
    devices = json.loads((GRAPHICS / "devices.json").read_text(encoding="utf-8"))
    SEGMENTS.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fps = cfg["fps"]

    timeline: dict[str, tuple[float, float]] = {}
    segments: list[Path] = []
    missing: list[str] = []
    t = 0.0
    for i, shot in enumerate(cfg["shots"]):
        out = SEGMENTS / f"{i:02d}_{shot['id']}.mp4"
        kind = shot["kind"]
        if kind == "ai":
            clip = CLIPS / f"{shot['id']}.mp4"
            if clip.exists():
                ai_shot(shot, clip, out, cfg)
            else:
                missing.append(shot["id"])
                still(GRAPHICS / f"card_{shot['id']}.png", out, shot["dur"], fps)
        elif kind == "screen":
            rec = SCREENS / f"{shot['screen']}.mp4"
            if rec.exists():
                screen_shot(shot, rec, out, cfg, devices)
            else:
                missing.append(f"{shot['id']} ({shot['screen']})")
                still(GRAPHICS / f"card_{shot['id']}.png", out, shot["dur"], fps)
        else:
            still(GRAPHICS / "endcard.png", out, shot["dur"], fps, fade_in=True)
        timeline[shot["id"]] = (t, t + shot["dur"])
        t += shot["dur"]
        segments.append(out)
        print(f"  {shot['id']:>3}  {kind:<7} {shot['dur']:>4}s")
    total = t

    concat_list = SEGMENTS / "concat.txt"
    concat_list.write_text("".join(f"file '{p.as_posix()}'\n" for p in segments), encoding="utf-8")
    body = SEGMENTS / "body.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(body)])

    # Supers and the disclaimer, each a looped PNG faded in and out over its window.
    inputs = ["-i", str(body)]
    chains, last = [], "0:v"
    overlays: list[tuple[Path, float, float]] = []
    for i, s in enumerate(cfg["supers"]):
        start = timeline[s["from"]][0] + s.get("in", 0)
        end = timeline[s["to"]][1]
        overlays.append((GRAPHICS / f"super_{i}.png", start, end))
    ai_ids = [s["id"] for s in cfg["shots"] if s["kind"] == "ai"]
    if any(i not in missing for i in ai_ids):
        end_card_start = timeline[cfg["shots"][-1]["id"]][0]
        overlays.append((GRAPHICS / "disclaimer.png", 0.0, end_card_start))

    for n, (png, start, end) in enumerate(overlays, start=1):
        inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{total:.3f}", "-i", str(png)]
        fade_out = max(start, end - SUPER_FADE)
        chains.append(
            f"[{n}:v]format=rgba,fade=t=in:st={start:.3f}:d={SUPER_FADE}:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d={SUPER_FADE}:alpha=1[o{n}]"
        )
        chains.append(f"[{last}][o{n}]overlay=0:0:enable='between(t,{start:.3f},{end:.3f})'[v{n}]")
        last = f"v{n}"
    chains.append(f"[{last}]format=yuv420p[vout]")

    ai_missing = [m for m in missing if m in ai_ids]
    name = "animatic.mp4" if ai_missing else "signed-before-dark.mp4"
    final = OUTPUT / name
    run([*inputs, "-filter_complex", ";".join(chains), "-map", "[vout]", "-map", "0:a",
         "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final)])

    print(f"\n{final} ({total:.1f}s)")
    if missing:
        print("Still placeholders: " + ", ".join(missing))


if __name__ == "__main__":
    main()
