/* ============================================================================
   CONFIGURAÇÃO — edite APENAS este arquivo.
   ----------------------------------------------------------------------------
   Cole abaixo a URL do seu App da Web do Google Apps Script (termina em /exec).
   Passo a passo no README.md (seção "Deploy").

   MODO DEMONSTRAÇÃO: enquanto WEB_APP_URL não estiver preenchido (ou DEMO=true),
   o site funciona 100% sem backend, com dados fictícios em memória — ótimo para
   a comissão ver tudo rodando na hora. Ao colar a URL real, passa a usar o Sheets.
   ============================================================================ */
window.MILES_CONFIG = {
  // 1) Cole aqui a URL do Apps Script (Implantar → App da Web). Ex.:
  //    "https://script.google.com/macros/s/AKfycb.../exec"
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzrtKdHhYaNTJfhNgy1aM95JopGozhWFeWEhIByszO7QaVfr_OikzavfyQvii2arQy8/exec",

  // 2) Forçar modo demonstração mesmo com WEB_APP_URL preenchido? (deixe false
  //    para usar o backend real; true mantém a demo pública com dados fictícios).
  DEMO: false,

  // 3) Identidade do seminário (aparece no certificado e nas telas).
  SEMINARIO: "Seminário de Inovação em Saúde",
  EDICAO: "Instituto MILES · Turma 2026",
  LOCAL: "Instituto MILES",
  ASSINANTE_NOME: "Coordenação de Inovação",
  ASSINANTE_CARGO: "Instituto MILES · Diretoria de Inovação",

  // 4) Regras (mantêm o frontend e o backend coerentes).
  TOTAL_AULAS: 4,
  MIN_PRESENCAS: 3,

  // 5) Títulos de exibição (o backend também devolve via listarAulas).
  AULAS: [
    { aulaId: 1, titulo: "Aula 1 — Inovação e Liderança em Saúde" },
    { aulaId: 2, titulo: "Aula 2 — Gestão de Times Clínicos de Alta Performance" },
    { aulaId: 3, titulo: "Aula 3 — Empreendedorismo e Modelos de Negócio em Saúde" },
    { aulaId: 4, titulo: "Aula 4 — Transformação Digital e o Futuro do Cuidado" },
  ],
};
