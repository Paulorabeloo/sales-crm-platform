/**
 * Message-template variable rendering (see the message-templates API contract).
 * The backend stores the raw body; the client replaces the variables.
 * Unknown or empty variables become an empty string, never the literal tag.
 */

export interface TemplateVars {
  first_name?: string;
  course?: string;
  unit?: string;
  consultant?: string;
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key];
    return value ?? "";
  });
}
