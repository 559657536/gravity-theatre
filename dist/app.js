(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sceneInfo = {
    spiral: { no: '01', name: '星河初生', english: 'GENESIS', poem: '万千星辰，始于一次相遇。', chord: [130.81, 196, 261.63, 329.63] },
    collision: { no: '02', name: '双星之舞', english: 'ENCOUNTER', poem: '隔着漫长岁月，仍然向你靠近。', chord: [146.83, 220, 293.66, 369.99] },
    blackhole: { no: '03', name: '光的边界', english: 'EVENT HORIZON', poem: '连光都停留的地方，藏着怎样的秘密。', chord: [98, 146.83, 196, 233.08] },
    nebula: { no: '04', name: '星云来信', english: 'NEBULA', poem: '你身上的每一颗原子，都曾是一颗星。', chord: [174.61, 261.63, 349.23, 440] },
    supernova: { no: '05', name: '最后的盛放', english: 'SUPERNOVA', poem: '有些告别，是另一片星空的开始。', chord: [164.81, 246.94, 329.63, 415.3] }
  };
  const ids = Object.keys(sceneInfo);
  const state = { scene: 'spiral', tool: 'attract', paused: false, rotate: true, cinema: false, tour: false, audio: false };
  let engine, tourTimer, tourStep = 0, toastTimer, postcardURL, postcardSnapshot, sound;
  const storageKey = 'gravity-theatre-bookmarks-v1';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
  }

  class CosmicSound {
    constructor() { this.ctx = null; this.enabled = false; this.voices = []; this.lastNote = 0; }
    async enable() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('当前浏览器暂不支持声音合成');
      if (!this.ctx) {
        const ctx = this.ctx = new AudioContext();
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.ratio.value = 8;
        this.master.connect(compressor);
        compressor.connect(ctx.destination);
        this.delay = ctx.createDelay(1);
        this.delay.delayTime.value = .37;
        const feedback = ctx.createGain(); feedback.gain.value = .23;
        this.delay.connect(feedback); feedback.connect(this.delay);
        const wet = ctx.createGain(); wet.gain.value = .19;
        this.delay.connect(wet); wet.connect(this.master);
        const chord = sceneInfo[state.scene].chord;
        chord.forEach((frequency, i) => {
          const oscillator = ctx.createOscillator();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency / 2;
          oscillator.detune.value = [-4, 3, -2, 5][i];
          const gain = ctx.createGain(); gain.gain.value = .035;
          const mod = ctx.createOscillator(); mod.frequency.value = .05 + i * .016;
          const modGain = ctx.createGain(); modGain.gain.value = .015;
          mod.connect(modGain); modGain.connect(gain.gain); mod.start();
          oscillator.connect(gain); gain.connect(this.master); oscillator.start();
          this.voices.push({ oscillator, gain, mod, modGain });
        });
      }
      await this.ctx.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(.5, this.ctx.currentTime, .5);
    }
    disable() { this.enabled = false; if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .15); }
    setScene(id) { if (!this.ctx) return; this.voices.forEach((v, i) => v.oscillator.frequency.setTargetAtTime(sceneInfo[id].chord[i] / 2, this.ctx.currentTime, 1.5)); }
    note(x, y) {
      if (!this.enabled || !this.ctx || this.ctx.currentTime - this.lastNote < .13) return;
      const ctx = this.ctx; this.lastNote = ctx.currentTime;
      const pentatonic = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
      const index = Math.max(0, Math.min(9, Math.floor(x * 10)));
      const frequency = sceneInfo[state.scene].chord[0] * 2 ** (pentatonic[index] / 12 + .5);
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(.09 + (1 - y) * .035, ctx.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + 2.8);
      osc.connect(gain); gain.connect(this.master); gain.connect(this.delay);
      osc.start(); osc.stop(ctx.currentTime + 3);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
    burst() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx, buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, ctx.currentTime); filter.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 1.8);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(.22, ctx.currentTime + .04); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + 1.8);
      source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
  }

  function updateSceneUI() {
    const info = sceneInfo[state.scene];
    $$('.scene').forEach(button => {
      const selected = button.dataset.scene === state.scene;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    $('#scene-coordinate').textContent = `CHAPTER ${info.no} / ${info.english}`;
    $('#scene-poem').textContent = info.poem;
    sound.setScene(state.scene);
  }
  function setScene(id, fromTour = false) {
    if (!sceneInfo[id]) return;
    if (state.tour && !fromTour) stopTour();
    state.scene = id; engine.setScene(id); updateSceneUI();
  }
  function setTool(id) {
    state.tool = id; engine.setTool(id);
    $$('.tool').forEach(button => { const selected = button.dataset.tool === id; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    const hint = { attract: '在星空中按住并拖动，让星辰靠近你', repel: '在星空中按住并拖动，拨开一条星光之路', orbit: '拖动星空转换视角，滚动鼠标拉近远方' };
    $('#interaction-hint').replaceChildren();
    const cross = document.createElement('span'); cross.className = 'hint-cross'; cross.textContent = '＋';
    $('#interaction-hint').append(cross, hint[id]);
    $('#universe').style.cursor = id === 'orbit' ? 'grab' : 'crosshair';
  }
  function setPaused(value) {
    state.paused = value; engine.setPaused(value);
    $('#pause').setAttribute('aria-pressed', String(value));
    $('#pause').setAttribute('aria-label', value ? '继续时间' : '暂停时间');
    $('#pause-icon').textContent = value ? '▷' : 'Ⅱ';
    $('#time-status').textContent = value ? '时间已暂停' : '时间流动中';
  }
  function syncParameters() {
    const snapshot = engine.getSnapshot();
    for (const key of ['gravity', 'speed', 'glow']) {
      const value = snapshot.parameters[key];
      $('#' + key).value = value;
      $('#' + key + '-value').textContent = value.toFixed(2) + (key === 'speed' ? ' ×' : '');
    }
    if (typeof snapshot.autoRotate === 'boolean') state.rotate = snapshot.autoRotate;
    $('#rotate-toggle').setAttribute('aria-checked', String(state.rotate));
  }
  function setCinema(value) {
    state.cinema = value; document.body.classList.toggle('cinema', value);
    $('#cinema-exit').hidden = !value;
    if (value) $('#cinema-exit').focus(); else $('#cinema-toggle').focus();
  }
  function startTour() {
    state.tour = true; tourStep = 0; setPaused(false);
    engine.setAutoRotate(true); state.rotate = true; $('#rotate-toggle').setAttribute('aria-checked', 'true');
    $('#tour-toggle').setAttribute('aria-pressed', 'true');
    $('#tour-toggle').children[1].textContent = '结束这次漫游';
    $('.tour-icon').textContent = 'Ⅱ'; setScene(ids[0], true);
    toast('60 秒宇宙漫游开始。你随时可以伸手参与。');
    tourTimer = setInterval(() => {
      if (state.paused || document.hidden || $$('dialog[open]').length) return;
      tourStep++;
      if (tourStep >= 5) { stopTour(); toast('旅途结束。现在，宇宙交给你。'); return; }
      setScene(ids[tourStep], true);
    }, 12000);
  }
  function stopTour() {
    clearInterval(tourTimer); state.tour = false;
    $('#tour-toggle').setAttribute('aria-pressed', 'false');
    $('#tour-toggle').children[1].textContent = '让宇宙自己讲述'; $('.tour-icon').textContent = '▷';
  }
  function burst() {
    if (state.paused) setPaused(false);
    engine.burst(); sound.burst();
    $('#burst').classList.remove('burst-flash'); void $('#burst').offsetWidth; $('#burst').classList.add('burst-flash');
  }
  async function toggleSound() {
    try {
      if (state.audio) { sound.disable(); state.audio = false; }
      else { await sound.enable(); state.audio = true; }
      $('#sound-toggle').classList.toggle('sound-on', state.audio);
      $('#sound-toggle').setAttribute('aria-pressed', String(state.audio));
      $('.sound-label').textContent = state.audio ? '声音开启' : '声音关闭';
      $('#sound-toggle').title = state.audio ? '关闭生成式声音 · M' : '开启生成式声音 · M';
      if (state.audio) toast('声音已开启。触碰星空，听见它的回应。');
    } catch (error) { toast(error.message || '声音暂时无法开启'); }
  }

  function readBookmarks() {
    try { const records = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(records) ? records.filter(r => r && typeof r.id === 'string' && r.snapshot && sceneInfo[r.snapshot.scene]).slice(0, 6) : []; }
    catch (_) { return []; }
  }
  function writeBookmarks(records) { try { localStorage.setItem(storageKey, JSON.stringify(records)); return true; } catch (_) { toast('浏览器未允许本地保存，你仍然可以下载明信片。'); return false; } }
  function renderBookmarks() {
    const container = $('#bookmarks'); container.replaceChildren();
    const records = readBookmarks();
    if (records.length) { const title = document.createElement('p'); title.className = 'eyebrow'; title.textContent = '你的宇宙收藏'; title.style.marginBottom = '4px'; container.append(title); }
    records.forEach(record => {
      const row = document.createElement('div'); row.className = 'bookmark-row';
      const restore = document.createElement('button'); restore.textContent = sceneInfo[record.snapshot.scene].name;
      const date = document.createElement('small'); date.textContent = record.date; restore.append(date);
      restore.addEventListener('click', () => {
        try { stopTour(); const accepted = engine.restoreSnapshot(record.snapshot); if (accepted === false) throw new Error('invalid'); state.scene = record.snapshot.scene; updateSceneUI(); syncParameters(); setTool(engine.getSnapshot().tool); setPaused(false); $('#postcard-dialog').close(); toast('已回到这片宇宙。'); }
        catch (_) { toast('这份收藏无法恢复，请尝试其他收藏。'); }
      });
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', '删除 ' + sceneInfo[record.snapshot.scene].name + ' 收藏');
      remove.addEventListener('click', () => { if (writeBookmarks(readBookmarks().filter(item => item.id !== record.id))) renderBookmarks(); });
      row.append(restore, remove); container.append(row);
    });
  }
  async function makePostcard() {
    try {
      postcardSnapshot = engine.getSnapshot();
      const source = engine.capture();
      const picture = new Image(); picture.src = source;
      await picture.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1125;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#080c11'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const margin = 34, imageHeight = 850, imageWidth = 1732;
      const scale = Math.min(imageWidth / picture.width, imageHeight / picture.height);
      const w = picture.width * scale, h = picture.height * scale;
      ctx.drawImage(picture, margin + (imageWidth - w) / 2, margin + (imageHeight - h) / 2, w, h);
      ctx.strokeStyle = '#465051'; ctx.lineWidth = 1; ctx.strokeRect(34.5, 34.5, 1731, 849);
      const info = sceneInfo[postcardSnapshot.scene];
      ctx.fillStyle = '#ddc6a4'; ctx.font = '18px Consolas, monospace'; ctx.fillText(`GRAVITY THEATRE / ${info.english}`, 70, 940);
      ctx.fillStyle = '#e7e6df'; ctx.font = '38px "Microsoft YaHei", sans-serif'; ctx.fillText(info.poem, 70, 1003);
      ctx.fillStyle = '#809195'; ctx.font = '17px "Microsoft YaHei", sans-serif'; ctx.fillText('引力剧场 · 这一刻的宇宙，只属于你。', 70, 1064);
      ctx.textAlign = 'right'; ctx.font = '18px Consolas, monospace';
      const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
      ctx.fillText(stamp + ' · UTC+8', 1728, 940);
      ctx.fillStyle = '#d8bc91'; ctx.font = '20px Consolas, monospace'; ctx.fillText('CHAPTER ' + info.no, 1728, 1064);
      postcardURL = canvas.toDataURL('image/png');
      $('#postcard-preview').src = postcardURL;
      renderBookmarks(); $('#postcard-dialog').showModal();
    } catch (_) { toast('明信片暂时生成失败，请稍后重试。'); }
  }

  sound = new CosmicSound();
  try {
    engine = new window.GravityEngine($('#universe'), {
      onStats: (stats) => { $('#particle-count').textContent = stats.count.toLocaleString('en-US') + ' 颗星辰'; $('#fps').textContent = Math.round(stats.fps) + ' FPS'; },
      onError: (message) => { $('#error-banner').textContent = message; $('#error-banner').hidden = false; }
    });
  } catch (_) {
    $('#error-banner').textContent = '星系暂时无法启动。请用支持 Canvas 的现代浏览器打开此页面。'; $('#error-banner').hidden = false; return;
  }
  engine.setParameter('speed', 1);
  $$('.scene').forEach(button => button.addEventListener('click', () => setScene(button.dataset.scene)));
  $$('.tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  ['gravity', 'speed', 'glow'].forEach(key => $('#' + key).addEventListener('input', event => {
    const value = Number(event.target.value); engine.setParameter(key, value);
    $('#' + key + '-value').textContent = value.toFixed(2) + (key === 'speed' ? ' ×' : '');
  }));
  $('#pause').addEventListener('click', () => setPaused(!state.paused));
  $('#burst').addEventListener('click', burst);
  $('#reset').addEventListener('click', () => { stopTour(); engine.reset(); state.rotate = true; engine.setAutoRotate(true); setPaused(false); syncParameters(); toast('这片星空，重新开始。'); });
  $('#rotate-toggle').addEventListener('click', () => { state.rotate = !state.rotate; engine.setAutoRotate(state.rotate); $('#rotate-toggle').setAttribute('aria-checked', String(state.rotate)); });
  $('#tour-toggle').addEventListener('click', () => state.tour ? stopTour() : startTour());
  $('#sound-toggle').addEventListener('click', toggleSound);
  $('#cinema-toggle').addEventListener('click', () => setCinema(true));
  $('#cinema-exit').addEventListener('click', () => setCinema(false));
  $('#postcard-open').addEventListener('click', makePostcard);
  $('#download-postcard').addEventListener('click', () => {
    if (!postcardURL) return;
    const bytes = Uint8Array.from(atob(postcardURL.split(',')[1]), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `引力剧场-${sceneInfo[postcardSnapshot.scene].name}-${Date.now()}.png`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('#bookmark').addEventListener('click', () => {
    if (!postcardSnapshot) return;
    const record = { id: Date.now().toString(36), date: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' · UTC+8', snapshot: postcardSnapshot };
    if (writeBookmarks([record, ...readBookmarks()].slice(0, 6))) { renderBookmarks(); toast('已收藏。下次打开，这片宇宙还在。'); }
  });
  $('#help-open').addEventListener('click', () => $('#help-dialog').showModal());
  $('#about-open').addEventListener('click', () => $('#about-dialog').showModal());
  $('.brand').addEventListener('click', event => { event.preventDefault(); setScene('spiral'); });
  $$('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
  });
  $('#universe').addEventListener('pointerdown', event => sound.note(event.clientX / innerWidth, event.clientY / innerHeight));
  $('#universe').addEventListener('pointermove', event => { if (event.buttons) sound.note(event.clientX / innerWidth, event.clientY / innerHeight); });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || $$('dialog[open]').length) return;
    const key = event.key.toLowerCase();
    if (event.repeat) return;
    if (key === ' ' && !/BUTTON|A/.test(event.target.tagName)) { event.preventDefault(); setPaused(!state.paused); }
    if (key === '1') setTool('attract'); if (key === '2') setTool('repel'); if (key === '3') setTool('orbit');
    if (key === 'b') burst(); if (key === 'h') setCinema(!state.cinema); if (key === 'm') toggleSound();
    if (key === 'escape' && state.cinema) setCinema(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (sound.ctx) { if (document.hidden) sound.ctx.suspend().catch(() => {}); else if (state.audio) sound.ctx.resume().catch(() => {}); }
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { clearInterval(tourTimer); engine.destroy(); if (sound.ctx) sound.ctx.close().catch(() => {}); } });
  if (reducedMotion) { setPaused(true); state.rotate = false; engine.setAutoRotate(false); $('#rotate-toggle').setAttribute('aria-checked', 'false'); }
})();
