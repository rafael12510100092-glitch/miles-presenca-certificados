# Modelo da planilha (Google Sheets)

A planilha é o banco de dados. As duas abas abaixo são criadas automaticamente pela função
`setup()` do Apps Script — você **não precisa** montá-las à mão.

## Aba `Aulas`
Configuração das 4 aulas do seminário.

| aulaId | titulo | data |
|:------:|--------|------|
| 1 | Aula 1 — Inovação e Liderança em Saúde | *(opcional)* |
| 2 | Aula 2 — Gestão de Times Clínicos de Alta Performance | |
| 3 | Aula 3 — Empreendedorismo e Modelos de Negócio em Saúde | |
| 4 | Aula 4 — Transformação Digital e o Futuro do Cuidado | |

- **aulaId** — número de 1 a 4; é o que vai **embutido no QR Code**.
- **titulo** — texto exibido nas telas e no certificado.
- **data** — opcional; só informativo.

## Aba `Presencas`
Uma linha por presença registrada. Chave lógica de unicidade: **`cpf` + `aulaId`**.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | texto (UUID) | Identificador único da linha. |
| `timestamp` | ISO 8601 | Momento do registro, no fuso `America/Sao_Paulo` (gravado com `Utilities.formatDate`). |
| `aulaId` | número 1–4 | Aula correspondente. |
| `nomeCompleto` | texto | Nome informado pelo aluno. |
| `cpf` | texto (11 díg.) | Só dígitos, guardado como texto (preserva zeros à esquerda). |
| `email` | texto | E-mail informado. |
| `consentimentoLGPD` | booleano | `TRUE` — registro só ocorre com consentimento. |
| `origemToken` | texto | `rotativo` · `estatico` · `aberto` (como o QR foi validado). |

> **Minimização (LGPD):** coletamos só o necessário. Não guardamos `userAgent`/IP nem outros
> metadados — apenas nome, CPF, e-mail e a aula.

### Por que CPF como texto
Um CPF começando com `0` perderia o zero se fosse número. O backend grava `'<digitos>`
(apóstrofo inicial força o Sheets a tratar como texto).

### Regras de negócio que tocam a planilha
- **Anti-duplicidade:** antes de inserir, varre-se `Presencas` por `cpf+aulaId`.
- **Elegibilidade (Projeto 2):** conta `aulaId` **distintos** por `cpf`; `≥ 3` ⇒ certificado.
- **Concorrência:** inserção protegida por `LockService` para não duplicar em cliques simultâneos.

## Dados de exemplo (`semearExemplos`)
| Nome | CPF | Aulas | Resultado |
|------|-----|:-----:|-----------|
| Ana Souza Lima | 111.111.111-11 | 1, 2, 4 | ✓ elegível (3/4) |
| Bruno Costa Pereira | 222.222.222-22 | 1, 3 | ✕ negado (2/4) |
| Carla Mendes Rocha | 333.333.333-33 | 1, 2, 3, 4 | ✓ elegível (4/4) |

> São CPFs **fictícios** (todos os dígitos iguais) — propositalmente inválidos, seguros para
> uma planilha pública de avaliação.
