"""Source DTOs and decision records for the clubs pipeline (Task 7)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class ClubRecord:
    """One logical row of the student-groups export; strings verbatim."""

    group_type: str
    name: str
    description: str
    contact_emails: str
    advisor: str
    funding_category: str
    tags: str
    website_url: str
    instagram_url: str
    facebook_url: str
    linkedin_url: str
    youtube_url: str
    twitter_url: str
    tiktok_url: str
    other_social_urls: str
    source_url: str
    directory_source_url: str
    raw: Mapping[str, str]  # verbatim column -> value


@dataclass(frozen=True)
class LivewhaleGroup:
    """One recorded LiveWhale publisher group (titles HTML-unescaped)."""

    id: int
    title: str
    fullname: str
    web_address: str
    timezone: str


@dataclass(frozen=True)
class LinkDecision:
    """The linkage outcome for one organization against the group list.

    ``method`` is ``"exact"``/``"fuzzy"`` for accepted links (then
    ``livewhale_group`` and ``score`` are set) and ``None`` otherwise (then
    ``reason`` says why: ``below-threshold`` | ``ambiguous-margin`` |
    ``degenerate-subset``). Best/runner-up candidates are always reported
    for auditability.
    """

    organization_id: str
    club_name: str
    method: str | None
    livewhale_group: str | None
    score: float | None
    reason: str | None
    best_group: str | None
    best_score: float | None
    runner_up_group: str | None
    runner_up_score: float | None

    def __post_init__(self) -> None:
        linked = self.method is not None
        if linked and (self.livewhale_group is None or self.score is None or self.reason is not None):
            raise ValueError("a linked decision carries group+score and no reason")
        if not linked and (self.livewhale_group is not None or self.score is not None):
            raise ValueError("an unlinked decision carries no group or score")
        if not linked and self.reason is None:
            raise ValueError("an unlinked decision must carry a reason")


@dataclass(frozen=True)
class EventObservation:
    """One physical LiveWhale event instance: organizer x raw location."""

    organizer: str  # HTML-unescaped organizer (LiveWhale group title)
    location: str  # verbatim location cell


@dataclass(frozen=True)
class DefaultPlaceEvidence:
    """Per-organization venue evidence behind the default_place_id rule."""

    organization_id: str
    observations: int  # resolved venue observations attributed to the org
    winner_place_id: str | None
    winner_count: int
    share: float | None  # winner_count / observations; None when 0 observations
    awarded: bool


@dataclass(frozen=True)
class GateCheck:
    """One named publication gate with its threshold and measured value."""

    name: str
    required: float
    actual: float
    passed: bool


@dataclass(frozen=True)
class ClubsGates:
    checks: tuple[GateCheck, ...]

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)
