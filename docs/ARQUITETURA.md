# Arquitetura e decisões técnicas

## Visão geral

```
┌──────────────┐   POST (text/plain, JSON)   ┌────────────────────┐   read/write   ┌───────────────┐
│  Frontend    │ ─────────────────────────▶  │  Apps Script       │ ─────────────▶ │ Google Sheets │
│  (Netlify)   │ ◀─────────────────────────  │  Web App (/exec)    │ ◀───────────── │  (banco)      │
│ HTML/CSS/JS  │        JSON de resposta      │  doGet / doPost     │                │ Aulas /       │
└──────────────┘                              └────────────────────┘                │ Presencas     │
        ▲ escaneia QR                                                                └───────────────┘
        │
   📱 Aluno
```

Um **único** App da Web atende os dois projetos, roteando por `action` no corpo da
requisição. Isso mantém **uma planilha, um backend e um repositório** — menos partes para
configurar e uma fonte única de verdade para as presenças (o Projeto 2 lê exatamente o que o
Projeto 1 grava).

## Por que essa stack
- **Google Sheets como banco:** requisito da tarefa e perfeito para o volume (dezenas/centenas
  de linhas). Visualização e auditoria “de graça”, sem painel extra.
- **Apps Script:** requisito da tarefa; roda colado na planilha, sem servidor para manter, com
  `LockService`, `PropertiesService` e `Utilities.computeHmacSha256Signature` prontos.
- **Frontend estático (sem framework):** carrega rápido no celular (cenário real: aluno
  escaneia e preenche na hora), zero build, deploy trivial no Netlify. HTML/CSS/JS puro + uma
  lib JS **vendorizada localmente** (`assets/vendor/qrcode.min.js` para gerar os QRs — sem
  depender de CDN, funciona offline). O download do certificado usa a **impressão
  nativa do navegador** (“Salvar como PDF”), que reproduz o CSS com fidelidade total — sem as
  limitações de rasterização do html2canvas com temas escuros/`aspect-ratio`/`mask`.

**Identidade visual — “Credencial Gravada”.** Segue a marca real do Instituto MILES
(institutomiles.com.br): logo oficial (globo + wordmark), dourado **#D4AF37 sobre preto #050505** e a
tipografia da marca (**Cinzel** para títulos/marca, **Playfair Display** para nomes, **Manrope** para
corpo/UI). Em vez da estética genérica “landing dark + dourado”, o sistema trata cada tela como um
**documento de credencial gravado**: superfície fosca (sem halos/glow), **guilhochê de segurança**
gerado por matemática (curvas hipotrocoides em SVG — `assets/guilloche-*.svg`) como marca d'água,
cabeçalho de documento com numerais tabulares, capa emoldurada por filetes, dourado usado como
*tinta* (1 acento por tela) e o **nome do aluno como elemento herói** no certificado. O certificado
usa `print-color-adjust: exact` para imprimir o fundo escuro corretamente.

## Comunicação Frontend ↔ Apps Script (CORS)
O Apps Script não permite definir cabeçalhos CORS no `ContentService`. O padrão consolidado
para chamá-lo de outro domínio (Netlify) é fazer **`POST` com `Content-Type: text/plain`**:
isso evita o *preflight* `OPTIONS`, e a resposta final (servida por
`script.googleusercontent.com`) já vem com `Access-Control-Allow-Origin: *`. Por isso o helper
`api()` (em `assets/app.js`) envia o JSON como texto. Sem proxies, sem gambiarra de JSONP.

## Modelo de dados
Detalhe das colunas em [`PLANILHA.md`](PLANILHA.md). Resumo:
- **`Aulas`** — `aulaId · titulo · data` (as 4 aulas do seminário; configurável).
- **`Presencas`** — uma linha por presença: `id · timestamp · aulaId · nomeCompleto · cpf ·
  email · consentimentoLGPD · origemToken` (sem `userAgent`/IP — minimização de dados). O
  `timestamp` é gravado no fuso `America/Sao_Paulo` (`Utilities.formatDate`).

**Identidade do aluno = CPF** (só dígitos). É a chave que conecta os dois projetos e a base do
anti-duplicidade.

## Anti-duplicidade (mesmo aluno + mesma aula)
No `registrarPresenca`, dentro de um **`LockService.getScriptLock()`** (evita corrida em
cliques/escaneamentos simultâneos), o backend varre `Presencas` procurando `cpf + aulaId`. Se
já existe, responde `status: "duplicada"` (a UI mostra “você já estava presente”) e **não**
grava outra linha. O CPF é guardado como texto (`'` + dígitos) para preservar zeros à esquerda.
A **mesma** leitura da aba (`getValues()`) serve para o dedup **e** para contar as aulas do
aluno — uma única varredura por registro, dentro do lock (em vez de duas).

## Elegibilidade do certificado (Projeto 2)
`consultarCertificado` conta as **aulas distintas** com presença para o CPF. `elegível =
distintas ≥ 3`. Retorna `presentes`, `faltantes`, `qtd`, `total` e um `motivo` legível
(*“presença insuficiente: 2 de 4 aulas”*). O frontend então:
- **elegível →** renderiza o certificado (logo oficial + nome + CPF + aulas + data + selo) e
  oferece **Baixar PDF** (via impressão nativa do navegador → “Salvar como PDF”, em A4 paisagem);
- **não elegível →** mostra o motivo e quais aulas faltam;
- **não encontrado →** orienta a registrar presença primeiro.

## 🔒 Bônus — impedir reuso/print do QR
**Mecanismo implementado: token rotativo assinado (HMAC-SHA256) com janela curta.**

1. O instrutor **escolhe a duração** de cada QR no painel (`qrcodes.html`), que pede tokens ao
   backend: `token = "r.<periodo>.<janela>.<assinatura>"`, com
   `assinatura = HMAC(SECRET, "r:<aula>:<periodo>:<janela>")` e `janela = floor(epoch / periodo)`.
   **O período viaja assinado no token**, então o servidor valida com o mesmo período — sem
   guardar estado e sem o cliente poder “esticar” a validade (o período está dentro do HMAC).
2. O QR codifica `presenca.html?aula=<id>&tk=<token>`.
3. O QR **exibido** gira a cada `periodo`; ao registrar, o backend recalcula a assinatura e aceita a
   **janela atual e a anterior** → validade de **~1 a 2× o período** (margem para escanear e
   preencher). Período fora de `[PERIODO_MIN=15s, PERIODO_MAX=30min]` é recusado. Assinatura certa
   mas janela passada → **`expirado`**; errada → **`inválido`**. Comparação em **tempo constante**.
4. O `SECRET` é gerado no `setup()` (256 bits, 3 UUIDs v4) e mora em **Script Properties** —
   nunca vai para o frontend nem para a planilha (que é pública). Ninguém consegue forjar tokens.

**Defesas combinadas (em profundidade):**
- Janela curta derrota o **screenshot/print** deixado na tela e o reenvio tardio.
- **Anti-duplicidade** (CPF+aula) derrota o mesmo aluno marcando duas vezes (e limita o reuso
  de um token capturado dentro da janela).
- A página do instrutor **renova o QR sozinha** e mostra uma barra de contagem; nada de código fixo na tela.

**Duração como controle:** a duração escolhida pelo instrutor é o equilíbrio segurança × conveniência —
ex.: **2 min num congresso** dá tempo do público escanear e ainda gira o código. É o **meio-termo**
entre o estático (zero proteção, qualquer um reusa o print) e janelas curtas demais (expira antes de a
pessoa abrir a câmera).

**Modo avaliação:** existe a flag `ALLOW_STATIC` (padrão `true`) que também aceita um QR estático,
para o avaliador escanear um código fixo sem cronômetro. Em produção, `ALLOW_STATIC=false` força só o
rotativo. Há ainda `ENFORCE_TOKEN` para abrir/fechar a exigência.

**Outras camadas possíveis (não implementadas, citadas como evolução):** vincular ao intervalo
real de horário da aula; conferência de geolocalização/IP; *short-link* com expiração; exigir
login Google. O rotativo já entrega o essencial do bônus sem fricção para o aluno.

## Privacidade / LGPD
- **Consentimento explícito e bloqueante:** o botão de registrar fica **desabilitado** até o
  aceite, e o backend **recusa** o registro sem `consent = true`. O aviso traz **base legal**
  (consentimento, art. 7º, I), **finalidade**, **retenção** e **contato do encarregado (DPO)**.
- **Minimização:** coletamos só nome, CPF e e-mail — **não** guardamos `userAgent`/IP.
- **Mascaramento no servidor:** `listarPresencas` devolve o CPF **mascarado** (`•••.•••.789-09`)
  por padrão; o CPF completo só sai com a `ADMIN_KEY` correta. Não é “esconder no cliente”.
- `consultarCertificado` é **só por CPF** (sem busca por nome) para não permitir associar
  nome→CPF de terceiros. CPF coletado **sem validar dígitos** (conforme a tarefa).
- A tela de presença avisa que é **ambiente de avaliação** (usar dados fictícios). A planilha
  pública contém **apenas dados fictícios**; em produção seria privada e com CPF tokenizado.

## Modo demonstração
Enquanto `WEB_APP_URL` não está configurado (ou `config.js → DEMO: true`), o `api()` roteia para
um **backend em memória** (`demoApi`) com os mesmos dados de exemplo e o mesmo contrato. Resultado:
a comissão abre o site **sem nenhum deploy** e vê tudo funcionando (admin populado, certificado
emitindo/negando, verificação), com um selo discreto “modo demonstração” e status no rodapé. Ao
colar a URL real, o site passa a usar o Sheets — sem mudar nenhuma outra linha.

## Verificação de certificado
O rodapé do certificado traz um **código** determinístico (`MILES-2026-XXXXXX`) derivado do CPF —
o **mesmo algoritmo** no frontend e no backend. A página `verificar.html` chama
`verificarCertificado(codigo)`, que recomputa o código de cada CPF, confirma a elegibilidade e
devolve **nome + aulas + CPF mascarado**. Fecha o ciclo: o “código de verificação” realmente verifica.

## Contrato de erro
Por limitação do `ContentService`, **toda resposta sai como HTTP 200**; o sucesso/erro de negócio
vai no campo `ok` (e `status`/`erro`) do corpo JSON. O `api()` trata por `ok`, não por status HTTP.

## Hardening & acessibilidade
- **Headers (Netlify):** `Content-Security-Policy` (script/style/connect restritos), `HSTS`,
  `Permissions-Policy` (câmera/geo/microfone desligados), `X-Frame-Options`, `X-Content-Type-Options`.
- **Acessibilidade:** foco visível por teclado (`:focus-visible`), `aria-live` em mensagens,
  modal LGPD com `role="dialog"` + Esc + gestão de foco, rótulos/`aria-*`, contraste AA, `prefers-reduced-motion`.

## Limitações conhecidas
- Sheets/Apps Script têm cotas; adequado para o porte de um seminário, não para milhares de
  req/s.
- “Mesmo aluno” é definido por CPF; não há verificação de identidade real (fora do escopo).
- O relógio do token depende do horário do servidor Google (confiável) e tolera a latência do
  escaneamento via janela anterior.
