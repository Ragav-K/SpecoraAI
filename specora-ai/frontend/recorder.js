/**
 * Specora AI — Audio Recorder Module
 * Handles MediaRecorder, waveform visualization, and file upload
 */
const Recorder = (() => {
  let mediaRecorder = null;
  let audioChunks = [];
  let audioCtx = null;
  let analyser = null;
  let recInterval = null;
  let recSeconds = 0;
  let animFrame = null;
  let recording = false;
  let paused = false;
  let recordedBlob = null;
  let recordedMimeType = '';
  let previewObjectUrl = null;

  // Candidate container/codec combinations, best first. Chrome/Firefox pick
  // webm; Safari only supports mp4 — recording there and then labelling the
  // blob "audio/webm" produces a mislabelled upload.
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return '';
    }
    return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  /** Release the previous take's resources before starting a new one. */
  function resetTake() {
    // Without this, a failed second take silently re-submits the first one.
    recordedBlob = null;
    recordedMimeType = '';
    audioChunks = [];

    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    const preview = document.getElementById('rec-preview');
    if (preview) preview.style.display = 'none';

    const audio = document.getElementById('rec-audio');
    if (audio) audio.removeAttribute('src');
  }

  function releaseAudioContext() {
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    analyser = null;
  }

  /**
   * Start live audio recording via microphone
   */
  async function startRecording() {
    resetTake();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // No fake "demo mode": it animated a waveform and claimed a recording was
      // ready while capturing nothing, so processing failed later with a
      // misleading message. Tell the user the truth instead.
      console.warn('Microphone access failed:', e.name, e.message);

      const message =
        e.name === 'NotAllowedError' || e.name === 'SecurityError'
          ? 'Microphone access was denied. Enable it in your browser settings, or use the Upload tab instead.'
          : e.name === 'NotFoundError'
            ? 'No microphone was found. Connect one, or use the Upload tab instead.'
            : `Could not start recording: ${e.message}. You can use the Upload tab instead.`;

      App.showNotif(message, '!');
      updateUI('idle');
      return;
    }

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const mimeType = pickMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      // Trust the recorder's own report over our request.
      recordedMimeType = mediaRecorder.mimeType || mimeType || '';

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = onRecordingStop;
      mediaRecorder.start(100);

      recording = true;
      paused = false;
      recSeconds = 0;

      updateUI('recording');
      startTimer();
      drawWaveform();
    } catch (e) {
      console.error('Failed to start recorder:', e);
      stream.getTracks().forEach((t) => t.stop());
      releaseAudioContext();
      App.showNotif(`Could not start recording: ${e.message}`, '!');
      updateUI('idle');
    }
  }

  /**
   * Pause or resume recording
   */
  function pauseRecording() {
    if (!recording) return;

    if (!paused) {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
      clearInterval(recInterval);
      paused = true;
      updateUI('paused');
    } else {
      if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume();
      paused = false;
      updateUI('recording');
      startTimer();
    }
  }

  /**
   * Stop recording
   */
  function stopRecording() {
    clearInterval(recInterval);
    cancelAnimationFrame(animFrame);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      // Stream tracks need to be stopped to release the microphone
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    } else {
      onRecordingStop();
    }

    recording = false;
    paused = false;
    updateUI('stopped');
  }

  /**
   * Called when recording finishes
   */
  function onRecordingStop() {
    releaseAudioContext();

    if (audioChunks.length === 0) {
      // Nothing was captured — say so rather than implying a usable recording.
      App.showNotif('No audio was captured. Please try recording again.', '!');
      updateUI('idle');
      return;
    }

    // Carry the real recorded type through instead of hardcoding webm.
    const type = recordedMimeType || audioChunks[0].type || 'audio/webm';
    recordedBlob = new Blob(audioChunks, { type });
    recordedMimeType = type;

    previewObjectUrl = URL.createObjectURL(recordedBlob);
    const audio = document.getElementById('rec-audio');
    if (audio) audio.src = previewObjectUrl;

    const preview = document.getElementById('rec-preview');
    if (preview) preview.style.display = 'block';

    const dur = document.getElementById('rec-time-dur');
    if (dur) dur.textContent = formatTime(recSeconds);

    App.showNotif('Recording saved successfully!', '✓');
  }

  /**
   * Return the last recorded blob (or null)
   */
  function getRecordedBlob() {
    return recordedBlob;
  }

  /**
   * The actual MIME type of the last recording, so the upload can be named and
   * labelled correctly (Safari records mp4, not webm).
   */
  function getRecordedMimeType() {
    return recordedMimeType;
  }

  /**
   * Check if currently recording
   */
  function isRecording() {
    return recording;
  }

  // ── Timer ──
  function startTimer() {
    recInterval = setInterval(() => {
      recSeconds++;
      document.getElementById('rec-timer').textContent = formatTimerDisplay(recSeconds);
    }, 1000);
  }

  function formatTimerDisplay(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }

  function formatTime(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ── UI updates ──
  function updateUI(state) {
    const dot = document.getElementById('rec-dot');
    const statusText = document.getElementById('rec-status-text');
    const badge = document.getElementById('rec-badge');
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');

    switch (state) {
      case 'recording':
        dot.className = 'rec-dot recording';
        statusText.textContent = 'Recording...';
        badge.textContent = 'Recording';
        badge.className = 'badge badge-red';
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnPause.textContent = '⏸ Pause';
        btnStop.disabled = false;
        break;
      case 'paused':
        dot.className = 'rec-dot paused';
        statusText.textContent = 'Paused';
        badge.textContent = 'Paused';
        badge.className = 'badge badge-amber';
        btnPause.textContent = '▶ Resume';
        break;
      case 'stopped':
        dot.className = 'rec-dot';
        statusText.textContent = 'Recording saved';
        badge.textContent = 'Saved';
        badge.className = 'badge badge-green';
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = true;
        break;
      case 'idle':
        // Recording never started, or captured nothing — reset the controls.
        dot.className = 'rec-dot';
        statusText.textContent = 'Ready to record';
        badge.textContent = 'Idle';
        badge.className = 'badge badge-amber';
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnPause.textContent = '⏸ Pause';
        btnStop.disabled = true;
        clearCanvas();
        break;
    }
  }

  function clearCanvas() {
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Read a CSS custom property so the canvas can never drift from the theme.
   * Hardcoding colours here is what left the waveform dark-themed after a restyle.
   */
  function token(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // ── Waveform (real) ──
  function drawWaveform() {
    // Only ever driven by real microphone data — there is no synthetic fallback.
    if (!analyser) return;
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth;
    const H = 60;
    canvas.width = W;
    canvas.height = H;
    const buf = new Uint8Array(analyser.frequencyBinCount);

    const trackColor = token('--bg3', '#F1F3F6');
    const barColor = token('--accent', '#0E7C74');

    function render() {
      animFrame = requestAnimationFrame(render);
      analyser.getByteFrequencyData(buf);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = trackColor;
      ctx.fillRect(0, 0, W, H);
      const barW = (W / buf.length) * 2.5;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const barH = (buf[i] / 255) * H;
        const alpha = 0.45 + buf[i] / 512;
        ctx.fillStyle = barColor;
        ctx.globalAlpha = Math.min(alpha, 1);
        ctx.fillRect(x, H - barH, barW - 1, barH);
        x += barW;
      }
      // Reset, or the last bar's alpha bleeds into next frame's background fill.
      ctx.globalAlpha = 1;
    }
    render();
  }

  return {
    startRecording,
    pauseRecording,
    stopRecording,
    getRecordedBlob,
    getRecordedMimeType,
    isRecording,
  };
})();
