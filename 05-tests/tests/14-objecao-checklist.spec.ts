import { expect, test, type Locator, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { loginUI, resolveNextContactPrompt, selectOption, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const LEAD_NAME = `Lead Objeção ${RUN_ID}`;
const VALID_CPF = "52998224725"; // dígitos verificadores válidos

/** Field wrapper (label + control) inside the enrollment form. */
function labeledField(page: Page, label: string): Locator {
  return page
    .locator("div.flex.flex-col")
    .filter({ has: page.locator(`label:text-is("${label}")`) })
    .last();
}

test.describe("Objeção do catálogo + checklist de fechamento", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.objection, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.objection, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    const deal = await api.createDeal({
      title: LEAD_NAME,
      phone: uniquePhone(),
      ownerId: me.id,
      interestCourse: "Direito",
    });
    dealId = deal.id;
    await api.registerFirstContact(dealId);
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("quick log com objeção do catálogo mostra o contorno na hora e no detalhe", async () => {
    await page.goto(`/negociacoes/${dealId}`);
    await page
      .getByRole("button", { name: "Conversou, com objeção" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Qual foi a objeção?" }),
    ).toBeVisible();
    await selectOption(
      page,
      dialog.getByRole("combobox", { name: "Qual foi a objeção?" }),
      "Preço",
    );
    // Coaching na hora: o contorno do catálogo aparece no próprio dialog.
    await expect(dialog.getByText("Como contornar")).toBeVisible();
    await expect(dialog.getByText(/custo por dia/)).toBeVisible();
    await dialog.getByRole("button", { name: "Salvar objeção" }).click();
    await expect(toast(page, "Objeção registrada.")).toBeVisible();

    // Prompt de próximo contato encadeado (cadência) — dispensa.
    await resolveNextContactPrompt(page, "Sem próximo passo");

    // Card "Objeção principal" do detalhe: seleção + painel de contorno.
    const card = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: page.getByRole("heading", { name: "Objeção principal" }) });
    await expect(
      card.getByRole("combobox", { name: "Objeção principal" }),
    ).toContainText("Preço");
    await expect(card.getByText("Como contornar")).toBeVisible();
    await expect(card.getByText(/custo por dia/)).toBeVisible();

    // Backend: o quick log gravou o objection_id do catálogo no deal.
    const deal = await api.getDeal(dealId);
    expect(deal.objection_id).not.toBeNull();

    // Timeline com o label pt-BR do tipo novo.
    await expect(
      page.getByText("Conversou, com objeção", { exact: true }).last(),
    ).toBeVisible();
  });

  test("na etapa pré-won o checklist mostra N de M e completa ao preencher", async () => {
    // Leva o deal até "Fechamento em andamento" (gate: CPF) via API.
    const stages = await api.getStages();
    await api.mergeEnrollment(dealId, { cpf: VALID_CPF });
    await api.moveStage(dealId, stages["Fechamento em andamento"].id);

    await page.goto(`/negociacoes/${dealId}`);
    const checklist = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({
        has: page.getByRole("heading", { name: "Checklist para concluir" }),
      });
    await expect(checklist).toBeVisible();
    // Derivado dos required_fields da etapa Concluído (contrato + RA).
    await expect(checklist.getByText("0 de 2", { exact: true })).toBeVisible();
    await expect(checklist.getByText("Contrato assinado?")).toBeVisible();
    await expect(checklist.getByText("RA / matrícula gerada")).toBeVisible();

    // Clicar no item foca o campo correspondente do form de matrícula.
    await checklist
      .getByRole("button", { name: "Ir para o campo RA / matrícula gerada" })
      .click();
    await expect(page.locator("#ef-ra_number")).toBeFocused();

    // Preenche os dois campos pelo form de matrícula e salva.
    await page.locator("#ef-ra_number").fill(`RA-${RUN_ID}`);
    await selectOption(
      page,
      labeledField(page, "Contrato assinado?").getByRole("combobox"),
      "Sim",
    );
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(toast(page, "Dados da matrícula salvos.")).toBeVisible();

    // Checklist ao vivo: 2 de 2, itens riscados.
    await expect(checklist.getByText("2 de 2", { exact: true })).toBeVisible();

    // E o gate do won passa direto (sem dialog de campos faltando).
    await page.getByRole("button", { name: "Marcar vendida" }).click();
    const wonDialog = page.getByRole("dialog");
    await wonDialog.getByRole("button", { name: "Confirmar venda" }).click();
    await expect(toast(page, "Matrícula registrada!")).toBeVisible();
    const deal = await api.getDeal(dealId);
    expect(deal.status).toBe("won");
  });
});
