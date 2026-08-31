import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import { E2E_ADMIN_PASSWORD, E2E_ADMINS, uniquePhone } from "./helpers/env";
import { loginUI } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const LOST_REASON = "Preço/mensalidade";

test.describe("Relatórios (admin)", () => {
  let page: Page;
  let api: ApiClient;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.reports, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.reports, E2E_ADMIN_PASSWORD);
    const me = await api.me();

    // Dados próprios do spec: 1 perdida (com 1º contato + motivo) e 1 vendida.
    const reasons = await api.listLostReasons();
    const reason = reasons.find((r) => r.label === LOST_REASON);
    if (!reason) throw new Error(`Lost reason "${LOST_REASON}" not seeded`);

    const lostDeal = await api.createDeal({
      title: "Relatório Perdida E2E",
      phone: uniquePhone(),
      ownerId: me.id,
      value: 300,
    });
    await api.registerFirstContact(lostDeal.id);
    await api.markLost(lostDeal.id, reason.id);

    const wonDeal = await api.createDeal({
      title: "Relatório Vendida E2E",
      phone: `219${String(Date.now()).slice(-8)}`,
      ownerId: me.id,
      value: 500,
    });
    // O won agora passa pelo gate da etapa Concluído (contrato + RA).
    await api.markWonWithGate(wonDeal.id, 500);
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("KPIs carregam com números, funil novo mostra as 6 etapas com legendas e motivos de perda listam o motivo usado", async () => {
    await page.goto("/relatorios");
    await expect(
      page.getByRole("heading", { name: "Relatórios" }),
    ).toBeVisible();

    // KPI cards não-vazios: o rótulo é o <p> uppercase e o valor é o <p
    // class="tnum text-2xl"> do mesmo CardContent.
    const kpiValue = (label: string) =>
      page
        .locator("div.p-4")
        .filter({ has: page.locator(`p:text-is("${label}")`) })
        .locator("p.tnum");
    await expect(kpiValue("Leads no período")).toHaveText(/[1-9]\d*/);
    await expect(kpiValue("Conversão geral")).toHaveText(/%/);
    await expect(kpiValue("Vendas")).toHaveText(/[1-9]/);
    await expect(kpiValue("Tempo médio de resposta")).not.toHaveText("…");
    // Sem investimento lançado o CAC NUNCA é fabricado: fica em branco.
    // O placeholder é o token strings.common.none (meia-risca, não travessão).
    await expect(kpiValue("CAC médio")).toHaveText("–");

    // Funil novo: 1ª e última etapas na tabela, com contagem e legenda
    // diagnóstica por transição.
    await expect(
      page.getByRole("heading", { name: "Funil de conversão" }),
    ).toBeVisible();
    const funnelRow = page.getByRole("row", { name: /Novo lead/ });
    await expect(funnelRow).toBeVisible();
    await expect(funnelRow).toContainText(/[1-9]/);
    await expect(page.getByRole("row", { name: /Concluído/ })).toBeVisible();
    await expect(
      page.getByText("Queda aqui: o 1º toque não está sendo feito"),
    ).toBeVisible();
    await expect(
      page.getByText("Queda aqui: fricção de documentos ou pagamento"),
    ).toBeVisible();

    // Motivos de perda: o motivo usado acima aparece no ranking.
    const lostCard = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({
        has: page.getByRole("heading", { name: "Motivos de perda" }),
      });
    await expect(lostCard.getByText(LOST_REASON, { exact: true })).toBeVisible();

    // Vendas: a venda registrada aparece na tabela.
    const salesCard = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: page.getByRole("heading", { name: "Vendas", exact: true }) });
    await expect(salesCard).toContainText(/R\$/);

    // Seção nova: sem próximo passo por consultor.
    await expect(
      page.getByRole("heading", { name: "Sem próximo passo por consultor" }),
    ).toBeVisible();
  });
});
