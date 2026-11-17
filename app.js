'use strict';

/* ================= Storage ================= */
const STORE_KEY = 'tabata.workouts.v1';
const SETTINGS_KEY = 'tabata.settings.v1';

function loadWorkouts() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}
function saveWorkouts(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
function loadSettings() {
  try { return Object.assign({ muted: false }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch (e) { return { muted: false }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

let workouts = loadWorkouts();
if (!workouts) {
  workouts = [{
    id: uid(),
    name: 'Sample Tabata',
    sets: 3,
    exRest: 10,
    setRest: 60,
    exercises: [
      { name: 'Jumping Jacks', duration: 20 },
      { name: 'Push Ups', duration: 20 },
      { name: 'Squats', duration: 20 },
      { name: 'Mountain Climbers', duration: 20 },
    ],
  }];
  saveWorkouts(workouts);
}
const settings = loadSettings();

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ================= Helpers ================= */
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const PREP_SECONDS = 5;
const COUNTDOWN_SECONDS = 3;

/* Build the full list of timed segments for a workout. */
function buildSegments(w) {
  const segs = [];
  const n = w.exercises.length;
  segs.push({ type: 'prep', dur: PREP_SECONDS, set: 1, ex: 0, next: w.exercises[0].name });
  for (let s = 1; s <= w.sets; s++) {
    for (let i = 0; i < n; i++) {
      const e = w.exercises[i];
      const firstOverall = s === 1 && i === 0;
      if (!firstOverall) {
        segs.push({ type: 'countdown', dur: COUNTDOWN_SECONDS, set: s, ex: i, next: e.name });
      }
      segs.push({ type: 'work', dur: e.duration, set: s, ex: i, name: e.name, firstOfSet: i === 0 });
      if (i < n - 1 && (w.exRest || 0) > 0) {
        segs.push({ type: 'rest', kind: 'ex', dur: w.exRest, set: s, ex: i, next: w.exercises[i + 1].name });
      }
      if (i === n - 1 && s < w.sets && w.setRest > 0) {
        segs.push({ type: 'rest', kind: 'set', dur: w.setRest, set: s, ex: i, next: w.exercises[0].name });
      }
    }
  }
  return segs;
}
function totalSeconds(w) { return buildSegments(w).reduce((a, s) => a + s.dur, 0); }

/* ================= Views & navigation ================= */
let currentView = 'home';
function showView(name, push = true) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
  currentView = name;
  window.scrollTo(0, 0);
  if (push && name !== 'home') history.pushState({ view: name }, '');
}
window.addEventListener('popstate', () => {
  if (currentView === 'timer') stopTimer(false);
  renderHome();
  showView('home', false);
});
function goHome() {
  if (history.state && history.state.view) history.back();
  else { renderHome(); showView('home', false); }
}

/* ================= Home ================= */
function renderHome() {
  const list = $('workout-list');
  list.innerHTML = '';
  $('empty-msg').classList.toggle('hidden', workouts.length > 0);
  workouts.forEach((w) => {
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = `
      <h3>${esc(w.name)}</h3>
      <p class="sub">${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'} · ${w.sets} set${w.sets === 1 ? '' : 's'} · ${w.exRest || 0}s rest between exercises · ${w.setRest}s between sets · ${fmt(totalSeconds(w))} total</p>
      <p class="ex-preview">${w.exercises.map((e) => `${esc(e.name)} (${e.duration}s)`).join(' · ')}</p>
      <div class="actions">
        <button class="btn primary" data-act="start">▶ Start</button>
        <button class="btn" data-act="edit">Edit</button>
        <button class="btn" data-act="copy" aria-label="Duplicate">⧉</button>
        <button class="btn danger" data-act="del" aria-label="Delete">🗑</button>
      </div>`;
    li.querySelector('[data-act=start]').onclick = () => startTimer(w);
    li.querySelector('[data-act=edit]').onclick = () => openEditor(w);
    li.querySelector('[data-act=copy]').onclick = () => {
      const copy = JSON.parse(JSON.stringify(w));
      copy.id = uid(); copy.name = w.name + ' (copy)';
      workouts.splice(workouts.indexOf(w) + 1, 0, copy);
      saveWorkouts(workouts); renderHome();
    };
    li.querySelector('[data-act=del]').onclick = () => {
      if (confirm(`Delete "${w.name}"?`)) {
        workouts = workouts.filter((x) => x !== w);
        saveWorkouts(workouts); renderHome();
      }
    };
    list.appendChild(li);
  });
}
$('btn-new').onclick = () => openEditor(null);

/* ================= Editor ================= */
let editing = null; // workout being edited (null = new)
let draftRows = []; // [{name, duration}]

function openEditor(w) {
  editing = w;
  $('edit-title').textContent = w ? 'Edit workout' : 'New workout';
  $('f-name').value = w ? w.name : '';
  $('f-sets').value = w ? w.sets : 3;
  $('f-exrest').value = w ? (w.exRest || 0) : 10;
  $('f-setrest').value = w ? w.setRest : 60;
  $('f-default').value = w ? (w.exercises[0]?.duration || 20) : 20;
  draftRows = w ? w.exercises.map((e) => ({ ...e })) : Array.from({ length: 4 }, () => ({ name: '', duration: 20 }));
  $('f-count').value = draftRows.length;
  renderRows();
  showView('edit');
}

function syncRowsFromDom() {
  document.querySelectorAll('#exercise-rows li').forEach((li, i) => {
    if (!draftRows[i]) return;
    draftRows[i].name = li.querySelector('.ex-name').value;
    draftRows[i].duration = li.querySelector('.ex-dur').value;
  });
}

function renderRows() {
  const ol = $('exercise-rows');
  ol.innerHTML = '';
  draftRows.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <input class="ex-name" type="text" placeholder="Exercise ${i + 1} name" maxlength="60" value="${esc(r.name)}">
      <label class="dur"><input class="ex-dur" type="number" min="1" max="3600" inputmode="numeric" value="${esc(r.duration)}" aria-label="Duration for exercise ${i + 1} in seconds"></label>`;
    ol.appendChild(li);
  });
  updateSummary();
}

function setExerciseCount(n) {
  syncRowsFromDom();
  const def = clampInt($('f-default').value, 1, 3600, 20);
  while (draftRows.length < n) draftRows.push({ name: '', duration: def });
  draftRows.length = n;
  renderRows();
}

function draftWorkout() {
  syncRowsFromDom();
  return {
    name: $('f-name').value.trim() || 'Workout',
    sets: clampInt($('f-sets').value, 1, 50, 1),
    exRest: clampInt($('f-exrest').value, 0, 3600, 0),
    setRest: clampInt($('f-setrest').value, 0, 3600, 0),
    exercises: draftRows.map((r, i) => ({
      name: (r.name || '').trim() || `Exercise ${i + 1}`,
      duration: clampInt(r.duration, 1, 3600, 20),
    })),
  };
}

function updateSummary() {
  const w = draftWorkout();
  $('edit-summary').textContent = `Total time: ${fmt(totalSeconds(w))} (includes rests, ${PREP_SECONDS}s start countdown and ${COUNTDOWN_SECONDS}s countdown before each exercise)`;
}

document.querySelectorAll('.stepper button').forEach((b) => {
  b.onclick = () => {
    const input = $(b.dataset.target);
    const v = clampInt(input.value, 1, 50, 1) + parseInt(b.dataset.step, 10);
    input.value = Math.min(50, Math.max(1, v));
    input.dispatchEvent(new Event('change'));
  };
});
$('f-count').addEventListener('change', () => {
  const n = clampInt($('f-count').value, 1, 50, 1);
  $('f-count').value = n;
  setExerciseCount(n);
});
$('f-sets').addEventListener('change', () => { $('f-sets').value = clampInt($('f-sets').value, 1, 50, 1); updateSummary(); });
$('edit-form').addEventListener('input', (e) => {
  if (e.target.id !== 'f-count') updateSummary();
});
$('btn-apply-all').onclick = () => {
  syncRowsFromDom();
  const def = clampInt($('f-default').value, 1, 3600, 20);
  draftRows.forEach((r) => { r.duration = def; });
  renderRows();
};
$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  // make sure count field is applied even if user didn't blur it
  const n = clampInt($('f-count').value, 1, 50, 1);
  if (n !== draftRows.length) setExerciseCount(n);
  const w = draftWorkout();
  if (editing) {
    Object.assign(editing, w);
  } else {
    w.id = uid();
    workouts.push(w);
  }
  saveWorkouts(workouts);
  goHome();
});
$('btn-edit-back').onclick = goHome;

/* ================= Audio ================= */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq = 880, ms = 150, vol = 0.5) {
  if (settings.muted || !audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.05);
}
const tick = () => beep(880, 160, 0.5);
const goBeep = () => beep(1320, 450, 0.6);
function doneChime() { beep(988, 180); setTimeout(() => beep(1319, 180), 200); setTimeout(() => beep(1568, 500), 400); }

let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => /^en[-_]US/i.test(v.lang) && v.localService)
    || voices.find((v) => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (settings.muted || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-US'; }
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    // Chrome can drop an utterance queued right after cancel(), so wait a beat.
    setTimeout(() => speechSynthesis.speak(u), 60);
  } else {
    speechSynthesis.speak(u);
  }
}
function unlockSpeech() {
  // A silent utterance during a user gesture unlocks speech on mobile browsers.
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

/* ================= Wake lock ================= */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* not available */ }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer && !timer.paused && !timer.done) requestWakeLock();
});

/* ================= Timer engine ================= */
let timer = null;
const RING_LEN = 2 * Math.PI * 90;

function startTimer(w) {
  ensureAudio();
  unlockSpeech();
  timer = {
    workout: w,
    segs: buildSegments(w),
    idx: 0,
    endAt: 0,
    remainingMs: 0,
    paused: false,
    done: false,
    lastSec: null,
    interval: null,
  };
  $('t-workout').textContent = w.name;
  updateMuteBtn();
  showView('timer');
  requestWakeLock();
  enterSegment(0);
  timer.interval = setInterval(onTick, 100);
}

function stopTimer(navigate = true) {
  if (timer) clearInterval(timer.interval);
  timer = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWakeLock();
  if (navigate) goHome();
}

function enterSegment(i, announce = true) {
  const seg = timer.segs[i];
  timer.idx = i;
  timer.endAt = performance.now() + seg.dur * 1000;
  timer.remainingMs = seg.dur * 1000;
  timer.lastSec = null;
  renderSegment();
  if (!announce) return;
  const w = timer.workout;
  const prev = timer.segs[i - 1];
  if (seg.type === 'prep') {
    speak(`Get ready. First exercise: ${seg.next}`);
  } else if (seg.type === 'work') {
    goBeep();
    const prefix = seg.firstOfSet && w.sets > 1 ? `Set ${seg.set}. ` : '';
    speak(prefix + seg.name);
  } else if (seg.type === 'rest') {
    goBeep();
    speak(seg.kind === 'set'
      ? `Rest ${seg.dur} seconds. Next set starts with ${seg.next}`
      : `Rest ${seg.dur} seconds. Next up: ${seg.next}`);
  } else if (seg.type === 'countdown' && !(prev && prev.type === 'rest')) {
    // No rest before this countdown, so announce what's coming now.
    speak(`Next: ${seg.next}`);
  }
  // countdown beeps come from onSecond()
}

function finish() {
  timer.done = true;
  clearInterval(timer.interval);
  const view = $('view-timer');
  view.className = 'view active timer phase-done';
  $('t-phase').textContent = 'COMPLETE';
  $('t-time').textContent = '✓';
  $('t-ring').style.strokeDashoffset = 0;
  $('t-exercise').textContent = 'Great work!';
  $('t-next').textContent = `${timer.workout.name} · ${fmt(totalSeconds(timer.workout))}`;
  $('t-total').textContent = '0:00';
  $('btn-pause').textContent = '↻';
  $('btn-pause').setAttribute('aria-label', 'Restart');
  doneChime();
  setTimeout(() => speak('Workout complete. Great job!'), 300);
  releaseWakeLock();
}

function onTick() {
  if (!timer || timer.paused || timer.done) return;
  let rem = timer.endAt - performance.now();
  // Handle large jumps (e.g. throttled in background) by advancing through segments
  while (rem <= 0) {
    if (timer.idx + 1 >= timer.segs.length) { finish(); return; }
    const overshoot = -rem;
    enterSegment(timer.idx + 1, overshoot < 1000);
    timer.endAt -= overshoot;
    rem = timer.endAt - performance.now();
  }
  timer.remainingMs = rem;
  const sec = Math.ceil(rem / 1000);
  if (sec !== timer.lastSec) {
    timer.lastSec = sec;
    onSecond(sec);
  }
  renderProgress(rem);
}

function onSecond(sec) {
  const seg = timer.segs[timer.idx];
  $('t-time').textContent = seg.dur >= 60 ? fmt(sec) : sec;
  if (seg.type === 'prep' || seg.type === 'countdown') {
    tick();
  }
}

function renderSegment() {
  const seg = timer.segs[timer.idx];
  const w = timer.workout;
  const view = $('view-timer');
  view.className = 'view active timer phase-' + seg.type;
  const labels = { prep: 'GET READY', countdown: 'NEXT UP', work: 'WORK', rest: 'REST' };
  $('t-phase').textContent = labels[seg.type];
  $('t-time').textContent = seg.dur >= 60 ? fmt(seg.dur) : seg.dur;
  $('t-set').textContent = `${seg.set}/${w.sets}`;
  $('t-ex').textContent = `${seg.ex + 1}/${w.exercises.length}`;
  if (seg.type === 'work') {
    $('t-exercise').textContent = seg.name;
    const nxt = timer.segs.slice(timer.idx + 1).find((s) => s.type === 'work');
    $('t-next').textContent = nxt ? `Next: ${nxt.name}` : 'Last exercise!';
  } else if (seg.type === 'rest') {
    $('t-exercise').textContent = 'Rest';
    $('t-next').textContent = seg.kind === 'set' ? `Next: Set ${seg.set + 1} · ${seg.next}` : `Next: ${seg.next}`;
  } else {
    $('t-exercise').textContent = seg.next;
    $('t-next').textContent = seg.type === 'prep' ? 'Starting soon' : '';
  }
  $('btn-pause').textContent = timer.paused ? '▶' : '⏸';
  $('btn-pause').setAttribute('aria-label', timer.paused ? 'Resume' : 'Pause');
  renderProgress(timer.remainingMs);
}

function renderProgress(rem) {
  const seg = timer.segs[timer.idx];
  const frac = Math.max(0, Math.min(1, rem / (seg.dur * 1000)));
  $('t-ring').style.strokeDashoffset = RING_LEN * (1 - frac);
  let total = rem / 1000;
  for (let i = timer.idx + 1; i < timer.segs.length; i++) total += timer.segs[i].dur;
  $('t-total').textContent = fmt(Math.ceil(total));
}

function togglePause() {
  if (!timer) return;
  if (timer.done) { const w = timer.workout; clearInterval(timer.interval); startTimerInPlace(w); return; }
  ensureAudio();
  if (timer.paused) {
    timer.paused = false;
    timer.endAt = performance.now() + timer.remainingMs;
    requestWakeLock();
  } else {
    timer.paused = true;
    timer.remainingMs = Math.max(0, timer.endAt - performance.now());
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  $('btn-pause').textContent = timer.paused ? '▶' : '⏸';
  $('btn-pause').setAttribute('aria-label', timer.paused ? 'Resume' : 'Pause');
  $('t-phase').textContent = timer.paused ? 'PAUSED' : { prep: 'GET READY', countdown: 'NEXT UP', work: 'WORK', rest: 'REST' }[timer.segs[timer.idx].type];
}

function startTimerInPlace(w) {
  // restart without pushing another history entry
  ensureAudio();
  unlockSpeech();
  timer = { workout: w, segs: buildSegments(w), idx: 0, endAt: 0, remainingMs: 0, paused: false, done: false, lastSec: null, interval: null };
  requestWakeLock();
  enterSegment(0);
  timer.interval = setInterval(onTick, 100);
}

function jump(delta) {
  if (!timer || timer.done) return;
  ensureAudio();
  let target = timer.idx + delta;
  if (delta < 0) {
    const seg = timer.segs[timer.idx];
    const elapsed = seg.dur * 1000 - (timer.paused ? timer.remainingMs : timer.endAt - performance.now());
    if (elapsed > 2000) target = timer.idx; // restart current segment
  }
  if (target >= timer.segs.length) { finish(); return; }
  target = Math.max(0, target);
  const wasPaused = timer.paused;
  timer.paused = false;
  enterSegment(target, !wasPaused);
  if (wasPaused) {
    timer.paused = true;
    $('btn-pause').textContent = '▶';
    $('t-phase').textContent = 'PAUSED';
  }
}

$('btn-pause').onclick = togglePause;
$('btn-skip').onclick = () => jump(1);
$('btn-prev').onclick = () => jump(-1);
$('btn-timer-close').onclick = () => {
  if (timer && !timer.done && !timer.paused && !confirm('Stop this workout?')) return;
  stopTimer(true);
};

function updateMuteBtn() {
  $('btn-mute').textContent = settings.muted ? '🔇' : '🔊';
  $('btn-mute').setAttribute('aria-label', settings.muted ? 'Unmute' : 'Mute');
}
$('btn-mute').onclick = () => {
  settings.muted = !settings.muted;
  if (settings.muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  saveSettings();
  updateMuteBtn();
};

/* ================= PWA install ================= */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('btn-install').classList.remove('hidden');
});
$('btn-install').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  $('btn-install').classList.add('hidden');
};
window.addEventListener('appinstalled', () => $('btn-install').classList.add('hidden'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

renderHome();
