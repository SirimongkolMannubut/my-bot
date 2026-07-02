// --- ตัวแปรแคชสถานะบนหน้าเว็บ ---
let botGuilds = [];
let isBotOnline = false;
let loadedGuildId = null;
let hasInitialLoaded = false;

// --- องค์ประกอบ DOM ---
// ส่วนหัวและสถานะ
const botStatusBadge = document.getElementById('bot-status');
const botStatusText = botStatusBadge.querySelector('.status-text');
const pingStat = document.getElementById('stat-ping');
const serversStat = document.getElementById('stat-servers');
const globalGuildSelect = document.getElementById('global-guild-select');

// เมนูแท็บ
const tabButtons = document.querySelectorAll('.tab-btn, .nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

// แท็บ 1: ค่าทั่วไป & Logs
const generalSettingsForm = document.getElementById('general-settings-form');
const botPrefixInput = document.getElementById('bot-prefix');
const botActivityInput = document.getElementById('bot-activity');
const logsContainer = document.getElementById('logs-container');
const btnClearLogs = document.getElementById('btn-clear-logs');

// แท็บ 2: จัดการห้อง (Channels)
const channelCreateForm = document.getElementById('channel-create-form');
const newChannelName = document.getElementById('new-channel-name');
const newChannelType = document.getElementById('new-channel-type');
const newChannelParent = document.getElementById('new-channel-parent');
const newChannelPrivate = document.getElementById('new-channel-private');
const newChannelReadonly = document.getElementById('new-channel-readonly');
const newChannelMuted = document.getElementById('new-channel-muted');
const btnCreateChannel = document.getElementById('btn-create-channel');

// แท็บ 3: ข้อความต้อนรับ (Welcome)
const welcomeSettingsForm = document.getElementById('welcome-settings-form');
const welcomeEnabledCheck = document.getElementById('welcome-enabled');
const welcomeChannelSelect = document.getElementById('welcome-channel-select');
const welcomeMessageInput = document.getElementById('welcome-message-input');
const leaveEnabledCheck = document.getElementById('leave-enabled');
const leaveChannelSelect = document.getElementById('leave-channel-select');
const leaveMessageInput = document.getElementById('leave-message-input');
const btnSaveWelcome = document.getElementById('btn-save-welcome');

// แท็บ 4: คำสั่งตอบกลับพิเศษ
const customCommandForm = document.getElementById('custom-command-form');
const cmdName = document.getElementById('cmd-name');
const cmdResponse = document.getElementById('cmd-response');
const commandsTableBody = document.getElementById('commands-table-body');

// แท็บ 5: จัดการสมาชิก (Moderation)
const moderationForm = document.getElementById('moderation-form');
const modMemberSelect = document.getElementById('mod-member-select');
const modActionSelect = document.getElementById('mod-action-select');
const btnExecuteMod = document.getElementById('btn-execute-mod');

// แท็บ 6: เครื่องเล่นเพลง
const musicVoiceSelect = document.getElementById('music-voice-select');
const musicSearch = document.getElementById('music-search');
const btnMusicPlay = document.getElementById('btn-music-play');
const btnMusicPlayUrl = document.getElementById('btn-music-play-url');
const btnMusicJoin = document.getElementById('btn-music-join');
const btnMusicFav = document.getElementById('btn-music-fav');
const btnMusicPause = document.getElementById('btn-music-pause');
const btnMusicStop = document.getElementById('btn-music-stop');
const playlistQueue = document.getElementById('playlist-queue');
const favoritesQueue = document.getElementById('favorites-queue');
const musicSearchResults = document.getElementById('music-search-results');
const musicResultsList = document.getElementById('music-results-list');
const nowPlayingBar = document.getElementById('now-playing-bar');
const npTitle = document.getElementById('np-title');
const npChannel = document.getElementById('np-channel');
const npThumbnail = document.getElementById('np-thumbnail');
const btnClearSearch = document.getElementById('btn-music-clear-search');
const musicAutoplayToggle = document.getElementById('music-autoplay-toggle');

// ตัวแปรสำหรับเพลงที่เลือกอยู่
let selectedSong = null; // { title, url, channel, thumbnail }

// Helper: เล่นเพลงด้วย URL
async function playMusicQuery(query, displayTitle, duration) {
  const guildId = globalGuildSelect.value;
  const voiceChannelId = musicVoiceSelect.value;
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!voiceChannelId) return alert('กรุณาเลือกห้องแชทเสียงที่จะให้บอทเข้า!');
  if (!query) return alert('กรุณาป้อนลิงก์เพลงหรือค้นหาก่อน!');

  addLog(`กำลังสั่งให้บอทรันเพลง: "${displayTitle || query}"`, 'system');
  btnMusicPlay.disabled = true;
  btnMusicPlayUrl.disabled = true;

  try {
    const response = await fetch('/api/music/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, voiceChannelId, query, title: displayTitle, duration })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`เริ่มเล่นเพลงสำเร็จ: ${result.title}`, 'success');
      fetchBotStatus();
    } else {
      addLog(`เกิดข้อผิดพลาด: ${result.error}`, 'error');
      const banner = document.getElementById('music-error-banner');
      const bannerText = document.getElementById('music-error-text');
      if (banner && bannerText) { bannerText.textContent = result.error; banner.style.display = 'flex'; }
    }
  } catch (error) {
    addLog('ไม่สามารถสั่งรันเพลงได้', 'error');
  } finally {
    btnMusicPlay.disabled = false;
    btnMusicPlayUrl.disabled = false;
  }
}

// ---- SEARCH SYSTEM ----
let searchDebounce = null;

function showSearchResults(videos) {
  if (!videos || videos.length === 0) {
    musicResultsList.innerHTML = '<div class="search-loading">ไม่พบผลลัพธ์</div>';
    musicSearchResults.style.display = 'block';
    return;
  }
  musicResultsList.innerHTML = '';
  videos.forEach(v => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <img class="sr-thumb" src="${v.thumbnail}" alt="" onerror="this.src='https://img.youtube.com/vi/${v.id}/mqdefault.jpg'">
      <div class="sr-info">
        <div class="sr-title">${v.title}</div>
        <div class="sr-meta">
          <span>${v.channel}</span>
          ${v.views ? `<span>· ${v.views}</span>` : ''}
        </div>
      </div>
      <span class="sr-duration">${v.duration}</span>
    `;
    item.addEventListener('click', () => {
      selectSong(v);
    });
    musicResultsList.appendChild(item);
  });
  musicSearchResults.style.display = 'block';
}

function selectSong(v) {
  selectedSong = v;
  // แสดง Now Playing Bar
  npTitle.textContent = v.title;
  npChannel.textContent = v.channel || '';
  npThumbnail.src = v.thumbnail || '';
  nowPlayingBar.style.display = 'flex';
  // ซ่อน dropdown แต่คง search value
  musicSearchResults.style.display = 'none';
  musicSearch.value = v.title;
  btnClearSearch.style.display = 'inline-flex';
  // เปิดปุ่มเล่น
  if (globalGuildSelect.value) {
    btnMusicPlay.disabled = false;
    btnMusicFav.disabled = false;
  }
}

function clearSearch() {
  selectedSong = null;
  musicSearch.value = '';
  musicSearchResults.style.display = 'none';
  nowPlayingBar.style.display = 'none';
  btnClearSearch.style.display = 'none';
  btnMusicPlay.disabled = true;
  btnMusicFav.disabled = true;
}

musicSearch.addEventListener('input', () => {
  const q = musicSearch.value.trim();
  btnClearSearch.style.display = q ? 'inline-flex' : 'none';

  // ถ้าเป็น YouTube URL → ไม่ต้องค้นหา
  if (q.startsWith('http')) {
    musicSearchResults.style.display = 'none';
    selectedSong = null;
    nowPlayingBar.style.display = 'none';
    return;
  }

  if (!q) {
    musicSearchResults.style.display = 'none';
    return;
  }

  // Debounce 450ms
  clearTimeout(searchDebounce);
  musicResultsList.innerHTML = '<div class="search-loading">⏳ กำลังค้นหา...</div>';
  musicSearchResults.style.display = 'block';

  searchDebounce = setTimeout(async () => {
    if (musicSearch.value.trim() !== q) return; // ยกเลิกถ้ามีการพิมพ์ใหม่
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      showSearchResults(data.results);
    } catch (e) {
      musicResultsList.innerHTML = '<div class="search-loading">❌ ค้นหาไม่สำเร็จ</div>';
    }
  }, 450);
});

// ปิด dropdown เมื่อคลิกนอก
document.addEventListener('click', (e) => {
  if (!e.target.closest('.music-search-wrapper')) {
    musicSearchResults.style.display = 'none';
  }
});

// ปุ่มล้างช่องค้นหา
btnClearSearch.addEventListener('click', clearSearch);

// ปุ่มเล่นเพลงที่เลือกจาก search
btnMusicPlay.addEventListener('click', () => {
  if (!selectedSong) return;
  playMusicQuery(selectedSong.url, selectedSong.title, selectedSong.duration);
});

// ปุ่มเล่นจาก URL โดยตรง
btnMusicPlayUrl.addEventListener('click', () => {
  const q = musicSearch.value.trim();
  if (!q) return alert('กรุณาวางลิงก์ YouTube ในช่องค้นหาก่อน!');
  playMusicQuery(q, q);
});

// ปุ่มพักเพลงชั่วคราว
btnMusicPause.addEventListener('click', async () => {
  const guildId = globalGuildSelect.value;
  if (!guildId) return;
  addLog('กำลังส่งคำขอสลับสถานะ เล่น/หยุดชั่วคราว...', 'system');
  try {
    const response = await fetch('/api/music/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId })
    });
    if (response.ok) addLog('สลับสถานะ เล่น/หยุดชั่วคราว สำเร็จ', 'success');
  } catch (error) {
    console.error('พักเพลงล้มเหลว:', error);
  }
});

// ปุ่มหยุดเล่นและออกจากห้องเสียง
btnMusicStop.addEventListener('click', async () => {
  const guildId = globalGuildSelect.value;
  if (!guildId) return;
  addLog('กำลังสั่งให้บอทล้างคิวเพลงและออกจากห้องเสียง...', 'system');
  try {
    const response = await fetch('/api/music/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId })
    });
    if (response.ok) {
      addLog('หยุดเล่นและออกจากห้องเสียงเรียบร้อยแล้ว', 'success');
      fetchBotStatus();
    }
  } catch (error) {
    console.error('หยุดเล่นเพลงล้มเหลว:', error);
  }
});

musicAutoplayToggle.addEventListener('change', async () => {
  const guildId = globalGuildSelect.value;
  if (!guildId) return;
  const enabled = musicAutoplayToggle.checked;
  addLog(`กำลังสลับสถานะ Autoplay เป็น: ${enabled ? 'เปิด' : 'ปิด'}...`, 'system');
  try {
    await fetch('/api/music/autoplay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, enabled })
    });
  } catch (error) {
    console.error('Autoplay toggle failed:', error);
  }
});

// แท็บ 7: จัดการบทบาท (Roles)
const roleCreateForm = document.getElementById('role-create-form');
const newRoleName = document.getElementById('new-role-name');
const newRoleColor = document.getElementById('new-role-color');
const roleColorHex = document.getElementById('role-color-hex');
const newRolePreset = document.getElementById('new-role-preset');
const newRoleHoist = document.getElementById('new-role-hoist');
const newRoleMentionable = document.getElementById('new-role-mentionable');
const btnCreateRole = document.getElementById('btn-create-role');
const rolesListBody = document.getElementById('roles-list-body');


// --- ระบบบันทึก Logs บนหน้าเว็บ ---
function addLog(text, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  entry.innerText = `[${timeStr}] ${text}`;
  logsContainer.appendChild(entry);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// --- แท็บควบคุมการสลับหน้า ---
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // ปิดแท็บเดิม
    tabButtons.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    
    // เปิดแท็บที่เลือก
    btn.classList.add('active');
    const targetTab = btn.getAttribute('data-tab');
    document.getElementById(targetTab).classList.add('active');
  });
});

// --- ดึงข้อมูลสถานะบอทจาก API ---
async function fetchBotStatus() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('การเชื่อมต่อล้มเหลว');
    const data = await response.json();
    
    isBotOnline = data.online;
    if (isBotOnline) {
      botStatusBadge.className = 'status-badge online';
      botStatusText.innerText = 'Online';
      pingStat.innerText = `${data.ping} ms`;
      serversStat.innerText = data.guildCount;
      
      // อัปเดตค่า Prefix/Activity เมื่ออินพุตไม่ถูกโฟกัส
      if (document.activeElement !== botPrefixInput && document.activeElement !== botActivityInput) {
        botPrefixInput.value = data.prefix || '!';
        botActivityInput.value = data.activity || '';
      }
      
      botGuilds = data.guilds || [];
      updateGlobalGuildSelect();
      
      // Sync autoplay switch
      const activeGuild = botGuilds.find(g => g.id === globalGuildSelect.value);
      if (activeGuild) {
        musicAutoplayToggle.checked = !!activeGuild.autoplayEnabled;
      }
    } else {
      setUIOffline();
    }
  } catch (error) {
    setUIOffline();
  }
}

// ดึง Logs
async function fetchLogs() {
  try {
    const response = await fetch('/api/logs');
    if (!response.ok) return;
    const logs = await response.json();
    
    logsContainer.innerHTML = '';
    if (logs.length === 0) {
      addLog('ไม่มีประวัติการทำงานล่าสุด', 'system');
      return;
    }
    
    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.type}`;
      entry.innerText = `[${log.time}] ${log.message}`;
      logsContainer.appendChild(entry);
    });
  } catch (error) {
    console.error('ดึง logs ไม่สำเร็จ:', error);
  }
}

// ตั้งค่า UI บอทออฟไลน์
function setUIOffline() {
  isBotOnline = false;
  botStatusBadge.className = 'status-badge offline';
  botStatusText.innerText = 'Offline';
  pingStat.innerText = '- ms';
  serversStat.innerText = '-';
  globalGuildSelect.innerHTML = '<option value="">-- บอทปิดใช้งานอยู่ --</option>';
  globalGuildSelect.disabled = true;
  disableGuildDependentControls();
}

// เคลียร์/ปิดตัวควบคุมทั้งหมดที่ขึ้นกับเซิร์ฟเวอร์
function disableGuildDependentControls() {
  // แท็บ 2: ห้อง
  newChannelName.disabled = true;
  newChannelType.disabled = true;
  newChannelParent.innerHTML = '<option value="">-- ไม่จัดเข้าหมวดหมู่ (อยู่นอกสุด) --</option>';
  newChannelParent.disabled = true;
  newChannelPrivate.disabled = true;
  newChannelReadonly.disabled = true;
  newChannelMuted.disabled = true;
  btnCreateChannel.disabled = true;
  
  // แท็บ 3: ต้อนรับ
  welcomeEnabledCheck.disabled = true;
  welcomeChannelSelect.disabled = true;
  welcomeMessageInput.disabled = true;
  leaveEnabledCheck.disabled = true;
  leaveChannelSelect.disabled = true;
  leaveMessageInput.disabled = true;
  btnSaveWelcome.disabled = true;
  
  // แท็บ 5: สมาชิก
  modMemberSelect.disabled = true;
  modActionSelect.disabled = true;
  btnExecuteMod.disabled = true;
  
  // แท็บ 6: เพลง
  musicVoiceSelect.disabled = true;
  musicSearch.disabled = true;
  btnMusicPlay.disabled = true;
  btnMusicJoin.disabled = true;
  btnMusicFav.disabled = true;
  btnMusicPause.disabled = true;
  btnMusicStop.disabled = true;
  musicAutoplayToggle.disabled = true; // Add this
  musicAutoplayToggle.checked = false; // Add this
  favoritesQueue.innerHTML = '<li class="empty-list">กรุณาเลือกเซิร์ฟเวอร์เพื่อดึงข้อมูลคลังเพลงโปรด</li>';

  // แท็บ 7: ยศ
  newRoleName.disabled = true;
  newRoleColor.disabled = true;
  newRolePreset.disabled = true;
  newRoleHoist.disabled = true;
  newRoleMentionable.disabled = true;
  btnCreateRole.disabled = true;
  rolesListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">กรุณาเลือกเซิร์ฟเวอร์เพื่อดึงข้อมูลบทบาท</td></tr>';
}

// อัปเดตรายชื่อเซิร์ฟเวอร์
function updateGlobalGuildSelect() {
  const currentVal = globalGuildSelect.value;
  globalGuildSelect.disabled = false;
  
  if (!hasInitialLoaded) {
    globalGuildSelect.innerHTML = '<option value="">-- เลือกเซิร์ฟเวอร์แชท --</option>';
    botGuilds.forEach(guild => {
      const opt = document.createElement('option');
      opt.value = guild.id;
      opt.text = guild.name;
      globalGuildSelect.add(opt);
    });

    if (botGuilds.length > 0) {
      globalGuildSelect.value = botGuilds[0].id;
      loadedGuildId = botGuilds[0].id;
      enableGuildDependentControls(botGuilds[0].id);
    } else {
      disableGuildDependentControls();
    }
    hasInitialLoaded = true;
  } else {
    if (currentVal !== loadedGuildId) {
      loadedGuildId = currentVal;
      enableGuildDependentControls(currentVal);
    } else if (currentVal) {
      updateDynamicGuildStatus(currentVal);
    }
  }
}

function updateDynamicGuildStatus(guildId) {
  const guild = botGuilds.find(g => g.id === guildId);
  if (!guild) return;
  
  // อัปเดตปุ่มหยุดเมื่อบอทอยู่ในห้องเสียง
  if (guild.connectedVoiceChannelId) {
    btnMusicStop.disabled = false;
    btnMusicPause.disabled = false;
  } else {
    btnMusicStop.disabled = true;
    btnMusicPause.disabled = true;
  }

  // อัปเดตคิวเพลงเรียลไทม์
  updateMusicQueueUI(guild.musicQueue || []);
}


// เปิดใช้งานตัวควบคุมตามเซิร์ฟเวอร์ที่เลือก
function enableGuildDependentControls(guildId) {
  if (!guildId) {
    disableGuildDependentControls();
    return;
  }
  
  const guild = botGuilds.find(g => g.id === guildId);
  if (!guild) return;

  // แท็บ 2: ห้อง
  newChannelName.disabled = false;
  newChannelType.disabled = false;
  newChannelPrivate.disabled = false;
  newChannelReadonly.disabled = false;
  newChannelMuted.disabled = false;
  btnCreateChannel.disabled = false;

  newChannelParent.innerHTML = '<option value="">-- ไม่จัดเข้าหมวดหมู่ (อยู่นอกสุด) --</option>';
  newChannelParent.disabled = false;
  if (guild.categories && guild.categories.length > 0) {
    guild.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.text = `📁 ${cat.name}`;
      newChannelParent.add(opt);
    });
  }

  // แท็บ 3: ต้อนรับ
  welcomeEnabledCheck.disabled = false;
  leaveEnabledCheck.disabled = false;
  btnSaveWelcome.disabled = false;
  
  // กรองแสดงเฉพาะห้องข้อความสำหรับระบบต้อนรับ/บอกลา
  welcomeChannelSelect.innerHTML = '<option value="">-- เลือกห้องข้อความ --</option>';
  leaveChannelSelect.innerHTML = '<option value="">-- เลือกห้องข้อความ --</option>';
  
  if (guild.textChannels && guild.textChannels.length > 0) {
    guild.textChannels.forEach(ch => {
      const opt1 = document.createElement('option');
      opt1.value = ch.id;
      opt1.text = `# ${ch.name}`;
      welcomeChannelSelect.add(opt1);
      
      const opt2 = document.createElement('option');
      opt2.value = ch.id;
      opt2.text = `# ${ch.name}`;
      leaveChannelSelect.add(opt2);
    });
  }

  // โหลดค่าแจ้งเตือนต้อนรับเดิม
  welcomeEnabledCheck.checked = guild.welcomeEnabled || false;
  welcomeChannelSelect.value = guild.welcomeChannelId || '';
  welcomeMessageInput.value = guild.welcomeMessage || '';
  
  leaveEnabledCheck.checked = guild.leaveEnabled || false;
  leaveChannelSelect.value = guild.leaveChannelId || '';
  leaveMessageInput.value = guild.leaveMessage || '';
  
  toggleWelcomeInputs();
  toggleLeaveInputs();

  // แท็บ 5: สมาชิก (Moderation)
  modMemberSelect.innerHTML = '<option value="">-- เลือกสมาชิก --</option>';
  if (guild.members && guild.members.length > 0) {
    modMemberSelect.disabled = false;
    modActionSelect.disabled = false;
    btnExecuteMod.disabled = false;
    guild.members.forEach(mem => {
      const opt = document.createElement('option');
      opt.value = mem.id;
      opt.text = mem.tag;
      modMemberSelect.add(opt);
    });
  } else {
    modMemberSelect.innerHTML = '<option value="">-- ไม่พบสมาชิกในเซิร์ฟ --</option>';
    modMemberSelect.disabled = true;
    modActionSelect.disabled = true;
    btnExecuteMod.disabled = true;
  }

  // แท็บ 6: เพลง
  musicVoiceSelect.innerHTML = '<option value="">-- เลือกห้องเสียง --</option>';
  if (guild.voiceChannels && guild.voiceChannels.length > 0) {
    musicVoiceSelect.disabled = false;
    musicSearch.disabled = false;
    btnMusicPlay.disabled = true; // enabled only when song selected
    btnMusicPlayUrl.disabled = false;
    btnMusicJoin.disabled = false;
    btnMusicFav.disabled = true; // enabled only when song selected
    btnMusicPause.disabled = false;
    btnMusicStop.disabled = false;
    musicAutoplayToggle.disabled = false; // Add this
    
    guild.voiceChannels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.text = `🔊 ${ch.name}`;
      musicVoiceSelect.add(opt);
    });
    
    if (guild.connectedVoiceChannelId) {
      musicVoiceSelect.value = guild.connectedVoiceChannelId;
    }
  } else {
    musicVoiceSelect.innerHTML = '<option value="">-- ไม่พบห้องเสียง --</option>';
    musicVoiceSelect.disabled = true;
    musicSearch.disabled = true;
    btnMusicPlay.disabled = true;
    btnMusicPlayUrl.disabled = true;
    btnMusicJoin.disabled = true;
    btnMusicFav.disabled = true;
    btnMusicPause.disabled = true;
    btnMusicStop.disabled = true;
    musicAutoplayToggle.disabled = true; // Add this
    musicAutoplayToggle.checked = false; // Add this
  }

  // แท็บ 7: ยศ (Roles)
  newRoleName.disabled = false;
  newRoleColor.disabled = false;
  newRolePreset.disabled = false;
  newRoleHoist.disabled = false;
  newRoleMentionable.disabled = false;
  btnCreateRole.disabled = false;

  // ดึงคิวเพลงเซิร์ฟเวอร์
  updateMusicQueueUI(guild.musicQueue || []);

  // ดึงข้อมูลเพลงโปรดประจำเซิร์ฟเวอร์ และ บทบาทยศ
  fetchAndRenderFavorites(guildId);
  fetchAndRenderRoles(guildId);
}

// สวิตช์เปิด-ปิดช่องป้อนระบบต้อนรับคนเข้า/ออก
function toggleWelcomeInputs() {
  const isEnabled = welcomeEnabledCheck.checked;
  welcomeChannelSelect.disabled = !isEnabled;
  welcomeMessageInput.disabled = !isEnabled;
}

function toggleLeaveInputs() {
  const isEnabled = leaveEnabledCheck.checked;
  leaveChannelSelect.disabled = !isEnabled;
  leaveMessageInput.disabled = !isEnabled;
}

welcomeEnabledCheck.addEventListener('change', toggleWelcomeInputs);
leaveEnabledCheck.addEventListener('change', toggleLeaveInputs);

// ตรวจจับการเลือกเซิร์ฟเวอร์กลาง
globalGuildSelect.addEventListener('change', (e) => {
  enableGuildDependentControls(e.target.value);
});

// --- แท็บ 1: บันทึกค่าตั้งค่าทั่วไปลง MongoDB ---
generalSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prefix = botPrefixInput.value.trim();
  const activity = botActivityInput.value.trim();
  
  if (!prefix) return alert('กรุณากรอก Prefix!');
  
  addLog('กำลังบันทึกการตั้งค่าทั่วไปลง MongoDB...', 'system');
  try {
    const response = await fetch('/api/settings/general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, activity })
    });
    const result = await response.json();
    if (response.ok) {
      addLog('บันทึกตั้งค่าทั่วไปลง MongoDB สำเร็จ! 🍃', 'success');
      loadedGuildId = null;
      fetchBotStatus();
    } else {
      addLog(`เกิดข้อผิดพลาด: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('ไม่สามารถส่งคำขอตั้งค่าได้', 'error');
  }
});

// ปุ่มล้าง Log บนแผง Dashboard
btnClearLogs.addEventListener('click', () => {
  logsContainer.innerHTML = '';
  addLog('ล้างประวัติการทำงานบนหน้าเว็บสำเร็จ', 'system');
});

// --- แท็บ 2: ส่งคำขอสร้างห้องใหม่ ---
channelCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guildId = globalGuildSelect.value;
  const name = newChannelName.value.trim();
  const type = newChannelType.value;
  
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!name) return alert('กรุณากรอกชื่อห้องที่จะสร้าง!');
  
  addLog(`กำลังสร้างห้องแชทใหม่ "${name}"...`, 'system');
  btnCreateChannel.disabled = true;

  try {
    const response = await fetch('/api/channels/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, name, type })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`สร้างห้องใหม่สำเร็จ: ${result.channelName}`, 'success');
      newChannelName.value = '';
      loadedGuildId = null;
      fetchBotStatus(); // อัปเดต dropdown ช่องห้องเสียง/แชท
    } else {
      addLog(`ไม่สามารถสร้างห้องได้: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการสั่งสร้างห้อง', 'error');
  } finally {
    btnCreateChannel.disabled = false;
  }
});

// --- แท็บ 3: บันทึกระบบต้อนรับลง MongoDB ---
welcomeSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guildId = globalGuildSelect.value;
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');

  const welcomeEnabled = welcomeEnabledCheck.checked;
  const welcomeChannelId = welcomeChannelSelect.value;
  const welcomeMessage = welcomeMessageInput.value.trim();
  const leaveEnabled = leaveEnabledCheck.checked;
  const leaveChannelId = leaveChannelSelect.value;
  const leaveMessage = leaveMessageInput.value.trim();

  if (welcomeEnabled && !welcomeChannelId) return alert('กรุณาเลือกห้องแจ้งต้อนรับ!');
  if (leaveEnabled && !leaveChannelId) return alert('กรุณาเลือกห้องแจ้งบอกลา!');

  addLog('กำลังส่งคำขอบันทึกข้อมูลต้อนรับลง MongoDB...', 'system');
  btnSaveWelcome.disabled = true;

  try {
    const response = await fetch('/api/settings/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guildId,
        welcomeEnabled,
        welcomeChannelId,
        welcomeMessage,
        leaveEnabled,
        leaveChannelId,
        leaveMessage
      })
    });
    const result = await response.json();
    if (response.ok) {
      addLog('บันทึกการตั้งค่าต้อนรับลง MongoDB สำเร็จ! 🍃', 'success');
      loadedGuildId = null;
      fetchBotStatus();
    } else {
      addLog(`บันทึกต้อนรับล้มเหลว: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการบันทึกข้อมูลต้อนรับ', 'error');
  } finally {
    btnSaveWelcome.disabled = false;
  }
});

// --- แท็บ 4: คำสั่งตอบกลับพิเศษ ---
// โหลดคำสั่งพิเศษจาก DB
async function fetchCustomCommands() {
  try {
    const response = await fetch('/api/commands');
    if (!response.ok) return;
    const commands = await response.json();
    
    commandsTableBody.innerHTML = '';
    if (commands.length === 0) {
      commandsTableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">ยังไม่มีคำสั่งพิเศษเพิ่มลงฐานข้อมูล</td></tr>';
      return;
    }
    
    commands.forEach(cmd => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${cmd.commandName}</strong></td>
        <td>${cmd.responseContent}</td>
        <td class="text-right">
          <button class="btn btn-sm btn-danger" onclick="deleteCustomCommand('${cmd.commandName}')">ลบ</button>
        </td>
      `;
      commandsTableBody.appendChild(tr);
    });
  } catch (error) {
    console.error('โหลดคำสั่งพิเศษล้มเหลว:', error);
  }
}

// ส่งเพิ่มคำสั่งลง DB
customCommandForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = cmdName.value.trim().toLowerCase();
  const responseText = cmdResponse.value.trim();
  
  if (!name || !responseText) return;
  
  addLog(`กำลังสร้างคำสั่งตอบกลับพิเศษ "${name}"...`, 'system');
  try {
    const response = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, response: responseText })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`เพิ่มคำสั่งพิเศษ "${name}" สำเร็จ!`, 'success');
      cmdName.value = '';
      cmdResponse.value = '';
      fetchCustomCommands();
    } else {
      addLog(`เพิ่มคำสั่งล้มเหลว: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการเพิ่มคำสั่ง', 'error');
  }
});

// ลบคำสั่งพิเศษออกจาก DB
async function deleteCustomCommand(name) {
  if (!confirm(`คุณต้องการลบคำสั่ง "${name}" หรือไม่?`)) return;
  
  addLog(`กำลังลบคำสั่งพิเศษ "${name}"...`, 'system');
  try {
    const response = await fetch(`/api/commands/${name}`, { method: 'DELETE' });
    if (response.ok) {
      addLog(`ลบคำสั่งพิเศษ "${name}" สำเร็จแล้ว!`, 'success');
      fetchCustomCommands();
    } else {
      addLog(`ลบคำสั่งพิเศษไม่สำเร็จ`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการขอลบคำสั่ง', 'error');
  }
}

// --- แท็บ 5: จัดการสมาชิก (Moderation Action) ---
moderationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guildId = globalGuildSelect.value;
  const userId = modMemberSelect.value;
  const action = modActionSelect.value;
  
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!userId) return alert('กรุณาเลือกสมาชิกที่จะลงโทษ!');
  
  const memberName = modMemberSelect.options[modMemberSelect.selectedIndex].text;
  if (!confirm(`ยืนยันที่จะทำลงโทษ "${memberName}" โดยการ [${action.toUpperCase()}] หรือไม่?`)) return;
  
  addLog(`กำลังดำเนินการลงโทษ [${action.toUpperCase()}] สมาชิก ${memberName}...`, 'system');
  btnExecuteMod.disabled = true;

  try {
    const response = await fetch('/api/moderation/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, userId, action })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`ลงโทษสำเร็จ! สมาชิกถูกจัดการเรียบร้อย`, 'success');
      fetchBotStatus(); // อัปเดตรายชื่อสมาชิกเซิร์ฟเวอร์ใหม่
    } else {
      addLog(`ไม่สามารถดำเนินการลงโทษได้: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการส่งคำสั่งลงโทษ', 'error');
  } finally {
    btnExecuteMod.disabled = false;
  }
});

// --- แท็บ 6: ระบบเพลง ---
// โหลดคิวเพลงลง UI
function updateMusicQueueUI(queue) {
  playlistQueue.innerHTML = '';
  if (!queue || queue.length === 0) {
    playlistQueue.innerHTML = '<li class="empty-list">ยังไม่มีเพลงในคิว</li>';
    return;
  }
  
  queue.forEach((song, idx) => {
    const li = document.createElement('li');
    let actionsHTML = '';
    
    // Add controls for songs that are in the queue but not currently playing (index > 0)
    if (idx > 0) {
      actionsHTML = `
        <div class="queue-item-actions" style="display:flex; gap:0.35rem;">
          <button class="btn-icon-only btn-move-top-queue" title="เล่นถัดไป (บนสุด)" data-index="${idx}">⚡</button>
          <button class="btn-icon-only btn-move-up-queue" title="เลื่อนขึ้น" data-index="${idx}">🔼</button>
          <button class="btn-icon-only btn-remove-queue" title="ลบออกจากคิว" data-index="${idx}" style="color:var(--red);">❌</button>
        </div>
      `;
    }
    
    li.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.15rem; min-width:0; flex:1; text-align:left;">
        <span style="font-weight: 600; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${idx === 0 ? '▶️ <strong>กำลังเล่น:</strong>' : `🎵 #${idx}`} ${song.title}
        </span>
        <span style="font-size:0.75rem; color:var(--text3);">${song.duration}</span>
      </div>
      ${actionsHTML}
    `;

    // Bind event listeners for actions
    if (idx > 0) {
      li.querySelector('.btn-move-top-queue').addEventListener('click', async () => {
        const guildId = globalGuildSelect.value;
        try {
          const res = await fetch('/api/music/queue/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildId, index: idx, direction: 'top' })
          });
          if (res.ok) fetchBotStatus();
        } catch (err) { console.error(err); }
      });

      li.querySelector('.btn-move-up-queue').addEventListener('click', async () => {
        const guildId = globalGuildSelect.value;
        try {
          const res = await fetch('/api/music/queue/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildId, index: idx, direction: 'up' })
          });
          if (res.ok) fetchBotStatus();
        } catch (err) { console.error(err); }
      });

      li.querySelector('.btn-remove-queue').addEventListener('click', async () => {
        const guildId = globalGuildSelect.value;
        try {
          const res = await fetch('/api/music/queue', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildId, index: idx })
          });
          if (res.ok) fetchBotStatus();
        } catch (err) { console.error(err); }
      });
    }

    playlistQueue.appendChild(li);
  });
}



// ปรับสีและรหัสสี HEX แบบสด
newRoleColor.addEventListener('input', () => {
  roleColorHex.innerText = newRoleColor.value.toUpperCase();
});

// --- ระบบคลังเพลงโปรดประจำเซิร์ฟเวอร์ (Saved Playlists) ---
async function fetchAndRenderFavorites(guildId) {
  if (!guildId) return;
  try {
    const response = await fetch(`/api/music/favorites?guildId=${guildId}`);
    if (response.ok) {
      const favorites = await response.json();
      renderFavoritesList(guildId, favorites);
    }
  } catch (error) {
    console.error('โหลดเพลงโปรดล้มเหลว:', error);
  }
}

function renderFavoritesList(guildId, favorites) {
  favoritesQueue.innerHTML = '';
  if (!favorites || favorites.length === 0) {
    favoritesQueue.innerHTML = '<li class="empty-list">ไม่มีเพลงโปรดจัดเก็บอยู่ขณะนี้ ลองพิมพ์เพลงแล้วกดบันทึกเพลงโปรดได้เลย!</li>';
    return;
  }

  favorites.forEach(song => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.15rem;">
        <span style="font-weight: 600;">${song.title}</span>
        <span style="font-size: 0.75rem; color: var(--text-secondary);">ความยาว: ${song.duration}</span>
      </div>
      <div class="favorite-actions">
        <button class="btn-icon-only btn-play-fav" title="เล่นทันที" data-url="${song.url}" data-title="${song.title}">▶️</button>
        <button class="btn-icon-only btn-remove-fav" title="ลบจากคลัง" data-id="${song._id}">❌</button>
      </div>
    `;

    // ปุ่มกดเล่นสตรีมเพลงโปรด
    li.querySelector('.btn-play-fav').addEventListener('click', async (e) => {
      const btn = e.target;
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title');
      const voiceChannelId = musicVoiceSelect.value;
      if (!voiceChannelId) return alert('กรุณาเลือกห้องเสียงที่จะให้บอทเข้าก่อน!');
      
      addLog(`กำลังเรียกสตรีมเพลงโปรดจากคลัง: "${title}"`, 'system');
      try {
        const playRes = await fetch('/api/music/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, voiceChannelId, query: url })
        });
        if (playRes.ok) {
          const resObj = await playRes.json();
          addLog(`เริ่มเล่นเพลงสำเร็จ: ${resObj.title}`, 'success');
          fetchBotStatus();
        } else {
          const errObj = await playRes.json();
          addLog(`เกิดข้อผิดพลาด: ${errObj.error}`, 'error');
        }
      } catch (err) {
        addLog('ไม่สามารถสั่งรันเพลงได้', 'error');
      }
    });

    // ปุ่มลบเพลงโปรดออกจากคลัง
    li.querySelector('.btn-remove-fav').addEventListener('click', async (e) => {
      const btn = e.target;
      const id = btn.getAttribute('data-id');
      if (!confirm('ต้องการลบเพลงนี้ออกจากรายการเพลงโปรดของเซิร์ฟใช่หรือไม่?')) return;

      try {
        const delRes = await fetch(`/api/music/favorites?id=${id}`, {
          method: 'DELETE'
        });
        if (delRes.ok) {
          addLog('ลบเพลงโปรดออกจากคลังสำเร็จ', 'success');
          fetchAndRenderFavorites(guildId);
        }
      } catch (err) {
        addLog('ไม่สามารถลบเพลงโปรดได้', 'error');
      }
    });

    favoritesQueue.appendChild(li);
  });
}

// คลิกบันทึกเพลงโปรด
btnMusicFav.addEventListener('click', async () => {
  const guildId = globalGuildSelect.value;
  const query = musicSearch.value.trim();
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!query) return alert('กรุณากรอกชื่อเพลงหรือลิงก์ในช่องแชทก่อนบันทึก!');

  addLog(`กำลังนำเข้าและบันทึกเพลงโปรด "${query}" ลงในคลัง...`, 'system');
  btnMusicFav.disabled = true;

  try {
    const response = await fetch('/api/music/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, query })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`บันทึกเพลงโปรดสำเร็จ: ${result.song.title}`, 'success');
      musicSearch.value = '';
      fetchAndRenderFavorites(guildId);
    } else {
      addLog(`ไม่สามารถเซฟเพลงได้: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดขณะเซฟเพลงโปรด', 'error');
  } finally {
    btnMusicFav.disabled = false;
  }
});

// คลิกเชื่อมต่อเข้าห้องแชทเสียงเพื่อสแตนด์บาย 24/7 (โดยยังไม่รันเพลง)
btnMusicJoin.addEventListener('click', async () => {
  const guildId = globalGuildSelect.value;
  const voiceChannelId = musicVoiceSelect.value;
  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!voiceChannelId) return alert('กรุณาเลือกห้องเสียงแชทที่จะให้บอทเข้าสแตนด์บาย!');

  addLog('กำลังสั่งให้บอทเดินทางเข้าห้องเสียงเพื่อสแตนด์บาย 24/7...', 'system');
  btnMusicJoin.disabled = true;

  try {
    const response = await fetch('/api/music/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, voiceChannelId })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`บอทเชื่อมต่อเข้าสแตนด์บายในห้องเสียงสำเร็จ และจะสแตนด์บายตลอด 24/7`, 'success');
      fetchBotStatus();
    } else {
      addLog(`ไม่สามารถเชื่อมต่อห้องเสียงได้: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการสั่งให้บอทเข้าห้องเสียง', 'error');
  } finally {
    btnMusicJoin.disabled = false;
  }
});

// --- ระบบจัดการบทบาทยศสิทธิ์ใน Discord (Roles Management) ---
async function fetchAndRenderRoles(guildId) {
  if (!guildId) return;
  try {
    const response = await fetch(`/api/roles?guildId=${guildId}`);
    if (response.ok) {
      const roles = await response.json();
      renderRolesTable(guildId, roles);
    }
  } catch (error) {
    console.error('โหลดข้อมูลบทบาทล้มเหลว:', error);
  }
}

function renderRolesTable(guildId, roles) {
  rolesListBody.innerHTML = '';
  if (!roles || roles.length === 0) {
    rolesListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">ไม่พบบทบาทยศในเซิร์ฟเวอร์นี้</td></tr>';
    return;
  }

  roles.forEach(role => {
    const tr = document.createElement('tr');
    const colorStyle = role.color === '#000000' ? '#99aab5' : role.color;
    
    tr.innerHTML = `
      <td>
        <span class="role-badge" style="color: ${colorStyle}; border-color: ${colorStyle}33;">
          <span class="role-color-dot" style="background-color: ${colorStyle};"></span>
          ${role.name}
        </span>
      </td>
      <td>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">${role.position}</span>
      </td>
      <td>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">${role.hoist ? '✅ แยกกลุ่ม' : '❌ รวมกลุ่ม'}</span>
      </td>
      <td class="text-right">
        ${role.editable 
          ? `<button class="btn btn-danger btn-sm btn-delete-role" data-id="${role.id}" data-name="${role.name}">ลบยศ</button>`
          : `<span class="text-muted" style="font-size: 0.8rem; font-style: italic;">🔐 บล็อกไว้</span>`
        }
      </td>
    `;

    // ผูกสิทธิ์ลบยศในปุ่ม
    const delBtn = tr.querySelector('.btn-delete-role');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const name = e.target.getAttribute('data-name');
        if (!confirm(`คุณแน่ใจว่าต้องการลบบทบาทยศ "${name}" ออกจากดิสคอร์ดถาวรใช่หรือไม่?`)) return;

        addLog(`กำลังส่งคำขอลบยศ: "${name}"...`, 'system');
        try {
          const response = await fetch(`/api/roles?guildId=${guildId}&roleId=${id}`, {
            method: 'DELETE'
          });
          const result = await response.json();
          if (response.ok) {
            addLog(`ลบบทบาทยศ "${result.roleName}" สำเร็จ!`, 'success');
            fetchAndRenderRoles(guildId);
          } else {
            addLog(`ไม่สามารถลบยศได้: ${result.error}`, 'error');
          }
        } catch (err) {
          addLog('เกิดข้อผิดพลาดในการลบยศ', 'error');
        }
      });
    }

    rolesListBody.appendChild(tr);
  });
}

// ฟอร์มส่งขอสร้างยศใหม่
roleCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guildId = globalGuildSelect.value;
  const name = newRoleName.value.trim();
  const color = newRoleColor.value;
  const preset = newRolePreset.value;
  const hoist = newRoleHoist.checked;
  const mentionable = newRoleMentionable.checked;

  if (!guildId) return alert('กรุณาเลือกเซิร์ฟเวอร์ควบคุมก่อน!');
  if (!name) return alert('กรุณากรอกชื่อยศ!');

  addLog(`กำลังสร้างยศใหม่ "${name}" พร้อมสิทธิ์ตามพรีเซต...`, 'system');
  btnCreateRole.disabled = true;

  try {
    const response = await fetch('/api/roles/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, name, color, hoist, mentionable, preset })
    });
    const result = await response.json();
    if (response.ok) {
      addLog(`สร้างยศใหม่สำเร็จ: ${result.roleName}`, 'success');
      newRoleName.value = '';
      newRoleColor.value = '#99aab5';
      roleColorHex.innerText = '#99AAB5';
      newRolePreset.value = 'custom';
      newRoleHoist.checked = false;
      newRoleMentionable.checked = false;
      fetchAndRenderRoles(guildId);
    } else {
      addLog(`ไม่สามารถสร้างยศได้: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog('เกิดข้อผิดพลาดในการสั่งสร้างยศ', 'error');
  } finally {
    btnCreateRole.disabled = false;
  }
});

// --- ทำงานทันทีเมื่อโหลดหน้าเว็บ ---
addLog('กำลังโหลดข้อมูลแผงควบคุมหลัก...', 'system');
fetchBotStatus();
fetchLogs();
fetchCustomCommands();

// รันลูปดึงข้อมูลทุกๆ 2.5 วินาที
setInterval(() => {
  fetchBotStatus();
  fetchLogs();
}, 2500);

// Mobile sidebar toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebarEl = document.getElementById('sidebar');
const overlayEl = document.getElementById('sidebar-overlay');
if (mobileMenuBtn && sidebarEl && overlayEl) {
  mobileMenuBtn.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
    overlayEl.classList.toggle('visible');
  });
  overlayEl.addEventListener('click', () => {
    sidebarEl.classList.remove('open');
    overlayEl.classList.remove('visible');
  });
}
