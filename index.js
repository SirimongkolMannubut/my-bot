// โหลด environment variables จากไฟล์ .env
require('dotenv').config();

// ตั้งค่าเรียกใช้ FFmpeg Static อัตโนมัติ (ช่วยแปลงไฟล์เสียง YouTube)
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    console.log(`[SYSTEM] โหลด FFmpeg Static สำเร็จ: ${ffmpegPath}`);
  }
} catch (err) {
  console.log('[SYSTEM] ไม่พบ ffmpeg-static จะใช้ตัวแปรระบบหลักถ้ามี');
}

const express = require('express');
const { Client, GatewayIntentBits, ChannelType, ActivityType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const path = require('path');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const youtubeDl = require('youtube-dl-exec');

// สร้าง stream เสียงโดย spawn yt-dlp โดยตรง (pipe stdout เข้า Discord)
function createYtdlpStream(url) {
  const proc = spawn('yt-dlp', [
    '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    '--output', '-',
    '--quiet',
    '--no-warnings',
    '--no-check-certificate',
    '--no-playlist',
    '--extractor-args', 'youtube:player_client=ios',
    url
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  return proc.stdout;
}

// --- ระบบบันทึก Logs ในหน่วยความจำ (In-Memory Logs) ---
const botLogs = [];
function logEvent(message, type = 'system') {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  botLogs.push({ time, message, type });
  
  if (botLogs.length > 50) {
    botLogs.shift();
  }
  
  console.log(`[${type.toUpperCase()}] [${time}] ${message}`);
}

// --- เชื่อมต่อ MongoDB ---
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  logEvent('ข้อผิดพลาด: ไม่พบ MONGODB_URI ในไฟล์ .env', 'error');
  process.exit(1);
}

// ตัวแปรและแคชในแอปพลิเคชัน
let botPrefix = '!';
let botActivity = 'พิมพ์ !ping';
const settingsCache = new Map(); // guildId -> settings document
const musicQueues = new Map();   // guildId -> array of songs { title, url, duration }
const audioPlayers = new Map();  // guildId -> AudioPlayer instance

// --- โครงสร้างฐานข้อมูล MongoDB ---
// 1. Settings Schema
const settingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: '!' },
  activity: { type: String, default: 'พิมพ์ !ping' },
  welcomeEnabled: { type: Boolean, default: false },
  welcomeChannelId: { type: String, default: '' },
  welcomeMessage: { type: String, default: 'ยินดีต้อนรับคุณ {user} เข้าสู่เซิร์ฟเวอร์ของเรา! 🎉' },
  leaveEnabled: { type: Boolean, default: false },
  leaveChannelId: { type: String, default: '' },
  leaveMessage: { type: String, default: 'คุณ {user} ได้ออกจากเซิร์ฟเวอร์ไปแล้ว ขอให้โชคดีครับ 👋' },
  voiceChannelId: { type: String, default: null }
});
const Settings = mongoose.model('Settings', settingsSchema);

// 2. Custom Command Schema
const customCommandSchema = new mongoose.Schema({
  commandName: { type: String, required: true, unique: true },
  responseContent: { type: String, required: true }
});
const CustomCommand = mongoose.model('CustomCommand', customCommandSchema);

// 3. Saved Song Schema (ระบบคลังเพลงโปรดประจำเซิร์ฟเวอร์)
const savedSongSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
  duration: { type: String, default: '00:00' },
  createdAt: { type: Date, default: Date.now }
});
const SavedSong = mongoose.model('SavedSong', savedSongSchema);


// ฟังก์ชันดึงค่าตั้งค่าของแต่ละกิลด์ (โหลดจาก DB / สร้างถ้ายังไม่มี)
async function getGuildSettings(guildId) {
  if (!guildId) return { prefix: '!', activity: 'พิมพ์ !ping' };
  
  if (settingsCache.has(guildId)) {
    return settingsCache.get(guildId);
  }
  
  try {
    let config = await Settings.findOne({ guildId });
    if (!config) {
      config = await Settings.create({ guildId });
    }
    settingsCache.set(guildId, config);
    return config;
  } catch (error) {
    logEvent(`ดึงข้อมูลตั้งค่าสำหรับห้อง ${guildId} ล้มเหลว: ${error.message}`, 'error');
    return { prefix: '!', activity: 'พิมพ์ !ping' };
  }
}

// เชื่อมต่อฐานข้อมูล MongoDB Atlas
mongoose.connect(MONGODB_URI)
  .then(() => {
    logEvent('เชื่อมต่อกับ MongoDB Atlas สำเร็จ! 🍃', 'success');
  })
  .catch(error => {
    logEvent(`เชื่อมต่อ MongoDB ล้มเหลว: ${error.message}`, 'error');
  });

// --- จัดการการทำงานของระบบเล่นเพลง ---
function getGuildAudioPlayer(guildId, connection) {
  if (audioPlayers.has(guildId)) {
    const existing = audioPlayers.get(guildId);
    connection.subscribe(existing);
    return existing;
  }
  
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    logEvent(`เพลงเล่นจบแล้วในกิลด์ ${guildId} กำลังดึงเพลงถัดไป...`, 'bot');
    playNextSong(guildId);
  });

  player.on('error', error => {
    logEvent(`ข้อผิดพลาดของเครื่องเล่นเพลง: ${error.message}`, 'error');
  });

  connection.subscribe(player);
  audioPlayers.set(guildId, player);
  return player;
}

function connectToVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  // ระบบตรวจจับสายหลุดและเชื่อมต่อใหม่ให้แบบ 24/7
  connection.on('stateChange', async (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (error) {
        if (connection.state.status === VoiceConnectionStatus.Disconnected) {
          logEvent(`[24/7 Reconnect] บอทตรวจพบสัญญาณห้องเสียงหลุดในเซิร์ฟ "${guild.name}" กำลังกู้คืนช่องเสียงอัตโนมัติ...`, 'warning');
          const settings = await getGuildSettings(guild.id);
          if (settings && settings.voiceChannelId) {
            const activeCh = guild.channels.cache.get(settings.voiceChannelId);
            if (activeCh) {
              connectToVoice(guild, activeCh);
            }
          }
        }
      }
    }
  });

  getGuildAudioPlayer(guild.id, connection);
  return connection;
}

async function playNextSong(guildId) {
  const queue = musicQueues.get(guildId);
  const player = audioPlayers.get(guildId);
  const connection = getVoiceConnection(guildId);

  if (!queue || queue.length === 0 || !player || !connection) {
    if (player) player.stop();
    return;
  }

  // ลบเพลงแรกที่เพิ่งเล่นจบไปออกจากคิว
  queue.shift();

  if (queue.length === 0) {
    logEvent(`คิวเพลงในเซิร์ฟเวอร์หมดแล้ว ID: ${guildId}`, 'bot');
    player.stop();
    return;
  }

  // ดึงเพลงถัดมาเพื่อรันต่อ
  const nextSong = queue[0];
  try {
    logEvent(`กำลังดึงสตรีมเพลงถัดไปจาก YouTube: "${nextSong.title}"`, 'bot');

    // pipe yt-dlp โดยตรงเข้า Discord ไม่ต้องดึง CDN URL ที่อาจหมดอายุ
    const stream = createYtdlpStream(nextSong.url);
    const resource = createAudioResource(stream);
    player.play(resource);
    logEvent(`กำลังเล่นเพลงถัดไป: "${nextSong.title}"`, 'bot');
  } catch (error) {
    logEvent(`รันเพลงถัดไปผิดพลาด: ${error.message}`, 'error');
    playNextSong(guildId);
  }
}

// --- กำหนดค่าและสร้าง Express Server ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ตรวจสอบ Discord Token
if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  logEvent('ข้อผิดพลาด: กรุณาใส่ Discord Bot Token ของคุณในไฟล์ .env ก่อนรันบอท', 'error');
  process.exit(1);
}

// --- สร้าง Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ]
});

// บอทออนไลน์สำเร็จ
client.once('ready', async () => {
  logEvent(`บอทล็อกอินสำเร็จในชื่อ: ${client.user.tag}`, 'success');
  client.user.setActivity(botActivity, { type: ActivityType.Playing });

  // ดึงห้องตั้งค่าทั้งหมดที่มีการระบุห้องเสียง 24/7 ไว้ เพื่อทำการเชื่อมต่อเข้าห้องให้อัตโนมัติ (เช่น หลังรีสตาร์ท / ดีพลอย)
  try {
    const activeSettings = await Settings.find({ voiceChannelId: { $ne: null } });
    for (const setting of activeSettings) {
      const guild = client.guilds.cache.get(setting.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(setting.voiceChannelId);
      if (!channel) {
        setting.voiceChannelId = null;
        await setting.save();
        continue;
      }
      logEvent(`[24/7] กำลังสแตนด์บายเชื่อมต่อเข้าห้องเสียงอัตโนมัติในเซิร์ฟ "${guild.name}" ห้อง "${channel.name}" 🍃`, 'system');
      connectToVoice(guild, channel);
    }
  } catch (err) {
    console.error('[24/7 Error] ไม่สามารถเชื่อมต่อห้องเสียงตอนเริ่มทำงานได้:', err);
  }
});

// เหตุการณ์เมื่อคนเข้าเซิร์ฟเวอร์ (Welcome)
client.on('guildMemberAdd', async (member) => {
  try {
    const config = await getGuildSettings(member.guild.id);
    if (config.welcomeEnabled && config.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(config.welcomeChannelId);
      if (channel) {
        const text = config.welcomeMessage.replace('{user}', `<@${member.user.id}>`);
        await channel.send(text);
        logEvent(`ส่งข้อความต้อนรับคนเข้าใหม่ @${member.user.username} ไปที่ห้อง #${channel.name}`, 'bot');
      }
    }
  } catch (error) {
    logEvent(`ส่งข้อความต้อนรับผิดพลาด: ${error.message}`, 'error');
  }
});

// เหตุการณ์เมื่อคนออกจากเซิร์ฟเวอร์ (Leave)
client.on('guildMemberRemove', async (member) => {
  try {
    const config = await getGuildSettings(member.guild.id);
    if (config.leaveEnabled && config.leaveChannelId) {
      const channel = member.guild.channels.cache.get(config.leaveChannelId);
      if (channel) {
        const text = config.leaveMessage.replace('{user}', `**${member.user.username}**`);
        await channel.send(text);
        logEvent(`ส่งข้อความบอกลาคนออกจากเซิร์ฟเวอร์ @${member.user.username} ไปที่ห้อง #${channel.name}`, 'bot');
      }
    }
  } catch (error) {
    logEvent(`ส่งข้อความบอกลาผิดพลาด: ${error.message}`, 'error');
  }
});

// เหตุการณ์รับข้อความ (Commands)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  const config = await getGuildSettings(guildId);
  const prefix = config ? config.prefix : '!';

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  logEvent(`ผู้ใช้ @${message.author.username} ใช้คำสั่ง: ${message.content} ในเซิร์ฟเวอร์: ${message.guild?.name || 'DM'}`, 'user');

  if (command === 'ping') {
    try {
      await message.reply('🏓 Pong!');
      logEvent('ตอบกลับคำสั่ง ping สำเร็จ', 'bot');
    } catch (e) {
      logEvent(`คำสั่ง ping ผิดพลาด: ${e.message}`, 'error');
    }
    return;
  }

  if (command === 'hello') {
    try {
      await message.reply(`สวัสดีครับคุณ @${message.author.username}! 👋`);
      logEvent('ตอบกลับคำสั่ง hello สำเร็จ', 'bot');
    } catch (e) {
      logEvent(`คำสั่ง hello ผิดพลาด: ${e.message}`, 'error');
    }
    return;
  }

  // ตรวจคำสั่งพิเศษใน MongoDB
  try {
    const cmdDoc = await CustomCommand.findOne({ commandName: command });
    if (cmdDoc) {
      await message.reply(cmdDoc.responseContent);
      logEvent(`รันคำสั่งพิเศษ "${command}" ตอบกลับ: ${cmdDoc.responseContent}`, 'bot');
    }
  } catch (error) {
    logEvent(`ค้นหาคำสั่งพิเศษล้มเหลว: ${error.message}`, 'error');
  }
});

// --- API สำหรับหน้าแผงควบคุม Dashboard ---

// 1. ดึงสถานะทั่วไปและข้อมูลรายเซิร์ฟเวอร์
app.get('/api/status', async (req, res) => {
  if (!client.isReady()) {
    return res.json({ online: false });
  }

  try {
    const guildsData = await Promise.all(client.guilds.cache.map(async (guild) => {
      const config = await getGuildSettings(guild.id);
      
      const textChannels = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText)
        .map(ch => ({ id: ch.id, name: ch.name }));

      const voiceChannels = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildVoice)
        .map(ch => ({ id: ch.id, name: ch.name }));

      const categories = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildCategory)
        .map(ch => ({ id: ch.id, name: ch.name }));

      let members = [];
      try {
        const fetched = await guild.members.fetch({ limit: 100 });
        members = fetched
          .filter(m => !m.user.bot)
          .map(m => ({ id: m.id, tag: m.user.tag }));
      } catch (err) {
        members = guild.members.cache
          .filter(m => !m.user.bot)
          .map(m => ({ id: m.id, tag: m.user.tag }));
      }

      const botVoice = guild.members.me?.voice;
      const connectedCh = botVoice?.channel;

      return {
        id: guild.id,
        name: guild.name,
        textChannels,
        voiceChannels,
        categories,
        members,
        welcomeEnabled: config.welcomeEnabled,
        welcomeChannelId: config.welcomeChannelId,
        welcomeMessage: config.welcomeMessage,
        leaveEnabled: config.leaveEnabled,
        leaveChannelId: config.leaveChannelId,
        leaveMessage: config.leaveMessage,
        prefix: config.prefix,
        activity: config.activity,
        connectedVoiceChannelId: connectedCh ? connectedCh.id : null,
        connectedVoiceChannelName: connectedCh ? connectedCh.name : null,
        musicQueue: musicQueues.get(guild.id) || []
      };
    }));

    res.json({
      online: true,
      ping: client.ws.ping,
      guildCount: client.guilds.cache.size,
      prefix: botPrefix,
      activity: botActivity,
      guilds: guildsData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. บันทึกตั้งค่าทั่วไป
app.post('/api/settings/general', async (req, res) => {
  const { prefix, activity } = req.body;
  try {
    if (prefix) botPrefix = prefix;
    if (activity !== undefined) {
      botActivity = activity;
      if (client.isReady()) {
        client.user.setActivity(botActivity, { type: ActivityType.Playing });
      }
    }

    await Settings.updateMany({}, { prefix: botPrefix, activity: botActivity });
    settingsCache.clear();

    logEvent(`บันทึกตั้งค่าทั่วไปเรียบร้อย: Prefix = "${botPrefix}", Activity = "${botActivity}"`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. สร้างห้องใหม่แชท/ห้องเสียง (Channel Creator)
app.post('/api/channels/create', async (req, res) => {
  const { guildId, name, type } = req.body;
  if (!guildId || !name || !type) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const channelType = type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
    const newCh = await guild.channels.create({
      name: name,
      type: channelType
    });

    logEvent(`สร้างห้องแชทใหม่สำเร็จ: "${newCh.name}" (${type}) ในเซิร์ฟ "${guild.name}"`, 'system');
    res.json({ success: true, channelName: newCh.name });
  } catch (error) {
    logEvent(`สร้างห้องไม่สำเร็จ: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// 4. บันทึกข้อความแจ้งเตือนคนเข้าออก
app.post('/api/settings/welcome', async (req, res) => {
  const {
    guildId,
    welcomeEnabled,
    welcomeChannelId,
    welcomeMessage,
    leaveEnabled,
    leaveChannelId,
    leaveMessage
  } = req.body;

  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    let config = await Settings.findOne({ guildId });
    if (!config) config = new Settings({ guildId });

    config.welcomeEnabled = welcomeEnabled;
    config.welcomeChannelId = welcomeChannelId || '';
    config.welcomeMessage = welcomeMessage || '';
    config.leaveEnabled = leaveEnabled;
    config.leaveChannelId = leaveChannelId || '';
    config.leaveMessage = leaveMessage || '';

    await config.save();
    settingsCache.set(guildId, config);

    logEvent(`บันทึกระบบต้อนรับของเซิร์ฟ ID: ${guildId} สำเร็จ 🍃`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. ดึงคำสั่งพิเศษทั้งหมด
app.get('/api/commands', async (req, res) => {
  try {
    const cmds = await CustomCommand.find();
    res.json(cmds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. เพิ่มหรือแก้ไขคำสั่งพิเศษ
app.post('/api/commands', async (req, res) => {
  const { name, response } = req.body;
  if (!name || !response) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  try {
    let cmd = await CustomCommand.findOne({ commandName: name });
    if (cmd) {
      cmd.responseContent = response;
      await cmd.save();
    } else {
      await CustomCommand.create({ commandName: name, responseContent: response });
    }
    logEvent(`เพิ่ม/แก้ไขคำสั่งพิเศษ "${name}" ลงใน MongoDB 🍃`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. ลบคำสั่งพิเศษ
app.delete('/api/commands/:name', async (req, res) => {
  const name = req.params.name;
  try {
    await CustomCommand.deleteOne({ commandName: name });
    logEvent(`ลบคำสั่งพิเศษ "${name}" ออกจาก MongoDB 🍃`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. จัดการลงโทษสมาชิก (Kick / Ban / Timeout)
app.post('/api/moderation/action', async (req, res) => {
  const { guildId, userId, action } = req.body;
  if (!guildId || !userId || !action) {
    return res.status(400).json({ error: 'ระบุข้อมูลไม่ครบ' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const member = await guild.members.fetch(userId);
    if (!member) return res.status(404).json({ error: 'ไม่พบสมาชิกนี้' });

    if (action === 'kick') {
      await member.kick('ลงโทษโดยแอดมินผ่าน Dashboard');
      logEvent(`เตะ @${member.user.username} ออกจากเซิร์ฟ "${guild.name}" ผ่าน Dashboard`, 'system');
    } else if (action === 'ban') {
      await member.ban({ reason: 'ลงโทษโดยแอดมินผ่าน Dashboard' });
      logEvent(`แบน @${member.user.username} ออกจากเซิร์ฟ "${guild.name}" ผ่าน Dashboard`, 'system');
    } else if (action === 'timeout') {
      await member.timeout(10 * 60 * 1000, 'ลงโทษโดยแอดมินผ่าน Dashboard');
      logEvent(`จำกัดการแชท (Timeout) @${member.user.username} เป็นเวลา 10 นาทีในเซิร์ฟ "${guild.name}"`, 'system');
    } else {
      return res.status(400).json({ error: 'คำสั่งลงโทษไม่ถูกต้อง' });
    }

    res.json({ success: true });
  } catch (error) {
    logEvent(`ดำเนินการลงโทษไม่สำเร็จ: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// --- 8.1 ระบบจัดการบทบาท/ยศ (Roles Management) ---
// ดึงข้อมูลยศทั้งหมดในกิลด์ เรียงจากระดับสูงลงต่ำ
app.get('/api/roles', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const botMember = guild.members.me;
    const roles = guild.roles.cache.map(role => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      hoist: role.hoist,
      mentionable: role.mentionable,
      position: role.position,
      editable: role.id !== guild.roles.everyone.id && role.comparePositionTo(botMember.roles.highest) < 0
    })).sort((a, b) => b.position - a.position);

    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// สร้างยศใหม่ตามพรีเซตสิทธิ์ต่างๆ
app.post('/api/roles/create', async (req, res) => {
  const { guildId, name, color, hoist, mentionable, preset } = req.body;
  if (!guildId || !name) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    // กำหนดสิทธิ์ตาม Preset สิทธิ์ใน Discord
    let permissions = [];
    if (preset === 'admin') {
      permissions = [PermissionFlagsBits.Administrator];
    } else if (preset === 'mod') {
      permissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ];
    } else if (preset === 'dj') {
      permissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.SendMessages
      ];
    } else if (preset === 'member') {
      permissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.ReadMessageHistory
      ];
    }

    const newRole = await guild.roles.create({
      name: name,
      color: color || '#99aab5',
      hoist: hoist || false,
      mentionable: mentionable || false,
      permissions: permissions,
      reason: 'สร้างยศผ่านระบบ Web Dashboard'
    });

    logEvent(`สร้างบทบาทยศสำเร็จ: "${newRole.name}" สี "${color}" พรีเซต "${preset}" ในเซิร์ฟ "${guild.name}"`, 'system');
    res.json({ success: true, roleName: newRole.name });
  } catch (error) {
    logEvent(`สร้างยศไม่สำเร็จ: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// ลบยศออกจากดิสคอร์ด
app.delete('/api/roles', async (req, res) => {
  const { guildId, roleId } = req.query;
  if (!guildId || !roleId) return res.status(400).json({ error: 'ข้อมูลระบุไม่ครบถ้วน' });

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const role = guild.roles.cache.get(roleId);
    if (!role) return res.status(404).json({ error: 'ไม่พบบทบาทยศนี้' });

    const botMember = guild.members.me;
    if (role.id === guild.roles.everyone.id) {
      return res.status(403).json({ error: 'ไม่สามารถลบบทบาท @everyone ได้' });
    }
    if (role.comparePositionTo(botMember.roles.highest) >= 0) {
      return res.status(403).json({ error: 'บทบาทนี้อยู่ระดับสูงกว่าหรือเท่ากับยศสูงสุดของบอท ไม่สามารถลบได้' });
    }

    const roleName = role.name;
    await role.delete('ลบบทบาทผ่านแผงควบคุม Dashboard');
    logEvent(`ลบยศสำเร็จ: "${roleName}" ในเซิร์ฟ "${guild.name}"`, 'system');
    res.json({ success: true, roleName });
  } catch (error) {
    logEvent(`ลบยศไม่สำเร็จ: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// ค้นหาเพลงบน YouTube (ส่งผลลัพธ์กลับมาให้เลือก เหมือน YouTube Search)
app.get('/api/music/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ results: [] });

  try {
    const { default: youtubeSr } = await import('youtube-sr');
    const results = await youtubeSr.YouTube.search(q.trim(), { limit: 8, type: 'video' });
    const videos = results.map(v => ({
      id: v.id,
      title: v.title || 'ไม่ทราบชื่อเพลง',
      url: `https://www.youtube.com/watch?v=${v.id}`,
      duration: v.durationFormatted || '0:00',
      thumbnail: v.thumbnail?.url || `https://img.youtube.com/vi/${v.id}/mqdefault.jpg`,
      channel: v.channel?.name || '',
      views: v.views ? `${(v.views / 1000000).toFixed(1)}M views` : '',
    }));
    res.json({ results: videos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// เข้าร่วมห้องเสียงเพื่อสแตนด์บาย 24/7 (โดยยังไม่เล่นเพลง)
app.post('/api/music/join', async (req, res) => {
  const { guildId, voiceChannelId } = req.body;
  if (!guildId || !voiceChannelId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      return res.status(404).json({ error: 'ไม่พบช่องเสียงแชท' });
    }

    // เชื่อมต่อห้องเสียงและลงทะเบียนการกู้สาย 24/7
    connectToVoice(guild, channel);

    // บันทึกห้องเสียงลงฐานข้อมูลสำหรับสแตนด์บายอัตโนมัติ
    const settings = await getGuildSettings(guildId);
    settings.voiceChannelId = voiceChannelId;
    await settings.save();

    logEvent(`บอทเชื่อมต่อเข้าร่วมห้องเสียง "${channel.name}" เพื่อสแตนด์บาย 24/7 เรียบร้อย`, 'bot');
    res.json({ success: true, channelName: channel.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. สั่งรันเพลงเข้าห้องแชทเสียง (รองรับเสิร์ชด้วยคำค้นหา และลิงก์ตรง ด้วยความเสถียรของ yt-dlp)
app.post('/api/music/play', async (req, res) => {
  const { guildId, voiceChannelId, query } = req.body;
  if (!guildId || !voiceChannelId || !query) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'ไม่พบเซิร์ฟเวอร์' });

    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      return res.status(404).json({ error: 'ไม่พบช่องเสียงแชท' });
    }

    // ทำการเชื่อมต่อห้องเสียงและลงทะเบียนลิสเนอร์กู้สาย 24/7
    const connection = connectToVoice(guild, channel);

    // บันทึกห้องเสียงล่าสุดลงใน MongoDB สำหรับสแตนด์บาย 24/7
    const settings = await getGuildSettings(guildId);
    settings.voiceChannelId = voiceChannelId;
    await settings.save();

    logEvent(`กำลังค้นหาและดึงข้อมูลเพลงจาก YouTube: "${query}"`, 'system');

    let targetQuery = query;
    const isUrl = query.startsWith('http');

    // ตัด playlist params ออกเพื่อเล่นเพลงเดียว
    if (isUrl) {
      try {
        const cleanUrl = new URL(query);
        const videoId = cleanUrl.searchParams.get('v');
        if (videoId) targetQuery = `https://www.youtube.com/watch?v=${videoId}`;
      } catch (_) {}
    } else {
      targetQuery = `ytsearch1:${query}`;
    }

    const info = await youtubeDl(targetQuery, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificate: true,
      noPlaylist: true,
      extractorArgs: 'youtube:player_client=ios',
    });

    const video = info.entries ? info.entries[0] : info;
    if (!video) return res.status(404).json({ error: 'ไม่พบผลลัพธ์' });

    const title = video.title;
    const url = video.webpage_url || video.url;
    const seconds = video.duration || 0;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const duration = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;

    const audioFormats = video.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
    if (audioFormats.length === 0) return res.status(400).json({ error: 'ไม่พบฟอร์แมตเสียง' });
    audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
    const streamUrl = audioFormats[0].url;

    const song = { title, url, duration };
    let queue = musicQueues.get(guildId);
    if (!queue) { queue = []; musicQueues.set(guildId, queue); }
    queue.push(song);

    const player = getGuildAudioPlayer(guildId, connection);
    if (player.state.status === AudioPlayerStatus.Idle && queue.length === 1) {
      logEvent(`เริ่มเล่นเพลง: "${song.title}"`, 'bot');
      // pipe yt-dlp โดยตรงเข้า Discord ไม่ต้องดึง CDN URL
      const stream = createYtdlpStream(url);
      const resource = createAudioResource(stream);
      player.play(resource);
    } else {
      logEvent(`เพิ่มเพลงเข้าคิวลำดับที่: ${queue.length}`, 'bot');
    }

    res.json({ success: true, title: song.title });
  } catch (error) {
    logEvent(`เชื่อมต่อห้องเสียง/เล่นเพลง YouTube ผิดพลาด: ${error.message}`, 'error');
    res.status(500).json({ error: `เกิดข้อผิดพลาดในการรันสตรีม: ${error.message}` });
  }
});

// พักเพลง / เล่นต่อชั่วคราว
app.post('/api/music/pause', (req, res) => {
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    const player = audioPlayers.get(guildId);
    if (player) {
      if (player.state.status === AudioPlayerStatus.Playing) {
        player.pause();
        logEvent(`พักการเล่นเพลงชั่วคราวในเซิร์ฟ ID: ${guildId}`, 'bot');
      } else if (player.state.status === AudioPlayerStatus.Paused) {
        player.unpause();
        logEvent(`เล่นเพลงต่อจากเดิมในเซิร์ฟ ID: ${guildId}`, 'bot');
      }
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'บอทไม่ได้เปิดคิวเพลงอยู่ในขณะนี้' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ออกจากห้องเสียง & ล้างคิวเพลง
app.post('/api/music/stop', async (req, res) => {
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    const player = audioPlayers.get(guildId);
    if (player) {
      player.stop();
      audioPlayers.delete(guildId);
    }

    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
    
    musicQueues.delete(guildId);

    // เคลียร์ค่าบันทึก 24/7 เพื่อให้รู้ว่าผู้ใช้สั่งปลดบอทออกจากการเชื่อมต่อถาวรแล้ว
    const settings = await getGuildSettings(guildId);
    settings.voiceChannelId = null;
    await settings.save();

    logEvent(`ล้างคิวเพลงและบอทตัดสายออกจากห้องเสียงเรียบร้อย เซิร์ฟ ID: ${guildId}`, 'bot');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- 10. ระบบจัดเก็บเพลงโปรด (Saved Favorites Playlists) ---
// ดึงรายการเพลงโปรดทั้งหมดในกิลด์
app.get('/api/music/favorites', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    const songs = await SavedSong.find({ guildId }).sort({ createdAt: -1 });
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// บันทึกเพลงโปรดลง MongoDB
app.post('/api/music/favorites', async (req, res) => {
  const { guildId, title, url, duration, query } = req.body;
  if (!guildId) return res.status(400).json({ error: 'ไม่พบกิลด์ ID' });

  try {
    let targetTitle = title;
    let targetUrl = url;
    let targetDuration = duration;

    // หากส่งคำค้นหามาแทนข้อมูลตรงๆ ให้แปลง/เสิร์ชผ่าน yt-dlp ก่อนเซฟ
    if (query && (!title || !url)) {
      logEvent(`ค้นหาเพลงโปรด: "${query}"`, 'system');
      let targetQuery = query;
      if (!query.startsWith('http')) {
        targetQuery = `ytsearch1:${query}`;
      } else {
        try {
          const cu = new URL(query);
          const vid = cu.searchParams.get('v');
          if (vid) targetQuery = `https://www.youtube.com/watch?v=${vid}`;
        } catch (_) {}
      }
      const info = await youtubeDl(targetQuery, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificate: true,
        noPlaylist: true,
        extractorArgs: 'youtube:player_client=android,web',
      });
      const video = info.entries ? info.entries[0] : info;
      if (!video) return res.status(404).json({ error: 'ไม่พบเพลงนี้บน YouTube' });
      targetTitle = video.title;
      targetUrl = video.webpage_url || video.url;
      const seconds = video.duration || 0;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      targetDuration = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
    }

    if (!targetTitle || !targetUrl) {
      return res.status(400).json({ error: 'ข้อมูลระบุไม่ครบถ้วน' });
    }

    const exists = await SavedSong.findOne({ guildId, url: targetUrl });
    if (exists) {
      return res.status(400).json({ error: 'เพลงนี้อยู่ในคลังเพลงโปรดเรียบร้อยแล้ว' });
    }

    const saved = await SavedSong.create({
      guildId,
      title: targetTitle,
      url: targetUrl,
      duration: targetDuration
    });
    logEvent(`บันทึกเพลงโปรดสำเร็จ: "${targetTitle}" ลงในคลังเซิร์ฟเวอร์ 🍃`, 'system');
    res.json({ success: true, song: saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ลบเพลงโปรดออกจาก MongoDB
app.delete('/api/music/favorites', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ไม่พบ ID เพลงโปรด' });

  try {
    const deleted = await SavedSong.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'ไม่พบเพลงโปรดที่ต้องการลบ' });
    logEvent(`ลบเพลงโปรดสำเร็จ: "${deleted.title}" ออกจากคลังเซิร์ฟเวอร์ 🍃`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ดึง Logs
app.get('/api/logs', (req, res) => {
  res.json(botLogs);
});

// --- สตาร์ท Web Server และล็อกอิน ---
app.listen(PORT, () => {
  logEvent(`แผงควบคุม Dashboard รันใช้งานที่ http://localhost:${PORT}`, 'system');
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  logEvent(`บอทล็อกอินล้มเหลว: ${error.message}`, 'error');
});
