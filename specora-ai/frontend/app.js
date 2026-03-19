/**
 * Specora AI — Main Application Module
 * Navigation, state management, rendering, editor, and export logic
 */
const App = (() => {
  // ── State ──
  const state = {
    currentPage: 'landing',
    inputTab: 'record',
    uploadedFile: null,
    detailPlaying: false,
    currentMeetingId: null,
    meetings: [],
    docs: { srs: null, stories: null, api: null, db: null, arch: null },
    user: null, // Stores logged in user
    audioObjectUrl: null,
  };

  function getSession() {
    const raw = localStorage.getItem('specora_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      localStorage.removeItem('specora_session');
      return null;
    }
  }

  // ── Navigation ──
  function nav(page) {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    state.currentPage = page;

    const navMap = {
      landing: 'Home',
      dashboard: 'Dashboard',
      'new-meeting': 'New Meeting',
      'meeting-detail': 'Meeting Detail',
      docs: 'Documentation',
      editor: 'Editor',
      export: 'Export',
    };
    document.querySelectorAll('.nav-item').forEach((n) => {
      if (n.textContent.trim().includes(navMap[page] || '')) n.classList.add('active');
    });

    if (page === 'dashboard') renderDashboard();
    if (page === 'meeting-detail') renderMeetingDetail();
    if (page === 'docs') renderDocs();
    if (page === 'editor') loadEditorDoc('srs');
  }

  // ── Dashboard ──
  async function renderDashboard() {
    const el = document.getElementById('meetings-list');
    const statsCards = document.querySelectorAll('.stat-card .stat-val');

    try {
      state.meetings = await API.getMeetings();
    } catch (e) {
      // If backend is down, use empty array
      state.meetings = [];
    }

    const meetings = state.meetings;

    // Update stats
    const total = meetings.length;
    const transcribed = meetings.filter((m) => m.transcript).length;
    const analyzed = meetings.filter((m) => m.status === 'completed').length;
    const exported = 0; // tracked locally

    if (statsCards.length >= 4) {
      statsCards[0].textContent = total;
      statsCards[1].textContent = transcribed;
      statsCards[2].textContent = analyzed;
      statsCards[3].textContent = exported;
    }

    const statusColors = {
      completed: 'badge-green',
      analyzing: 'badge-purple',
      transcribing: 'badge-teal',
      created: 'badge-amber',
      error: 'badge-red',
    };

    if (meetings.length === 0) {
      el.innerHTML = `
        <div class="card center" style="padding:40px">
          <div style="font-size:32px;margin-bottom:12px">📭</div>
          <h3 class="mb8">No meetings yet</h3>
          <p class="text2 text-sm mb16">Create your first meeting to get started</p>
          <button class="btn btn-primary" onclick="App.nav('new-meeting')">+ New Meeting</button>
        </div>`;
      return;
    }

    el.innerHTML = meetings
      .map(
        (m) => `
      <div class="meeting-card" onclick="App.viewMeeting('${m._id}')">
        <div class="fl-row sb">
          <h3>${m.title}</h3>
          <span class="badge ${statusColors[m.status] || 'badge-amber'}">${m.status}</span>
        </div>
        <div class="fl-row gap8 text-sm text2">
          <span>📅 ${new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span>·</span>
          <span>${m.transcript ? '📝 Transcribed' : '⏳ Pending'}</span>
        </div>
        <p class="text-sm text2">${m.transcript ? m.transcript.substring(0, 120) + '...' : 'No transcript yet'}</p>
      </div>`
      )
      .join('');
    
    // Sync sidebar list whenever dashboard renders (since it fetches latest)
    renderSidebarMeetings();
  }

  function renderSidebarMeetings() {
    const el = document.getElementById('sidebar-meetings');
    if (!el) return;

    if (state.meetings.length === 0) {
      el.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text3);">No meetings</div>';
      return;
    }

    // Show top 10 most recent
    el.innerHTML = state.meetings.slice(0, 10).map(m => `
      <button class="nav-item ${state.currentMeetingId === m._id ? 'active' : ''}" 
              style="padding:6px 12px;font-size:12.5px;gap:8px;" 
              onclick="App.viewMeeting('${m._id}')">
        <span style="font-size:12px;">📄</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.title}</span>
      </button>
    `).join('');
  }

  // ── View a specific meeting ──
  async function viewMeeting(id) {
    state.currentMeetingId = id;
    renderSidebarMeetings(); // Update sidebar highlight
    try {
      const meeting = await API.getMeeting(id);
      state.docs = {
        srs: meeting.srs || '',
        stories: meeting.userStories || [],
        api: meeting.apiEndpoints || [],
        db: meeting.dbTables || [],
        arch: meeting.architecture || '',
      };
    } catch (e) {
      console.error('Failed to load meeting:', e.message);
    }
    nav('meeting-detail');
  }

  // ── Meeting Detail ──
  async function renderMeetingDetail() {
    if (!state.currentMeetingId) {
      setDefaultDocs();
      renderReqs();
      return;
    }

    try {
      const meeting = await API.getMeeting(state.currentMeetingId);
      document.getElementById('detail-title').textContent = meeting.title;

      // Audio
      const audioContainer = document.getElementById('detail-audio-container');
      const audioPlayer = document.getElementById('detail-audio-player');
      const audioDownload = document.getElementById('detail-audio-download');
      const noAudio = document.getElementById('detail-no-audio');
      
      if (state.audioObjectUrl) {
        URL.revokeObjectURL(state.audioObjectUrl);
        state.audioObjectUrl = null;
      }

      if (meeting.audioUrl) {
        try {
          const audioBlob = await API.getMeetingAudio(state.currentMeetingId);
          const audioSrc = URL.createObjectURL(audioBlob);
          state.audioObjectUrl = audioSrc;
          audioPlayer.src = audioSrc;
          audioDownload.href = audioSrc;
          audioDownload.download = `${meeting.title || 'specora-audio'}.webm`;
          audioContainer.style.display = 'block';
          noAudio.style.display = 'none';
        } catch (err) {
          console.error('Audio playback error:', err);
          audioContainer.style.display = 'none';
          noAudio.style.display = 'block';
          showNotif('Unable to load meeting audio', '!');
        }
      } else {
        audioContainer.style.display = 'none';
        noAudio.style.display = 'block';
      }

      // Transcript
      const transcriptEl = document.getElementById('detail-transcript');
      if (meeting.transcript) {
        // SECURITY: render transcript as plain text to avoid stored XSS
        transcriptEl.textContent = meeting.transcript;
      } else {
        transcriptEl.innerHTML = '<p class="text3">No transcript available yet.</p>';
      }

      // Requirements from meeting data
      if (meeting.requirements && meeting.requirements.length > 0) {
        renderReqsFromData(meeting.requirements);
      } else {
        renderReqs();
      }

      // Update state docs
      state.docs = {
        srs: meeting.srs || '',
        stories: meeting.userStories || [],
        api: meeting.apiEndpoints || [],
        db: meeting.dbTables || [],
        arch: meeting.architecture || '',
      };
    } catch (e) {
      setDefaultDocs();
      renderReqs();
    }
  }

  function renderReqsFromData(requirements) {
    document.getElementById('req-list').innerHTML = requirements
      .map(
        (r, i) => `
      <div class="req-item">
        <div class="req-num">${i + 1}</div>
        <div style="flex:1;font-size:13.5px;">${r}</div>
      </div>`
      )
      .join('');
  }

  function renderReqs() {
    document.getElementById('req-list').innerHTML = '<p class="text3">No requirements extracted yet. Process a meeting first.</p>';
    document.getElementById('entities-list').innerHTML = '<p class="text3">No entities detected yet.</p>';
  }

  // ── Input tab switching ──
  function switchInputTab(tab, btn) {
    state.inputTab = tab;
    document.getElementById('tab-record').style.display = tab === 'record' ? 'block' : 'none';
    document.getElementById('tab-upload').style.display = tab === 'upload' ? 'block' : 'none';
    document.querySelectorAll('#input-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // ── File upload ──
  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('upload-zone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processUploadedFile(file);
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processUploadedFile(file);
  }

  function processUploadedFile(file) {
    state.uploadedFile = file;
    document.getElementById('upload-filename').textContent = file.name;
    document.getElementById('upload-size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    document.getElementById('upload-preview').style.display = 'block';
    showNotif(`File "${file.name}" ready for processing`, '✓');
  }

  // ── Process audio (main flow) ──
  async function processAudio() {
    const nameInput = document.getElementById('project-name');
    const name = nameInput.value.trim() || 'New Meeting';
    const processBtn = document.getElementById('process-btn');
    const processingCard = document.getElementById('processing-card');
    const stepsEl = document.getElementById('processing-steps');

    processBtn.disabled = true;
    processingCard.style.display = 'block';

    // Reset processing steps UI
    stepsEl.innerHTML = `
      <div class="fl-row gap8" id="step-create">
        <span class="spinner" id="sp0"></span>
        <div>
          <div style="font-size:13.5px;font-weight:500;">Creating meeting</div>
          <div class="text-sm text2">Setting up in database...</div>
        </div>
      </div>`;

    try {
      // Step 1: Create meeting
      const meeting = await API.createMeeting(name);
      state.currentMeetingId = meeting._id;
      await markStepDone('sp0', 'step-create', 'Meeting created');

      // Step 2: Upload audio
      stepsEl.innerHTML += `
        <div class="fl-row gap8" id="step-upload">
          <span class="spinner" id="sp1"></span>
          <div>
            <div style="font-size:13.5px;font-weight:500;">Uploading audio</div>
            <div class="text-sm text2">Sending audio file to server...</div>
          </div>
        </div>`;

      const audioFile = state.uploadedFile || Recorder.getRecordedBlob();
      if (!audioFile) {
        // UX: guard against empty submissions to avoid backend failures
        alert('Please record or upload audio before processing.');
        throw new Error('No audio selected');
      }
      const file = audioFile instanceof Blob ? new File([audioFile], 'recording.webm', { type: 'audio/webm' }) : audioFile;
      await API.uploadAudio(meeting._id, file);
      await markStepDone('sp1', 'step-upload', 'Audio uploaded');

      // Step 3: Transcribe
      stepsEl.innerHTML += `
        <div class="fl-row gap8" id="step-transcribe">
          <span class="spinner" id="sp2"></span>
          <div>
            <div style="font-size:13.5px;font-weight:500;">Transcribing audio</div>
            <div class="text-sm text2">Sending to AssemblyAI...</div>
          </div>
        </div>`;

      try {
        await API.transcribe(meeting._id);
        await markStepDone('sp2', 'step-transcribe', 'Transcription complete');
      } catch (e) {
        await markStepDone('sp2', 'step-transcribe', 'Transcription skipped (check API key)');
      }

      // Step 4: Analyze
      stepsEl.innerHTML += `
        <div class="fl-row gap8" id="step-analyze">
          <span class="spinner" id="sp3"></span>
          <div>
            <div style="font-size:13.5px;font-weight:500;">Analyzing with GPT-4</div>
            <div class="text-sm text2">Extracting requirements...</div>
          </div>
        </div>`;

      try {
        const result = await API.analyze(meeting._id);
        state.docs = {
          srs: result.meeting.srs || '',
          stories: result.meeting.userStories || [],
          api: result.meeting.apiEndpoints || [],
          db: result.meeting.dbTables || [],
          arch: result.meeting.architecture || '',
        };
        await markStepDone('sp3', 'step-analyze', 'Analysis complete');
      } catch (e) {
        setDefaultDocs();
        await markStepDone('sp3', 'step-analyze', 'Analysis skipped (check API key)');
      }

      stepsEl.innerHTML += `<div class="badge badge-green mt8" style="font-size:13px;padding:8px 16px;">✓ Processing complete!</div>`;
      showNotif('Meeting processed! View documentation →', '✓');
      
      // Refresh meetings list to show new meeting in sidebar/dashboard
      try {
        state.meetings = await API.getMeetings();
        renderSidebarMeetings();
      } catch (e) {}
    } catch (error) {
      stepsEl.innerHTML += `<div class="badge badge-red mt8" style="font-size:13px;padding:8px 16px;">✗ Error: ${error.message}</div>`;
      showNotif('Processing failed: ' + error.message, '!');
    }

    processBtn.disabled = false;
  }

  function markStepDone(spinnerId, stepId, doneText) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const sp = document.getElementById(spinnerId);
        if (sp) sp.outerHTML = `<span style="color:var(--teal);font-size:15px;">✓</span>`;
        const step = document.getElementById(stepId);
        if (step) {
          const info = step.querySelector('.text-sm');
          if (info) info.textContent = doneText;
        }
        resolve();
      }, 400);
    });
  }

  // ── Sidebar Toggle ──
  function toggleSidebarMeetings() {
    const el = document.getElementById('sidebar-meetings');
    const chevron = document.getElementById('sidebar-meetings-chevron');
    if (!el || !chevron) return;
    
    if (el.style.display === 'none') {
      el.style.display = 'flex';
      chevron.style.transform = 'rotate(0deg)';
    } else {
      el.style.display = 'none';
      chevron.style.transform = 'rotate(-90deg)';
    }
  }

  // ── Audio playback (for record preview) ──
  function togglePlay(id) {
    const audio = document.getElementById(id);
    if (audio.paused) audio.play();
    else audio.pause();
  }

  // ── Documentation page ──
  function switchDocTab(tab, btn) {
    document.querySelectorAll('.doc-content').forEach((d) => (d.style.display = 'none'));
    document.getElementById('doc-' + tab).style.display = 'block';
    document.querySelectorAll('#doc-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function renderDocs() {
    if (!state.docs.srs) setDefaultDocs();
    const d = state.docs;

    // SRS
    document.getElementById('doc-srs').innerHTML = `
      <div class="doc-section">
        <div class="doc-section-header"><h3>Software Requirements Specification</h3><span class="badge badge-purple">v1.0</span></div>
        <div class="doc-section-body">${(d.srs || '')
          .split('\n')
          .filter(Boolean)
          .map((p) => `<p style="margin-bottom:12px;">${p}</p>`)
          .join('')}</div>
      </div>`;

    // Stories
    document.getElementById('doc-stories').innerHTML = `
      <div class="doc-section">
        <div class="doc-section-header"><h3>User Stories</h3></div>
        <div class="doc-section-body">
          ${(d.stories || [])
            .map(
              (s, i) => `
            <div class="req-item">
              <div class="req-num">${i + 1}</div>
              <div>${s}</div>
            </div>`
            )
            .join('')}
        </div>
      </div>`;

    // API
    document.getElementById('doc-api').innerHTML = `
      <div class="doc-section">
        <div class="doc-section-header"><h3>Suggested API Endpoints</h3></div>
        <div class="doc-section-body">
          ${(d.api || [])
            .map(
              (ep) => `
            <div class="req-item">
              <div class="req-num" style="font-family:var(--mono);font-size:10px;width:44px;border-radius:6px;">${ep.method}</div>
              <div>
                <div class="mono text-teal mb4">${ep.path}</div>
                <div class="text-sm text2">${ep.description}</div>
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>`;

    // DB
    document.getElementById('doc-db').innerHTML = `
      <div class="doc-section">
        <div class="doc-section-header"><h3>Database Tables</h3></div>
        <div class="doc-section-body">
          <div class="grid-2 gap16">
            ${(d.db || [])
              .map(
                (t) => `
              <div class="card card-sm" style="background:var(--bg3);">
                <h3 class="mono text-accent mb8">${t.table}</h3>
                ${(t.columns || [])
                  .map((c) => `<div class="text-sm text2 mono" style="padding:3px 0;border-bottom:1px solid var(--border);">${c}</div>`)
                  .join('')}
              </div>`
              )
              .join('')}
          </div>
        </div>
      </div>`;

    // Architecture
    document.getElementById('doc-arch').innerHTML = `
      <div class="doc-section">
        <div class="doc-section-header"><h3>System Architecture</h3></div>
        <div class="doc-section-body">${(d.arch || '')
          .split('\n')
          .filter(Boolean)
          .map((p) => `<p style="margin-bottom:12px;">${p}</p>`)
          .join('')}</div>
      </div>`;
  }

  // ── Editor ──
  function loadEditorDoc(type) {
    if (!state.docs.srs) setDefaultDocs();
    const d = state.docs;
    const titles = {
      srs: 'Software Requirements Spec',
      stories: 'User Stories',
      api: 'API Endpoints',
      db: 'Database Schema',
      arch: 'Architecture Notes',
    };
    document.getElementById('editor-title').textContent = titles[type] || type;

    let content = '';
    if (type === 'srs')
      content = (d.srs || '')
        .split('\n')
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join('');
    if (type === 'stories') content = (d.stories || []).map((s, i) => `<p><strong>${i + 1}.</strong> ${s}</p>`).join('');
    if (type === 'api')
      content = (d.api || []).map((ep) => `<p><strong>${ep.method}</strong> <code>${ep.path}</code> — ${ep.description}</p>`).join('');
    if (type === 'db')
      content = (d.db || []).map((t) => `<p><strong>${t.table}</strong>: ${(t.columns || []).join(', ')}</p>`).join('');
    if (type === 'arch')
      content = (d.arch || '')
        .split('\n')
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join('');

    document.getElementById('rich-editor').innerHTML = content || '<p>No content generated yet. Process a meeting first.</p>';
  }

  function fmt(cmd, val) {
    document.execCommand(cmd, false, val || null);
    document.getElementById('rich-editor').focus();
  }

  function saveEditor() {
    showNotif('Draft saved!', '✓');
  }

  async function aiAssist() {
    const instruction = document.getElementById('ai-assist-input').value;
    if (!instruction.trim()) {
      showNotif('Enter an instruction for AI assist', '!');
      return;
    }

    const spinner = document.getElementById('ai-assist-spinner');
    spinner.style.display = 'inline';
    const current = document.getElementById('rich-editor').innerText.slice(0, 400);

    // AI assist works client-side for now (could be routed through backend later)
    setTimeout(() => {
      document.getElementById('rich-editor').innerHTML += `<hr style="border:none;border-top:1px solid var(--border);margin:12px 0;"><p style="color:var(--teal);">💡 AI suggestion: ${instruction}</p>`;
      showNotif('AI improvement added!', '✓');
      spinner.style.display = 'none';
      document.getElementById('ai-assist-input').value = '';
    }, 1500);
  }

  // ── Export ──
  function exportAs(format) {
    if (!state.docs.srs) setDefaultDocs();
    const d = state.docs;

    if (format === 'md') {
      let md = `# Software Requirements Specification\n\n${d.srs || ''}\n\n`;
      md += `## User Stories\n\n${(d.stories || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`;
      md += `## API Endpoints\n\n${(d.api || []).map((e) => `- **${e.method}** \`${e.path}\` — ${e.description}`).join('\n')}\n\n`;
      md += `## Database Tables\n\n${(d.db || []).map((t) => `### ${t.table}\n- ${(t.columns || []).join('\n- ')}`).join('\n\n')}\n\n`;
      md += `## Architecture\n\n${d.arch || ''}`;

      downloadFile('specora-requirements.md', md, 'text/markdown');
    } else if (format === 'pdf' || format === 'docx') {
      showNotif(`${format.toUpperCase()} export requires backend. Connect API keys to enable.`, '⬇');
    }
  }

  function downloadFile(filename, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    showNotif(`${filename} downloaded!`, '✓');
  }

  // ── Default docs (empty) ──
  function setDefaultDocs() {
    state.docs = {
      srs: '',
      stories: [],
      api: [],
      db: [],
      arch: '',
    };
  }

  // ── Delete Meeting ──
  async function deleteMeeting() {
    if (!state.currentMeetingId) return;
    
    const confirmDelete = confirm("Are you sure you want to delete this meeting? This action cannot be undone.");
    if (!confirmDelete) return;

    try {
      const deletedId = state.currentMeetingId;
      await API.deleteMeeting(deletedId);
      showNotif('Meeting deleted successfully', '✓');

      // State: drop deleted meeting first, then clear the current selection
      state.meetings = state.meetings.filter(m => m._id !== deletedId);
      state.currentMeetingId = null;

      // UI: refresh sidebar + reset detail view before navigating away
      renderSidebarMeetings();
      if (state.audioObjectUrl) {
        URL.revokeObjectURL(state.audioObjectUrl);
        state.audioObjectUrl = null;
      }
      setDefaultDocs();
      renderReqs();
      nav('dashboard');
    } catch (e) {
      showNotif('Failed to delete meeting: ' + e.message, '!');
    }
  }

  // ── Notifications ──
  function showNotif(msg, icon = '✓') {
    const el = document.getElementById('notif');
    document.getElementById('notif-msg').textContent = msg;
    document.getElementById('notif-icon').textContent = icon;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  // ── Init ──
  function init() {
    // 1. Auth Gate
    const session = getSession();
    if (!session || !session.token || !session.user) {
      window.location.href = 'auth.html';
      return;
    }
    
    try {
      state.user = session.user;
      updateSidebarUserInfo();
    } catch (e) {
      // Invalid session data
      localStorage.removeItem('specora_session');
      window.location.href = 'auth.html';
      return;
    }

    setDefaultDocs();
    
    // Fetch meetings to populate sidebar immediately
    API.getMeetings().then(meetings => {
      state.meetings = meetings;
      renderSidebarMeetings();
    }).catch(e => console.error("Failed to load initial meetings", e));

    nav('landing');
  }

  // ── Auth Utilities ──
  function logout() {
    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = null;
    }
    localStorage.removeItem('specora_session');
    window.location.href = 'auth.html';
  }

  function updateSidebarUserInfo() {
    // We'll add this UI in index.html and target it here
    const userNameEl = document.getElementById('sidebar-user-name');
    if (userNameEl && state.user) {
      userNameEl.textContent = state.user.name || state.user.email.split('@')[0];
    }
  }

  // Public API
  return {
    nav,
    viewMeeting,
    switchInputTab,
    handleDrop,
    handleFileSelect,
    processAudio,
    togglePlay,
    toggleSidebarMeetings,
    switchDocTab,
    loadEditorDoc,
    fmt,
    saveEditor,
    aiAssist,
    deleteMeeting,
    exportAs,
    showNotif,
    logout,
    init,
  };
})();

// Start the app
document.addEventListener('DOMContentLoaded', App.init);
