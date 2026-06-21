/**
 * MILES — Presença (QR Code) + Gerador de Certificados
 * ----------------------------------------------------------------------------
 * Backend ÚNICO em Google Apps Script (Web App) que atende os dois projetos:
 *   • Projeto 1 — registro de presença a partir do QR Code da aula
 *   • Projeto 2 — consulta de elegibilidade + emissão/verificação de certificado
 *
 * Banco de dados: a própria planilha do Google Sheets onde este script está
 * vinculado (abas "Aulas" e "Presencas", criadas automaticamente por setup()).
 *
 * COMO USAR (resumo — passo a passo completo no README):
 *   1. Extensões → Apps Script, cole este arquivo.
 *   2. Rode setup() uma vez (cria abas, semeia as 4 aulas e gera o segredo HMAC
 *      em Script Properties — NUNCA fica na planilha pública).
 *   3. (Recomendado p/ avaliação) rode semearExemplos() para inserir dados fictícios.
 *   4. Implantar → Nova implantação → App da Web
 *        • Executar como: Eu (dono)  • Quem tem acesso: Qualquer pessoa
 *      Copie a URL (termina em /exec) e cole em site/config.js.
 *
 * Contrato de erro: por limitação do ContentService, TODA resposta sai como
 * HTTP 200; o sucesso/erro de negócio é sinalizado pelo campo `ok` no corpo JSON.
 * ----------------------------------------------------------------------------
 */

// ===== Parâmetros de negócio =================================================
const TOTAL_AULAS   = 4;   // seminário com 4 aulas
const MIN_PRESENCAS = 3;   // 3 de 4 = 75% para liberar o certificado
const SEMINARIO     = 'Seminário de Inovação em Saúde'; // deve casar com config.js

// ===== Parâmetros do anti-reuso (QR rotativo) ================================
// A DURAÇÃO do QR é escolhida pelo instrutor no painel e viaja ASSINADA dentro do
// token, então o servidor valida com o mesmo período. Aceitamos a janela atual e a
// anterior → validade de ~1 a 2× a duração escolhida (tempo de escanear e preencher).
const PERIODO_PADRAO = 60;    // segundos (usado se o painel não enviar nada)
const PERIODO_MIN    = 15;    // limites de segurança para o período aceito
const PERIODO_MAX    = 1800;  // 30 min

// ===== Nomes das abas ========================================================
const ABA_AULAS     = 'Aulas';
const ABA_PRESENCAS = 'Presencas';

const CAB_AULAS     = ['aulaId', 'titulo', 'data'];
const CAB_PRESENCAS = ['id', 'timestamp', 'aulaId', 'nomeCompleto', 'cpf',
                       'email', 'consentimentoLGPD', 'origemToken'];

// Seminário-tema coerente com o Instituto MILES (inovação/liderança em saúde).
const AULAS_SEED = [
  [1, 'Aula 1 — Inovação e Liderança em Saúde', ''],
  [2, 'Aula 2 — Gestão de Times Clínicos de Alta Performance', ''],
  [3, 'Aula 3 — Empreendedorismo e Modelos de Negócio em Saúde', ''],
  [4, 'Aula 4 — Transformação Digital e o Futuro do Cuidado', ''],
];

// =============================================================================
//  SETUP — rode uma vez no editor do Apps Script
// =============================================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const aulas = pegarOuCriarAba_(ss, ABA_AULAS, CAB_AULAS);
  if (aulas.getLastRow() < 2) {
    aulas.getRange(2, 1, AULAS_SEED.length, 3).setValues(AULAS_SEED);
  }

  const pres = pegarOuCriarAba_(ss, ABA_PRESENCAS, CAB_PRESENCAS);
  pres.setFrozenRows(1);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET'))        props.setProperty('SECRET', gerarSecret_());
  if (!props.getProperty('ENFORCE_TOKEN')) props.setProperty('ENFORCE_TOKEN', 'true');
  if (!props.getProperty('ALLOW_STATIC'))  props.setProperty('ALLOW_STATIC', 'true');
  // ADMIN_KEY é opcional: se definido, listarPresencas exige essa chave para
  // devolver o CPF COMPLETO. Sem ela, o CPF sai sempre mascarado (LGPD).

  const msg = 'Setup concluído.\n'
    + '• Abas "Aulas" e "Presencas" prontas.\n'
    + '• 4 aulas (tema saúde) semeadas.\n'
    + '• SECRET gerado em Script Properties.\n'
    + '• ENFORCE_TOKEN=true, ALLOW_STATIC=true.\n\n'
    + 'Em produção real: ALLOW_STATIC=false (força só o QR rotativo).\n'
    + 'Para CPF completo no painel: defina ADMIN_KEY em Propriedades do script.\n\n'
    + 'Próximo passo: Implantar → App da Web (acesso: Qualquer pessoa).';
  Logger.log(msg);
  return msg;
}

/** Apaga TODAS as presenças (mantém a estrutura). Útil para limpar testes. */
function limparPresencas() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRESENCAS);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  return 'Presenças apagadas.';
}

/** Insere presenças de exemplo (dados FICTÍCIOS) para avaliação/demonstração. */
function semearExemplos() {
  // Ana: 3/4 → elegível no limite.  Bruno: 2/4 → negado.  Carla: 4/4 → elegível.
  const exemplos = [
    ['Ana Souza Lima',      '11111111111', 'ana@exemplo.com',   [1, 2, 4]],
    ['Bruno Costa Pereira', '22222222222', 'bruno@exemplo.com', [1, 3]],
    ['Carla Mendes Rocha',  '33333333333', 'carla@exemplo.com', [1, 2, 3, 4]],
  ];
  exemplos.forEach(function (e) {
    e[3].forEach(function (aulaId) {
      registrarPresenca_({ aulaId: aulaId, nome: e[0], cpf: e[1], email: e[2],
                           consent: true, token: tokenEstatico_(aulaId) });
    });
  });
  return 'Exemplos inseridos (Ana 3/4 ✓, Bruno 2/4 ✕, Carla 4/4 ✓).';
}

// =============================================================================
//  ROTEADOR HTTP (Web App)
// =============================================================================
function doPost(e) {
  // Leitura defensiva: e / postData / contents podem faltar (ping, healthcheck).
  var raw = (e && e.postData && e.postData.contents) || '{}';
  var dados = {};
  try { dados = JSON.parse(raw); } catch (err) { dados = {}; }
  return rotear_(dados, (e && e.parameter) || {});
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return rotear_(p, p);
  return json_({
    ok: true,
    app: 'MILES — Presença + Certificados',
    versao: '2.0',
    acoes: ['emitirToken', 'registrarPresenca', 'consultarCertificado',
            'verificarCertificado', 'enviarMeuCertificado', 'enviarCertificadosElegiveis',
            'listarPresencas', 'listarAulas'],
  });
}

function rotear_(dados, params) {
  try {
    var action = dados.action || params.action;
    switch (action) {
      case 'emitirToken':           return json_(emitirToken_(dados));
      case 'registrarPresenca':     return json_(registrarPresenca_(dados));
      case 'consultarCertificado':  return json_(consultarCertificado_(dados));
      case 'verificarCertificado':  return json_(verificarCertificado_(dados));
      case 'enviarMeuCertificado':        return json_(enviarMeuCertificado_(dados));
      case 'enviarCertificadosElegiveis': return json_(enviarCertificadosElegiveis_(dados));
      case 'listarPresencas':       return json_(listarPresencas_(dados));
      case 'listarAulas':           return json_({ ok: true, aulas: listarAulas_() });
      default: return json_({ ok: false, erro: 'Ação desconhecida: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, erro: String(err && err.message ? err.message : err) });
  }
}

// =============================================================================
//  PROJETO 1 — Presença
// =============================================================================

/** Gera os tokens (rotativo da janela atual + estático) de TODAS as aulas.
 *  PROTEGIDO POR SENHA: só o instrutor (com a ADMIN_KEY) emite tokens válidos —
 *  assim ninguém de fora gera um QR para marcar presença sem estar na aula.
 *  `dados.periodo` (segundos) é a duração escolhida pelo instrutor no painel. */
function emitirToken_(dados) {
  var temChave = !!PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!temChave) {
    return { ok: false, restrito: true, semChave: true,
             erro: 'Painel do instrutor protegido. Defina ADMIN_KEY nas Propriedades do Script (Apps Script).' };
  }
  if (!chaveAdminOk_(dados && dados.adminKey)) {
    return { ok: false, restrito: true, erro: 'Chave de administrador incorreta ou ausente.' };
  }
  var periodo = clampPeriodo_(dados && dados.periodo);
  var win = janelaPara_(periodo);
  var rotativos = {}, estaticos = {};
  listarAulas_().forEach(function (a) {
    rotativos[a.aulaId] = tokenRotativo_(a.aulaId, periodo, win);
    estaticos[a.aulaId] = tokenEstatico_(a.aulaId);
  });
  return {
    ok: true, periodo: periodo, win: win,
    expiraEm: (win + 1) * periodo * 1000,
    rotativos: rotativos, estaticos: estaticos,
  };
}

/**
 * Registra a presença. Valida consentimento (LGPD), token (anti-reuso) e
 * evita duplicidade (mesmo CPF + mesma aula). Usa LockService e UMA única
 * leitura da aba (dedup + contagem no mesmo laço).
 */
function registrarPresenca_(dados) {
  var aulaId = parseInt(dados.aulaId, 10);
  var nome   = (dados.nome || '').toString().trim();
  var cpf    = somenteDigitos_(dados.cpf);
  var email  = (dados.email || '').toString().trim();
  var consent = dados.consent === true || dados.consent === 'true';

  if (!(aulaId >= 1 && aulaId <= TOTAL_AULAS)) return { ok: false, status: 'invalido', motivo: 'Aula inválida.' };
  if (nome.length < 3)   return { ok: false, status: 'invalido', motivo: 'Informe o nome completo.' };
  if (cpf.length !== 11) return { ok: false, status: 'invalido', motivo: 'CPF deve ter 11 dígitos. (Não validamos os dígitos verificadores.)' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, status: 'invalido', motivo: 'E-mail inválido.' };
  if (!consent)          return { ok: false, status: 'consentimento', motivo: 'É necessário aceitar o aviso de consentimento (LGPD).' };

  var v = validarToken_(aulaId, dados.token);
  if (!v.ok) return { ok: false, status: 'token', motivo: motivoToken_(v.motivo) };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = abaPresencas_();
    var linhas = sh.getDataRange().getValues(); // 1 leitura só
    var iAula = CAB_PRESENCAS.indexOf('aulaId');
    var iCpf  = CAB_PRESENCAS.indexOf('cpf');
    var doAluno = {};   // aulas distintas já registradas para este CPF
    var dup = false;
    for (var r = 1; r < linhas.length; r++) {
      if (somenteDigitos_(linhas[r][iCpf]) === cpf) {
        var ai = parseInt(linhas[r][iAula], 10);
        doAluno[ai] = true;
        if (ai === aulaId) dup = true;
      }
    }
    if (dup) {
      return { ok: true, status: 'duplicada', aulaId: aulaId,
               message: 'Presença nesta aula já estava registrada.',
               totalAluno: Object.keys(doAluno).length };
    }
    sh.appendRow([
      Utilities.getUuid(),
      Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
      aulaId, nome, "'" + cpf, // apóstrofo força texto (preserva zeros à esquerda)
      email, consent, v.tipo,
    ]);
    doAluno[aulaId] = true;
    return { ok: true, status: 'registrada', aulaId: aulaId,
             message: 'Presença registrada com sucesso.',
             totalAluno: Object.keys(doAluno).length };
  } finally {
    lock.releaseLock();
  }
}

// =============================================================================
//  PROJETO 2 — Certificado
// =============================================================================

/**
 * Consulta por CPF quantas das 4 aulas a pessoa tem presença e decide
 * elegibilidade. (Apenas por CPF — não buscamos por nome para não permitir
 * a associação nome→CPF de terceiros.)
 */
function consultarCertificado_(dados) {
  var cpf = somenteDigitos_(dados.cpf);
  if (cpf.length !== 11) return { ok: false, erro: 'Informe um CPF com 11 dígitos.' };

  var info = agregarCpf_(cpf);
  if (info.presentes.length === 0) {
    return { ok: true, encontrado: false,
             erro: 'Nenhuma presença encontrada para este CPF.' };
  }
  var faltantes = [];
  for (var i = 1; i <= TOTAL_AULAS; i++) if (info.presentes.indexOf(i) === -1) faltantes.push(i);
  var elegivel = info.presentes.length >= MIN_PRESENCAS;
  return {
    ok: true, encontrado: true, elegivel: elegivel,
    nome: info.nome, cpf: cpf, cpfFormatado: formatarCpf_(cpf),
    presentes: info.presentes, faltantes: faltantes,
    qtd: info.presentes.length, total: TOTAL_AULAS, minimo: MIN_PRESENCAS,
    codigo: codigoCertificado_(cpf),
    motivo: elegivel
      ? 'Presença suficiente: ' + info.presentes.length + ' de ' + TOTAL_AULAS + ' aulas.'
      : 'Presença insuficiente: ' + info.presentes.length + ' de ' + TOTAL_AULAS + ' aulas.',
  };
}

/** Verifica a autenticidade de um certificado pelo código MILES-2026-XXXXXX. */
function verificarCertificado_(dados) {
  var codigo = (dados.codigo || '').toString().trim().toUpperCase();
  if (!/^MILES-2026-\d{6}$/.test(codigo)) {
    return { ok: false, erro: 'Código inválido. Formato esperado: MILES-2026-000000.' };
  }
  var sh = abaPresencas_();
  var linhas = sh.getDataRange().getValues();
  var iCpf = CAB_PRESENCAS.indexOf('cpf');
  var vistos = {};
  for (var r = 1; r < linhas.length; r++) {
    var cpf = somenteDigitos_(linhas[r][iCpf]);
    if (!cpf || vistos[cpf]) continue;
    vistos[cpf] = true;
    if (codigoCertificado_(cpf) === codigo) {
      var info = agregarCpf_(cpf);
      var elegivel = info.presentes.length >= MIN_PRESENCAS;
      return {
        ok: true, encontrado: true, valido: elegivel,
        nome: info.nome, cpfMascarado: mascararCpf_(cpf),
        qtd: info.presentes.length, total: TOTAL_AULAS, codigo: codigo,
        mensagem: elegivel
          ? 'Certificado válido.'
          : 'Há registro de presença para este código, mas a pessoa não atingiu o mínimo de ' + MIN_PRESENCAS + ' aulas — nenhum certificado foi emitido.',
      };
    }
  }
  return { ok: true, encontrado: false, valido: false,
           mensagem: 'Nenhum certificado corresponde a este código.' };
}

/**
 * Painel administrativo (somente leitura) — PROTEGIDO POR SENHA.
 * Sem a ADMIN_KEY correta, NENHUM dado de aluno (nem nomes, nem métricas) é
 * devolvido — assim quem só escaneou o QR não consegue ver quem foi ao evento.
 * O CPF sai mascarado por padrão; completo apenas com `cpfCompleto: true`.
 */
function listarPresencas_(dados) {
  var temChave = !!PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!temChave) {
    return { ok: false, restrito: true, semChave: true,
             erro: 'Painel protegido. Defina ADMIN_KEY nas Propriedades do Script (Apps Script) para acessar.' };
  }
  if (!chaveAdminOk_(dados && dados.adminKey)) {
    return { ok: false, restrito: true,
             erro: 'Chave de administrador incorreta ou ausente.' };
  }
  var completo = dados && (dados.cpfCompleto === true || dados.cpfCompleto === 'true');

  var sh = abaPresencas_();
  var linhas = sh.getDataRange().getValues();
  var iAula = CAB_PRESENCAS.indexOf('aulaId');
  var iCpf  = CAB_PRESENCAS.indexOf('cpf');
  var iNome = CAB_PRESENCAS.indexOf('nomeCompleto');

  var porCpf = {};
  var porAula = {};
  for (var a = 1; a <= TOTAL_AULAS; a++) porAula[a] = 0;
  for (var r = 1; r < linhas.length; r++) {
    var cpf = somenteDigitos_(linhas[r][iCpf]);
    if (!cpf) continue;
    var ai = parseInt(linhas[r][iAula], 10);
    if (!porCpf[cpf]) porCpf[cpf] = { nome: String(linhas[r][iNome] || ''), aulas: {} };
    if (!porCpf[cpf].aulas[ai]) { porCpf[cpf].aulas[ai] = true; if (porAula[ai] != null) porAula[ai]++; }
  }

  var alunos = Object.keys(porCpf).map(function (cpf) {
    var a = porCpf[cpf];
    var presentes = Object.keys(a.aulas).map(Number).sort(function (x, y) { return x - y; });
    return {
      nome: a.nome,
      cpf: completo ? formatarCpf_(cpf) : mascararCpf_(cpf),
      presentes: presentes, qtd: presentes.length,
      elegivel: presentes.length >= MIN_PRESENCAS,
    };
  }).sort(function (x, y) { return x.nome.localeCompare(y.nome); });

  var elegiveis = alunos.filter(function (a) { return a.elegivel; }).length;
  return {
    ok: true, total: TOTAL_AULAS, minimo: MIN_PRESENCAS, admin: true,
    resumo: {
      alunos: alunos.length, elegiveis: elegiveis,
      naoElegiveis: alunos.length - elegiveis,
      taxaConclusao: alunos.length ? Math.round((elegiveis / alunos.length) * 100) : 0,
      porAula: porAula,
    },
    alunos: alunos,
  };
}

function listarAulas_() {
  var sh = abaAulas_();
  var linhas = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < linhas.length; r++) {
    if (linhas[r][0] === '' || linhas[r][0] === null) continue;
    out.push({ aulaId: parseInt(linhas[r][0], 10),
               titulo: String(linhas[r][1] || ('Aula ' + linhas[r][0])),
               data: linhas[r][2] ? String(linhas[r][2]) : '' });
  }
  return out;
}

/** Agrega as aulas distintas de um CPF. */
function agregarCpf_(cpf) {
  var sh = abaPresencas_();
  var linhas = sh.getDataRange().getValues();
  var iAula = CAB_PRESENCAS.indexOf('aulaId');
  var iCpf  = CAB_PRESENCAS.indexOf('cpf');
  var iNome = CAB_PRESENCAS.indexOf('nomeCompleto');
  var set = {}, nome = '';
  for (var r = 1; r < linhas.length; r++) {
    if (somenteDigitos_(linhas[r][iCpf]) === cpf) {
      set[parseInt(linhas[r][iAula], 10)] = true;
      nome = String(linhas[r][iNome] || nome);
    }
  }
  return { nome: nome, presentes: Object.keys(set).map(Number).sort(function (a, b) { return a - b; }) };
}

// =============================================================================
//  E-mail do certificado (MailApp) — sai do Gmail da conta que publicou o script
// =============================================================================

/** Aluno pede o próprio certificado por e-mail (precisa estar elegível). */
function enviarMeuCertificado_(dados) {
  var cpf = somenteDigitos_(dados.cpf);
  if (cpf.length !== 11) return { ok: false, erro: 'Informe um CPF com 11 dígitos.' };
  var a = mapaAlunos_()[cpf];
  if (!a) return { ok: false, erro: 'Nenhum registro encontrado para este CPF.' };
  if (a.presentes.length < MIN_PRESENCAS)
    return { ok: false, erro: 'Presença insuficiente: ' + a.presentes.length + ' de ' + TOTAL_AULAS + ' aulas.' };
  if (!a.email) return { ok: false, erro: 'Não há e-mail cadastrado para este CPF.' };
  a.cpf = cpf;
  enviarEmailCertificado_(a, dados.siteUrl);
  return { ok: true, enviadoPara: mascararEmail_(a.email) };
}

/** Admin envia o certificado a TODOS os elegíveis de uma vez. */
function enviarCertificadosElegiveis_(dados) {
  if (!chaveAdminOk_(dados && dados.adminKey))
    return { ok: false, erro: 'Chave de admin necessária (defina ADMIN_KEY no Apps Script).' };
  var mapa = mapaAlunos_(), enviados = 0, semEmail = 0;
  Object.keys(mapa).forEach(function (cpf) {
    var a = mapa[cpf];
    if (a.presentes.length < MIN_PRESENCAS) return;
    if (!a.email) { semEmail++; return; }
    a.cpf = cpf;
    enviarEmailCertificado_(a, dados.siteUrl);
    enviados++;
  });
  return { ok: true, enviados: enviados, semEmail: semEmail };
}

function enviarEmailCertificado_(a, siteUrl) {
  var base = String(siteUrl || '').replace(/\/+$/, '');
  var codigo = codigoCertificado_(a.cpf);
  var linkCert = base ? base + '/certificado.html?cpf=' + a.cpf : '';
  var linkVer  = base ? base + '/verificar.html?c=' + codigo : '';
  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto">' +
      '<div style="background:#0b0b0b;color:#D4AF37;padding:18px 22px;border-radius:10px 10px 0 0;font-size:18px;font-weight:bold;letter-spacing:2px">INSTITUTO MILES</div>' +
      '<div style="border:1px solid #eadfbf;border-top:none;border-radius:0 0 10px 10px;padding:24px;color:#222">' +
        '<h2 style="margin:0 0 .4rem;color:#946c26">Seu certificado está pronto 🎉</h2>' +
        '<p>Olá, <b>' + escaparHtml_(a.nome) + '</b>!</p>' +
        '<p>Você concluiu o <b>' + escaparHtml_(SEMINARIO) + '</b> com presença em ' +
          '<b>' + a.presentes.length + ' de ' + TOTAL_AULAS + ' aulas</b>. Parabéns!</p>' +
        (linkCert ? '<p style="margin:24px 0"><a href="' + linkCert + '" style="background:#D4AF37;color:#1a1305;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">Ver e baixar meu certificado</a></p>' : '') +
        '<p style="font-size:13px;color:#666">Código de verificação: <b>' + codigo + '</b>' +
          (linkVer ? ' &middot; <a href="' + linkVer + '">verificar autenticidade</a>' : '') + '</p>' +
      '</div>' +
      '<p style="font-size:11px;color:#999;text-align:center;margin-top:10px">Instituto MILES &middot; Think Miles Further</p>' +
    '</div>';
  MailApp.sendEmail({ to: a.email, subject: 'Seu certificado — ' + SEMINARIO, htmlBody: html, name: 'Instituto MILES' });
}

/** Uma varredura → mapa { cpf: { nome, email, presentes[] } }. */
function mapaAlunos_() {
  var sh = abaPresencas_();
  var linhas = sh.getDataRange().getValues();
  var iAula = CAB_PRESENCAS.indexOf('aulaId'), iCpf = CAB_PRESENCAS.indexOf('cpf');
  var iNome = CAB_PRESENCAS.indexOf('nomeCompleto'), iMail = CAB_PRESENCAS.indexOf('email');
  var m = {};
  for (var r = 1; r < linhas.length; r++) {
    var cpf = somenteDigitos_(linhas[r][iCpf]);
    if (!cpf) continue;
    if (!m[cpf]) m[cpf] = { nome: '', email: '', aulas: {} };
    m[cpf].nome = String(linhas[r][iNome] || m[cpf].nome);
    if (linhas[r][iMail]) m[cpf].email = String(linhas[r][iMail]);
    m[cpf].aulas[parseInt(linhas[r][iAula], 10)] = true;
  }
  Object.keys(m).forEach(function (cpf) {
    m[cpf].presentes = Object.keys(m[cpf].aulas).map(Number).sort(function (a, b) { return a - b; });
  });
  return m;
}

function mascararEmail_(e) {
  e = String(e || ''); var at = e.indexOf('@');
  return at < 1 ? e : e.charAt(0) + '•••' + e.slice(at);
}
function escaparHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// =============================================================================
//  TESTES — rode runTests() no editor (menu Executar) e veja o resultado nos Logs
// =============================================================================
function runTests() {
  var falhas = [];
  function check(cond, nome) { if (!cond) falhas.push(nome); Logger.log((cond ? '✓ ' : '✕ ') + nome); }

  // utilitários
  check(somenteDigitos_('123.456.789-09') === '12345678909', 'somenteDigitos remove pontuação');
  check(formatarCpf_('12345678909') === '123.456.789-09', 'formatarCpf formata');
  check(mascararCpf_('12345678909') === '•••.•••.789-09', 'mascararCpf mascara');
  check(mascararEmail_('lalala@gmail.com') === 'l•••@gmail.com', 'mascararEmail mascara');
  check(clampPeriodo_(5) === PERIODO_MIN && clampPeriodo_(99999) === PERIODO_MAX && clampPeriodo_('abc') === PERIODO_PADRAO, 'clampPeriodo respeita limites');

  // código de verificação determinístico
  var c1 = codigoCertificado_('33333333333');
  check(/^MILES-2026-\d{6}$/.test(c1), 'código tem formato válido');
  check(c1 === codigoCertificado_('333.333.333-33'), 'código ignora pontuação do CPF');

  // tokens (assume ENFORCE_TOKEN=true)
  var per = 120, win = janelaPara_(per), tk = tokenRotativo_(1, per, win);
  check(validarToken_(1, tk).ok, 'token rotativo recém-emitido é válido');
  check(!validarToken_(2, tk).ok, 'token de uma aula não vale para outra');
  check(!validarToken_(1, 'r.' + per + '.' + win + '.assinaturaerrada').ok, 'assinatura errada é rejeitada');
  check(validarToken_(1, tokenRotativo_(1, per, win - 1)).ok, 'janela anterior ainda é aceita');
  check(!validarToken_(1, tokenRotativo_(1, per, win - 5)).ok, 'janela antiga expira');
  check(!validarToken_(1, 'r.5.' + win + '.x').ok, 'período fora do limite é rejeitado');
  var est = tokenEstatico_(1);
  check(flags_().ALLOW_STATIC ? validarToken_(1, est).ok : !validarToken_(1, est).ok, 'token estático segue ALLOW_STATIC');

  var resumo = falhas.length === 0
    ? 'TODOS OS TESTES PASSARAM ✓ (' + 14 + ' verificações)'
    : falhas.length + ' FALHA(S): ' + falhas.join(' | ');
  Logger.log(resumo);
  return resumo;
}

// =============================================================================
//  Tokens (anti-reuso do QR) — HMAC-SHA256 com segredo no servidor
// =============================================================================
function clampPeriodo_(p) {
  p = parseInt(p, 10);
  if (isNaN(p)) return PERIODO_PADRAO;
  return Math.max(PERIODO_MIN, Math.min(PERIODO_MAX, p));
}
function janelaPara_(periodo) { return Math.floor((new Date().getTime()) / 1000 / periodo); }
// Token rotativo: "r.<periodo>.<janela>.<assinatura>" — o período viaja assinado.
function tokenRotativo_(aulaId, periodo, win) { return 'r.' + periodo + '.' + win + '.' + hmac_('r:' + aulaId + ':' + periodo + ':' + win); }
function tokenEstatico_(aulaId)               { return 's.' + hmac_('s:' + aulaId); }

/**
 * Regras:
 *   • ENFORCE_TOKEN=false → modo aberto (aceita qualquer scan).
 *   • Token rotativo "r.<periodo>.<janela>.<sig>": o período (duração escolhida pelo
 *     instrutor) viaja assinado. Aceita a janela atual e a anterior → validade de
 *     ~1 a 2× o período. Período fora de [PERIODO_MIN, PERIODO_MAX] é recusado.
 *   • Token estático "s.<sig>" só é aceito se ALLOW_STATIC=true (conveniência de
 *     avaliação; em produção use ALLOW_STATIC=false).
 */
function validarToken_(aulaId, token) {
  var f = flags_();
  if (!f.ENFORCE_TOKEN) return { ok: true, tipo: 'aberto' };
  if (!token) return { ok: false, motivo: 'sem_token' };

  if (token.indexOf('s.') === 0) {
    if (f.ALLOW_STATIC && seguroIgual_(token, tokenEstatico_(aulaId))) return { ok: true, tipo: 'estatico' };
    return { ok: false, motivo: f.ALLOW_STATIC ? 'invalido' : 'estatico_off' };
  }

  var partes = token.split('.');
  if (partes.length !== 4 || partes[0] !== 'r') return { ok: false, motivo: 'formato' };
  var periodo = parseInt(partes[1], 10), win = parseInt(partes[2], 10);
  if (isNaN(periodo) || isNaN(win)) return { ok: false, motivo: 'formato' };
  if (periodo < PERIODO_MIN || periodo > PERIODO_MAX) return { ok: false, motivo: 'invalido' };

  var atual = janelaPara_(periodo);
  for (var i = 0; i < 2; i++) { // janela atual + anterior
    if (win === atual - i && seguroIgual_(token, tokenRotativo_(aulaId, periodo, win))) return { ok: true, tipo: 'rotativo' };
  }
  if (seguroIgual_(token, tokenRotativo_(aulaId, periodo, win))) return { ok: false, motivo: 'expirado' };
  return { ok: false, motivo: 'invalido' };
}

function motivoToken_(m) {
  switch (m) {
    case 'expirado':     return 'Este QR Code expirou. Peça o código atualizado exibido na tela da aula.';
    case 'sem_token':    return 'QR Code sem código de validação. Escaneie o QR exibido na aula.';
    case 'estatico_off': return 'QR estático desabilitado. Use o QR rotativo exibido na tela.';
    default:             return 'QR Code inválido. Escaneie o código exibido na tela da aula.';
  }
}

// =============================================================================
//  Utilitários
// =============================================================================
function flags_() {
  var p = PropertiesService.getScriptProperties();
  return {
    ENFORCE_TOKEN: (p.getProperty('ENFORCE_TOKEN') || 'true') === 'true',
    ALLOW_STATIC:  (p.getProperty('ALLOW_STATIC')  || 'true') === 'true',
  };
}

function chaveAdminOk_(chave) {
  var k = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!k && !!chave && seguroIgual_(String(chave), String(k));
}

function secret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SECRET');
  if (!s) { s = gerarSecret_(); p.setProperty('SECRET', s); }
  return s;
}

/** Segredo de 256 bits derivado de 3 UUIDs v4 (aleatórios). */
function gerarSecret_() {
  var rnd = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rnd));
}

function hmac_(msg) {
  var raw = Utilities.computeHmacSha256Signature(msg, secret_());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

/** Comparação de tempo (aproximadamente) constante, contra timing attacks. */
function seguroIgual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

function somenteDigitos_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

function formatarCpf_(cpf) {
  var d = somenteDigitos_(cpf);
  if (d.length !== 11) return d;
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function mascararCpf_(cpf) {
  var d = somenteDigitos_(cpf);
  if (d.length !== 11) return d;
  return '•••.•••.' + d.slice(6, 9) + '-' + d.slice(9);
}

/** Código de verificação determinístico (igual ao do frontend). */
function codigoCertificado_(cpf) {
  var d = somenteDigitos_(cpf), s = 0;
  for (var i = 0; i < d.length; i++) s = (s * 31 + d.charCodeAt(i)) % 1000000;
  return 'MILES-2026-' + ('00000' + s).slice(-6);
}

function pegarOuCriarAba_(ss, nome, cabecalho) {
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  var atual = sh.getRange(1, 1, 1, cabecalho.length).getValues()[0];
  var precisa = false;
  for (var i = 0; i < cabecalho.length; i++) if (atual[i] !== cabecalho[i]) precisa = true;
  if (precisa) sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  return sh;
}

function abaPresencas_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRESENCAS);
  if (!sh) throw new Error('Aba "Presencas" não existe. Rode setup() primeiro.');
  return sh;
}
function abaAulas_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_AULAS);
  if (!sh) throw new Error('Aba "Aulas" não existe. Rode setup() primeiro.');
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
