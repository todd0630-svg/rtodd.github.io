import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://zkarexhmqozyekwpgsug.supabase.co',
  'sb_publishable_CGnWqiqvGRw6RECLHeo2LQ_MEmISGUB'
);
const PLAYLIST_ID = 'PLA6Ev6GSTKFc';

export class CyTubeRoom {
  constructor(roomId, username, isModerator, playerId, _canvasId, chatLogId, chatFormId, chatInputId) {
    this.roomId = roomId;
    this.username = username;
    this.isModerator = isModerator;
    this.playerId = playerId;
    this.chatLog = document.getElementById(chatLogId);
    this.chatForm = document.getElementById(chatFormId);
    this.chatInput = document.getElementById(chatInputId);
    this.canvas = document.getElementById('paint-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.strokeHistory = [];
    this.currentStroke = [];
    this.queueItems = [];
    this.queueVotes = new Map();
    this.messageTimes = [];
    this.lastQueueSubmission = 0;
    this.player = null;
    this.syncing = false;
    this.bindChat();
    this.bindVoting();
    this.bindQueue();
    this.initCanvas();
    this.connect();
    this.createPlayer();
  }

  createPlayer() {
    const create = () => {
      if (!window.YT?.Player || this.player) return;
      if (window.location.protocol === 'file:') {
        const playerHost = document.getElementById(this.playerId);
        if (playerHost) {
          playerHost.innerHTML = '<div class="flex h-full min-h-[260px] items-center justify-center p-6 text-center text-sm text-slate-300">YouTube playback is available when this site is opened over HTTPS. Use the deployed site to watch the shared playlist.</div>';
        }
        return;
      }
      this.player = new YT.Player(this.playerId, {
        width: '100%',
        height: '390',
        playerVars: { listType: 'playlist', list: PLAYLIST_ID, playsinline: 1, controls: this.isModerator ? 1 : 0, origin: window.location.origin, rel: 0 },
        events: { onStateChange: event => this.playerChanged(event) }
      });
    };
    if (window.YT?.Player) create();
    else window.addEventListener('youtube-api-ready', create, { once: true });
  }

  async connect() {
    this.setStatus('Connecting to community room...');
    this.channel = supabase.channel(`room:${this.roomId}`, {
      config: { presence: { key: this.username } }
    });
    this.channel
      .on('presence', { event: 'sync' }, () => this.renderUsers())
      .on('broadcast', { event: 'video_sync' }, ({ payload }) => this.receiveVideo(payload))
      .on('broadcast', { event: 'request_sync' }, () => {
        if (this.isModerator) this.sendVideoState();
      })
      .on('broadcast', { event: 'video_vote' }, ({ payload }) => this.renderVote(payload))
      .on('broadcast', { event: 'queue_vote' }, ({ payload }) => {
        this.queueVotes.set(payload.itemId, (this.queueVotes.get(payload.itemId) || 0) + 1);
        this.renderQueue();
      })
      .on('broadcast', { event: 'canvas_stroke' }, ({ payload }) => {
        this.strokeHistory.push(payload);
        this.redrawCanvas();
      })
      .on('broadcast', { event: 'canvas_clear' }, () => {
        this.strokeHistory = [];
        this.clearCanvas();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
        if (message.room_id === this.roomId) this.renderMessage(message.user_name, message.content, message.created_at);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'queue_items' }, ({ new: item }) => {
        if (item.room_id === this.roomId && !this.queueItems.some(existing => existing.id === item.id)) {
          this.queueItems.push(item);
          this.renderQueue();
        }
      });
    this.channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        const presenceResult = await this.channel.track({ user: this.username, role: this.isModerator ? 'host' : 'viewer' });
        if (presenceResult?.error) {
          this.setStatus('Connected, but presence is unavailable. Check Realtime settings.');
          return;
        }
        await this.loadHistory();
        await this.loadQueue();
        if (!this.isModerator) this.requestSync();
        this.setStatus(`Connected as ${this.username}`);
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        this.setStatus(`Room connection ${status.toLowerCase().replace('_', ' ')}.`);
      }
    });
  }

  setStatus(message) {
    const status = document.getElementById('room-status');
    if (status) status.textContent = message;
  }

  async loadHistory() {
    const { data, error } = await supabase.from('messages').select('user_name, content, created_at').eq('room_id', this.roomId).order('created_at', { ascending: true }).limit(100);
    if (!error) data.forEach(message => this.renderMessage(message.user_name, message.content, message.created_at));
  }

  async loadQueue() {
    const { data, error } = await supabase.from('queue_items').select('id, video_id, title, submitted_by, created_at').eq('room_id', this.roomId).order('created_at', { ascending: true }).limit(50);
    if (error) {
      this.setQueueStatus('Queue is not configured yet. Apply the Supabase queue migration.');
      return;
    }
    this.queueItems = data || [];
    this.renderQueue();
  }

  bindQueue() {
    document.getElementById('queue-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const urlInput = document.getElementById('queue-url');
      const titleInput = document.getElementById('queue-title');
      const status = document.getElementById('queue-status');
      if (Date.now() - this.lastQueueSubmission < 10000) {
        if (status) status.textContent = 'Please wait before adding another video.';
        return;
      }
      const videoId = this.extractVideoId(urlInput.value.trim());
      if (!videoId) {
        if (status) status.textContent = 'Enter a valid YouTube video URL or 11-character video ID.';
        return;
      }
      const title = titleInput.value.trim() || `YouTube video ${videoId}`;
      const { error } = await supabase.from('queue_items').insert({ room_id: this.roomId, video_id: videoId, title: title.slice(0, 160), submitted_by: this.username });
      if (error) {
        if (status) status.textContent = `Unable to add video: ${error.message}`;
        return;
      }
      urlInput.value = '';
      titleInput.value = '';
      this.lastQueueSubmission = Date.now();
      if (status) status.textContent = 'Video added to the community queue.';
    });
  }

  extractVideoId(value) {
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.hostname === 'youtu.be') return url.pathname.slice(1).match(/^[A-Za-z0-9_-]{11}$/)?.[0] || '';
      if (url.hostname.endsWith('youtube.com')) {
        return url.searchParams.get('v')?.match(/^[A-Za-z0-9_-]{11}$/)?.[0] || url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})|\/embed\/([A-Za-z0-9_-]{11})/)?.slice(1).find(Boolean) || '';
      }
    } catch { return ''; }
    return '';
  }

  setQueueStatus(message) {
    const status = document.getElementById('queue-status');
    if (status) status.textContent = message;
  }

  renderQueue() {
    const list = document.getElementById('queue-list');
    if (!list) return;
    list.replaceChildren(...this.queueItems.map(item => {
      const row = document.createElement('article');
      row.className = 'flex flex-col gap-3 rounded-2xl border border-white/10 bg-brand-dark/50 p-4 sm:flex-row sm:items-center sm:justify-between';
      const detail = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'font-semibold text-white';
      title.textContent = item.title;
      const meta = document.createElement('p');
      meta.className = 'mt-1 text-xs text-slate-400';
      meta.textContent = `Added by ${item.submitted_by}`;
      detail.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'flex shrink-0 gap-2';
      const vote = document.createElement('button');
      vote.className = 'rounded-full border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-xs font-semibold text-brand-accent';
      vote.textContent = `Vote (${this.queueVotes.get(item.id) || 0})`;
      vote.addEventListener('click', () => this.channel?.send({ type: 'broadcast', event: 'queue_vote', payload: { itemId: item.id, user: this.username } }));
      const play = document.createElement('button');
      play.className = 'rounded-full bg-brand-accent px-3 py-2 text-xs font-semibold text-brand-dark';
      play.textContent = 'Play';
      play.addEventListener('click', () => this.player?.loadVideoById(item.video_id));
      actions.append(vote, play);
      row.append(detail, actions);
      return row;
    }));
  }

  bindChat() {
    this.chatForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const content = this.chatInput.value.trim();
      if (!content) return;
      const now = Date.now();
      this.messageTimes = this.messageTimes.filter(time => now - time < 60000);
      if (now - (this.messageTimes.at(-1) || 0) < 3000 || this.messageTimes.length >= 8) {
        this.renderMessage('System', 'Please slow down before sending another message.');
        return;
      }
      this.messageTimes.push(now);
      this.chatInput.value = '';
      const { error } = await supabase.from('messages').insert({ room_id: this.roomId, user_name: this.username, content: content.slice(0, 1000) });
      if (error) {
        const missingTable = error.message.includes("Could not find the table 'public.messages'");
        this.renderMessage('System', missingTable ? 'Chat is not configured yet. Apply the Supabase migration, then reload this page.' : `Chat is unavailable: ${error.message}`);
      }
    });
  }

  renderMessage(username, content, createdAt) {
    const message = document.createElement('div');
    message.className = 'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm';
    const header = document.createElement('div');
    header.className = 'flex justify-between gap-3';
    const name = document.createElement('strong');
    name.className = 'text-brand-accent';
    name.textContent = username;
    const time = document.createElement('span');
    time.className = 'text-xs text-slate-500';
    time.textContent = createdAt ? new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const body = document.createElement('p');
    body.className = 'mt-1 break-words text-slate-200';
    body.textContent = content;
    header.append(name, time);
    message.append(header, body);
    this.chatLog?.appendChild(message);
    if (this.chatLog) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  renderUsers() {
    const users = Object.values(this.channel.presenceState()).flat();
    const count = document.getElementById('user-count');
    const roster = document.getElementById('user-roster');
    if (count) count.textContent = users.length;
    if (roster) {
      roster.replaceChildren(...users.map(user => {
        const badge = document.createElement('span');
        badge.className = 'rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300';
        badge.textContent = `${user.user || 'Guest'}${user.role === 'host' ? ' · Host' : ''}`;
        return badge;
      }));
    }
  }

  playerChanged(event) {
    if (!this.isModerator || this.syncing || ![YT.PlayerState.PLAYING, YT.PlayerState.PAUSED].includes(event.data)) return;
    this.sendVideoState();
  }

  sendVideoState() {
    if (!this.player || !this.isModerator) return;
    this.channel.send({ type: 'broadcast', event: 'video_sync', payload: { time: this.player.getCurrentTime(), playing: this.player.getPlayerState() === YT.PlayerState.PLAYING, sender: this.username } });
  }

  receiveVideo(payload) {
    if (!this.player || payload.sender === this.username) return;
    this.syncing = true;
    if (Math.abs(this.player.getCurrentTime() - payload.time) > 2) this.player.seekTo(payload.time, true);
    payload.playing ? this.player.playVideo() : this.player.pauseVideo();
    setTimeout(() => { this.syncing = false; }, 500);
  }

  requestSync() { this.channel.send({ type: 'broadcast', event: 'request_sync' }); }

  bindVoting() {
    document.getElementById('btn-vote')?.addEventListener('click', () => {
      const title = document.getElementById('video-title')?.value.trim() || 'Community video';
      this.channel?.send({ type: 'broadcast', event: 'video_vote', payload: { user: this.username, title } });
    });
  }

  renderVote({ user, title }) {
    const log = document.getElementById('vote-log');
    if (!log) return;
    const vote = document.createElement('div');
    vote.className = 'text-sm text-slate-300';
    vote.textContent = `${user} voted for ${title}`;
    log.prepend(vote);
  }

  initCanvas() {
    if (!this.canvas || !this.ctx) return;
    this.clearCanvas();
    let drawing = false;
    const pointFromEvent = event => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * this.canvas.width / rect.width,
        y: (event.clientY - rect.top) * this.canvas.height / rect.height
      };
    };
    this.canvas.addEventListener('pointerdown', event => {
      drawing = true;
      this.currentStroke = [pointFromEvent(event)];
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!drawing) return;
      const next = pointFromEvent(event);
      const previous = this.currentStroke.at(-1);
      const color = document.getElementById('brush-color')?.value || '#E08A63';
      const size = Number(document.getElementById('brush-size')?.value || 5);
      this.drawSegment(previous, next, color, size);
      this.currentStroke.push({ ...next, color, size });
    });
    const finishStroke = () => {
      if (!drawing) return;
      drawing = false;
      if (this.currentStroke.length < 2 || !this.channel) return;
      const stroke = { id: crypto.randomUUID(), owner: this.username, points: this.currentStroke };
      this.strokeHistory.push(stroke);
      this.channel.send({ type: 'broadcast', event: 'canvas_stroke', payload: stroke });
    };
    this.canvas.addEventListener('pointerup', finishStroke);
    this.canvas.addEventListener('pointercancel', finishStroke);
    window.addEventListener('pointerup', finishStroke);
    document.getElementById('btn-undo')?.addEventListener('click', () => {
      const lastStroke = [...this.strokeHistory].reverse().find(stroke => stroke.owner === this.username);
      if (!lastStroke) return;
      this.strokeHistory = this.strokeHistory.filter(stroke => stroke.id !== lastStroke.id);
      this.redrawCanvas();
    });
    document.getElementById('btn-clear-canvas')?.addEventListener('click', () => {
      this.strokeHistory = [];
      this.clearCanvas();
      this.channel?.send({ type: 'broadcast', event: 'canvas_clear' });
    });
    document.getElementById('btn-download-canvas')?.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'tokenhaven-community-canvas.png';
      link.href = this.canvas.toDataURL('image/png');
      link.click();
    });
  }

  drawSegment(previous, next, color, size) {
    this.ctx.beginPath();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.moveTo(previous.x, previous.y);
    this.ctx.lineTo(next.x, next.y);
    this.ctx.stroke();
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  redrawCanvas() {
    this.clearCanvas();
    this.strokeHistory.forEach(stroke => stroke.points.slice(1).forEach((point, index) => {
      this.drawSegment(stroke.points[index], point, point.color, point.size);
    }));
  }
}
