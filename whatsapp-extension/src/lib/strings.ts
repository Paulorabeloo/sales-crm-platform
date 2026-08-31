/**
 * pt-BR UI strings. Code and identifiers stay in English; every text a user
 * sees lives here. Rule: no em-dash in any string.
 */

export const STRINGS = {
  // General
  appName: "CRM Lead Capture",
  loading: "Carregando...",
  save: "Salvar",
  cancel: "Cancelar",
  close: "Fechar",
  retry: "Tentar novamente",
  copied: "Copiado!",
  copy: "Copiar",
  errorGeneric: "Algo deu errado. Tente novamente.",
  errorNetwork: "Sem conexão com a API. Confira se o servidor está rodando.",
  errorUnauthorized: "Sessão expirada. Faça login de novo no ícone da extensão.",

  // Popup / auth
  popupTitle: "CRM Lead Capture",
  emailLabel: "E-mail",
  passwordLabel: "Senha",
  loginButton: "Entrar",
  loggingIn: "Entrando...",
  logoutButton: "Sair",
  loggedInAs: "Conectado como",
  sessionInfo: "A sessão dura 12 horas e termina ao fechar o navegador.",
  settingsTitle: "Configuração",
  apiBaseLabel: "URL da API",
  crmBaseLabel: "URL do CRM",
  settingsSaved: "Configuração salva.",
  invalidUrl: "URL inválida.",
  loginFailed: "E-mail ou senha incorretos.",
  loginRateLimited: "Muitas tentativas. Aguarde um minuto.",

  // Panel shell
  panelTitle: "CRM",
  panelCollapse: "Recolher painel",
  panelExpand: "Abrir painel do CRM",
  notLoggedIn: "Você não está conectado ao CRM.",
  notLoggedInHint: "Clique no ícone da extensão na barra do navegador para fazer login.",
  noConversation: "Abra uma conversa para ver o lead.",
  groupConversation: "Conversa de grupo: captura de lead indisponível.",
  noPhoneDetected: "Não foi possível identificar o telefone desta conversa.",
  noPhoneHint: "Se o contato estiver salvo na agenda, o WhatsApp Web nem sempre expõe o número. Envie ou receba uma mensagem na conversa e tente de novo, ou digite o telefone abaixo.",
  phoneManualLabel: "Telefone (com DDD)",
  phoneInvalid: "Telefone inválido. Use DDD + número, ex: 63 99999 0001.",
  searching: "Buscando no CRM...",

  // Lead card
  leadFound: "Lead no CRM",
  stageLabel: "Etapa",
  ownerLabel: "Dono",
  ownerYou: "Você",
  ownerQueue: "Fila (sem dono)",
  ownerOther: "Outro consultor",
  nextContactLabel: "Próximo contato",
  nextContactNone: "Sem próximo passo",
  lastActivitiesLabel: "Últimas atividades",
  noActivities: "Sem atividades registradas.",
  openInCrm: "Abrir no CRM",
  contactNoOpenDeal: "Contato existe no CRM, mas sem negociação aberta.",
  createDealForContact: "Criar negociação",
  dealClosedWon: "Negociação concluída (matrícula).",
  dealClosedLost: "Negociação perdida.",

  // Quick log
  quickLogTitle: "Registrar contato",
  quickLogAttempt: "Tentei, sem resposta",
  quickLogAdvance: "Conversamos, avançou",
  quickLogObjection: "Conversamos, objeção",
  quickLogVisit: "Visita agendada",
  quickLogVisitNeedsDate: "Informe a data da visita para registrar.",
  quickLogSaved: "Contato registrado.",
  visitDateLabel: "Data e hora da visita",
  attemptCountInfo: "Tentativas sem resposta até agora:",

  // Next contact scheduling
  scheduleNextTitle: "Agendar próximo contato",
  scheduleNextButton: "Agendar",
  scheduleSaved: "Próximo contato agendado.",
  scheduleDateLabel: "Data e hora",
  scheduleNeedsDate: "Informe a data e hora.",

  // First contact
  firstContactButton: "Registrar 1º contato",
  firstContactDone: "1º contato registrado",
  firstContactSaved: "Primeiro contato registrado.",

  // Create lead
  createLeadTitle: "Criar lead",
  createLeadButton: "+ Criar lead",
  nameLabel: "Nome",
  courseLabel: "Curso de interesse (opcional)",
  unitLabel: "Unidade",
  unitNone: "Sem unidade",
  createLeadSubmit: "Criar no CRM",
  creating: "Criando...",
  leadCreated: "Lead criado no CRM.",
  nameRequired: "Informe o nome do lead.",
  duplicatePhone: "Este telefone já existe no CRM. Carregando o lead existente...",

  // Templates
  templatesTitle: "Modelos de mensagem",
  templatesEmpty: "Nenhum modelo cadastrado.",

  // RD Conversas stub
  rdNotConfigured: "Adaptador do RD Conversas ainda não configurado. Veja o README da extensão.",
} as const;

/** pt-BR labels for activity types shown in the timeline. */
export const ACTIVITY_LABELS: Record<string, string> = {
  deal_created: "Negociação criada",
  stage_changed: "Mudou de etapa",
  status_changed: "Status alterado",
  owner_changed: "Dono alterado",
  note: "Anotação",
  first_contact_registered: "1º contato registrado",
  first_contact_corrected: "1º contato corrigido",
  task_created: "Tarefa criada",
  task_completed: "Tarefa concluída",
  attempt_no_answer: "Tentativa sem resposta",
  talked_advance: "Conversa que avançou",
  talked_objection: "Conversa com objeção",
  visit_scheduled: "Visita agendada",
  cycle_changed: "Mudou de ciclo",
  reopened_in_cycle: "Reaberto em novo ciclo",
};
