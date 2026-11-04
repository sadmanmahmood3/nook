# Nook — IUB Study Lounge

A cozy virtual library for IUB students. Make an avatar, walk in, pick a desk, and study with a focus timer and ambient sound.

## Features
- A 2D library drawn live on a canvas: arched windows, bookshelves, 12 desks
- Your own avatar (name, skin tone, hairstyle including hijab, outfit)
- Tap the floor to walk, tap an empty chair to sit; your timer shows above your head while you study
- Bot students and a wandering librarian (real students arrive in Phase 2)
- Pomodoro timer: 15 / 25 / 50 / 90 minute focus sessions, short and long breaks, long break after 4 sessions
- Four scenes: Morning, Rainy, Night, Café change the light and the view outside
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
| `world.js` | Draws the library, characters and lighting; handles walking and sitting |
| `audio.js` | Generates the ambient sounds and the end-of-session chime |
| `app.js` | Timer, scenes, avatar editor, sound mixer, tasks, stats |

## Roadmap
- [x] Phase 1: Library, avatars, timer, ambient sounds
- [ ] Phase 2: Google sign-in + live rooms (see who is studying right now) with Firebase
- [ ] Phase 3: IUB-only sign-up, course rooms (CSE 317, CSE 451…), streak leaderboard, chat
- [ ] Phase 4: Deploy on Netlify, polish, test on phones

## Tech
HTML, CSS, JavaScript (no frameworks), Canvas 2D, Web Audio API.

Built by Sadman Mahmood.
