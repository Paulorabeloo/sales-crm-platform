# BUGS: QA final (E2E rodada 2, funil novo)

Suíte: 30 testes / 30 passando em 2 execuções completas consecutivas, sem
flaky (retries = 0 nas duas). Rodada anterior (2026-08-28, funil antigo):
18/18.

## Bugs reais encontrados NESTA rodada (todos corrigidos)

1. 🟡 **`GET /deals/recoverable` não excluía deals já reabertos.**
   Repro: perder lead com motivo recuperável → ativar ciclo novo → "Reabrir no
   ciclo atual" → o lead antigo CONTINUAVA na aba Resgate e no badge do menu
   para sempre (dava para reabrir de novo, gerando duplicatas).
   Fix (backend): `NOT EXISTS` de activity `reopened_in_cycle` na query de
   `03-backend/app/api/deals.py` (`recoverable_deals`). Coberto por pytest
   (`tests/test_rescue.py::test_reopened_deal_leaves_recoverable_list`) e pelo
   E2E `13-resgate`.

2. 🟡 **Quick log não contava como 1º contato, então o lead nunca saía de
   "Responder agora".**
   Repro: lead novo no Meu Dia → "Registrar contato → Sem resposta" + agendar
   D+1 → o lead permanecia em "Responder agora" (a seção só olhava
   `first_whatsapp_contact_at`, que o quick log não gravava). Contradiz o the spec ("registra contato + agenda D+1 → some de Responder agora"): uma
   tentativa registrada É o primeiro toque do consultor.
   Fix (backend): o primeiro quick log de um deal sem 1º contato registra
   `first_whatsapp_contact_at` (write-once, activity `first_contact_registered`
   com `payload.via = "quick_log"`) em
   `03-backend/app/services/deals.py::quick_log`. Coberto por pytest
   (`tests/test_followup.py::test_quick_log_registers_first_contact_and_leaves_respond_now`)
   e pelo E2E `09-meu-dia`.

3. 🟢 **Prompt de próximo contato morria junto com a linha do Meu Dia.**
   Consequência direta do fix 2: `useQuickLog` invalidava `["my-day"]` na
   hora, o refetch removia a linha de "Responder agora" e desmontava o
   componente que hospeda o prompt encadeado: o prompt piscava e sumia antes
   do clique.
   Fix (frontend): a invalidação de `["my-day"]` foi movida para o FECHAMENTO
   do prompt (e para o sucesso do dialog de visita, que não encadeia prompt)
   em `04-frontend/src/components/deals/quick-log.tsx` +
   `04-frontend/src/hooks/mutations.ts` (`useQuickLog`). A lista continua
   fresca; o prompt sobrevive.

## Observações menores (🟢) não corrigidas nesta rodada

1. 🟢 **Mesmo padrão de desmonte no botão WhatsApp do Meu Dia.** O fluxo
   "Registrar e abrir" do `WhatsAppButton` (registrar 1º contato a partir da
   linha do Meu Dia) invalida `["my-day"]` imediatamente
   (`useRegisterFirstContact` → `invalidateDeal`); o prompt encadeado desse
   caminho pode desmontar da mesma forma quando o lead sai da seção. Baixo
   impacto (o caminho principal é o quick log, já corrigido); se incomodar,
   aplicar o mesmo padrão de invalidação adiada.

2. 🟢 **Negociação criada pelo admin sempre nasce sem responsável** (rodada
   anterior, mantido): o dialog não tem campo "Responsável", então o admin
   precisa de um clique extra em "Assumir".

3. 🟢 **CPF inválido no gate devolve `validation_error` genérico** ("Confira
   os campos informados") em vez de mensagem específica do campo (observação
   da onda 2 frontend, mantida).

## Pendências pré-existentes (fora do escopo desta rodada)

Já documentadas nas notas de integração (não re-testadas como bug):
- `PATCH /deals/{id}` ignora `null` (não dá pra limpar valor/unidade/dono),
  exceto `next_contact_at`/`objection_id`/`deadline_on`, que já aceitam null
  explícito;
- `reports/response-time|sales|cooling` não filtram por unidade/consultor;
- busca do kanban é client-side;
- KPIs de relatórios usam fuso UTC (deals criados ~23h locais caem no dia
  seguinte; Minor 4 do review da fase 1).
