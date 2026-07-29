"""Organization -> LiveWhale publisher-group linkage plus the sidecar.

Plan rule: exact normalized match (Task 4 ``normalize_alias`` on both
sides; group titles HTML-unescaped) first, then RapidFuzz
``token_set_ratio >= 92`` with a runner-up margin ``>= 5``; a margin
failure is ambiguous — no link, reported.

One fail-closed guard is layered on top (Task 7 brief, "never guess"):
``token_set_ratio`` scores a strict token-subset at 100, which would link
"College Hill Irish Music Ensemble" to the Music *department* group. After
dropping filler tokens, a candidate whose significant tokens are a strict
subset of the club's (or vice versa) is rejected with reason
``degenerate-subset``. The guard only ever rejects candidates the naive
rule would accept — it can never add a link — and every rejection reports
the candidate and scores for human review.

Sidecar schema v1 (pinned by the plan AND by the app lane's
``packages/contract/src/seeds.ts`` ``OrgLivewhaleGroupsSchema``,
field-for-field)::

    {"schema_version": 1,
     "generated_at": "<UTC ISO>",
     "mappings": [{"organization_id": "<slug>",
                   "livewhale_group": "<source name>",
                   "match_method": "exact|fuzzy",
                   "score": <0..100>}]}
"""

from __future__ import annotations

from datetime import UTC, datetime
import html
import json
from pathlib import Path

from rapidfuzz import fuzz

from brownsync_ingest.clubs.models import LinkDecision, LivewhaleGroup
from brownsync_ingest.gazetteer.aliases import normalize_alias


TOKEN_SET_THRESHOLD = 92.0
RUNNER_UP_MARGIN = 5.0

# Tokens that carry no identity: their presence/absence never distinguishes
# a club from a LiveWhale group ("Brown Outing Club" IS "Outing Club").
FILLER_TOKENS = frozenset(
    {"brown", "university", "the", "of", "for", "and", "at", "in", "a", "an"}
)

_REQUIRED_GROUP_FIELDS = ("id", "title", "fullname", "web_address", "timezone")

REASON_BELOW_THRESHOLD = "below-threshold"
REASON_AMBIGUOUS_MARGIN = "ambiguous-margin"
REASON_DEGENERATE_SUBSET = "degenerate-subset"


class LivewhaleGroupsError(ValueError):
    """The recorded groups document does not have the expected structure."""


def load_livewhale_groups(path: Path | str) -> tuple[LivewhaleGroup, ...]:
    """Load the recorded groups list, HTML-unescaping display strings."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise LivewhaleGroupsError("groups document must be a JSON array")
    groups: list[LivewhaleGroup] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict) or any(
            field not in item for field in _REQUIRED_GROUP_FIELDS
        ):
            raise LivewhaleGroupsError(
                f"group {index}: expected fields {_REQUIRED_GROUP_FIELDS}"
            )
        groups.append(
            LivewhaleGroup(
                id=int(item["id"]),
                title=html.unescape(str(item["title"])),
                fullname=html.unescape(str(item["fullname"])),
                web_address=str(item["web_address"]),
                timezone=str(item["timezone"]),
            )
        )
    return tuple(groups)


def significant_tokens(name: str) -> frozenset[str]:
    """Normalized tokens minus filler — the identity-bearing words."""
    return frozenset(normalize_alias(name).split(" ")) - FILLER_TOKENS


def _is_degenerate_subset(club_name: str, group_title: str) -> bool:
    club = significant_tokens(club_name)
    group = significant_tokens(group_title)
    return club != group and (club < group or group < club)


def link_club(
    organization_id: str, club_name: str, group_titles: tuple[str, ...]
) -> LinkDecision:
    """Decide the LiveWhale link for one organization, always reporting."""
    club_normalized = normalize_alias(club_name)

    def decision(
        *,
        method: str | None,
        livewhale_group: str | None = None,
        score: float | None = None,
        reason: str | None = None,
        best: tuple[float, str] | None = None,
        runner_up: tuple[float, str] | None = None,
    ) -> LinkDecision:
        return LinkDecision(
            organization_id=organization_id,
            club_name=club_name,
            method=method,
            livewhale_group=livewhale_group,
            score=score,
            reason=reason,
            best_group=best[1] if best else None,
            best_score=best[0] if best else None,
            runner_up_group=runner_up[1] if runner_up else None,
            runner_up_score=runner_up[0] if runner_up else None,
        )

    for title in group_titles:
        if normalize_alias(title) == club_normalized:
            return decision(
                method="exact",
                livewhale_group=title,
                score=100.0,
                best=(100.0, title),
            )

    scored = sorted(
        (
            (float(fuzz.token_set_ratio(club_normalized, normalize_alias(title))), title)
            for title in group_titles
        ),
        key=lambda item: (-item[0], item[1]),
    )
    best = scored[0] if scored else None
    runner_up = scored[1] if len(scored) > 1 else None

    if best is None or best[0] < TOKEN_SET_THRESHOLD:
        return decision(
            method=None, reason=REASON_BELOW_THRESHOLD, best=best, runner_up=runner_up
        )
    if runner_up is not None and best[0] - runner_up[0] < RUNNER_UP_MARGIN:
        return decision(
            method=None, reason=REASON_AMBIGUOUS_MARGIN, best=best, runner_up=runner_up
        )
    if _is_degenerate_subset(club_name, best[1]):
        return decision(
            method=None, reason=REASON_DEGENERATE_SUBSET, best=best, runner_up=runner_up
        )
    return decision(
        method="fuzzy",
        livewhale_group=best[1],
        score=best[0],
        best=best,
        runner_up=runner_up,
    )


def build_organization_sidecar(
    decisions: tuple[LinkDecision, ...], *, generated_at: datetime
) -> dict[str, object]:
    """The organization sidecar document, schema v1, sorted by org id."""
    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    timestamp = generated_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    linked = sorted(
        (d for d in decisions if d.method is not None),
        key=lambda d: d.organization_id,
    )
    return {
        "schema_version": 1,
        "generated_at": timestamp,
        "mappings": [
            {
                "organization_id": d.organization_id,
                "livewhale_group": d.livewhale_group,
                "match_method": d.method,
                "score": d.score,
            }
            for d in linked
        ],
    }
