"""Populate the CRM with a realistic demo dataset.

Everything it writes is fictional: invented people, invented business units and
invented campaign budgets. It exists so the product can be shown, recorded or
explored with numbers that behave like a real operation instead of an empty
board.

Usage (with the API running):

    python scripts/seed_demo.py [--api http://127.0.0.1:8000] [--leads 90]

The script talks to the public API for everything it can, so the data respects
the same rules a user would face: stage gates, mandatory loss reasons and the
write-once first contact timestamp. Timestamps are then aged directly in the
database, because an operation that started today has no response time, no
cooling deals and no funnel history to report on.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

FIRST_NAMES = [
    "Mariana", "João", "Fernanda", "Lucas", "Patrícia", "Rafael", "Juliana",
    "Thiago", "Camila", "Vinícius", "Larissa", "Gustavo", "Aline", "Rodrigo",
    "Bianca", "Felipe", "Natália", "Marcelo", "Débora", "Anderson", "Tatiane",
    "Leonardo", "Simone", "Eduardo", "Priscila", "Rogério", "Vanessa",
    "Alexandre", "Kelly", "Márcio", "Renata", "Fábio", "Cristiane", "Henrique",
    "Jéssica", "Danilo", "Adriana", "Sérgio", "Elaine", "Wesley", "Michele",
    "Otávio", "Roberta", "Caio", "Sandra", "Igor", "Letícia", "Murilo",
    "Viviane", "Hugo", "Carolina", "Douglas", "Beatriz", "Everton", "Silvana",
]
LAST_NAMES = [
    "Silva", "Souza", "Rocha", "Almeida", "Gomes", "Nunes", "Castro",
    "Barbosa", "Ferreira", "Dias", "Pinto", "Ramos", "Moreira", "Teixeira",
    "Cardoso", "Andrade", "Correia", "Freitas", "Vieira", "Melo", "Cunha",
    "Pires", "Braga", "Martins", "Lopes", "Santana", "Duarte", "Reis",
]
UNITS = [
    "Unidade Centro", "Unidade Norte", "Unidade Sul", "Unidade Leste",
    "Unidade Oeste", "Unidade Litoral", "Unidade Serra",
]
CONSULTANTS = [
    ("Ana Beatriz Souza", "ana.souza@example.com"),
    ("Bruno Carvalho", "bruno.carvalho@example.com"),
    ("Carla Mendes", "carla.mendes@example.com"),
    ("Diego Farias", "diego.farias@example.com"),
]
COURSES = [
    "Enfermagem", "Análise e Desenvolvimento de Sistemas", "Pedagogia",
    "Administração", "Psicologia", "Direito", "Fisioterapia",
    "Educação Física", "Ciências Contábeis", "Nutrição", "Engenharia Civil",
]
SOURCES = [
    ("meta_ads", "Captação Instagram"),
    ("meta_ads", "Remarketing"),
    ("google_ads", "Busca por marca"),
    ("google_ads", "Busca por cursos"),
    ("indicacao", None),
    ("site", None),
    ("whatsapp", None),
]
MODALITIES = ["presencial", "semipresencial", "ead"]
ENTRY_METHODS = ["vestibular", "enem", "transferencia", "segunda_graduacao"]
EXTRA_LOSS_REASONS = [
    ("Vai esperar o próximo semestre", True),
    ("Sem condição financeira no momento", True),
    ("Curso não oferecido na unidade", True),
    ("Horário incompatível", True),
    ("Bolsa insuficiente", True),
    ("Distância da unidade", False),
    ("Já estuda em outra instituição", False),
    ("Contato inválido", False),
    ("Lead duplicado", False),
]
# Leads per target outcome. The shape is deliberate: most of the volume sits at
# the top and thins out towards the close, which is what a funnel report needs
# in order to show where deals actually die.
PLAN = [(1, 16), (2, 18), (3, 14), (4, 10), (5, 7), ("won", 13), ("lost", 16)]

SPEND = [
    ("meta_ads", "Captação Instagram", 9400),
    ("meta_ads", "Remarketing", 2600),
    ("google_ads", "Busca por marca", 1900),
    ("google_ads", "Busca por cursos", 5100),
]


class Api:
    def __init__(self, base: str, email: str, password: str) -> None:
        self.base = base.rstrip("/") + "/api/v1"
        self.token = self("POST", "/auth/login", {"email": email, "password": password})["access_token"]

    def __call__(self, method: str, path: str, body: Any = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        token = getattr(self, "token", None)
        if token:
            request.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(request) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            return {"error": error.code, "body": error.read().decode()[:200]}


def rows(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        return payload.get("items", [])
    return payload or []


def valid_cpf(rnd: random.Random) -> str:
    digits = [rnd.randint(0, 9) for _ in range(9)]
    for _ in range(2):
        total = sum((len(digits) + 1 - i) * v for i, v in enumerate(digits))
        digits.append(total * 10 % 11 % 10)
    return "%d%d%d.%d%d%d.%d%d%d-%d%d" % tuple(digits)


def sql(container: str, database: str, statement: str) -> None:
    subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "crm", "-d", database,
         "-v", "ON_ERROR_STOP=1", "-q", "-c", statement],
        check=True, capture_output=True, text=True,
    )


def age_the_data(container: str, database: str, days: int) -> None:
    """Spread the dataset over the past `days` so the reports have something to
    report: lead age, response time, cooling deals and a dated funnel."""
    sql(container, database, f"""
        SET app.allow_first_contact_override = 'on';

        WITH spread AS (SELECT id, random() * {days - 2} + 1 AS age FROM deals)
        UPDATE deals d SET created_at = now() - spread.age * interval '1 day'
        FROM spread WHERE d.id = spread.id;

        UPDATE deals SET first_whatsapp_contact_at = created_at +
          CASE WHEN random() < 0.7 THEN random() * 300 * interval '1 minute'
               ELSE (random() * 70 + 25) * interval '1 hour' END
        WHERE first_whatsapp_contact_at IS NOT NULL;

        UPDATE deals SET won_at = created_at + (random() * 20 + 3) * interval '1 day'
        WHERE won_at IS NOT NULL;
        UPDATE deals SET lost_at = created_at + (random() * 25 + 2) * interval '1 day'
        WHERE lost_at IS NOT NULL;

        UPDATE deals SET last_activity_at = GREATEST(created_at,
          CASE WHEN random() < 0.55 THEN now() - random() * 2 * interval '1 day'
               ELSE now() - (random() * 14 + 3) * interval '1 day' END)
        WHERE status = 'open';
        UPDATE deals SET last_activity_at = COALESCE(won_at, lost_at)
        WHERE status <> 'open';

        UPDATE activities a SET created_at = d.created_at + random() * (now() - d.created_at)
        FROM deals d WHERE a.deal_id = d.id;

        UPDATE deal_stage_history h
        SET entered_at = GREATEST(d.created_at, h.entered_at - random() * {days // 3} * interval '1 day')
        FROM deals d WHERE h.deal_id = d.id;
    """)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a demo dataset.")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--email", default="admin@example.com")
    parser.add_argument("--password", default="ChangeMe123!")
    parser.add_argument("--container", default="sales-crm-postgres")
    parser.add_argument("--database", default="sales_crm")
    parser.add_argument("--days", type=int, default=55, help="history window")
    parser.add_argument("--cycle-deadline-in", type=int, default=18)
    args = parser.parse_args()

    rnd = random.Random(7)
    api = Api(args.api, args.email, args.password)
    print("connected to", args.api)

    for name, recoverable in EXTRA_LOSS_REASONS:
        existing = {r["label"] for r in rows(api("GET", "/lost-reasons"))}
        if name not in existing:
            api("POST", "/lost-reasons", {"label": name, "is_recoverable": recoverable})
    reasons = rows(api("GET", "/lost-reasons"))
    objections = rows(api("GET", "/objections"))

    units = rows(api("GET", "/units?limit=100"))
    for index, wanted in enumerate(UNITS):
        if index < len(units):
            api("PATCH", f"/units/{units[index]['id']}", {"name": wanted})
        else:
            api("POST", "/units", {"name": wanted})
    units = rows(api("GET", "/units?limit=100"))
    print("units:", len(units))

    people = {u["email"]: u for u in rows(api("GET", "/users?limit=200"))}
    consultants = []
    for name, email in CONSULTANTS:
        if email in people:
            consultants.append(people[email])
            continue
        created = api("POST", "/users", {
            "email": email, "name": name, "password": "Consultor123!", "role": "CONSULTOR",
        })
        if "error" not in created:
            consultants.append(created)
    print("consultants:", len(consultants))

    cycle = api("GET", "/cycles/active")
    from datetime import date, timedelta
    deadline = (date.today() + timedelta(days=args.cycle_deadline_in)).isoformat()
    api("PATCH", f"/cycles/{cycle['id']}", {"name": "2026.2", "deadline_on": deadline})
    print("cycle 2026.2 closes in", args.cycle_deadline_in, "days")

    month = date.today().replace(day=1).isoformat()
    previous = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1).isoformat()
    for source, campaign, amount in SPEND:
        api("POST", "/campaign-spend", {"month": month, "source": source,
                                        "campaign": campaign, "amount": str(amount)})
        api("POST", "/campaign-spend", {"month": previous, "source": source,
                                        "campaign": campaign, "amount": str(round(amount * 0.8))})

    for consultant in consultants:
        api("POST", "/goals", {"cycle_id": cycle["id"], "scope": "consultant",
                               "target_user_id": consultant["id"],
                               "target_count": rnd.choice([6, 8, 10])})

    used_names: set[str] = set()
    made = 0
    for target, quantity in PLAN:
        for _ in range(quantity):
            while True:
                person = f"{rnd.choice(FIRST_NAMES)} {rnd.choice(LAST_NAMES)}"
                if person not in used_names:
                    used_names.add(person)
                    break
            contact = api("POST", "/contacts", {
                "name": person,
                "phone_whatsapp": "+5547%09d" % rnd.randint(0, 999999999),
                "email": person.split()[0].lower() + str(rnd.randint(1, 99)) + "@example.com",
            })
            if "error" in contact:
                continue
            source, campaign = rnd.choice(SOURCES)
            deal = api("POST", "/deals", {
                "title": person, "contact_id": contact["id"],
                "unit_id": rnd.choice(units)["id"],
                "owner_id": rnd.choice(consultants)["id"],
                "source": source, "campaign": campaign,
                "qualification": rnd.randint(1, 5),
                "enrollment_data": {
                    "interest_course": rnd.choice(COURSES),
                    "modality": rnd.choice(MODALITIES),
                },
            })
            if "error" in deal:
                print("  could not create deal:", deal["body"][:120])
                continue
            advance(api, rnd, deal, target, reasons, objections)
            made += 1
    print("deals:", made)

    age_the_data(args.container, args.database, args.days)
    print("history spread over the last", args.days, "days")

    summary = api("GET", "/reports/summary")
    print("\nleads in period:", summary.get("leads_count"),
          "| sales:", summary.get("sales_count"),
          "| median response:", summary.get("median_response_minutes"), "min")
    return 0


def advance(api: Api, rnd: random.Random, deal: dict, target, reasons, objections) -> None:
    """Walk a deal to its target stage, filling what each gate requires."""
    deal_id = deal["id"]
    level = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, "won": 6, "lost": rnd.choice([2, 3, 4, 5])}[target]
    stages = {s["sort_order"]: s for s in api("GET", "/pipelines")[0]["stages"]}

    if level >= 2 or rnd.random() < 0.3:
        api("POST", f"/deals/{deal_id}/first-contact", {})

    kinds = ["attempt_no_answer"] * rnd.randint(1, 3) if level == 2 else []
    if level >= 3:
        kinds = ["attempt_no_answer"] * rnd.randint(0, 2) + ["talked_advance"]
    if target == "lost":
        kinds.append("talked_objection")
    for kind in kinds:
        body: dict[str, Any] = {"kind": kind}
        if kind == "talked_objection" and objections:
            body["objection_id"] = rnd.choice(objections)["id"]
        if rnd.random() < 0.7:
            from datetime import datetime, timedelta, timezone
            offset = rnd.choice([-3, -1, 1, 2, 3, 7])
            body["next_contact_at"] = (datetime.now(timezone.utc) + timedelta(days=offset)).isoformat()
        api("POST", f"/deals/{deal_id}/log", body)

    if level >= 3:
        current = api("GET", f"/deals/{deal_id}").get("enrollment_data") or {}
        payload = dict(current)
        payload.setdefault("entry_method", rnd.choice(ENTRY_METHODS))
        if level >= 4:
            payload.setdefault("monthly_fee_value", rnd.choice([349.9, 399.9, 449.9, 499.9, 589.9]))
            payload.setdefault("scholarship_offered", rnd.choice(["30%", "40%", "50%", "20%"]))
        if level >= 5:
            payload.setdefault("cpf", valid_cpf(rnd))
        api("PATCH", f"/deals/{deal_id}", {"enrollment_data": payload})

    for order in range(2, min(level, 5) + 1):
        api("PATCH", f"/deals/{deal_id}/stage", {"stage_id": stages[order]["id"]})

    if target == "won":
        current = api("GET", f"/deals/{deal_id}").get("enrollment_data") or {}
        api("PATCH", f"/deals/{deal_id}", {"enrollment_data": {**current, "contract_signed": True}})
        api("POST", f"/deals/{deal_id}/won",
            {"value": str(rnd.choice([349.9, 399.9, 449.9, 499.9, 589.9, 649.9]))})
    elif target == "lost":
        api("POST", f"/deals/{deal_id}/lost", {"lost_reason_id": rnd.choice(reasons)["id"]})


if __name__ == "__main__":
    sys.exit(main())
