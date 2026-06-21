/* ============================================================================
   MILES — utilitários compartilhados (frontend)
   ============================================================================ */
(function (global) {
  'use strict';

  var CFG = global.MILES_CONFIG || {};

  /* ---------- DOM ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Query string ---------- */
  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  /* ---------- CPF ---------- */
  function onlyDigits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function formatCPF(v) {
    var d = onlyDigits(v).slice(0, 11), out = d;
    if (d.length > 9)  out = d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (d.length > 6) out = d.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (d.length > 3) out = d.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return out;
  }
  function maskCPF(input) {
    input.addEventListener('input', function () {
      var before = input.value.length, pos = input.selectionStart;
      input.value = formatCPF(input.value);
      if (pos === before) input.setSelectionRange(input.value.length, input.value.length);
    });
  }
  function maskCPFmasked(cpfFormatado) {
    var d = onlyDigits(cpfFormatado);
    if (d.length !== 11) return cpfFormatado;
    return '•••.•••.' + d.slice(6, 9) + '-' + d.slice(9);
  }
  function maskEmail(e) { e = String(e || ''); var at = e.indexOf('@'); return at < 1 ? e : e.charAt(0) + '•••' + e.slice(at); }

  /* ---------- Código de verificação (mesmo algoritmo do backend) ---------- */
  function codigoCertificado(cpf) {
    var d = onlyDigits(cpf), s = 0;
    for (var i = 0; i < d.length; i++) s = (s * 31 + d.charCodeAt(i)) % 1000000;
    return 'MILES-2026-' + ('00000' + s).slice(-6);
  }

  /* ---------- Backend (Apps Script) com fallback de DEMONSTRAÇÃO ---------- */
  function configurado() { return CFG.WEB_APP_URL && CFG.WEB_APP_URL.indexOf('COLE_AQUI') === -1; }
  function useDemo() { return CFG.DEMO === true || !configurado(); }

  async function api(action, payload) {
    if (useDemo()) return demoApi(action, payload || {});
    var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    var res = await fetch(CFG.WEB_APP_URL, {
      method: 'POST', mode: 'cors', redirect: 'follow',
      // text/plain evita o "preflight" CORS — padrão para chamar Apps Script do navegador
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
    });
    if (!res.ok) throw new Error('Falha de rede (HTTP ' + res.status + ').');
    return res.json();
  }

  /* ---------- Backend de DEMONSTRAÇÃO (em memória, dados fictícios) -------- */
  var DEMO = null;
  function demoSeed() {
    var seeds = [
      ['Ana Souza Lima', '11111111111', 'ana@exemplo.com', [1, 2, 4]],
      ['Bruno Costa Pereira', '22222222222', 'bruno@exemplo.com', [1, 3]],
      ['Carla Mendes Rocha', '33333333333', 'carla@exemplo.com', [1, 2, 3, 4]],
    ], rows = [];
    seeds.forEach(function (s) { s[3].forEach(function (a) { rows.push({ aulaId: a, nome: s[0], cpf: s[1], email: s[2] }); }); });
    return rows;
  }
  function demoState() { if (!DEMO) DEMO = demoSeed(); return DEMO; }
  function demoAgg(cpf) {
    var set = {}, nome = '';
    demoState().forEach(function (r) { if (r.cpf === cpf) { set[r.aulaId] = true; nome = r.nome; } });
    return { nome: nome, presentes: Object.keys(set).map(Number).sort(function (a, b) { return a - b; }) };
  }
  function demoApi(action, p) {
    var TOT = CFG.TOTAL_AULAS || 4, MIN = CFG.MIN_PRESENCAS || 3;
    if (action === 'emitirToken') {
      var per = Math.max(15, Math.min(1800, parseInt(p.periodo, 10) || 60));
      var rot = {}, est = {};
      (CFG.AULAS || []).forEach(function (a) { rot[a.aulaId] = 'r.' + per + '.0.demo' + a.aulaId; est[a.aulaId] = 's.demo.' + a.aulaId; });
      return { ok: true, periodo: per, win: 0, expiraEm: Date.now() + per * 1000, rotativos: rot, estaticos: est, demo: true };
    }
    if (action === 'listarAulas') return { ok: true, aulas: CFG.AULAS || [], demo: true };
    if (action === 'registrarPresenca') {
      var cpf = onlyDigits(p.cpf), nome = (p.nome || '').trim();
      if (!(p.aulaId >= 1 && p.aulaId <= TOT)) return { ok: false, status: 'invalido', motivo: 'Aula inválida.' };
      if (nome.length < 3) return { ok: false, status: 'invalido', motivo: 'Informe o nome completo.' };
      if (cpf.length !== 11) return { ok: false, status: 'invalido', motivo: 'CPF deve ter 11 dígitos.' };
      if (!validEmail(p.email)) return { ok: false, status: 'invalido', motivo: 'E-mail inválido.' };
      if (p.consent !== true) return { ok: false, status: 'consentimento', motivo: 'É necessário aceitar o consentimento (LGPD).' };
      var dup = demoState().some(function (r) { return r.cpf === cpf && r.aulaId === Number(p.aulaId); });
      if (!dup) demoState().push({ aulaId: Number(p.aulaId), nome: nome, cpf: cpf, email: p.email });
      return { ok: true, status: dup ? 'duplicada' : 'registrada', aulaId: Number(p.aulaId), demo: true,
               totalAluno: demoAgg(cpf).presentes.length,
               message: dup ? 'Presença já registrada.' : 'Presença registrada.' };
    }
    if (action === 'consultarCertificado') {
      var c = onlyDigits(p.cpf);
      if (c.length !== 11) return { ok: false, erro: 'Informe um CPF com 11 dígitos.' };
      var info = demoAgg(c);
      if (!info.presentes.length) return { ok: true, encontrado: false, demo: true, erro: 'Nenhuma presença encontrada para este CPF.' };
      var falt = []; for (var i = 1; i <= TOT; i++) if (info.presentes.indexOf(i) === -1) falt.push(i);
      var elg = info.presentes.length >= MIN;
      return { ok: true, encontrado: true, elegivel: elg, demo: true, nome: info.nome, cpf: c, cpfFormatado: formatCPF(c),
               presentes: info.presentes, faltantes: falt, qtd: info.presentes.length, total: TOT, minimo: MIN,
               codigo: codigoCertificado(c),
               motivo: (elg ? 'Presença suficiente: ' : 'Presença insuficiente: ') + info.presentes.length + ' de ' + TOT + ' aulas.' };
    }
    if (action === 'verificarCertificado') {
      var cod = (p.codigo || '').trim().toUpperCase();
      if (!/^MILES-2026-\d{6}$/.test(cod)) return { ok: false, erro: 'Código inválido. Formato: MILES-2026-000000.' };
      var seen = {}, hit = null;
      demoState().forEach(function (r) { if (!seen[r.cpf]) { seen[r.cpf] = true; if (codigoCertificado(r.cpf) === cod) hit = r.cpf; } });
      if (!hit) return { ok: true, encontrado: false, valido: false, demo: true, mensagem: 'Nenhum certificado corresponde a este código.' };
      var ag = demoAgg(hit), ok2 = ag.presentes.length >= MIN;
      return { ok: true, encontrado: true, valido: ok2, demo: true, nome: ag.nome, cpfMascarado: maskCPFmasked(formatCPF(hit)),
               qtd: ag.presentes.length, total: TOT, codigo: cod,
               mensagem: ok2 ? 'Certificado válido.' : 'Há presença para este código, mas a pessoa não atingiu ' + MIN + ' aulas.' };
    }
    if (action === 'listarPresencas') {
      var por = {}, byCpf = {};
      for (var a2 = 1; a2 <= TOT; a2++) por[a2] = 0;
      demoState().forEach(function (r) {
        if (!byCpf[r.cpf]) byCpf[r.cpf] = { nome: r.nome, aulas: {} };
        if (!byCpf[r.cpf].aulas[r.aulaId]) { byCpf[r.cpf].aulas[r.aulaId] = true; if (por[r.aulaId] != null) por[r.aulaId]++; }
      });
      var alunos = Object.keys(byCpf).map(function (cpf) {
        var pr = Object.keys(byCpf[cpf].aulas).map(Number).sort(function (x, y) { return x - y; });
        return { nome: byCpf[cpf].nome, cpf: maskCPFmasked(formatCPF(cpf)), presentes: pr, qtd: pr.length, elegivel: pr.length >= MIN };
      }).sort(function (x, y) { return x.nome.localeCompare(y.nome); });
      var elg2 = alunos.filter(function (a) { return a.elegivel; }).length;
      return { ok: true, total: TOT, minimo: MIN, admin: false, demo: true,
               resumo: { alunos: alunos.length, elegiveis: elg2, naoElegiveis: alunos.length - elg2,
                         taxaConclusao: alunos.length ? Math.round(elg2 / alunos.length * 100) : 0, porAula: por },
               alunos: alunos };
    }
    if (action === 'enviarMeuCertificado') {
      var ec = onlyDigits(p.cpf), einfo = demoAgg(ec);
      if (!einfo.presentes.length) return { ok: false, demo: true, erro: 'Nenhuma presença encontrada para este CPF.' };
      if (einfo.presentes.length < MIN) return { ok: false, demo: true, erro: 'Presença insuficiente: ' + einfo.presentes.length + ' de ' + TOT + ' aulas.' };
      var erow = demoState().filter(function (r) { return r.cpf === ec; })[0];
      return { ok: true, demo: true, enviadoPara: maskEmail((erow && erow.email) || 'aluno@exemplo.com') };
    }
    if (action === 'enviarCertificadosElegiveis') {
      var eby = {}; demoState().forEach(function (r) { (eby[r.cpf] = eby[r.cpf] || { a: {} }).a[r.aulaId] = true; });
      var env = 0; Object.keys(eby).forEach(function (c) { if (Object.keys(eby[c].a).length >= MIN) env++; });
      return { ok: true, demo: true, enviados: env, semEmail: 0 };
    }
    return { ok: false, erro: 'Ação desconhecida (demo): ' + action };
  }

  /* ---------- Marca (topbar) ---------- */
  function brandHTML(active) {
    var links = [
      ['index.html', 'Início'],
      ['qrcodes.html', 'Presença · QR'],
      ['certificado.html', 'Certificado'],
      ['verificar.html', 'Verificar'],
      ['admin.html', 'Painel'],
    ];
    var nav = links.map(function (l) {
      return '<a href="' + l[0] + '"' + (active === l[0] ? ' aria-current="page" style="color:var(--gold-lt);background:var(--bg-3)"' : '') + '>' + l[1] + '</a>';
    }).join('');
    return '' +
      '<a class="brand" href="index.html" aria-label="Instituto MILES — início">' +
        '<img class="brand-logo" src="assets/miles-logo.png" alt="Instituto MILES">' +
        '<span class="brand-tag">Membership</span>' +
      '</a>' +
      '<nav class="topnav" aria-label="Navegação principal">' + nav + '</nav>';
  }
  function mountTopbar(active) {
    var bar = $('#topbar');
    if (bar) bar.innerHTML = brandHTML(active);
    initDemoBadge();
  }

  /* ---------- Badge de modo demonstração ---------- */
  function initDemoBadge() {
    if (!useDemo() || $('#demo-badge')) return;
    var b = el('div', { id: 'demo-badge', class: 'demo-badge', role: 'note',
      title: 'O site está rodando sem backend, com dados fictícios em memória.' });
    b.innerHTML = '● Modo demonstração · dados fictícios';
    document.body.appendChild(b);
  }

  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function validEmail(v) { return EMAIL_RE.test(String(v || '').trim()); }

  global.MILES = {
    cfg: CFG, $: $, $all: $all, el: el, qs: qs, escapeHTML: escapeHTML,
    api: api, configurado: configurado, useDemo: useDemo,
    onlyDigits: onlyDigits, formatCPF: formatCPF, maskCPF: maskCPF, maskCPFmasked: maskCPFmasked,
    codigoCertificado: codigoCertificado,
    brandHTML: brandHTML, mountTopbar: mountTopbar, initDemoBadge: initDemoBadge,
    validEmail: validEmail,
  };
})(window);
