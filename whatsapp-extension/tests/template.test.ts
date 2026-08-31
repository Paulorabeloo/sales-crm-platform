import { describe, expect, it } from "vitest";

import { renderTemplate } from "../src/lib/template";

describe("renderTemplate", () => {
  it("replaces the four contract variables", () => {
    const body =
      "Olá {{first_name}}! Sou {{consultant}} da unidade {{unit}} sobre o curso {{course}}.";
    expect(
      renderTemplate(body, {
        first_name: "Maria",
        consultant: "João",
        unit: "Centro",
        course: "Direito",
      }),
    ).toBe("Olá Maria! Sou João da unidade Centro sobre o curso Direito.");
  });

  it("replaces missing variables with an empty string (contract 14 §4.8)", () => {
    expect(renderTemplate("Olá {{first_name}}!", {})).toBe("Olá !");
  });

  it("replaces unknown variables with an empty string", () => {
    expect(renderTemplate("X {{whatever}} Y", { first_name: "A" })).toBe("X  Y");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Olá {{ first_name }}!", { first_name: "Maria" })).toBe("Olá Maria!");
  });

  it("leaves plain text untouched", () => {
    expect(renderTemplate("Sem variáveis aqui.", {})).toBe("Sem variáveis aqui.");
  });
});
