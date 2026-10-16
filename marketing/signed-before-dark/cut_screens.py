"""Cut the raw recordings from record_screens.mjs into screens/R1-R7.mp4.

Each screen is one or more windows between timing marks, joined and sped up
just enough to fit the shot it plays in (never faster than MAX_SPEED; past
that the start is trimmed instead).
  python cut_screens.py
"""

import json
import sys
from pathlib import Path

from build import FFMPEG, run

HERE = Path(__file__).resolve().parent
RAW = HERE / "build" / "raw"
SCREENS = HERE / "screens"
MAX_SPEED = 2.0

# screen: (raw file, [(start mark, offset), (end mark, offset)] windows, target seconds or None)
CUTS = {
    "R1": ("tablet", [(("R1.analyze", -3.0), ("R1.analyze", 1.2)), (("R1.items", -0.3), ("R1.end", 0))], 6),
    "R2": ("tablet", [(("R2.start", 0), ("R2.end", 0))], 3),
    # The preview with the company already filled in, then the auto-filled values.
    "R3": ("tablet", [(("R3.preview", 0.1), ("R3.preview", 1.9)), (("R3.autofilled", -0.4), ("R3.end", 0))], 5),
    "R4": ("tablet", [(("R4.start", 0), ("R4.end", 0))], 5),
    "R5": ("tablet", [(("R5.draw", -0.3), ("R5.end", 0))], None),
    "R6": ("R6", [(("R6.start", 0), ("R6.end", 0))], 3),
    "R7": ("R7", [(("R7.start", 0), ("R7.end", 0))], 1.5),
}


def main() -> None:
    marks_file = RAW / "marks.json"
    if not marks_file.exists():
        sys.exit("Run `node record_screens.mjs` first.")
    marks = json.loads(marks_file.read_text(encoding="utf-8"))
    flat = {**marks["tablet"], **marks["R6"], **marks["R7"]}
    SCREENS.mkdir(exist_ok=True)

    for name, (raw, windows, target) in CUTS.items():
        src = RAW / f"{raw}.webm"
        spans = [(flat[a] + da, flat[b] + db) for (a, da), (b, db) in windows]
        length = sum(e - s for s, e in spans)
        speed = 1.0 if not target else min(MAX_SPEED, max(1.0, length / target))
        keep_from = 0.0 if not target else max(0.0, length / speed - target)

        parts = [
            f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[p{i}]" for i, (s, e) in enumerate(spans)
        ]
        joined = "".join(f"[p{i}]" for i in range(len(spans)))
        graph = ";".join(parts) + (
            f";{joined}concat=n={len(spans)}:v=1:a=0,setpts=PTS/{speed:.4f},"
            f"trim=start={keep_from:.3f},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v]"
        )
        out = SCREENS / f"{name}.mp4"
        run(["-i", str(src), "-filter_complex", graph, "-map", "[v]", "-an",
             "-c:v", "libx264", "-preset", "medium", "-crf", "16", str(out)])
        print(f"  {name}: {length:.1f}s raw, x{speed:.2f} -> {out.name}")


if __name__ == "__main__":
    if not FFMPEG:
        sys.exit("ffmpeg not found")
    main()
