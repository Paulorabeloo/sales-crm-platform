"""Idempotent database seeds.

Run with::

    python -m app.db.seeds

Creates (only when missing — safe to re-run):
- initial ADMIN user (email/password from env: ADMIN_EMAIL / ADMIN_PASSWORD)
- default pipeline "Comercial" with the 6-stage milestone funnel (spec 11),
  including per-stage required-fields gates (spec 08) and playbooks (spec 12)
- 6 lost reasons (gate decision #3)
- 7 placeholder units (gate decision #4 — admin renames via settings UI)
- app settings: cooling_days=3, auto_first_contact_task=true,
  followup_cadence=[1, 3, 7] (spec 09.3)
- 3 generic WhatsApp message templates (spec 09.4)
- 8 catalog sources (feedback item 5): meta_ads, google_ads, tiktok_ads,
  indicacao, site, whatsapp, presencial, outro

Funnel note (spec 11): stages are verifiable lead MILESTONES, not seller
activities. Existing dev databases seeded with the old 4-stage funnel should
be recreated (drop/create + alembic upgrade + seeds) — acceptable in dev.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import (
    AppSetting,
    Cycle,
    LostReason,
    MessageTemplate,
    Objection,
    Pipeline,
    Source,
    Stage,
    Unit,
    User,
    UserRole,
)
from app.db.session import get_session_factory
from app.services.sources import SOURCE_SEEDS

logger = logging.getLogger("app.seeds")

# Stable UUID for the default pipeline (same as 02-schema/schema.sql) so the
# stage seeds have a fixed reference.
DEFAULT_PIPELINE_ID = uuid.UUID("018f0000-0000-7000-8000-000000000001")

# Stable UUID for the backfill/default cycle (same as migration 0003).
DEFAULT_CYCLE_ID = uuid.UUID("018f0000-0000-7000-8000-0000000000c1")

# (name, sort_order, is_won_stage, required_fields, playbook)
# required_fields follow spec 11's defaults, mapped onto the real catalog keys
# (spec table "admission_type" -> enrollment.entry_method, "monthly_value" ->
# enrollment.monthly_fee_value). Admin can edit them via PATCH /stages/{id}.
DEFAULT_STAGES: list[tuple[str, int, bool, list[str], str]] = [
    (
        "Novo lead",
        1,
        False,
        [],
        "Responda em até 15 minutos. Apresente-se, confirme o interesse e "
        "pergunte o melhor horário para conversar.",
    ),
    (
        "Tentando contato",
        2,
        False,
        ["first_whatsapp_contact_at"],
        "Siga a cadência D+1, D+3, D+7. Varie o horário das tentativas e "
        "registre cada uma com o botão Sem resposta.",
    ),
    (
        "Conversa qualificada",
        3,
        False,
        ["enrollment.interest_course", "enrollment.entry_method"],
        "Descubra: objetivo, urgência e orçamento. Pergunte antes de ofertar.",
    ),
    (
        "Proposta apresentada",
        4,
        False,
        ["enrollment.monthly_fee_value", "enrollment.scholarship_offered"],
        "Apresente valor antes do preço. Confirme se a condição cabe no "
        "orçamento e combine um prazo de decisão.",
    ),
    (
        "Fechamento em andamento",
        5,
        False,
        ["enrollment.cpf"],
        "Acompanhe documentos e pagamento de perto. Remova fricção: envie "
        "links diretos e confira pendências todos os dias.",
    ),
    (
        "Concluído",
        6,
        True,
        ["enrollment.contract_signed"],
        "Confirme contrato assinado e número de registro. Peça indicação e "
        "oriente os próximos passos.",
    ),
]

# (label, is_recoverable) — recoverable losses feed the win-back list
# (spec 10.4); the admin can flip the flag via PATCH /lost-reasons/{id}.
LOST_REASONS: list[tuple[str, bool]] = [
    ("Sem resposta/sumiu", True),
    ("Preço/mensalidade", True),
    ("Escolheu concorrente", False),
    ("Sem ENEM/documentação", True),
    ("Desistiu de estudar", False),
    ("Outro", False),
]

# Generic objection catalog (spec 12.2): name + suggested rebuttal, brand-free.
OBJECTION_SEEDS: list[tuple[str, str, int]] = [
    (
        "Preço",
        "Entenda o que pesa no valor antes de negociar: pergunte quanto caberia "
        "no orçamento hoje. Mostre o custo por dia e as opções de bolsa ou "
        "desconto. Compare com o retorno que a formação traz, não com o boleto.",
        1,
    ),
    (
        "Vou pensar",
        "Concorde e devolva a conversa: pergunte o que falta pra decidir. "
        "Quase sempre existe uma dúvida escondida (valor, tempo, medo). Combine "
        "uma data concreta de retorno e registre o próximo passo.",
        2,
    ),
    (
        "Preciso consultar alguém",
        "Valide a decisão em conjunto: ofereça conversar com a pessoa também, "
        "ou envie um resumo pronto pra ela ver (valores, horários, condições). "
        "Combine o retorno pra depois dessa conversa.",
        3,
    ),
    (
        "Sem tempo agora",
        "Reduza o esforço: resolva tudo pelo WhatsApp em poucos minutos, sem "
        "visita. Pergunte qual o melhor horário e agende um contato curto em "
        "vez de insistir agora.",
        4,
    ),
]

PLACEHOLDER_UNITS: list[str] = [
    "Unidade 1",
    "Unidade 2",
    "Unidade 3",
    "Unidade 4",
    "Unidade 5",
    "Unidade 6",
    "Unidade 7",
]

# Generic, brand-free WhatsApp templates (spec 09.4). Variables are rendered
# by the FRONTEND: {{first_name}}, {{course}}, {{unit}}, {{consultant}}.
DEFAULT_MESSAGE_TEMPLATES: list[tuple[str, str, int]] = [
    (
        "Primeiro contato",
        "Olá {{first_name}}! Vi seu interesse em {{course}}. Aqui é "
        "{{consultant}}, da unidade {{unit}}. Posso te passar as informações?",
        1,
    ),
    (
        "Lembrete",
        "Oi {{first_name}}, tudo bem? Passando para saber se você ainda tem "
        "interesse em {{course}}. Qualquer dúvida, estou à disposição!",
        2,
    ),
    (
        "Resgate",
        "Oi {{first_name}}! Ainda dá tempo de garantir sua vaga em "
        "{{course}}. Quer que eu te ajude a finalizar?",
        3,
    ),
]

DEFAULT_APP_SETTINGS: list[tuple[str, object]] = [
    ("cooling_days", 3),
    ("auto_first_contact_task", True),
    ("followup_cadence", [1, 3, 7]),
]


async def run_seeds() -> None:
    settings = get_settings()
    async with get_session_factory()() as session:
        # --- Default pipeline + stages ---------------------------------------
        pipeline = await session.get(Pipeline, DEFAULT_PIPELINE_ID)
        if pipeline is None:
            pipeline = Pipeline(
                id=DEFAULT_PIPELINE_ID, name="Comercial", is_active=True, is_default=True
            )
            session.add(pipeline)
            await session.flush()
            logger.info("Created default pipeline 'Comercial'")

        existing_stages = (
            await session.scalars(
                select(Stage.name).where(Stage.pipeline_id == DEFAULT_PIPELINE_ID)
            )
        ).all()
        for name, order, is_won, required_fields, playbook in DEFAULT_STAGES:
            if name not in existing_stages:
                session.add(
                    Stage(
                        pipeline_id=DEFAULT_PIPELINE_ID,
                        name=name,
                        sort_order=order,
                        is_won_stage=is_won,
                        required_fields=required_fields,
                        playbook=playbook,
                    )
                )
                logger.info("Created stage %r", name)

        # --- Active cycle (spec 10.1) ----------------------------------------
        active_cycle = await session.scalar(
            select(Cycle).where(Cycle.is_active.is_(True))
        )
        if active_cycle is None:
            session.add(
                Cycle(
                    id=DEFAULT_CYCLE_ID,
                    name="Ciclo 1",
                    starts_on=datetime.now(UTC).date(),
                    is_active=True,
                )
            )
            logger.info("Created active cycle 'Ciclo 1'")

        # --- Lost reasons -----------------------------------------------------
        existing_reasons = (await session.scalars(select(LostReason.label))).all()
        for order, (label, recoverable) in enumerate(LOST_REASONS, start=1):
            if label not in existing_reasons:
                session.add(
                    LostReason(
                        label=label, sort_order=order, is_recoverable=recoverable
                    )
                )
                logger.info("Created lost reason %r", label)

        # --- Objections (spec 12.2) -------------------------------------------
        existing_objections = (await session.scalars(select(Objection.name))).all()
        for name, rebuttal, order in OBJECTION_SEEDS:
            if name not in existing_objections:
                session.add(Objection(name=name, rebuttal=rebuttal, sort_order=order))
                logger.info("Created objection %r", name)

        # --- Source catalog (feedback item 5) ----------------------------------
        existing_sources = (await session.scalars(select(Source.key))).all()
        for key, label, order in SOURCE_SEEDS:
            if key not in existing_sources:
                session.add(Source(key=key, label=label, sort_order=order))
                logger.info("Created source %r", key)

        # --- Placeholder units ------------------------------------------------
        existing_units = (await session.scalars(select(Unit.name))).all()
        for name in PLACEHOLDER_UNITS:
            if name not in existing_units:
                session.add(Unit(name=name))
                logger.info("Created unit %r", name)

        # --- Message templates --------------------------------------------------
        existing_templates = (await session.scalars(select(MessageTemplate.name))).all()
        for name, body, order in DEFAULT_MESSAGE_TEMPLATES:
            if name not in existing_templates:
                session.add(MessageTemplate(name=name, body=body, sort_order=order))
                logger.info("Created message template %r", name)

        # --- Settings -----------------------------------------------------------
        for key, value in DEFAULT_APP_SETTINGS:
            if await session.get(AppSetting, key) is None:
                session.add(AppSetting(key=key, value=value))
                logger.info("Created setting %s=%r", key, value)

        # --- Initial admin ------------------------------------------------------
        admin = await session.scalar(
            select(User).where(func.lower(User.email) == settings.admin_email.lower())
        )
        if admin is None:
            session.add(
                User(
                    email=settings.admin_email,
                    password_hash=hash_password(settings.admin_password),
                    name=settings.admin_name,
                    role=UserRole.ADMIN,
                    is_active=True,
                )
            )
            logger.info("Created initial admin %r", settings.admin_email)

        await session.commit()
        logger.info("Seeds complete")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(run_seeds())


if __name__ == "__main__":
    main()
