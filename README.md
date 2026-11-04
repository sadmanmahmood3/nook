# Nook — IUB Study Lounge

A cozy virtual study room for IUB students. Pick a scene, start the focus timer, and study with ambient sound.

## Features (Phase 1)
- Pomodoro timer: 25 / 50 / 90 minute focus sessions, short and long breaks, long break after 4 sessions
- Four scenes: Morning, Rainy, Night, Café, each drawn live on a canvas
- Ambient sound mixer: rain, birds, wind, crickets, café, hum. All sounds are generated with the Web Audio API, so there are no audio files
- Today's task list
- Daily focus minutes, sessions and day streak
- Keyboard: `Space` start/pause, `R` reset
- Saves settings, tasks and stats in the browser (localStorage)

## Run it
Open `index.html` in a browser. No install or build step needed.

## Files
| File | What it does |
|---|---|
| `index.html` | Page structure |
| `style.css` | Look and layout; colours change per scene |
| `scene.js` | Draws the window, skyline, rain, stars, etc. |
| `audio.js` | Generates the ambient sounds and the end-of-session chime |
| `app.js` | Timer, scene switching, mixer, tasks, stats |

## Roadmap
- [x] Phase 1: Solo study room
- [ ] Phase 2: Google sign-in + live rooms (see who is studying right now) with Firebase
- [ ] Phase 3: IUB-only sign-up, course rooms (CSE 317, CSE 451…), streak leaderboard, chat
- [ ] Phase 4: Deploy on Netlify, polish, test on phones

## Tech
HTML, CSS, JavaScript (no frameworks), Canvas 2D, Web Audio API.

Built by Sadman Mahmood.
