import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import {
  dealCard,
  dragCardToColumn,
  kanbanColumn,
  kanbanFilterTrigger,
  leadQueue,
  loginUI,
  resolveNextContactPrompt,
  selectOption,
  toast,
} from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const LEAD_NAME = `Lead Fluxo ${RUN_ID}`;

interface KanbanCard {
  id: string;
  contact_name: string;
}
interface KanbanStage {
  name: string;
  deals: KanbanCard[];
}

test.describe("Fluxo do lead (caminho crítico, funil novo)", () => {
  let page: Page;
  let api: ApiClient;
  let phone: string;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    phone = uniquePhone();
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.leadFlow, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.leadFlow, E2E_ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("admin cria negociação e assume; card aparece em Novo lead", async () => {
    await page.goto("/negociacoes");
    await page.getByRole("button", { name: "Criar negociação" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome do lead").fill(LEAD_NAME);
    await dialog.getByLabel("WhatsApp").fill(phone);
    await dialog.getByLabel("Curso de interesse").fill("Direito");
    await dialog.getByLabel("Valor (R$)").fill("450");
    await selectOption(page, dialog.getByRole("combobox").first(), "Unidade 2");
    await dialog
      .getByRole("button", { name: "Criar negociação", exact: true })
      .click();
    await expect(toast(page, "Negociação criada.")).toBeVisible();

    // Negociação criada pelo admin nasce SEM dono -> cai na fila de novos leads.
    const queue = leadQueue(page);
    await expect(queue).toBeVisible();
    const queued = dealCard(queue, LEAD_NAME);
    await expect(queued).toBeVisible();
    await expect(queued).toContainText("Direito");

    // Admin assume -> o card vai pra 1ª etapa do funil novo ("Novo lead").
    await queued.getByRole("button", { name: "Assumir" }).click();
    await expect(toast(page, "Negociação assumida!")).toBeVisible();
    const card = dealCard(kanbanColumn(page, "Novo lead"), LEAD_NAME);
    await expect(card).toBeVisible();
    // Sem contato futuro agendado -> badge de atenção no card.
    await expect(card.getByText("Sem próximo passo", { exact: true })).toBeVisible();

    // Guarda o id pro resto do fluxo (via API, mesma visão do kanban).
    const kanban = await api.get<{ stages: KanbanStage[] }>("/deals/kanban");
    const found = kanban.stages
      .flatMap((s) => s.deals)
      .find((d) => d.contact_name === LEAD_NAME);
    expect(found, "deal criado deve aparecer no kanban da API").toBeTruthy();
    dealId = found!.id;
  });

  test("gate de campos: drag sem 1º contato abre 'Faltam campos para mover', preencher inline move e dispara o prompt", async () => {
    await page.goto("/negociacoes");
    const card = dealCard(kanbanColumn(page, "Novo lead"), LEAD_NAME);
    await expect(card).toBeVisible();

    // "Tentando contato" exige first_whatsapp_contact_at -> 422 vira dialog.
    await dragCardToColumn(page, card, kanbanColumn(page, "Tentando contato"));

    const gate = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Faltam campos para mover" }) });
    await expect(gate).toBeVisible();
    // (Com o modal aberto o fundo fica aria-hidden — o rollback do optimistic
    // update é validado implicitamente: o move real só acontece após salvar.)

    // Campo write-once vira switch "Registrar o 1º contato agora".
    await expect(gate.getByText("Registrar o 1º contato agora")).toBeVisible();
    const saveButton = gate.getByRole("button", { name: "Salvar e mover" });
    await expect(saveButton).toBeDisabled();
    await gate.getByRole("switch", { name: "1º contato no WhatsApp" }).click();
    await saveButton.click();

    // O move é repetido automaticamente e encadeia o prompt de próximo contato,
    // com "Amanhã" sugerido pela cadência (D+1).
    await expect(
      page.getByText(/Sugerido pela cadência: amanhã/),
    ).toBeVisible();
    await resolveNextContactPrompt(page, "Amanhã");
    await expect(toast(page, "Próximo contato agendado.")).toBeVisible();

    const moved = dealCard(kanbanColumn(page, "Tentando contato"), LEAD_NAME);
    await expect(moved).toBeVisible();
    await expect(moved.getByText(/Próximo: \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(moved.getByText(/1º contato \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

    // Persistiu no servidor (não é só o update otimista).
    await page.reload();
    await expect(
      dealCard(kanbanColumn(page, "Tentando contato"), LEAD_NAME),
    ).toBeVisible();
    const deal = await api.getDeal(dealId);
    expect(deal.first_whatsapp_contact_at).not.toBeNull();
    expect(deal.next_contact_at).not.toBeNull();
  });

  test("detalhe: 1º contato é write-once e o próximo passo aparece no header", async () => {
    await page.goto(`/negociacoes/${dealId}`);
    await expect(
      page.getByText(/1º contato \d{2}\/\d{2}\/\d{4}/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Registrar 1º contato" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Próximo: \d{2}\/\d{2}\/\d{4}/).first(),
    ).toBeVisible();
    // Playbook da etapa visível no detalhe.
    await expect(page.getByText("Guia desta etapa")).toBeVisible();
  });

  test("marcar perdida sem motivo é bloqueado; com motivo funciona", async () => {
    // Guard-rail também na API: perder sem motivo responde 422.
    const res = await api.postRaw(`/deals/${dealId}/lost`, {});
    expect(res.status()).toBe(422);

    await page.goto(`/negociacoes/${dealId}`);
    await page.getByRole("button", { name: "Marcar perdida" }).click();
    const dialog = page.getByRole("dialog");

    // Confirmar sem escolher motivo: bloqueado com mensagem, diálogo aberto.
    await dialog.getByRole("button", { name: "Confirmar perda" }).click();
    // exact: a descrição do diálogo também começa com essa frase.
    await expect(
      dialog.getByText("Informe o motivo da perda.", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    // Com motivo, funciona.
    await selectOption(page, dialog.getByRole("combobox"), "Sem resposta/sumiu");
    await dialog
      .getByLabel("Detalhes (opcional)")
      .fill("sumiu depois da proposta");
    await dialog.getByRole("button", { name: "Confirmar perda" }).click();
    await expect(toast(page, "Perda registrada.")).toBeVisible();
    await expect(page.getByText("Perdida", { exact: true }).first()).toBeVisible();
  });

  test("card perdido aparece no kanban com badge Perdida (filtro de status)", async () => {
    await page.goto("/negociacoes");
    // Perdidas saem do quadro por padrão — o filtro de status as traz de volta.
    await selectOption(page, kanbanFilterTrigger(page, "Status"), "Perdida");
    const card = dealCard(kanbanColumn(page, "Tentando contato"), LEAD_NAME);
    await expect(card).toBeVisible();
    await expect(card.getByText("Perdida", { exact: true })).toBeVisible();
  });
});
