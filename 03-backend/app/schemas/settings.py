"""App settings schemas."""

from typing import Annotated

from pydantic import BaseModel, Field

CadenceDay = Annotated[int, Field(ge=1, le=90)]


class AppSettingsOut(BaseModel):
    cooling_days: int
    auto_first_contact_task: bool
    followup_cadence: list[int]


class AppSettingsUpdate(BaseModel):
    cooling_days: int | None = Field(default=None, ge=1, le=90)
    auto_first_contact_task: bool | None = None
    followup_cadence: list[CadenceDay] | None = Field(
        default=None, min_length=1, max_length=10
    )
