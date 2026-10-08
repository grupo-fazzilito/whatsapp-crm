/*! ChatNexGen AI web chat widget
 * <script src="https://APP/widget.js" data-key="pk_xxx" async></script>
 * Optional: data-lang="es|en", data-open="true".
 * API: window.ChatNexGenChat.open() / .close() / .toggle()
 */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]');
  if (!script) return;
  var KEY = script.getAttribute('data-key');
  if (!KEY) return console.warn('[webchat] missing data-key');
  window.__cnxWebchat = window.__cnxWebchat || {};
  if (window.__cnxWebchat[KEY]) return;
  window.__cnxWebchat[KEY] = true;

  var BASE = new URL(script.src, location.href).origin;
  var API = BASE + '/api/webchat';
  var STORE_KEY = 'cnxwc:' + KEY;
  var POLL_MS = 4000;

  // ---------------------------------------------------------------- i18n
  var STRINGS = {
    es: {
      open: 'Abrir chat', close: 'Cerrar chat', placeholder: 'Escribe un mensaje…',
      message: 'Mensaje', send: 'Enviar', you: 'Tú', powered: 'Con tecnología de',
      intro: 'Antes de empezar, cuéntanos un poco sobre ti.', name: 'Nombre', email: 'Correo electrónico',
      phone: 'Teléfono', start: 'Iniciar chat', required: 'Este campo es obligatorio.',
      badEmail: 'Introduce un correo válido.', failed: 'No se pudo enviar.', retry: 'Reintentar',
      typing: 'Escribiendo…', tooMany: 'Demasiados mensajes. Espera un momento.',
      tooLong: 'El mensaje es demasiado largo (máx. 2000 caracteres).', unread: 'mensajes nuevos',
      offline: 'Sin conexión. Reintentando…', image: 'Imagen', file: 'Archivo adjunto', options: 'Opciones',
      error: 'Algo salió mal. Inténtalo de nuevo.', attach: 'Adjuntar imagen', prev: 'Anterior', next: 'Siguiente',
      cards: 'Productos', of: 'de', closeImg: 'Cerrar imagen', imgType: 'Solo imágenes JPG, PNG o WebP.',
      imgSize: 'La imagen supera los 5 MB.', noConv: 'Escribe un mensaje antes de enviar una imagen.'
    },
    en: {
      open: 'Open chat', close: 'Close chat', placeholder: 'Type a message…',
      message: 'Message', send: 'Send', you: 'You', powered: 'Powered by',
      intro: 'Before we start, tell us a little about yourself.', name: 'Name', email: 'Email',
      phone: 'Phone', start: 'Start chat', required: 'This field is required.',
      badEmail: 'Enter a valid email.', failed: 'Could not send.', retry: 'Retry',
      typing: 'Typing…', tooMany: 'Too many messages. Please wait a moment.',
      tooLong: 'The message is too long (max. 2000 characters).', unread: 'new messages',
      offline: 'Connection lost. Retrying…', image: 'Image', file: 'Attachment', options: 'Options',
      error: 'Something went wrong. Please try again.', attach: 'Attach image', prev: 'Previous', next: 'Next',
      cards: 'Products', of: 'of', closeImg: 'Close image', imgType: 'Only JPG, PNG or WebP images.',
      imgSize: 'The image is larger than 5 MB.', noConv: 'Send a message before sending an image.'
    }
  };
  var langAttr = script.getAttribute('data-lang') || navigator.language || 'es';
  var LANG = /^es/i.test(langAttr) ? 'es' : 'en';
  var T = STRINGS[LANG];

  // ---------------------------------------------------------------- storage
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.stored)); } catch (e) { /* private mode */ }
  }

  var state = {
    cfg: null, stored: load(), open: false, cursor: null, seen: {}, pending: [],
    es: null, esFails: 0, pollTimer: null, live: false, unread: 0, sending: 0, historyLoaded: false
  };

  // ---------------------------------------------------------------- utils
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function api(path, opts) {
    return fetch(API + path, Object.assign({ credentials: 'omit', mode: 'cors', cache: 'no-store' }, opts)).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) { var e = new Error(b.error || 'http_' + r.status); e.status = r.status; throw e; }
        return b;
      });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function qs(o) {
    return Object.keys(o).filter(function (k) { return o[k]; })
      .map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
  }
  function safeUrl(u) {
    if (!u) return null;
    try { var x = new URL(u, BASE); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  }
  function newer(a, b) { return !b || Date.parse(a) > Date.parse(b); }

  // WCAG: pick white or near-black text, whichever contrasts more with the brand color.
  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
  }
  function lum(rgb) {
    var c = rgb.map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function onColor(hex) {
    var L = lum(hexRgb(hex));
    var dark = lum(hexRgb('#111827'));
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / (dark + 0.05)) ? '#ffffff' : '#111827';
  }

  // ---------------------------------------------------------------- icons
  var ICON_CHAT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_CLIP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
  var ICON_SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>';

  // ---------------------------------------------------------------- styles
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.root{position:fixed;bottom:20px;z-index:2147483000;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;letter-spacing:normal;word-spacing:normal;text-transform:none;text-align:left;text-indent:0;-webkit-font-smoothing:antialiased}',
    '.root.right{right:20px}.root.left{left:20px}',
    'button,input,textarea{font:inherit;color:inherit}',
    '.launcher{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:var(--brand);color:var(--on);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.22);position:relative;transition:transform .15s ease}',
    '.launcher:hover{transform:scale(1.05)}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#b91c1c;color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center}',
    '.panel{position:absolute;bottom:72px;width:370px;max-width:calc(100vw - 40px);height:min(600px,calc(100vh - 110px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;opacity:1;transform:none;transition:opacity .18s ease,transform .18s ease}',
    '.right .panel{right:0;transform-origin:bottom right}.left .panel{left:0;transform-origin:bottom left}',
    '.panel.enter{opacity:0;transform:translateY(8px) scale(.98)}',
    '.panel[hidden]{display:none}',
    '@media (max-width:480px){.panel{position:fixed;inset:0;width:100%;max-width:none;height:100%;border-radius:0}.root.is-open .launcher{display:none}}',
    '.head{background:var(--brand);color:var(--on);padding:14px 12px 14px 16px;display:flex;align-items:center;gap:8px}',
    '.head .txt{flex:1;min-width:0}',
    '.head h2,.head p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.head h2{font-size:16px;font-weight:650;line-height:1.3}.head p{font-size:12.5px}',
    '.icon-btn{background:transparent;border:0;color:inherit;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '.icon-btn:hover{background:rgba(127,127,127,.2)}',
    '.notice{font-size:12.5px;color:#78350f;background:#fef3c7;padding:6px 14px}',
    '.log{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px;background:#f8fafc;overscroll-behavior:contain}',
    '.msg{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.msg.in{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}',
    '.msg.out{align-self:flex-end;background:var(--brand);color:var(--on);border-bottom-right-radius:4px}',
    '.msg a{color:inherit;text-decoration:underline}',
    '.msg img{display:block;max-width:100%;max-height:240px;border-radius:8px;margin:2px 0 4px}',
    '.time{display:block;font-size:11px;margin-top:2px;text-align:right}',
    '.msg.in .time{color:#475569}',
    '.msg.failed{outline:2px solid #b91c1c;outline-offset:1px}',
    '.fail{display:flex;gap:8px;align-items:center;align-self:flex-end;font-size:12px;color:#b91c1c}',
    '.fail button{background:none;border:0;color:#1d4ed8;text-decoration:underline;cursor:pointer;padding:2px}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:92%;margin:0;padding:0;border:0}',
    '.chips legend{font-size:12px;font-weight:600;color:#334155;padding:0;margin-bottom:4px;width:100%}',
    '.chip{border:1.5px solid var(--brand);background:#fff;color:#111827;border-radius:999px;padding:6px 12px;cursor:pointer;text-align:left}',
    '.chip:hover:not(:disabled){background:var(--brand);color:var(--on)}',
    '.chip:disabled{opacity:.55;cursor:default}',
    '.car{align-self:stretch;position:relative;margin:0 -14px;padding:0}',
    '.track{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 14px;padding:2px 14px 6px;scrollbar-width:thin;overscroll-behavior-x:contain}',
    '.card{flex:0 0 200px;scroll-snap-align:start;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}',
    '.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#f1f5f9}',
    '.card .cb{padding:8px 10px;display:flex;flex-direction:column;gap:6px;flex:1}',
    '.card h3{margin:0;font-size:14px;font-weight:650;line-height:1.3}.card p{margin:0;font-size:12.5px;color:#475569}',
    '.cbtn{border:1.5px solid var(--brand);background:#fff;color:#111827;border-radius:8px;padding:6px 8px;cursor:pointer;font-weight:600}',
    '.cbtn:hover{background:var(--brand);color:var(--on)}',
    '.cbtn:first-of-type{margin-top:auto}',
    '.nav{display:flex;justify-content:flex-end;gap:6px;padding:0 14px}',
    '.nav button{width:32px;height:32px;border-radius:50%;border:1px solid #94a3b8;background:#fff;cursor:pointer;font-size:18px;line-height:1}',
    '.nav button:disabled{opacity:.4;cursor:default}',
    '.clip{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:transparent;color:#334155;display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '.clip:hover{background:#f1f5f9}',
    '.lb{position:absolute;inset:0;z-index:5;background:rgba(15,23,42,.96);display:flex;align-items:center;justify-content:center;padding:48px 12px 12px}',
    '.lb img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;background:#fff}',
    '.lb button{position:absolute;top:8px;right:8px;color:#fff}',
    '.lb :focus-visible{outline-color:#fff}',
    '.typing{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px 14px;display:flex;gap:4px}',
    '.typing i{width:6px;height:6px;border-radius:50%;background:#64748b;animation:b 1s infinite ease-in-out}',
    '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes b{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '.composer{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff;align-items:flex-end}',
    'textarea{flex:1;resize:none;border:1px solid #94a3b8;border-radius:12px;padding:9px 12px;min-height:40px;max-height:120px;background:#fff;line-height:1.4}',
    '.send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--brand);color:var(--on);display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '.send:disabled{opacity:.5;cursor:default}',
    '.pre{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:14px}',
    '.pre p{margin:0;color:#334155}',
    '.pre label{display:block;font-weight:600;margin-bottom:4px}',
    '.pre input{width:100%;border:1px solid #94a3b8;border-radius:10px;padding:9px 12px;background:#fff}',
    '.pre input[aria-invalid=true]{border-color:#b91c1c}',
    '.err{color:#b91c1c;font-size:12.5px;margin-top:4px}',
    '.btn{border:0;border-radius:12px;padding:11px;background:var(--brand);color:var(--on);font-weight:650;cursor:pointer}',
    '.foot{font-size:11.5px;color:#475569;text-align:center;padding:4px 8px 8px;background:#fff}',
    '.foot a{color:#334155}',
    '.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    ':focus{outline:none}',
    ':focus-visible{outline:2px solid #1e293b;outline-offset:2px}',
    '.launcher:focus-visible{outline:3px solid #1e293b;outline-offset:3px;box-shadow:0 0 0 3px #fff}',
    '.head :focus-visible{outline-color:var(--on)}',
    '.msg.out :focus-visible{outline-color:var(--on)}',
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}'
  ].join('');

  // ---------------------------------------------------------------- UI
  var ui = {};

  function build(cfg) {
    var host = el('div', { 'data-chatnexgen-webchat': '', style: 'all:initial' });
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var brand = cfg.color || '#10b981';
    var wrap = el('div', { class: 'root ' + (cfg.position === 'left' ? 'left' : 'right'), lang: LANG });
    wrap.style.setProperty('--brand', brand);
    wrap.style.setProperty('--on', onColor(brand));

    ui.launcher = el('button', {
      type: 'button', class: 'launcher', 'aria-label': T.open, 'aria-expanded': 'false',
      'aria-controls': 'cnx-panel', onclick: toggle
    });
    ui.launcher.innerHTML = ICON_CHAT;
    ui.badge = el('span', { class: 'badge', hidden: true });
    ui.launcher.append(ui.badge);

    var titleId = 'cnx-title';
    ui.closeBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': T.close, onclick: function () { close(true); } });
    ui.closeBtn.innerHTML = ICON_X;
    var head = el('div', { class: 'head' }, [
      el('div', { class: 'txt' }, [
        el('h2', { id: titleId, text: cfg.title }),
        cfg.business_name && cfg.business_name !== cfg.title ? el('p', { text: cfg.business_name }) : null
      ]),
      ui.closeBtn
    ]);

    ui.notice = el('div', { class: 'notice', role: 'status', hidden: true, text: T.offline });
    ui.log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': cfg.title, tabindex: '0' });

    ui.input = el('textarea', {
      id: 'cnx-input', rows: '1', maxlength: '2000', placeholder: T.placeholder, 'aria-label': T.message,
      onkeydown: function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitComposer(); }
      },
      oninput: autoGrow
    });
    ui.sendBtn = el('button', { type: 'submit', class: 'send', 'aria-label': T.send });
    ui.sendBtn.innerHTML = ICON_SEND;
    ui.file = el('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, tabindex: '-1',
      onchange: function () { var f = ui.file.files && ui.file.files[0]; ui.file.value = ''; if (f) sendImage(f); }
    });
    var clip = el('button', { type: 'button', class: 'clip', 'aria-label': T.attach, title: T.attach, onclick: function () { ui.file.click(); } });
    clip.innerHTML = ICON_CLIP;
    ui.composer = el('form', { class: 'composer', onsubmit: function (e) { e.preventDefault(); submitComposer(); } }, [clip, ui.file, ui.input, ui.sendBtn]);

    var foot = el('div', { class: 'foot' }, [
      document.createTextNode(T.powered + ' '),
      el('a', { href: BASE, target: '_blank', rel: 'noopener noreferrer', text: 'ChatNexGen AI' })
    ]);

    ui.body = el('div', { style: 'display:contents' });
    ui.panel = el('div', {
      id: 'cnx-panel', class: 'panel', role: 'dialog', 'aria-labelledby': titleId, hidden: true,
      onkeydown: function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(true); } }
    }, [head, ui.notice, ui.body, foot]);

    wrap.append(ui.panel, ui.launcher);
    var style = el('style', { text: CSS });
    root.append(style, wrap);
    ui.wrap = wrap;
    document.body.appendChild(host);
  }

  function showChat() {
    ui.body.replaceChildren(ui.log, ui.composer);
  }

  function showPrechat(focus) {
    var fields = state.cfg.prechat_fields;
    var inputs = {};
    var form = el('form', { class: 'pre', novalidate: true, onsubmit: onSubmit }, [el('p', { text: T.intro })]);
    fields.forEach(function (f) {
      var id = 'cnx-pre-' + f;
      var input = el('input', {
        id: id, name: f, required: true, 'aria-describedby': id + '-err',
        type: f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text',
        autocomplete: f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'name', maxlength: f === 'name' ? '120' : '200'
      });
      inputs[f] = input;
      form.append(el('div', null, [el('label', { for: id, text: T[f] }), input, el('div', { id: id + '-err', class: 'err' })]));
    });
    var btn = el('button', { type: 'submit', class: 'btn', text: T.start });
    var formErr = el('div', { class: 'err', role: 'alert' });
    form.append(formErr, btn);
    ui.body.replaceChildren(form);

    function onSubmit(e) {
      e.preventDefault();
      var firstBad = null;
      var data = {};
      fields.forEach(function (f) {
        var input = inputs[f];
        var v = input.value.trim();
        var msg = !v ? T.required : f === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? T.badEmail : '';
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        form.querySelector('#cnx-pre-' + f + '-err').textContent = msg;
        if (msg && !firstBad) firstBad = input;
        data[f] = v;
      });
      if (firstBad) return firstBad.focus();
      btn.disabled = true;
      formErr.textContent = '';
      ensureSession(data).then(function () {
        state.stored.p = 1;
        save();
        showChat();
        startConversation();
        ui.input.focus();
      }).catch(function (err) {
        btn.disabled = false;
        formErr.textContent = err.status === 429 ? T.tooMany : T.error;
      });
    }
    var first = form.querySelector('input');
    if (first && focus !== false) first.focus();
  }

  function autoGrow() {
    ui.input.style.height = 'auto';
    ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + 'px';
  }

  // ---------------------------------------------------------------- open/close
  function needsPrechat() {
    return state.cfg.prechat_fields.length > 0 && !state.stored.p;
  }

  function open(e) {
    if (state.open) return;
    var focus = e !== false;
    state.open = true;
    ui.panel.hidden = false;
    ui.panel.classList.add('enter');
    requestAnimationFrame(function () { requestAnimationFrame(function () { ui.panel.classList.remove('enter'); }); });
    ui.wrap.classList.add('is-open');
    ui.launcher.setAttribute('aria-expanded', 'true');
    ui.launcher.setAttribute('aria-label', T.close);
    ui.launcher.innerHTML = ICON_X;
    ui.launcher.append(ui.badge);
    setUnread(0);
    if (needsPrechat()) return showPrechat(focus);
    showChat();
    if (focus) ui.input.focus();
    startConversation();
  }

  function close(returnFocus) {
    if (!state.open) return;
    state.open = false;
    ui.panel.hidden = true;
    ui.wrap.classList.remove('is-open');
    ui.launcher.setAttribute('aria-expanded', 'false');
    ui.launcher.setAttribute('aria-label', T.open);
    ui.launcher.innerHTML = ICON_CHAT;
    ui.launcher.append(ui.badge);
    if (returnFocus) ui.launcher.focus();
  }

  function toggle() { state.open ? close(true) : open(); }

  function setUnread(n) {
    state.unread = n;
    ui.badge.hidden = !n;
    ui.badge.textContent = n > 9 ? '9+' : String(n);
    ui.launcher.setAttribute('aria-label', (state.open ? T.close : T.open) + (n ? ' (' + n + ' ' + T.unread + ')' : ''));
  }

  // ---------------------------------------------------------------- session & data
  var sessionReq = null;
  function ensureSession(details) {
    if (state.stored.t && !details) return Promise.resolve();
    if (sessionReq && !details) return sessionReq;
    var req = post('/session', Object.assign({ key: KEY, visitor_token: state.stored.t }, details || {})).then(function (r) {
      state.stored.t = r.visitor_token;
      if (r.conversation_id) state.stored.c = r.conversation_id;
      save();
    }).finally(function () { if (sessionReq === req) sessionReq = null; });
    sessionReq = req;
    return req;
  }

  function resetVisitor() {
    state.stored = {};
    save();
    state.live = false;
    starting = null;
    clearTimeout(state.pollTimer);
    if (state.es) { state.es.close(); state.es = null; }
  }

  var starting = null;
  function startConversation() {
    if (starting) return starting;
    starting = ensureSession().then(function () {
      if (!state.historyLoaded) return loadHistory();
    }).then(startLive).catch(function (err) {
      starting = null;
      if (err && err.status === 401) resetVisitor();
    });
    return starting;
  }

  function loadHistory() {
    ui.log.setAttribute('aria-busy', 'true');
    if (state.cfg.greeting && !ui.log.querySelector('.greeting')) {
      renderMessage({ id: 'greeting', sender_type: 'bot', content_type: 'text', content_text: state.cfg.greeting, metadata: {} }, 'greeting');
    }
    return api('/messages?' + qs({ visitor_token: state.stored.t })).then(function (r) {
      (r.messages || []).forEach(function (m) { addMessage(m, true); });
      state.historyLoaded = true;
    }).finally(function () {
      ui.log.removeAttribute('aria-busy');
      scrollDown(true);
    });
  }

  function startLive() {
    if (state.live || !state.stored.t) return;
    state.live = true;
    if (window.EventSource && state.esFails < 2) openStream(); else startPolling();
  }

  function openStream() {
    var es = new EventSource(API + '/stream?' + qs({ visitor_token: state.stored.t, after: state.cursor }));
    state.es = es;
    es.onopen = function () { state.esFails = 0; setOffline(false); };
    es.onmessage = function (e) {
      try { addMessage(JSON.parse(e.data)); } catch (err) { /* ignore malformed */ }
    };
    es.addEventListener('bye', function () { es.close(); openStream(); });
    es.onerror = function () {
      es.close();
      if (state.es !== es) return;
      state.es = null;
      state.esFails++;
      if (state.esFails >= 2) startPolling();
      else setTimeout(openStream, 2000);
    };
  }

  function startPolling() {
    clearTimeout(state.pollTimer);
    var tick = function () {
      api('/messages?' + qs({ visitor_token: state.stored.t, after: state.cursor || new Date(0).toISOString() }))
        .then(function (r) { setOffline(false); (r.messages || []).forEach(function (m) { addMessage(m); }); })
        .then(function () { state.pollTimer = setTimeout(tick, POLL_MS); }, function (err) {
          if (err.status === 401 || err.status === 404) return resetVisitor();
          setOffline(true);
          state.pollTimer = setTimeout(tick, POLL_MS);
        });
    };
    state.pollTimer = setTimeout(tick, POLL_MS);
  }

  function setOffline(off) { if (ui.notice) ui.notice.hidden = !off; }

  // ---------------------------------------------------------------- messages
  function addMessage(m, fromHistory) {
    if (!m || !m.id || state.seen[m.id]) return;
    state.seen[m.id] = true;
    if (m.created_at && newer(m.created_at, state.cursor)) state.cursor = m.created_at;
    if (m.sender_type === 'customer') {
      // Our own optimistic bubble coming back: adopt it instead of duplicating.
      for (var i = 0; i < state.pending.length; i++) {
        var p = state.pending[i];
        if (!p.id && (p.img ? m.content_type === 'image' : p.text === m.content_text)) { p.id = m.id; return; }
      }
    } else {
      hideTyping();
      if (!state.open && !fromHistory) setUnread(state.unread + 1);
    }
    renderMessage(m);
  }

  function linkify(text, into) {
    var re = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, last = 0, match;
    while ((match = re.exec(text))) {
      into.append(document.createTextNode(text.slice(last, match.index)));
      into.append(el('a', { href: match[0], target: '_blank', rel: 'noopener noreferrer nofollow', text: match[0] }));
      last = match.index + match[0].length;
    }
    into.append(document.createTextNode(text.slice(last)));
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function renderMessage(m, extraClass) {
    var out = m.sender_type === 'customer';
    var node = el('div', { class: 'msg ' + (out ? 'out' : 'in') + (extraClass ? ' ' + extraClass : '') });
    node.append(el('span', { class: 'sr', text: (out ? T.you : state.cfg.business_name || state.cfg.title) + ': ' }));
    var url = m.local || safeUrl(m.media_url);
    var text = m.content_text || '';
    if (url && /^\[\w+\]$/.test(text)) text = '';
    if (url && m.content_type === 'image') {
      var alt = text || T.image;
      var a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
        e.preventDefault();
        viewImage(url, alt, a);
      } }, [el('img', { src: url, alt: alt, loading: 'lazy' })]);
      node.append(a);
    } else if (url) {
      node.append(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: (m.metadata && m.metadata.filename) || T.file }));
      if (text) node.append(document.createElement('br'));
    }
    if (text) linkify(text, node);
    if (m.created_at) node.append(el('time', { class: 'time', datetime: m.created_at, text: fmtTime(m.created_at) }));
    if (out) disableChips();
    ui.log.append(node);
    if (!out) { renderCards(m); renderChips(m); }
    scrollDown(out);
    return node;
  }

  // Full-size image inside the panel (payment QR, product photos).
  function viewImage(url, alt, opener) {
    var shut = function () { box.remove(); if (opener && opener.isConnected) opener.focus(); };
    var x = el('button', { type: 'button', class: 'icon-btn', 'aria-label': T.closeImg, onclick: shut });
    x.innerHTML = ICON_X;
    var box = el('div', {
      class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt,
      onclick: function (e) { if (e.target === box) shut(); },
      onkeydown: function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); shut(); }
        else if (e.key === 'Tab') { e.preventDefault(); x.focus(); }
      }
    }, [el('img', { src: url, alt: alt }), x]);
    ui.panel.append(box);
    x.focus();
  }

  // Product carousel: horizontal scroll-snap track + prev/next for keyboard and mouse.
  function renderCards(m) {
    var cards = (m.metadata || {}).cards;
    if (!Array.isArray(cards) || !cards.length) return;
    var track = el('div', { class: 'track' });
    cards.forEach(function (c, i) {
      if (!c || !c.title) return;
      var img = safeUrl(c.imageUrl);
      var body = el('div', { class: 'cb' }, [el('h3', { text: c.title }), c.subtitle ? el('p', { text: c.subtitle }) : null]);
      (c.buttons || []).forEach(function (b) {
        if (!b || !b.title) return;
        body.append(el('button', {
          type: 'button', class: 'cbtn', text: b.title, 'aria-label': b.title + ': ' + c.title,
          onclick: function () { send(String(b.title), b.id != null ? String(b.id) : null); }
        }));
      });
      track.append(el('div', { class: 'card', role: 'group', 'aria-roledescription': 'slide', 'aria-label': (i + 1) + ' ' + T.of + ' ' + cards.length + ': ' + c.title }, [
        img ? el('img', { src: img, alt: '', loading: 'lazy', decoding: 'async' }) : null, body
      ]));
    });
    var step = function (dir) {
      var card = track.querySelector('.card');
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      track.scrollBy({ left: dir * ((card ? card.offsetWidth : 200) + 10), behavior: reduce ? 'auto' : 'smooth' });
    };
    var prev = el('button', { type: 'button', 'aria-label': T.prev, text: '‹', onclick: function () { step(-1); } });
    var next = el('button', { type: 'button', 'aria-label': T.next, text: '›', onclick: function () { step(1); } });
    var sync = function () {
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    };
    track.addEventListener('scroll', sync, { passive: true });
    var nodes = [track];
    if (cards.length > 1) nodes.push(el('div', { class: 'nav' }, [prev, next]));
    ui.log.append(el('section', { class: 'car', 'aria-roledescription': 'carousel', 'aria-label': T.cards }, nodes));
    requestAnimationFrame(sync);
  }

  function renderChips(m) {
    var meta = m.metadata || {};
    var groups = [];
    if (Array.isArray(meta.options) && meta.options.length) groups.push({ title: null, options: meta.options });
    if (Array.isArray(meta.sections)) meta.sections.forEach(function (s) {
      if (s && Array.isArray(s.options) && s.options.length) groups.push({ title: s.title || null, options: s.options });
    });
    groups.forEach(function (g) {
      var set = el('fieldset', { class: 'chips' }, [el('legend', { class: g.title ? null : 'sr', text: g.title || meta.button_label || T.options })]);
      g.options.forEach(function (o) {
        if (!o || !o.title) return;
        set.append(el('button', {
          type: 'button', class: 'chip', title: o.description || null, text: o.title,
          onclick: function () { send(String(o.title), o.id != null ? String(o.id) : null); }
        }));
      });
      ui.log.append(set);
    });
  }

  function disableChips() {
    ui.log.querySelectorAll('.chip:not(:disabled)').forEach(function (b) { b.disabled = true; });
  }

  function nearBottom() { return ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80; }
  function scrollDown(force) {
    if (force || nearBottom()) ui.log.scrollTop = ui.log.scrollHeight;
  }

  var typingTimer = null;
  function showTyping() {
    if (ui.typing) return;
    ui.typing = el('div', { class: 'typing', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]);
    ui.log.append(ui.typing);
    scrollDown(true);
  }
  function hideTyping() {
    clearTimeout(typingTimer);
    if (ui.typing) { ui.typing.remove(); ui.typing = null; }
  }

  function submitComposer() {
    var text = ui.input.value.trim();
    if (!text) return;
    if (text.length > 2000) return alertFail(T.tooLong);
    ui.input.value = '';
    autoGrow();
    send(text, null);
  }

  function alertFail(msg) {
    var n = el('div', { class: 'fail', role: 'alert', text: msg });
    ui.log.append(n);
    scrollDown(true);
    setTimeout(function () { n.remove(); }, 6000);
  }

  function send(text, replyId) {
    var node = renderMessage({ id: 'tmp', sender_type: 'customer', content_type: 'text', content_text: text, created_at: new Date().toISOString(), metadata: {} });
    deliver({ id: null, text: text }, node, function () {
      return post('/messages', { visitor_token: state.stored.t, text: text, reply_id: replyId || undefined });
    }, function () { send(text, replyId); });
  }

  // Payment screenshots & co.: upload to /upload, then post the stored path.
  function sendImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return alertFail(T.imgType);
    if (file.size > 5 * 1024 * 1024) return alertFail(T.imgSize);
    var local = URL.createObjectURL(file);
    var node = renderMessage({ id: 'tmp', sender_type: 'customer', content_type: 'image', local: local, created_at: new Date().toISOString(), metadata: {} });
    deliver({ id: null, img: true }, node, function () {
      var fd = new FormData();
      fd.append('visitor_token', state.stored.t);
      fd.append('file', file);
      return api('/upload', { method: 'POST', body: fd }).then(function (r) {
        return post('/messages', { visitor_token: state.stored.t, image_path: r.path });
      });
    }, function () { sendImage(file); }, true);
  }

  function deliver(p, node, request, retry, isImage) {
    state.pending.push(p);
    state.sending++;
    typingTimer = setTimeout(showTyping, 700);
    ensureSession()
      .then(request)
      .then(function (r) {
        p.id = p.id || r.message_id;
        state.seen[r.message_id] = true;
        if (r.conversation_id && !state.stored.c) { state.stored.c = r.conversation_id; save(); }
        startConversation();
      })
      .catch(function (err) {
        hideTyping();
        state.pending.splice(state.pending.indexOf(p), 1);
        if (err.status === 401) resetVisitor();
        node.classList.add('failed');
        var s = err.status;
        var msg = s === 429 ? T.tooMany : s === 413 ? (isImage ? T.imgSize : T.tooLong) : s === 415 ? T.imgType : s === 409 ? T.noConv : T.failed;
        var again = el('button', { type: 'button', text: T.retry, onclick: function () { fail.remove(); node.remove(); retry(); } });
        var fail = el('div', { class: 'fail', role: 'alert' }, [document.createTextNode(msg), s === 409 || s === 415 || s === 413 ? null : again]);
        node.after(fail);
        scrollDown(true);
      })
      .finally(function () {
        state.sending--;
        // The reply usually arrives through the stream; give it a moment before dropping the indicator.
        setTimeout(function () { if (!state.sending) hideTyping(); }, 1500);
      });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    api('/config?' + qs({ key: KEY })).then(function (cfg) {
      cfg.prechat_fields = Array.isArray(cfg.prechat_fields) ? cfg.prechat_fields : [];
      state.cfg = cfg;
      build(cfg);
      window.ChatNexGenChat = { open: function () { open(); }, close: function () { close(false); }, toggle: toggle };
      // Returning visitor with a conversation: reconnect so replies show as unread.
      if (state.stored.t && state.stored.c) startConversation();
      if (script.getAttribute('data-open') === 'true') open(false);
    }).catch(function (err) {
      console.warn('[webchat] disabled:', err && err.message);
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
