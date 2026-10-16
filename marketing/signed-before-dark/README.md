# Signed Before Dark

The 78-second Scopit video. In it, Dana prices a flooded basement's pack-out,
gets the contract signed on site and the signed copy lands in both inboxes.
The script, shot list and AI prompts live in the "Signed Before Dark" doc.
This folder builds the video itself.

| Kind | Source | Made by |
| --- | --- | --- |
| AI shots (18) | `clips/<shot id>.mp4` | You, with a video model, from the doc's prompts |
| App screens R1-R7 | `screens/R*.mp4` | `record_screens.mjs` + `cut_screens.py` |
| Supers, end card, device frames, placeholder cards | `build/graphics/` | `render_graphics.mjs` |
| The edit | `output/` | `build.py` |

Until every AI shot has a clip, `build.py` writes `output/animatic.mp4`, with
a card in place of each missing shot. Once all 18 are in `clips/` it writes
`output/signed-before-dark.mp4` and adds the "Dramatization. AI-generated
scenes." line.

## Requirements

- Node (uses the frontend's Playwright install)
- Python 3.11+ with `pip install imageio-ffmpeg`, or ffmpeg on PATH
- Docker, for the recording stack

## Build the edit

```
node render_graphics.mjs
python build.py
```

## Re-record the app screens

`docker-compose.yml` runs its own Postgres, a Mailpit inbox and the backend.
The cloud database is never touched and no email leaves the machine. Only
`ANTHROPIC_API_KEY` is read from the repo `.env`, for Photo AI.

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout build/certs/key.pem -out build/certs/cert.pem -days 60 -subj "/CN=mail" -addext "subjectAltName=DNS:mail"
docker compose --env-file ../../.env up -d --build
(cd ../../frontend && npm run dev)
node record_screens.mjs
python cut_screens.py
python build.py
docker compose down -v
```

`record_screens.mjs` does the following:

1. Seeds Northline Restoration, Dana and Tom Miller.
2. Generates the contract PDF from `contract.html` and defines its fields.
3. Records one tablet session: Photo AI on two demo basement photos (R1), the estimate it creates (R2), Send for Signature with Direct Link (R3, R4), and Tom signing (R5).
4. Records the two completion emails Mailpit caught, on a phone screen (R6 Tom's copy, R7 Dana's notice).

On a failure it writes `build/raw/debug_failure.png`.

## Adding AI clips

Name each clip after its shot (`clips/1A.mp4`, `clips/2B.mp4`, ...) and run
`python build.py`. Each clip is cropped to fill 16:9 and trimmed to the
shot's length. Its audio is kept. Per shot in `shots.json`:

- `clipIn`: the second of the clip to start from.
- `composite.rect`: for 5B and 6B, `[x, y, w, h]` of the green tablet screen in the 1920x1080 frame. With it set, the green is keyed out and R4 or R5 plays underneath. Leave it `null` to use the clip as is.
