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
const DEFAULT_SETTINGS = { muted: false, voiceURI: '', rate: 1.08, pitch: 1.2 };
function loadSettings() {
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
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
let masterGain = null;
function beep(freq = 880, ms = 150, vol = 0.3) {
  if (settings.muted || !audioCtx) return;
  if (!masterGain) {
    // Keep the overall level well below clipping; a limiter catches any peaks.
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.1;
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(comp).connect(audioCtx.destination);
  }
  const t = audioCtx.currentTime + 0.01;
  const dur = ms / 1000;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  // Smooth attack and release so the tone has no clicks or crackle.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.012);
  gain.gain.setValueAtTime(vol, t + Math.max(0.013, dur - 0.06));
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const tick = () => beep(880, 140, 0.3);
const goBeep = () => beep(1175, 300, 0.35);
function doneChime() { beep(988, 160); setTimeout(() => beep(1319, 160), 180); setTimeout(() => beep(1568, 400), 360); }

/* ---- Voice ---- */
const FEMALE_RE = /female|woman|samantha|zira|aria|jenny|michelle|emma|ava\b|allison|susan|karen|moira|tessa|fiona|victoria|serena|kate|libby|sonia|natasha|hazel|heather|catherine|joanna|salli|kimberly|ivy|kendra|nicole|olivia|amy|google us english|x-sfg|x-tpf|x-tpc|x-iob|x-iog/i;
const MALE_RE = /\bmale\b|\bman\b|guy|david|mark|james|daniel|alex\b|fred|tom\b|ryan|george|matthew|joey|justin|brian|google uk english male|x-iol|x-tpd|x-iom/i;
const HQ_RE = /natural|neural|online|enhanced|premium|high/i;

let voice = null;
function englishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}
function voiceScore(v) {
  let s = 0;
  if (FEMALE_RE.test(v.name) || FEMALE_RE.test(v.voiceURI)) s += 100;
  else if (MALE_RE.test(v.name) || MALE_RE.test(v.voiceURI)) s -= 100;
  if (HQ_RE.test(v.name)) s += 30;
  if (!v.localService) s += 20; // network voices are usually the higher-quality ones
  if (/^en[-_]US/i.test(v.lang)) s += 10;
  if (v.default) s += 5;
  return s;
}
function pickVoice() {
  const voices = englishVoices();
  if (!voices.length) return;
  voice = (settings.voiceURI && voices.find((v) => v.voiceURI === settings.voiceURI))
    || voices.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  if (currentView === 'settings') renderSettings();
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (settings.muted || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-US'; }
  u.rate = settings.rate;
  u.pitch = settings.pitch;
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
  // Beep first, then speak once the beep has finished, so they never overlap.
  const afterBeep = (text) => setTimeout(() => { if (timer && timer.idx === i && !timer.paused) speak(text); }, 330);
  if (seg.type === 'prep') {
    speak(`Get ready! First up: ${seg.next}!`);
  } else if (seg.type === 'work') {
    goBeep();
    const isLast = seg.set === w.sets && seg.ex === w.exercises.length - 1;
    if (seg.firstOfSet && w.sets > 1) afterBeep(`Set ${seg.set}! ${seg.name}! Let's go!`);
    else if (isLast && w.exercises.length * w.sets > 1) afterBeep(`Last one! ${seg.name}! Give it everything!`);
    else afterBeep(`${seg.name}! Go!`);
  } else if (seg.type === 'rest') {
    goBeep();
    afterBeep(seg.kind === 'set'
      ? `Great set! Rest ${seg.dur} seconds. Next set starts with ${seg.next}!`
      : `Nice work! Rest ${seg.dur} seconds. Next up: ${seg.next}!`);
  } else if (seg.type === 'countdown' && !(prev && prev.type === 'rest')) {
    // No rest before this countdown, so announce what's coming now.
    speak(`Next up: ${seg.next}!`);
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
  setTimeout(() => speak('Workout complete! You crushed it! Amazing job!'), 800);
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
  if (seg.type === 'countdown' || (seg.type === 'prep' && sec <= 3)) {
    // In the 5s start countdown the voice speaks during 5-4, then beeps 3-2-1.
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

/* ================= Voice settings ================= */
function voiceLabel(v) {
  const tags = [];
  if (FEMALE_RE.test(v.name) || FEMALE_RE.test(v.voiceURI)) tags.push('female');
  if (HQ_RE.test(v.name) || !v.localService) tags.push('HQ');
  return `${v.name} (${v.lang})${tags.length ? ' · ' + tags.join(', ') : ''}`;
}
function renderSettings() {
  const sel = $('s-voice');
  const voices = englishVoices().sort((a, b) => voiceScore(b) - voiceScore(a));
  sel.innerHTML = '';
  if (!voices.length) {
    sel.innerHTML = '<option>Default voice</option>';
  }
  voices.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = voiceLabel(v);
    if (voice && v.voiceURI === voice.voiceURI) o.selected = true;
    sel.appendChild(o);
  });
  $('s-pitch').value = settings.pitch;
  $('s-rate').value = settings.rate;
  $('s-pitch-val').textContent = Number(settings.pitch).toFixed(2);
  $('s-rate-val').textContent = Number(settings.rate).toFixed(2) + '×';
}
$('btn-settings').onclick = () => { pickVoice(); renderSettings(); showView('settings'); };
$('btn-settings-back').onclick = goHome;
$('s-voice').onchange = () => {
  settings.voiceURI = $('s-voice').value;
  saveSettings(); pickVoice(); testVoice();
};
$('s-pitch').oninput = () => { settings.pitch = parseFloat($('s-pitch').value); $('s-pitch-val').textContent = settings.pitch.toFixed(2); saveSettings(); };
$('s-rate').oninput = () => { settings.rate = parseFloat($('s-rate').value); $('s-rate-val').textContent = settings.rate.toFixed(2) + '×'; saveSettings(); };
function testVoice() {
  const wasMuted = settings.muted;
  settings.muted = false;
  speak("Let's go! Jumping jacks! You've got this!");
  settings.muted = wasMuted;
}
$('btn-test-voice').onclick = testVoice;
$('btn-reset-voice').onclick = () => {
  Object.assign(settings, { voiceURI: '', rate: DEFAULT_SETTINGS.rate, pitch: DEFAULT_SETTINGS.pitch });
  saveSettings(); pickVoice(); renderSettings();
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
