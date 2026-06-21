# 🚀 Tutorial de deploy — passo a passo detalhado

Guia completo para colocar o projeto no ar do zero. Tempo estimado: **~20 minutos**.
Não precisa saber programar — é seguir na ordem.

> **Onde cada coisa vai morar:**
> - **Planilha** (Google Sheets) = banco de dados.
> - **Apps Script** (dentro da planilha) = backend (a “lógica”).
> - **GitHub** = guarda o código (repositório público).
> - **Netlify** = publica o site (a parte que as pessoas abrem).

---

## O que você vai precisar
- Uma **conta Google** (a mesma vai hospedar a planilha + o backend + enviar os e-mails).
- Uma conta no **GitHub** → https://github.com/signup
- Uma conta no **Netlify** → https://app.netlify.com/signup (pode entrar com o próprio GitHub).

> 💡 **Dica importante:** o site já funciona em **modo demonstração** sem nada disso. Se você só quer
> ver funcionando, pule para a [Parte 4](#parte-4--publicar-no-netlify) e publique direto — ele abre
> com dados fictícios. As Partes 1 a 3 são para ter o sistema **real**, gravando presenças de verdade.

---

## Parte 1 — Criar a planilha (banco de dados)

1. Acesse https://sheets.google.com e crie uma **planilha em branco**.
2. Dê um nome a ela (ex.: `MILES — Presenças`).
3. **Não precisa criar abas nem colunas** — o backend faz isso sozinho no próximo passo.

---

## Parte 2 — Configurar o backend (Google Apps Script)

### 2.1 — Colar o código
1. Com a planilha aberta, vá em **Extensões → Apps Script** (abre uma nova aba).
2. Apague qualquer código que aparecer no editor (o `function myFunction() {}`).
3. Abra o arquivo [`apps-script/Codigo.gs`](../apps-script/Codigo.gs) deste projeto, **copie tudo** e cole no editor.
4. Clique no ícone de **disquete (Salvar)**, ou `Ctrl+S`.

### 2.2 — Preparar as abas e o segredo
1. No topo do editor, no seletor de função (ao lado do botão ▶ Executar), escolha **`setup`**.
2. Clique em **▶ Executar**.
3. Na primeira vez o Google pede autorização:
   - Clique em **Revisar permissões** → escolha sua conta Google.
   - Vai aparecer “**O Google não verificou este app**”. Isso é normal (o app é seu).
     Clique em **Avançado → Acessar [nome do projeto] (não seguro)** → **Permitir**.
4. Pronto. Isso cria as abas `Aulas` e `Presencas`, semeia as 4 aulas e gera o segredo de segurança.

### 2.3 — (Recomendado) inserir dados de demonstração
1. No seletor de função, escolha **`semearExemplos`** → **▶ Executar**.
2. Isso insere 3 alunos fictícios (Ana 3/4 ✓, Bruno 2/4 ✕, Carla 4/4 ✓) para você testar.

> Para conferir que está tudo certo, rode também **`runTests`** — abra **Execuções** (menu lateral) ou
> os **Logs** e veja os “✓” de cada teste.

### 2.4 — Publicar como App da Web
1. No canto superior direito: **Implantar → Nova implantação**.
2. Clique na engrenagem ⚙ ao lado de “Selecionar tipo” → escolha **App da Web**.
3. Preencha:
   - **Descrição:** qualquer coisa (ex.: `v1`).
   - **Executar como:** **Eu (seu@email.com)**.
   - **Quem pode acessar:** **Qualquer pessoa**.  ⚠️ (precisa ser “Qualquer pessoa”, não “com conta Google”).
4. Clique em **Implantar** → autorize de novo se pedir.
5. **Copie a “URL do app da Web”** — ela termina em **`/exec`**. Guarde, você vai usar na Parte 3.

> 🔁 **Se mudar o `Codigo.gs` depois:** vá em **Implantar → Gerenciar implantações → ✏️ (editar) →
> Versão: Nova versão → Implantar**. A URL continua a mesma.

---

## Parte 3 — Conectar o site ao backend (sair do modo demo)

Esta é a parte que **tira o site do modo demonstração**.

1. Abra o arquivo [`site/config.js`](../site/config.js) num editor de texto.
2. Localize a primeira linha de configuração:

```js
WEB_APP_URL: "COLE_AQUI_A_URL_DO_APPS_SCRIPT",
```

3. **Substitua** `COLE_AQUI_A_URL_DO_APPS_SCRIPT` pela URL `/exec` que você copiou na Parte 2.4.
   Deve ficar assim (com a sua URL):

```js
WEB_APP_URL: "https://script.google.com/macros/s/AKfycb.../exec",
```

4. Confira que a linha de baixo está como `DEMO: false` (já vem assim).
5. Salve o arquivo.

> **Como saber se saiu do demo?** Quando o site abrir, o **rodapé da página inicial** mostra:
> - 🟡 **“Modo demonstração”** = ainda está sem backend (URL não preenchida).
> - 🟢 **“Backend online”** = conectado ao seu Apps Script. ✅
> - 🔴 **“Backend offline”** = a URL está preenchida mas algo está errado (veja [Problemas](#problemas-comuns)).
>
> Para **forçar** o modo demonstração mesmo com a URL preenchida (ex.: deixar uma demo pública), mude
> `DEMO: false` para `DEMO: true`.

---

## Parte 4 — Publicar no Netlify

Há dois caminhos. O **A** (via GitHub) é o recomendado para a entrega. O **B** é o atalho.

### Caminho A — via GitHub (recomendado)

**4A.1 — Subir o código para o GitHub:**

Crie um repositório **público vazio** em https://github.com/new (ex.: `miles-presenca-certificados`).
**Deixe TUDO desmarcado** — sem README, sem .gitignore, sem licença (o projeto já tem os seus). Depois,
no terminal dentro da pasta do projeto, rode os comandos abaixo **um por linha** (troque `SEU_USUARIO`):

```bash
cd miles-presenca-certificados
git init
git add .
git commit -m "MILES — presenca por QR Code + gerador de certificados"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/miles-presenca-certificados.git
git push -u origin main
```

> Por que o repositório precisa estar **vazio**? Os comandos acima já criam o primeiro commit. Se você
> marcar “Add a README/.gitignore/license”, o repositório nasce com um commit e o `git push` falha com
> `rejected — fetch first`.

**4A.2 — Conectar no Netlify:**
1. Em https://app.netlify.com → **Add new site → Import an existing project**.
2. Escolha **GitHub** e autorize → selecione o repositório.
3. Nas configurações de build, confirme:
   - **Publish directory:** `site`
   - **Build command:** *(deixe vazio — é um site estático)*
   - *(o arquivo `netlify.toml` já define isso automaticamente)*
4. Clique em **Deploy**. Em ~1 minuto o site fica no ar numa URL tipo `https://nome-aleatorio.netlify.app`.
5. *(Opcional)* **Site configuration → Change site name** para escolher um endereço melhor.

> Toda vez que você der `git push`, o Netlify republica sozinho.

### Caminho B — arrastar a pasta (sem GitHub)
1. Acesse https://app.netlify.com/drop
2. Arraste a pasta **`site`** para a área indicada. Pronto, fica no ar na hora.
   *(Mas para a entrega você vai precisar do GitHub público de qualquer forma.)*

---

## Parte 5 — Ajustes opcionais (recomendados)

### 5.1 — Liberar o envio de certificados por e-mail / CPF completo no painel
1. Volte ao editor do **Apps Script** → ⚙ **Configurações do projeto** → role até **Propriedades do script**.
2. Clique em **Adicionar propriedade do script**:
   - **Propriedade:** `ADMIN_KEY`  ·  **Valor:** uma senha sua (ex.: `miles2026`).
3. Salve. Agora, no painel (`admin.html`), o botão **“Enviar aos elegíveis”** e o **“mostrar CPF”**
   pedem essa chave.

> **De qual e-mail os certificados são enviados?** Do **Gmail da conta que publicou o Apps Script**
> (com o nome “Instituto MILES”). Cota: ~100 destinatários/dia no Gmail comum.

### 5.2 — Forçar só o QR rotativo (produção real)
Em **Propriedades do script**, mude `ALLOW_STATIC` para `false`. Isso desativa o QR estático e força só
o rotativo (mais seguro). Deixe `true` enquanto estiver demonstrando para a banca.

---

## ✅ Teste final (2 minutos)
Com tudo no ar (rodou `setup` + `semearExemplos`):
1. Abra o site → o rodapé deve dizer 🟢 **Backend online**.
2. **Presença · QR** → modo *Estático* → clique em “abrir no navegador” na Aula 1 → preencha → registra.
3. **Certificado** → CPF `111.111.111-11` (Ana, 3/4 → **emite**) · `222.222.222-22` (Bruno, 2/4 → **nega**).
4. **Verificar** → cole o código do certificado → “certificado autêntico”.
5. **Painel** → veja os totais, % de conclusão e presenças por aula.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Rodapé 🔴 **Backend offline** | URL errada ou implantação não é “Qualquer pessoa” | Refaça a Parte 2.4 conferindo o acesso; cole a URL `/exec` certinha |
| “Backend offline” mas a URL está certa | Você editou o `Codigo.gs` e não republicou | **Gerenciar implantações → Nova versão** |
| CPF `333...` dá “não encontrado” | Você não rodou `semearExemplos` | Rode `semearExemplos` no editor do Apps Script |
| Site abre 🟡 **Modo demonstração** sem querer | `WEB_APP_URL` ainda com o placeholder | Cole a URL real no `config.js` (Parte 3) |
| E-mail não envia | Faltou autorizar o envio / sem `ADMIN_KEY` | Rode qualquer função uma vez e autorize; defina `ADMIN_KEY` (5.1) |
| QR não aparece | Lib não carregou | Já vem embutida em `assets/vendor/` — confirme que a pasta subiu ao Netlify |

---

Qualquer detalhe técnico adicional está em [`ARQUITETURA.md`](ARQUITETURA.md) e
[`../apps-script/README.md`](../apps-script/README.md).
