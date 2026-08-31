import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { dealCard, kanbanColumn, loginUI, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const DEAL_NAME = `Venda Ganha ${RUN_ID}`;

test.describe("Marcar vendida (gate do won + regressão B1 do prefill)", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.won, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.won, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    // R$ 500,00 de propósito: o bug B1 transformava o prefill "500,00"
    // confirmado sem edição em 50.000.
    const deal = await api.createDeal({
      title: DEAL_NAME,
      phone: uniquePhone(),
      ownerId: me.id,
      value: 500,
    });
    dealId = deal.id;
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("B1: confirmar o prefill sem editar mantém R$ 500 e o gate do won pede contrato + RA", async () => {
    await page.goto(`/negociacoes/${dealId}`);
    await page.getByRole("button", { name: "Marcar vendida" }).click();

    const dialog = page.getByRole("dialog");
    // Prefill em pt-BR vindo da API ("500.00" -> "500,00").
    await expect(dialog.getByLabel("Valor (R$)")).toHaveValue("500,00");
    // Confirma SEM editar (cenário exato do B1).
    await dialog.getByRole("button", { name: "Confirmar venda" }).click();

    // Gate do won: a etapa Concluído exige contrato assinado + RA.
    const gate = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Faltam campos para concluir" }),
    });
    await expect(gate).toBeVisible();
    await expect(gate.getByText("Precisa estar marcado para avançar.")).toBeVisible();
    await gate.getByRole("switch", { name: "Contrato assinado?" }).click();
    await gate.getByLabel("RA / matrícula gerada").fill(`RA-${RUN_ID}`);
    await gate.getByRole("button", { name: "Salvar e concluir" }).click();

    await expect(toast(page, "Matrícula registrada!")).toBeVisible();
    await expect(page.getByText("Vendida", { exact: true }).first()).toBeVisible();

    // O valor NÃO virou 50.000 (B1): API confirma 500.00.
    const deal = await api.getDeal(dealId);
    expect(deal.status).toBe("won");
    expect(Number(deal.value)).toBe(500);
    expect(deal.enrollment_data?.contract_signed).toBe(true);
    expect(deal.enrollment_data?.ra_number).toBe(`RA-${RUN_ID}`);
  });

  test("card vai para Concluído com badge verde e agregado correto", async () => {
    await page.goto("/negociacoes");
    const column = kanbanColumn(page, "Concluído");
    const card = dealCard(column, DEAL_NAME);
    await expect(card).toBeVisible();
    const badge = card.getByText("Vendida", { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/text-success/); // variante verde (success)
    // O agregado da coluna reflete R$ 500,00 — não R$ 50.000,00 (B1).
    await expect(column).toContainText("500,00");
    await expect(column).not.toContainText("50.000");
  });
});
