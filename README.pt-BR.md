[English](README.md) | **Português**

# Sales CRM

Um CRM de vendas multi-unidade para equipes que vendem por WhatsApp. Os leads
entram por um webhook público de captação, os consultores trabalham cada um
deles num funil kanban com travas por etapa e cadência de follow-up, e a gestão
recebe os relatórios que respondem a única pergunta que importa: por que não
estamos vendendo?

São duas aplicações e uma extensão de navegador:

- **API** (`03-backend`): FastAPI + PostgreSQL, com as invariantes do funil
  garantidas pelo próprio banco de dados.
- **Aplicação web** (`04-frontend`): Next.js 15 App Router, TypeScript strict.
- **Extensão Chrome** (`whatsapp-extension`): painel lateral em Manifest V3 que
  transforma uma conversa aberta no WhatsApp Web em lead do CRM.
- **Suíte E2E** (`05-tests`): Playwright rodando contra a stack real.

Código, commits e documentação técnica estão em inglês. A interface do produto
está em pt-BR, porque quem usa são consultores de vendas; cada texto vive num
único módulo tipado, sem framework de i18n.

## Stack

| Camada | Escolhas |
|---|---|
| API | Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), Alembic, Pydantic v2 |
| Banco | PostgreSQL 16, com triggers, constraints CHECK e índices únicos parciais |
| Autenticação | hash argon2id, access token JWT, refresh rotativo em cookie httpOnly, RBAC |
| Web | Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, componentes estilo shadcn/ui sobre Radix, TanStack Query, React Hook Form + Zod, dnd-kit, Recharts |
| Extensão | Chrome Manifest V3, TypeScript, esbuild, painel em shadow DOM, sem framework |
| Testes | pytest + httpx contra PostgreSQL real, Playwright para E2E, Vitest para as unidades da extensão |

## Arquitetura

- **O banco é a fonte da verdade das invariantes.** O histórico de etapas, o
  `last_activity_at` e o carimbo de primeiro contato (gravável uma única vez)
  são mantidos por triggers do PostgreSQL, de modo que nenhum caminho de código
  consegue corromper as métricas de funil. A API define `app.user_id` por
  transação para que as triggers saibam atribuir a autoria de cada mudança.
- **As migrations são o schema.** O Alembic é dono do DDL, triggers incluídas.
  O `02-schema/schema.sql` é um retrato histórico legível da revisão 0001,
  nunca uma fonte de provisionamento.
- **Fronteiras tipadas em todo lugar.** Todo corpo de requisição e resposta é
  um modelo Pydantic v2 no servidor e um schema Zod mais um cliente tipado na
  aplicação web. O bloco variável de dados da matrícula é JSONB validado com
  `extra="forbid"`.
- **O escopo é aplicado na query.** Consultores só selecionam as próprias
  negociações mais a fila sem dono; administradores enxergam tudo. A interface
  esconde o que um perfil não pode usar, mas quem garante é o servidor, em cada
  SELECT.
- **Routers finos, serviços de verdade.** Os routers validam e conectam; as
  transições, a ingestão do webhook, os relatórios e a autenticação vivem em
  `app/services`.
- **Envelope de erro consistente.** Toda falha responde
  `{"detail", "code", ...extras}`; a aplicação web traduz códigos estáveis para
  o texto da interface.
- **SPA autenticada no cliente.** Nenhum dado sensível renderizado no servidor.
  O access token fica em memória, o refresh em cookie httpOnly, e um retry
  single-flight reautentica quando aparece um 401.

## Funcionalidades

### Funil e travas por etapa

Funil de seis etapas. Cada etapa declara `required_fields` (colunas da
negociação, `contact.*` ou `enrollment.*`) e um roteiro (`playbook`). Entrar
numa etapa sem os campos dela responde 422 com a lista do que falta, e a regra
vale no arrastar do kanban, no botão explícito de marcar como vendida e na
criação de uma negociação direto numa etapa do meio. O quadro faz arrasto
otimista com rollback, mostra contagem e soma de valores por coluna e sinaliza
as negociações esfriando.

### Follow-up e cadência

Um `next_contact_at` por negociação, registro em um clique de cada tentativa ou
conversa (sem resposta, conversou e avançou, conversou e apareceu objeção,
visita agendada), modelos de mensagem de WhatsApp com `{{variáveis}}`, e uma
tarefa opcional de "fazer o primeiro contato" criada automaticamente para os
leads que chegam pelo webhook. O **Meu Dia** condensa tudo isso numa fila única
de trabalho: responder agora, vence hoje, atrasados, esfriando sem próximo
passo, mais as tarefas pendentes.

### Captação de leads

O `POST /webhooks/leads/{token}` não exige autenticação e usa um token por
fonte de lead. Ele valida nome e telefone, deduplica o contato pelo telefone em
formato E.164, cria a negociação sem dono na primeira etapa do ciclo de vendas
ativo e a direciona para uma unidade pelo nome. Token inválido e payload
inválido são as únicas razões de recusa, porque nenhuma falha de configuração
nossa deveria custar um lead capturado. Toda chamada é registrada crua em
`webhook_deliveries`, então uma landing page quebrada em silêncio vira algo
diagnosticável.

### Extensão Chrome

Um painel lateral recolhível no `web.whatsapp.com`. Com uma conversa aberta ele
extrai o telefone do interlocutor, procura no CRM e mostra o cartão do lead
(etapa, dono, próximo contato, atividades recentes, ações de registro rápido,
modelos de mensagem) ou um formulário de criar lead em um clique. Ela tem o
próprio fluxo de login (`?client=extension`), que emite um único access token de
12 horas sem canal de refresh, revogável por troca de senha. Um segundo
adaptador vem desligado por configuração, para que o painel possa ser apontado
para qualquer outra caixa de entrada web.

### Análises

Conversão do funil etapa a etapa (lida do `deal_stage_history`, não do estado
atual), ranking de motivos de perda com as principais objeções, tempo de
resposta até o primeiro contato por consultor (média, mediana, p90 e percentual
atendido em 24 horas), vendas por unidade, consultor ou mês, lista ao vivo de
negociações esfriando, desfechos de conversa por consultor, e o bloco de
aquisição: ciclos de vendas com rollover, investimento mensal por campanha,
**CAC** por fonte, campanha, unidade ou mês, e **metas** de matrícula por ciclo.
Os orçamentos mensais são rateados pelos dias que cada mês contribui ao período
pedido, e os custos voltam como `null` quando não há investimento lançado,
porque o relatório nunca inventa um número.

### Administração

Usuários criados pelo administrador, sem cadastro aberto (ADMIN e CONSULTOR),
unidades de negócio, funis e etapas, motivos de perda com marcação de
recuperável, fontes de lead com rotação e revogação de token, catálogo de
objeções, modelos de mensagem e o limite de dias para considerar uma negociação
esfriando. As perdas marcadas como recuperáveis alimentam uma lista de
**resgate**: um clique reabre o contato como negociação nova no ciclo ativo,
vinculada à antiga, de forma idempotente.

## Portões de qualidade

Tudo abaixo está verde na árvore commitada.

| Portão | Resultado |
|---|---|
| `pytest` (API, PostgreSQL real, sem banco mockado) | 82 passando |
| `playwright test` (E2E, stack completa) | 30 passando, sem instabilidade entre execuções consecutivas |
| `mypy` sobre todo o pacote `app` (`disallow_untyped_defs`) | 0 erros |
| `tsc --noEmit` (web e extensão, strict) | 0 erros |
| `eslint` (web) | 0 erros, 0 avisos |
| `vitest` (unidades da extensão) | 25 passando |

A suíte de testes da API roda contra uma instância real de PostgreSQL que é
derrubada e recriada a cada execução: triggers e constraints fazem parte do
sistema sob teste, então o banco nunca é mockado.

## Como rodar localmente

Pré-requisitos: Python 3.12+, Node.js 18+, Docker.

```bash
# 1. Banco de dados
cd 03-backend
docker compose up -d

# 2. API
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # Linux e macOS: .venv/bin/pip
cp .env.example .env                       # ajuste JWT_SECRET e ADMIN_PASSWORD
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.db.seeds
.venv/Scripts/python -m uvicorn app.main:app --port 8000
# documentacao interativa em http://127.0.0.1:8000/docs

# 3. Aplicação web (novo terminal)
cd 04-frontend
npm install
cp .env.example .env.local                 # NEXT_PUBLIC_API_URL
npm run dev                                # http://localhost:3000

# 4. Extensão Chrome (opcional)
cd whatsapp-extension
npm install && npm run build
# carregue whatsapp-extension/dist como extensão sem compactação em
# chrome://extensions e adicione o id chrome-extension:// gerado
# na variável EXTENSION_ORIGINS do .env da API

# 5. Suíte E2E (opcional, com os passos 1 a 3 no ar)
cd 05-tests
npm install && npx playwright install chromium
npx playwright test
```

O seed cria um administrador a partir do `.env`, o funil padrão de seis etapas
com as travas por etapa, os motivos de perda, o catálogo de objeções, os modelos
de mensagem e as unidades de exemplo. Nenhum dado real acompanha o repositório.

## Estrutura do repositório

```
02-schema/            retrato histórico da revisão 0001 (DDL + modelos), só documentação
03-backend/           serviço FastAPI
  app/
    core/             configurações, segurança, dependências, erros, rate limit, logs
    db/               sessão async, modelos SQLAlchemy, seeds idempotentes
    api/              um router fino por módulo
    schemas/          modelos Pydantic v2 para cada fronteira
    services/         regras de negócio: transições, webhook, relatórios, autenticação
  alembic/versions/   migrations, a fonte da verdade do schema
  tests/              pytest contra PostgreSQL real
04-frontend/          aplicação web Next.js 15
  src/app/            tela de login + área autenticada (kanban, Meu Dia, relatórios, configurações)
  src/components/     primitivos de UI, kanban, negociações, relatórios, configurações, auth
  src/hooks/          hooks do TanStack Query
  src/lib/            cliente de API tipado, schemas Zod, textos da interface, formatadores
05-tests/             suíte Playwright E2E + setup global
whatsapp-extension/   extensão Chrome MV3 (background, adaptadores de conteúdo, painel, popup)
```

## Decisões de projeto

**Invariantes pertencem ao banco, não a uma camada de serviço.** O histórico de
etapas, o `last_activity_at` e a gravação única do primeiro contato são triggers
e constraints. Um importador futuro, um administrador corrigindo dados na mão,
ou um segundo serviço escrevendo no mesmo schema herdam as garantias de graça, e
os relatórios de funil podem confiar no `deal_stage_history` em vez de recalcular
a partir do estado atual.

**JSONB para a parte variável, colunas para a parte estável.** Identidade da
negociação, dinheiro, propriedade e datas são colunas de verdade, com índices de
verdade. O bloco de dados da matrícula, que muda de formato conforme o negócio,
mora numa coluna JSONB validada por um modelo Pydantic com `extra="forbid"`.
Flexibilidade sem uma migration por campo customizado, e sem uma tabela do tipo
entidade-atributo-valor.

**As travas de etapa são validadas no servidor, em todos os caminhos.** Os
campos obrigatórios de uma etapa são dado, não código, e a checagem roda no
arrasto do kanban, no marcar como vendida e na criação direta numa etapa do
meio. O diálogo que a interface abre é uma conveniência; o contrato é o 422 com
a lista dos campos que faltam.

**O RBAC é aplicado na query.** Checagem de perfil no router é barata e fácil de
esquecer. O escopo é um predicado composto em cada SELECT, então um consultor
não consegue ler a negociação de outro nem por um filtro, nem por um relatório,
nem por um id digitado na mão. O redirecionamento no frontend é cosmético.

**O carimbo de primeiro contato é gravável uma única vez.** Tempo de resposta é
a métrica que um time comercial mais se tenta a melhorar editando o histórico. O
carimbo pode ser definido uma vez por qualquer caminho (botão de WhatsApp,
registro rápido, extensão); depois disso, só um administrador corrige, e a
correção fica registrada como atividade auditável.

## Licença

MIT. Veja [LICENSE](LICENSE).
