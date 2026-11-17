# Tabata Timer

A Tabata-style interval timer for Android, installable straight from GitHub Pages as an app (PWA). It works offline once installed.

## Features
- Create, edit, duplicate and delete workouts (saved on your phone)
- Each workout has:
  - a list of exercises (name + duration in seconds each)
  - number of sets (the whole exercise list repeats per set)
  - rest time between sets
- 5-second "Get ready" countdown with beeps before the workout starts
- A voice speaks each exercise name as it begins ("Set 2. Push ups" at the start of a new set)
- 3-second countdown with beeps before every following exercise
- Pause / resume, skip, back, mute
- Keeps the screen awake while the timer runs

## Install on Android
1. Open the GitHub Pages link in **Chrome** on your phone.
2. Tap **Install** in the app's top bar, or use Chrome's menu ⋮ → **Add to Home screen** / **Install app**.
3. Launch **Tabata Timer** from your home screen or app drawer.

Make sure your media volume is up. The voice uses your phone's built-in text-to-speech engine.

## Development
Plain HTML/CSS/JS with no build step. To serve it locally:

```
python -m http.server 8000
```
