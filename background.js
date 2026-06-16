// background.js  – Service Worker
'use strict';

const OFFSET_ALARM = 'offset-confirm'; // 5秒後にタイマー開始
const TICK_ALARM   = 'timer-tick';     // 毎分アイコン更新
const EIGHT_HOURS  = 8  * 60 * 60 * 1000;
const TEN_HOURS    = 10 * 60 * 60 * 1000;
const CONFIRM_SEC  = 5; // 何秒後に自動確定するか

// ── 色定数 ───────────────────────────────────────────────────
const COLOR_IDLE    = '#9e9e9e'; // 未開始：グレー
const COLOR_PENDING = '#F9A825'; // セット中：アンバー
const COLOR_BLUE    = '#1976D2'; // 通常：青
const COLOR_ORANGE  = '#F57C00'; // 8時間超：オレンジ
const COLOR_RED     = '#D32F2F'; // 10時間超：赤

// ── 起動・インストール時 ───────────────────────────────────────
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.action.onClicked.addListener(() => {
  handleActionClick().catch(() => {});
});

async function init() {
  const data = await chrome.storage.local.get(
    ['timerState', 'startTime', 'hourOffset', 'notified8h', 'pendingOffset', 'nextChimeElapsedMs']
  );

  if (data.timerState === 'running' && data.startTime) {
    const elapsed = Date.now() - data.startTime + (data.hourOffset || 0) * 3600000;

    let nextChimeElapsedMs = data.nextChimeElapsedMs || computeNextChimeElapsedMs(elapsed);
    if (elapsed >= nextChimeElapsedMs) {
      await triggerAlarmSound();
      nextChimeElapsedMs = computeNextChimeElapsedMs(elapsed);
      await chrome.storage.local.set({ nextChimeElapsedMs });
    }

    const alarm = await chrome.alarms.get(TICK_ALARM);
    if (!alarm) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
    const refreshed = await chrome.storage.local.get(['startTime', 'hourOffset', 'notified8h', 'nextChimeElapsedMs']);
    await updateRunningIcon(
      refreshed.startTime,
      refreshed.hourOffset || 0,
      refreshed.notified8h || false
    );

  } else if (data.timerState === 'pending') {
    // SW再起動中にアラームが消えていたら即タイマー開始
    const alarm = await chrome.alarms.get(OFFSET_ALARM);
    if (!alarm) {
      await startTimer(data.pendingOffset || 0);
    } else {
      await drawIcon(String(data.pendingOffset || 0), COLOR_PENDING);
    }

  } else {
    await chrome.storage.local.set({ timerState: 'idle', pendingOffset: 0 });
    await drawIcon('', COLOR_IDLE);
  }
}

// ── アラーム ─────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {

  // 5秒後自動確定 → タイマー開始
  if (alarm.name === OFFSET_ALARM) {
    const { pendingOffset = 0 } = await chrome.storage.local.get('pendingOffset');
    await startTimer(pendingOffset);
    return;
  }

  // 毎分アイコン更新 ＆ 8時間通知チェック
  if (alarm.name === TICK_ALARM) {
    const data = await chrome.storage.local.get(
      ['timerState', 'startTime', 'hourOffset', 'notified8h', 'nextChimeElapsedMs']
    );
    if (data.timerState !== 'running' || !data.startTime) return;

    const elapsed = Date.now() - data.startTime + (data.hourOffset || 0) * 3600000;
    let nextChimeElapsedMs = data.nextChimeElapsedMs || computeNextChimeElapsedMs(elapsed);

    // 8時間ごとに通知（計測は継続）
    if (elapsed >= nextChimeElapsedMs) {
      await triggerAlarmSound();
      nextChimeElapsedMs = computeNextChimeElapsedMs(elapsed);
      await chrome.storage.local.set({ nextChimeElapsedMs });
    }

    await updateRunningIcon(data.startTime, data.hourOffset || 0, data.notified8h || false);
  }
});

// ── メッセージ ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ALARM_DONE') {
    chrome.offscreen.closeDocument().catch(() => {});
    sendResponse({ ok: true });
  }
});

// ── アイコン押下でオフセット選択 ───────────────────────────────
async function handleActionClick() {
  const data = await chrome.storage.local.get(['timerState', 'pendingOffset']);

  if (data.timerState === 'pending') {
    // 1回目=0, 2回目=1, 3回目=2 ... 最大7
    const nextOffset = Math.min((data.pendingOffset ?? -1) + 1, 7);
    await setPendingOffset(nextOffset);
    return;
  }

  if (data.timerState === 'running') {
    // 計測中に押したら、再設定モードへ入り直す
    await chrome.alarms.clear(TICK_ALARM);
    await chrome.storage.local.set({
      timerState:    'idle',
      startTime:     null,
      hourOffset:    0,
      notified8h:    false,
      pendingOffset: 0,
      alarmFireTime: null,
    });
  }

  await setPendingOffset(0);
}

async function setPendingOffset(offset) {
  const fireTime = Date.now() + CONFIRM_SEC * 1000;
  await chrome.alarms.clear(OFFSET_ALARM);
  chrome.alarms.create(OFFSET_ALARM, { delayInMinutes: CONFIRM_SEC / 60 });

  await chrome.storage.local.set({
    timerState:    'pending',
    pendingOffset: offset,
    alarmFireTime: fireTime,
  });

  await drawIcon(String(offset), COLOR_PENDING);
}

// ── タイマー開始 ──────────────────────────────────────────────
async function startTimer(hourOffset) {
  const startTime = Date.now();
  const elapsedAtStart = hourOffset * 3600000;
  await chrome.storage.local.set({
    timerState:    'running',
    startTime,
    hourOffset,
    nextChimeElapsedMs: computeNextChimeElapsedMs(elapsedAtStart),
    pendingOffset: 0,
    notified8h:    false,
    alarmFireTime: null,
  });

  await chrome.alarms.clear(TICK_ALARM);
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await updateRunningIcon(startTime, hourOffset, false);
}

// ── リセット ─────────────────────────────────────────────────
async function resetTimer() {
  await chrome.alarms.clear(TICK_ALARM);
  await chrome.alarms.clear(OFFSET_ALARM);
  await chrome.storage.local.set({
    timerState:    'idle',
    pendingOffset: 0,
    startTime:     null,
    hourOffset:    0,
    nextChimeElapsedMs: null,
    notified8h:    false,
    alarmFireTime: null,
  });
  chrome.offscreen.closeDocument().catch(() => {});
  await drawIcon('', COLOR_IDLE);
}

// ── 実行中アイコン更新 ────────────────────────────────────────
async function updateRunningIcon(startTime, hourOffset, notified8h) {
  const elapsed    = Date.now() - startTime + hourOffset * 3600000;
  const totalHours = Math.floor(elapsed / 3600000);
  const hoursInDay = totalHours % 24;
  const onHourBoundary = (elapsed % 3600000) < 60000;
  const displayNum = (totalHours > 0 && hoursInDay === 0 && onHourBoundary) ? 24 : hoursInDay;
  const text       = String(displayNum);

  let color;
  if (elapsed >= TEN_HOURS)                        color = COLOR_RED;
  else if (notified8h || elapsed >= EIGHT_HOURS)   color = COLOR_ORANGE;
  else                                             color = COLOR_BLUE;

  await drawIcon(text, color);
}

// ── OffscreenCanvas でアイコン描画 ────────────────────────────
async function drawIcon(text, bgColor) {
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const ctx    = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();

  if (text !== '') {
    ctx.fillStyle    = '#ffffff';
    // 文字幅を見ながら、収まる範囲で最大フォントを使う
    let fontSize = text.length >= 2 ? 34 : 40;
    while (fontSize > 16) {
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      const metrics = ctx.measureText(text);
      if (metrics.width <= size - 6) break;
      fontSize -= 1;
    }
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 1.5);
  } else {
    // 未開始：時計アイコン
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2, size / 2 - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + 8, size / 2);
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  await chrome.action.setIcon({ imageData });
}

// ── Offscreen ドキュメント（音声再生用）─────────────────────────
let offscreenCreating = null;

async function triggerAlarmSound() {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'PLAY_ALARM' }).catch(() => {});
}

async function ensureOffscreen() {
  if (offscreenCreating) { await offscreenCreating; return; }

  let exists = false;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    exists = contexts.length > 0;
  } catch (_) {}

  if (exists) return;

  offscreenCreating = chrome.offscreen.createDocument({
    url:           'offscreen.html',
    reasons:       ['AUDIO_PLAYBACK'],
    justification: '8時間経過アラーム音の再生',
  });
  try { await offscreenCreating; } finally { offscreenCreating = null; }
}

function computeNextChimeElapsedMs(elapsedMs) {
  return (Math.floor(elapsedMs / EIGHT_HOURS) + 1) * EIGHT_HOURS;
}
