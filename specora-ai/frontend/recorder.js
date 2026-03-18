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

  /**
   * Start live audio recording via microphone
   */
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = onRecordingStop;
      mediaRecorder.start(100);
      recording = true;
      paused = false;
      recSeconds = 0;

      updateUI('recording');
      startTimer();
      drawWaveform();
    } catch (e) {
      console.warn('Microphone access denied, using demo mode.');
      App.showNotif('Microphone access denied. Using demo mode.', '!');
      startDemoRecording();
    }
  }

  /**
   * Demo recording mode (no microphone)
   */
  function startDemoRecording() {
    recording = true;
    paused = false;
    recSeconds = 0;
    updateUI('recording');
    startTimer();
    drawDemoWaveform();
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
    if (audioChunks.length > 0) {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(recordedBlob);
      const audio = document.getElementById('rec-audio');
      if (audio) audio.src = url;
      document.getElementById('rec-preview').style.display = 'block';
      App.showNotif('Recording saved successfully!', '✓');
    } else {
      document.getElementById('rec-preview').style.display = 'block';
      document.getElementById('rec-time-dur').textContent = formatTime(recSeconds);
      App.showNotif('Demo recording ready for processing!', '✓');
    }
  }

  /**
   * Return the last recorded blob (or null)
   */
  function getRecordedBlob() {
    return recordedBlob;
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
    }
  }

  // ── Waveform (real) ──
  function drawWaveform() {
    if (!analyser) {
      drawDemoWaveform();
      return;
    }
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth;
    const H = 60;
    canvas.width = W;
    canvas.height = H;
    const buf = new Uint8Array(analyser.frequencyBinCount);

    function render() {
      animFrame = requestAnimationFrame(render);
      analyser.getByteFrequencyData(buf);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#181b22';
      ctx.fillRect(0, 0, W, H);
      const barW = (W / buf.length) * 2.5;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const barH = (buf[i] / 255) * H;
        const alpha = 0.5 + buf[i] / 512;
        ctx.fillStyle = `rgba(108,99,255,${alpha})`;
        ctx.fillRect(x, H - barH, barW - 1, barH);
        x += barW;
      }
    }
    render();
  }

  // ── Waveform (demo) ──
  function drawDemoWaveform() {
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 400;
    const H = 60;
    canvas.width = W;
    canvas.height = H;
    let t = 0;

    function render() {
      if (!recording && !paused) return;
      animFrame = requestAnimationFrame(render);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#181b22';
      ctx.fillRect(0, 0, W, H);
      const bars = Math.floor(W / 4);
      for (let i = 0; i < bars; i++) {
        const barH = (Math.sin(t + i * 0.3) * 0.5 + 0.5) * H * (0.3 + Math.random() * 0.4);
        const alpha = 0.4 + barH / H;
        ctx.fillStyle = `rgba(108,99,255,${alpha})`;
        ctx.fillRect(i * 4, H - barH, 3, barH);
      }
      t += 0.15;
    }
    render();
  }

  return {
    startRecording,
    pauseRecording,
    stopRecording,
    getRecordedBlob,
    isRecording,
  };
})();
