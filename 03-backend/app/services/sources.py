"""Source catalog and free-text source normalization (feedback item 5).

Why this exists
---------------
``deals.source`` and ``campaign_spend.source`` are plain TEXT columns, so
"meta", "Meta", "meta_ads" and "Meta Ads" used to be four different sources.
The CAC report groups by that text, which silently split one campaign's spend
across several rows and halved the reported cost per enrollment.

The fix keeps both columns as TEXT (no destructive schema change, no FK) but
funnels every WRITE through :func:`resolve_source`, which normalizes the raw
text to a stable catalog ``key``:

1. ``slugify_source`` trims, lowercases, strips accents and turns any run of
   non-alphanumerics into ``_`` ("Meta Ads " -> ``meta_ads``);
2. ``SOURCE_ALIASES`` maps the well-known spellings of the same channel onto
   one catalog key ("meta", "facebook", "ig" -> ``meta_ads``);
3. an unknown key is ACCEPTED and auto-registered in ``sources`` as INACTIVE.
   A lead is never refused because of a source we do not know yet (that rule is
   absolute for the public webhook); the admin later renames it, activates it
   or merges it by hand. Inactive entries stay out of the frontend selects but
   are visible with ``GET /sources?include_inactive=true``.
"""

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Source

MAX_KEY_LENGTH = 120

# (key, label, sort_order) — labels are pt-BR, shown as-is in the frontend.
SOURCE_SEEDS: list[tuple[str, str, int]] = [
    ("meta_ads", "Meta Ads (Facebook e Instagram)", 1),
    ("google_ads", "Google Ads", 2),
    ("tiktok_ads", "TikTok Ads", 3),
    ("indicacao", "Indicação", 4),
    ("site", "Site", 5),
    ("whatsapp", "WhatsApp", 6),
    ("presencial", "Presencial", 7),
    ("outro", "Outro", 8),
]

SEEDED_KEYS: frozenset[str] = frozenset(key for key, _, _ in SOURCE_SEEDS)

# Slug -> catalog key. Only unambiguous spellings of the same channel belong
# here; anything doubtful (e.g. "marketing") is left alone on purpose.
SOURCE_ALIASES: dict[str, str] = {
    # Meta
    "meta": "meta_ads",
    "meta_ad": "meta_ads",
    "meta_ads": "meta_ads",
    "facebook": "meta_ads",
    "facebook_ads": "meta_ads",
    "face": "meta_ads",
    "fb": "meta_ads",
    "fb_ads": "meta_ads",
    "instagram": "meta_ads",
    "instagram_ads": "meta_ads",
    "insta": "meta_ads",
    "ig": "meta_ads",
    "ig_ads": "meta_ads",
    # Google
    "google": "google_ads",
    "google_ads": "google_ads",
    "googleads": "google_ads",
    "google_adwords": "google_ads",
    "adwords": "google_ads",
    "gads": "google_ads",
    "youtube": "google_ads",
    "youtube_ads": "google_ads",
    # TikTok
    "tiktok": "tiktok_ads",
    "tiktok_ads": "tiktok_ads",
    "tik_tok": "tiktok_ads",
    "tik_tok_ads": "tiktok_ads",
    # Referral
    "indicacao": "indicacao",
    "indicacoes": "indicacao",
    "indicado": "indicacao",
    "indicacao_de_aluno": "indicacao",
    "referral": "indicacao",
    "boca_a_boca": "indicacao",
    # Own site
    "site": "site",
    "website": "site",
    "web": "site",
    "site_organico": "site",
    "organico": "site",
    "formulario_do_site": "site",
    # WhatsApp
    "whatsapp": "whatsapp",
    "whats": "whatsapp",
    "whats_app": "whatsapp",
    "wpp": "whatsapp",
    "zap": "whatsapp",
    # Walk-in
    "presencial": "presencial",
    "balcao": "presencial",
    "loja": "presencial",
    "walk_in": "presencial",
    # Catch-all
    "outro": "outro",
    "outros": "outro",
    "other": "outro",
    "desconhecido": "outro",
}


def slugify_source(raw: str) -> str:
    """Trim, lowercase, drop accents and collapse separators into ``_``.

    Returns an empty string when nothing usable is left (e.g. ``"   "``)."""
    ascii_text = (
        unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_text.strip().lower()).strip("_")
    return slug[:MAX_KEY_LENGTH]


def canonical_source_key(raw: str | None) -> str | None:
    """Pure (no database) normalization: slug + alias map.

    Shared by the write path and by migration 0005, so the data already in the
    database and everything written from now on land on the same keys."""
    if raw is None:
        return None
    slug = slugify_source(raw)
    if not slug:
        return None
    return SOURCE_ALIASES.get(slug, slug)


async def resolve_source(db: AsyncSession, raw: str | None) -> str | None:
    """Normalize ``raw`` to a catalog key, registering unknown keys.

    ``None``/blank stays ``None``. An unknown key is inserted as an INACTIVE
    catalog row (label = the raw text) so it shows up for the admin instead of
    silently fragmenting the CAC report. Never raises on an unknown source."""
    key = canonical_source_key(raw)
    if key is None:
        return None
    known = await db.scalar(select(Source.id).where(Source.key == key))
    if known is None:
        await db.execute(
            pg_insert(Source)
            .values(
                key=key,
                label=(raw or key).strip()[:MAX_KEY_LENGTH] or key,
                is_active=False,
                sort_order=999,
            )
            .on_conflict_do_nothing(index_elements=["key"])
        )
    return key
