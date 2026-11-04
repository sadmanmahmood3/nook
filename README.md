# Nook — IUB Study Lounge

A cozy virtual library for IUB students. Make an avatar, walk in, pick a desk, and study with a focus timer and ambient sound.

## Features
- A 2D library drawn live on a canvas: arched windows, bookshelves, 12 desks
- Your own avatar (name, skin tone, hairstyle including hijab, outfit)
- Walk with arrow keys / WASD and press E to sit (computer), or use the joystick and Sit button (phone). Tapping also works
- Your timer shows above your head while you study
- Share study material: PDFs, Word, slides, sheets, images, text, zip (up to 10 MB) or quick notes, with everyone or one person. People who shared something get a paper stack on their desk
- Bot students and a wandering librarian (real students arrive in Phase 2)
- Pomodoro timer: 15 / 25 / 50 / 90 minute focus sessions, short and long breaks, long break after 4 sessions
- Four scenes: Morning, Rainy, Night, Café change the light and the view outside
- Ambient sound mixer: rain, birds, wind, crickets, café, hum. All sounds are generated with the Web Audio API, so there are no audio files
- Today's task list
- Daily focus minutes, sessions and day streak
- Keyboard: arrows/WASD walk, `E` sit/stand, `Space` start/pause timer, `R` reset
- Saves settings, avatar, tasks and stats in the browser (localStorage)

## Run it
Open `index.html` in a browser. No install or build step needed.

## Files
| File | What it does |
|---|---|
| `index.html` | Page structure |
| `style.css` | Look and layout; colours change per scene |
| `world.js` | Draws the library, characters and lighting; handles walking and sitting |
| `config.js` | Supabase project address and public key |
| `net.js` | Talks to Supabase: sign-in, presence, movement, shared files |
| `online.js` | Connects the library to the network (falls back to solo mode) |
| `supabase/setup.sql` | Database tables, file bucket and security rules. Run once in the Supabase SQL Editor |
| `audio.js` | Generates the ambient sounds and the end-of-session chime |
| `app.js` | Timer, scenes, avatar editor, sound mixer, tasks, stats |
| `controls.js` | Keyboard, joystick and Sit button |
| `share.js` | Sharing files and notes, the shared files panel and viewer |

## Roadmap
- [x] Phase 1: Library, avatars, timer, ambient sounds
- [x] Phase 2: Live library with Supabase: see other students walk, sit and study in real time; files and notes really reach the people they're shared with
- [ ] Phase 3: IUB-only sign-up, course rooms (CSE 317, CSE 451…), streak leaderboard, chat
- [ ] Phase 4: Deploy on Netlify, polish, test on phones

## Tech
HTML, CSS, JavaScript (no frameworks), Canvas 2D, Web Audio API, Supabase (Postgres, Realtime, Storage, row level security).

Built by Sadman Mahmood.
