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
    this.player = null;
    this.syncing = false;
    this.bindChat();
    this.bindVoting();
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
        if (message.room_id === this.roomId) this.renderMessage(message.user_name, message.content, message.created_at);
      });
    this.channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        const presenceResult = await this.channel.track({ user: this.username, role: this.isModerator ? 'host' : 'viewer' });
        if (presenceResult?.error) {
          this.setStatus('Connected, but presence is unavailable. Check Realtime settings.');
          return;
        }
        await this.loadHistory();
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

  bindChat() {
    this.chatForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const content = this.chatInput.value.trim();
      if (!content) return;
      this.chatInput.value = '';
      const { error } = await supabase.from('messages').insert({ room_id: this.roomId, user_name: this.username, content });
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
}
