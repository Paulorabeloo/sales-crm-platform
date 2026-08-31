import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { loginUI, openSettingsTab, selectOption, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

// Nome dado pelo global-setup ao usuário deste spec (e2e-admin-12).
const MY_NAME = "Admin E2E 12";
// Fonte única por tentativa: um retry não colide com o lançamento anterior.
const SOURCE = `meta-${RUN_ID}`;

test.describe("CAC (spec 10.2) + metas (spec 10.3)", () => {
  let page: Page;
  let api: ApiClient;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.cacGoals, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.cacGoals, E2E_ADMIN_PASSWORD);
    const me = await api.me();

    // 1 lead da fonte SOURCE vendido no ciclo ativo (numerador do CAC) e
    // 1 lead sem fonte (linha "Sem atribuição" do relatório).
    const wonDeal = await api.createDeal({
      title: `CAC Meta ${RUN_ID}`,
      phone: uniquePhone(),
      ownerId: me.id,
      value: 800,
      source: SOURCE,
    });
    await api.markWonWithGate(wonDeal.id, 800);
    await api.createDeal({
      title: `CAC Sem Fonte ${RUN_ID}`,
      phone: `219${String(Date.now()).slice(-8)}`,
      ownerId: me.id,
    });

    // Retry-safety: remove uma meta minha deixada por uma tentativa anterior
    // (1 meta por alvo por ciclo — a criação pela UI daria 409).
    const cycle = await api.getActiveCycle();
    const goals = await api.get<Array<{ id: string; target_user_id: string | null }>>(
      "/goals",
      { cycle_id: cycle.id },
    );
    for (const goal of goals.filter((g) => g.target_user_id === me.id)) {
      await api.delete(`/goals/${goal.id}`);
    }
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("sem investimento o custo fica em branco; lançar spend calcula o custo por matrícula", async () => {
    // ANTES do lançamento: nada de custo fabricado na linha da fonte.
    await page.goto("/relatorios");
    const cacCard = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({
        has: page.getByRole("heading", { name: "CAC e custo por lead" }),
      });
    const metaRow = cacCard
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: SOURCE, exact: true }) });
    await expect(metaRow).toBeVisible();
    await expect(metaRow.getByText("sem investimento lançado")).toBeVisible();
    // Placeholder de valor vazio = token strings.common.none (meia-risca).
    await expect(metaRow).toContainText("–");

    // Lança R$ 1.000,00 na fonte no mês corrente.
    await openSettingsTab(page, "Investimento");
    await page.locator("#spend-source").fill(SOURCE);
    await page.locator("#spend-amount").fill("1.000,00");
    await page.getByRole("button", { name: "Lançar investimento" }).click();
    await expect(toast(page, "Investimento lançado.")).toBeVisible();
    await expect(page.getByRole("cell", { name: SOURCE, exact: true })).toBeVisible();

    // DEPOIS: custo por lead e por matrícula calculados na linha da fonte
    // (1 lead, 1 matrícula -> o mesmo valor nos dois). A verba mensal entra
    // rateada pelos dias do mês cobertos pelo período (M5), então o valor
    // exato depende do dia em que a suíte roda: o que se afirma é que existe
    // custo em reais, e que ele deixou de ser "sem investimento lançado".
    await page.goto("/relatorios");
    await expect(metaRow).toBeVisible();
    await expect(metaRow).toContainText(/R\$\s?\d/);
    await expect(metaRow.getByText("sem investimento lançado")).toHaveCount(0);

    // KPI "CAC médio" deixou de ficar em branco.
    const kpiCac = page
      .locator("div.p-4")
      .filter({ has: page.locator('p:text-is("CAC médio")') })
      .locator("p.tnum");
    await expect(kpiCac).toContainText("R$");

    // Lead sem fonte segue com custo em branco, nunca zero.
    const unattributedRow = cacCard.getByRole("row").filter({
      has: page.getByRole("cell", { name: "Sem atribuição", exact: true }),
    });
    await expect(unattributedRow).toBeVisible();
    await expect(
      unattributedRow.getByText("sem investimento lançado"),
    ).toBeVisible();
  });

  test("meta do consultor: progresso no kanban e ranking nos relatórios", async () => {
    await openSettingsTab(page, "Metas");

    // Tipo default = Consultor; seleciona o próprio usuário como alvo.
    // Comboboxes na ordem do form: ciclo (default ativo), tipo, alvo.
    await selectOption(page, page.getByRole("combobox").nth(2), MY_NAME);
    await page.getByLabel("Meta (matrículas)").fill("2");
    await page.getByRole("button", { name: "Criar meta" }).click();
    await expect(toast(page, "Meta criada.")).toBeVisible();
    await expect(page.getByRole("cell", { name: MY_NAME })).toBeVisible();

    // O progresso esperado vem do backend (retry pode ter vendas anteriores
    // no mesmo ciclo); na 1ª execução é 1 de 2.
    const progress = await api.get<{
      rows: Array<{ won_count: number; target_count: number; pct: number }>;
    }>("/goals/my-progress");
    expect(progress.rows).toHaveLength(1);
    const { won_count, target_count } = progress.rows[0];
    expect(target_count).toBe(2);
    expect(won_count).toBeGreaterThanOrEqual(1);

    // Kanban: barra discreta com o progresso do ciclo.
    await page.goto("/negociacoes");
    await expect(page.getByText("Sua meta do ciclo:")).toBeVisible();
    await expect(
      page.getByText(`${won_count} de ${target_count}`, { exact: true }),
    ).toBeVisible();

    // Relatórios: seção "Metas do ciclo" com o ranking do consultor.
    await page.goto("/relatorios");
    const goalsCard = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: page.getByRole("heading", { name: "Metas do ciclo" }) });
    await expect(goalsCard.getByText("Ranking de consultores")).toBeVisible();
    await expect(goalsCard.getByText(MY_NAME, { exact: true })).toBeVisible();
    await expect(goalsCard).toContainText(`${won_count}/${target_count}`);
  });
});
