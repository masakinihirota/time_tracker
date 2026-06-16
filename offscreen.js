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
  const DURATION = 0.6;  // 1回だけの短いチャイム
  const BEEP_LEN = 0.32; // ゆるやかな単音

  const ctx = new AudioContext();

  // ぴこぴこ2回ではなく、穏やかな1回のみ
  makeBeep(ctx, 0, BEEP_LEN, 698); // F5

  // 全ビープ終了まで待機
  return new Promise((resolve) => {
    setTimeout(() => {
      ctx.close();
      resolve();
    }, (DURATION + 0.1) * 1000);
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
  gain.gain.linearRampToValueAtTime(0.14, t0 + 0.07);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration);
}
