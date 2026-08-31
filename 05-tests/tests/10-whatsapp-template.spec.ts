import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { loginUI, openedUrls, stubWindowOpen } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

// Primeiro nome entra na variável {{first_name}} do template.
const LEAD_NAME = `Wpp Template${RUN_ID}`;

test.describe("Templates de mensagem no botão WhatsApp (spec 09.4)", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;
  let phone: string;

  test.beforeAll(async ({ browser }) => {
    phone = uniquePhone();
    page = await browser.newPage();
    // Intercepta window.open ANTES de navegar (o stub vale pra página toda).
    await stubWindowOpen(page);
    await loginUI(page, E2E_ADMINS.whatsapp, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.whatsapp, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    const deal = await api.createDeal({
      title: LEAD_NAME,
      phone,
      ownerId: me.id,
      interestCourse: "Enfermagem",
    });
    dealId = deal.id;
    // 1º contato já registrado: o clique não abre o diálogo de registro.
    await api.registerFirstContact(dealId);
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("dropdown de templates renderiza as variáveis no href do wa.me", async () => {
    await page.goto(`/negociacoes/${dealId}`);

    // Com templates ativos (3 do seed) o botão vira dropdown.
    await page
      .getByRole("button", { name: "Abrir WhatsApp" })
      .first()
      .click();
    await expect(
      page.getByText("Enviar com mensagem pronta"),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Primeiro contato" }).click();

    // window.open interceptado: URL wa.me com o telefone e o texto renderizado.
    const urls = await openedUrls(page);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(url.hostname).toBe("wa.me");
    // Telefone normalizado 55 + dígitos (sem "+").
    expect(url.pathname).toBe(`/55${phone}`);
    const text = url.searchParams.get("text");
    expect(text).not.toBeNull();
    // Template seed: "Olá {{first_name}}! Vi seu interesse em {{course}}..."
    expect(text).toContain(`Olá ${LEAD_NAME.split(" ")[0]}!`);
    expect(text).toContain("Enfermagem");
    // Variável sem valor ({{unit}} — deal sem unidade) vira string vazia,
    // nunca o placeholder cru.
    expect(text).not.toContain("{{");

    // "Sem mensagem" mantém o comportamento antigo (href sem ?text=).
    await page
      .getByRole("button", { name: "Abrir WhatsApp" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Sem mensagem" }).click();
    const urlsAfter = await openedUrls(page);
    expect(urlsAfter).toHaveLength(2);
    expect(urlsAfter[1]).toBe(`https://wa.me/55${phone}`);
  });
});
