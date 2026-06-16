// popup.js
"use strict";

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const TEN_HOURS   = 10 * 60 * 60 * 1000;

// DOM refs
const setView        = document.getElementById("set-view");
const runView        = document.getElementById("run-view");
const tapBtn         = document.getElementById("tap-btn");
const tapNum         = document.getElementById("tap-num");
const setInfo        = document.getElementById("set-info");
const countdownWrap  = document.getElementById("countdown-wrap");
const countdownBar   = document.getElementById("countdown-bar");
const countdownText  = document.getElementById("countdown-text");
const startNowBtn    = document.getElementById("start-now-btn");
const elapsedTime    = document.getElementById("elapsed-time");
const statusLabel    = document.getElementById("status-label");
const nextLabel      = document.getElementById("next-label");
const alertBadge     = document.getElementById("alert-badge");
const resetBtn       = document.getElementById("reset-btn");

let tickInterval      = null;
let countdownInterval = null;

// ── 初期化 ────────────────────────────────────────────────────
getStatus().then(render);

// ── タップボタン ──────────────────────────────────────────────
tapBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "INCREMENT_OFFSET" }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    const { pendingOffset, alarmFireTime } = res;
    tapNum.textContent = pendingOffset;
    updateSetInfo(pendingOffset);
    startCountdown(alarmFireTime);
    startNowBtn.classList.add("visible");
  });
});

// ── 今すぐ開始 ────────────────────────────────────────────────
startNowBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "START_NOW" }, () => {
    stopCountdown();
    getStatus().then(render);
    startTick();
  });
});

// ── やり直し ─────────────────────────────────────────────────
resetBtn.addEventListener("click", () => {
  stopTick();
  stopCountdown();
  chrome.runtime.sendMessage({ type: "RESET_TIMER" }, () => {
    render({ timerState: "idle", pendingOffset: 0 });
  });
});

// ── 初期描画 ─────────────────────────────────────────────────
function render(data) {
  const state = data.timerState || "idle";

  if (state === "running") {
    showRunView();
    renderElapsed(data.startTime, data.hourOffset || 0, data.notified8h || false);
    startTick();
  } else {
    showSetView();
    const offset = data.pendingOffset || 0;
    tapNum.textContent = offset;
    updateSetInfo(offset);

    if (state === "pending" && data.alarmFireTime) {
      startNowBtn.classList.add("visible");
      startCountdown(data.alarmFireTime);
    }
  }
}

// ── ビュー切替 ────────────────────────────────────────────────
function showSetView() {
  setView.style.display = "flex";
  runView.style.display = "none";
}
function showRunView() {
  setView.style.display = "none";
  runView.style.display = "flex";
}

// ── セット情報テキスト ────────────────────────────────────────
function updateSetInfo(offset) {
  if (offset === 0) {
    setInfo.textContent = "今すぐ開始（8時間後に通知）";
  } else {
    const remain = 8 - offset;
    if (remain <= 0) {
      setInfo.textContent = `${offset}時間目から→既に8時間超過`;
    } else {
      setInfo.textContent = `${offset}時間目から → あと ${remain} 時間で通知`;
    }
  }
}

// ── カウントダウンバー ────────────────────────────────────────
function startCountdown(fireTime) {
  stopCountdown();
  countdownWrap.classList.add("visible");
  updateCountdown(fireTime);
  countdownInterval = setInterval(() => {
    const done = updateCountdown(fireTime);
    if (done) {
      stopCountdown();
      // タイマーが開始されたはずなので running ビューへ遷移
      setTimeout(() => getStatus().then(render), 300);
    }
  }, 100);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  countdownWrap.classList.remove("visible");
}

/** @returns {boolean} 残り0になったか */
function updateCountdown(fireTime) {
  const remaining = Math.max(0, fireTime - Date.now());
  const fraction  = remaining / 5000;
  countdownBar.style.width = (fraction * 100) + "%";
  countdownText.textContent = (remaining / 1000).toFixed(1) + " 秒後に自動開始";
  return remaining <= 0;
}

// ── 実行中：毎秒更新 ─────────────────────────────────────────
function startTick() {
  stopTick();
  tickInterval = setInterval(() => {
    getStatus().then((data) => {
      if (data.timerState !== "running") { stopTick(); render(data); return; }
      renderElapsed(data.startTime, data.hourOffset || 0, data.notified8h || false);
    });
  }, 1000);
}
function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

// ── 経過時間表示 ──────────────────────────────────────────────
function renderElapsed(startTime, hourOffset, notified8h) {
  const elapsed   = Date.now() - startTime + hourOffset * 3600000;
  const totalSec  = Math.floor(elapsed / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  elapsedTime.textContent = `${pad(h)} : ${pad(m)} : ${pad(s)}`;
  elapsedTime.className   = "";

  if (elapsed >= TEN_HOURS) {
    elapsedTime.classList.add("red");
    statusLabel.textContent = "10時間超過";
  } else if (notified8h || elapsed >= EIGHT_HOURS) {
    elapsedTime.classList.add("orange");
    statusLabel.textContent = "8時間超過";
  } else {
    statusLabel.textContent = "計測中…";
  }

  if (notified8h || elapsed >= EIGHT_HOURS) {
    alertBadge.classList.add("visible");
  } else {
    alertBadge.classList.remove("visible");
  }

  if (elapsed < EIGHT_HOURS) {
    const rem = EIGHT_HOURS - elapsed;
    const rh  = Math.floor(rem / 3600000);
    const rm  = Math.floor((rem % 3600000) / 60000);
    const rs  = Math.floor((rem % 60000) / 1000);
    nextLabel.textContent = `8時間まで あと ${pad(rh)}:${pad(rm)}:${pad(rs)}`;
  } else {
    nextLabel.textContent = "";
  }
}

function pad(n) { return String(n).padStart(2, "0"); }

function getStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (data) => {
      if (chrome.runtime.lastError || !data) resolve({ timerState: "idle", pendingOffset: 0 });
      else resolve(data);
    });
  });
}
