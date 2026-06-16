// offscreen.js – 音声再生専用ドキュメント
'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PLAY_ALARM') {
    playAlarm().then(() => {
      // 再生完了を background に通知
      chrome.runtime.sendMessage({ type: 'ALARM_DONE' }).catch(() => {});
    });
    sendResponse({ ok: true });
  }
});

async function playAlarm() {
  const DURATION   = 4.0;  // 秒（3〜5秒の範囲）
  const BEEP_INTERVAL = 0.55; // ビープ間隔（秒）
  const BEEP_LEN   = 0.40; // 1ビープの長さ（秒）

  const ctx = new AudioContext();

  for (let t = 0; t + BEEP_LEN <= DURATION; t += BEEP_INTERVAL) {
    // 高音ビープ
    makeBeep(ctx, t, BEEP_LEN * 0.6, 1046); // C6
    // 少し遅れて低音
    makeBeep(ctx, t + BEEP_LEN * 0.6, BEEP_LEN * 0.35, 784); // G5
  }

  // 全ビープ終了まで待機
  return new Promise((resolve) => {
    setTimeout(() => {
      ctx.close();
      resolve();
    }, (DURATION + 0.5) * 1000);
  });
}

function makeBeep(ctx, startOffset, duration, freq) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type            = 'sine';
  osc.frequency.value = freq;

  const t0 = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.7, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration);
}
