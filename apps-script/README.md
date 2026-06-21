# Backend — Google Apps Script

Este é o backend **único** dos dois projetos (presença + certificados), rodando
como um **App da Web** do Google Apps Script, vinculado à planilha do Google Sheets
que funciona como banco de dados.

## Arquivos
- `Codigo.gs` — todo o backend (roteador `doGet`/`doPost`, `setup()`, ações).
- `appsscript.json` — manifesto (fuso `America/Sao_Paulo`, acesso do App da Web).

## Publicar (passo a passo)

1. Crie uma planilha em branco no Google Sheets.
2. **Extensões → Apps Script**.
3. Apague o conteúdo padrão e cole o conteúdo de `Codigo.gs`.
4. (Opcional, recomendado) No editor, clique na engrenagem **Configurações do projeto →
   "Mostrar o arquivo de manifesto appsscript.json"** e cole o `appsscript.json` deste diretório.
5. Selecione a função **`setup`** na barra superior e clique **Executar**. Autorize quando pedir.
   - Isso cria as abas `Aulas` e `Presencas`, semeia as 4 aulas e gera o segredo HMAC
     em *Script Properties* (nunca na planilha pública).
6. **Implantar → Nova implantação → tipo: App da Web**:
   - **Executar como:** Eu (o dono).
   - **Quem tem acesso:** **Qualquer pessoa**.
7. Copie a **URL do App da Web** (termina em `/exec`) e cole em `site/config.js` (`WEB_APP_URL`).

> Ao alterar o `Codigo.gs`, use **Implantar → Gerenciar implantações → editar (lápis) →
> Nova versão** para publicar a mudança na mesma URL.

## Funções úteis (rodar no editor)
- `setup()` — prepara tudo (idempotente; pode rodar de novo sem perder dados).
- `semearExemplos()` — **recomendado para avaliação**: insere 3 alunos fictícios (Ana 3/4 ✓, Bruno 2/4 ✕, Carla 4/4 ✓).
- `runTests()` — roda a suíte de testes (token, dedup, elegibilidade, código). Veja ✓/✕ em **Execuções/Logs**.
- `limparPresencas()` — apaga as presenças (mantém a estrutura).

## E-mail dos certificados (MailApp)
O envio sai do **Gmail da conta que publicou o script** (com nome de exibição “Instituto MILES”).
Na **primeira execução** o Google pede autorização para enviar e-mail. Cota: ~**100 destinatários/dia**
no Gmail comum (mais no Workspace). Para enviar em massa pelo painel, defina a Script Property `ADMIN_KEY`.

## Flags (Script Properties)
| Chave | Padrão | Efeito |
|------|--------|--------|
| `ENFORCE_TOKEN` | `true` | Exige token válido no QR para registrar presença. `false` = modo aberto. |
| `ALLOW_STATIC`  | `true` | Aceita também o QR estático (cômodo para avaliação). **Em produção real, use `false`** para forçar só o rotativo. |
| `ADMIN_KEY`     | (vazio) | Se definido, o painel só mostra o **CPF completo** quando essa chave é enviada (`adminKey`). Sem ela, o CPF sai sempre **mascarado**. |
| `SECRET`        | (gerado) | Segredo HMAC que assina os tokens. **Não exponha.** |

Edite em **Configurações do projeto → Propriedades do script**.

## Contrato de erro
Por limitação do `ContentService`, **toda resposta sai como HTTP 200**; sucesso/erro de negócio é
sinalizado pelo campo `ok` (e `status`/`erro`) no corpo JSON. O frontend trata por `ok`, não por status HTTP.

## Ações da API (POST com corpo JSON `{ "action": "...", ... }`)
| Ação | Entrada | Retorno |
|------|---------|---------|
| `emitirToken` | — | tokens rotativos + estáticos de todas as aulas |
| `registrarPresenca` | `aulaId, nome, cpf, email, consent, token` | `status: registrada \| duplicada \| token \| invalido \| consentimento` |
| `consultarCertificado` | `cpf` | elegibilidade + dados do certificado + `codigo` |
| `verificarCertificado` | `codigo` (MILES-2026-XXXXXX) | autenticidade (nome, aulas, CPF mascarado) |
| `enviarMeuCertificado` | `cpf, siteUrl` | envia o certificado do aluno por e-mail (se elegível) |
| `enviarCertificadosElegiveis` | `adminKey, siteUrl` | envia a todos os elegíveis (requer ADMIN_KEY) |
| `listarPresencas` | `adminKey` (opcional) | agregação por aluno + métricas (CPF mascarado por padrão) |
| `listarAulas` | — | títulos das 4 aulas |

> Privacidade: `consultarCertificado` é **só por CPF** (não busca por nome, para não associar
> nome→CPF de terceiros); `listarPresencas` mascara o CPF **no servidor**.
