"""The clubs job: export records -> contract organization rows behind
fail-closed gates, plus the schema-v1 LiveWhale sidecar.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from brownsync_ingest.clubs.job import (
    DROPPED_FIELD_COLUMNS,
    MIN_ORGANIZATIONS,
    SOURCE_BY_GROUP_TYPE,
    run_clubs_job,
)
from brownsync_ingest.contract import OrganizationRow
from brownsync_ingest.gazetteer.resolver import PlaceResolver, Resolution
from brownsync_ingest.output import model_identity

INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_CSV = INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"
REAL_EVENTS = INGEST_ROOT / "fixtures" / "user_provided" / "brown_upcoming_events.csv"
REAL_GROUPS = INGEST_ROOT / "fixtures" / "recorded" / "livewhale" / "groups.json"

CLUBS_HEADER = (
    "group_type,name,description,contact_emails,advisor,funding_category,tags,"
    "website_url,instagram_url,facebook_url,linkedin_url,youtube_url,twitter_url,"
    "tiktok_url,other_social_urls,source_url,directory_source_url"
)
EVENTS_HEADER = "event_id,title,organizer,location,online"
DIRECTORY = "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups"


def club_row(
    *,
    group_type: str = "Undergraduate student group",
    name: str = "Example Club",
    description: str = "We do things.",
    funding_category: str = "Category 2",
    tags: str = "UCS Recognized Undergrad Student Groups",
    website_url: str = "",
    instagram_url: str = "",
    source_url: str = "https://studentactivities.brown.edu/organizations/example-club",
    directory_source_url: str = DIRECTORY,
) -> str:
    cells = [
        group_type, name, description, "contact@brown.edu", "A. Advisor",
        funding_category, tags, website_url, instagram_url, "", "", "", "", "",
        "", source_url, directory_source_url,
    ]
    return ",".join(
        f'"{cell}"' if ("," in cell or '"' in cell) else cell for cell in cells
    )


class Workspace:
    def __init__(self, tmp_path: Path) -> None:
        self.tmp_path = tmp_path
        self.seeds_path = tmp_path / "seeds" / "organizations.ndjson"
        self.sidecar_path = tmp_path / "seeds" / "organization_livewhale_groups.json"
        self.staging_root = tmp_path / "staging"

    def clubs_csv(self, *rows: str) -> Path:
        path = self.tmp_path / "clubs.csv"
        path.write_text(
            "﻿" + CLUBS_HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8"
        )
        return path

    def events_csv(self, *rows: str) -> Path:
        path = self.tmp_path / "events.csv"
        path.write_text(
            "﻿" + EVENTS_HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8"
        )
        return path

    def groups_json(self, *titles: str) -> Path:
        path = self.tmp_path / "groups.json"
        payload = [
            {
                "id": index + 1,
                "title": title,
                "fullname": title,
                "web_address": f"https://events.brown.edu/{index + 1}/",
                "timezone": "America/New_York",
            }
            for index, title in enumerate(titles)
        ]
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def run(
        self,
        clubs: Path,
        groups: Path,
        events: Path,
        *,
        min_organizations: int = 1,
        resolver: object | None = None,
    ):
        return run_clubs_job(
            clubs,
            groups_path=groups,
            events_csv_path=events,
            resolver=resolver or PlaceResolver.from_files(),
            seeds_path=self.seeds_path,
            sidecar_path=self.sidecar_path,
            staging_root=self.staging_root,
            min_organizations=min_organizations,
            generated_at=datetime(2026, 7, 29, 12, 0, tzinfo=UTC),
        )


@pytest.fixture()
def workspace(tmp_path: Path) -> Workspace:
    return Workspace(tmp_path)


class StubResolver:
    def __init__(self, known: dict[str, str]) -> None:
        self.known = known

    def resolve(self, value: str) -> Resolution:
        place_id = self.known.get(value)
        return Resolution(
            query=value, place_id=place_id, room=None,
            method="exact" if place_id else "unresolved",
            reason=None if place_id else "below-threshold",
            score=None, candidates=(),
        )


class TestEmission:
    def test_rows_follow_the_emission_rules(self, workspace: Workspace) -> None:
        result = workspace.run(
            workspace.clubs_csv(
                club_row(
                    name="Alpha Club",
                    website_url="https://alpha.example.org",
                    instagram_url="https://instagram.com/alpha",
                ),
                club_row(
                    name="Beta Society",
                    description="",
                    source_url="https://studentactivities.brown.edu/organizations/beta-society",
                ),
                club_row(
                    group_type="Graduate student group",
                    name="Gamma Collective",
                    funding_category="",
                    tags="Graduate Student Council recognized group",
                    source_url="https://sites.brown.edu/gsc/student-groups/",
                    directory_source_url="https://sites.brown.edu/gsc/student-groups/",
                ),
            ),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
        )
        assert result.gates.passed
        rows = {row.id: row for row in result.rows}
        alpha = rows["alpha-club"]
        assert alpha == OrganizationRow(
            id="alpha-club", name="Alpha Club", kind="club", category=None,
            description="We do things.", url="https://alpha.example.org",
            instagram="https://instagram.com/alpha", default_place_id=None,
            source="studentactivities",
        )
        beta = rows["beta-society"]
        assert beta.description is None  # empty -> None
        assert beta.url == "https://studentactivities.brown.edu/organizations/beta-society"
        gamma = rows["gamma-collective"]
        assert gamma.source == "gsc"
        assert gamma.url is None  # shared directory URL is not an org URL
        assert SOURCE_BY_GROUP_TYPE == {
            "Undergraduate student group": "studentactivities",
            "Graduate student group": "gsc",
        }

    def test_slug_collisions_are_stable_in_source_order(self, workspace: Workspace) -> None:
        result = workspace.run(
            workspace.clubs_csv(
                club_row(name="Chinese Students and Scholars Association"),
                club_row(
                    group_type="Graduate student group",
                    name="Chinese Students and Scholars Association",
                    funding_category="",
                    tags="Graduate Student Council recognized group",
                ),
            ),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
        )
        assert [row.id for row in result.rows] == [
            "chinese-students-and-scholars-association",
            "chinese-students-and-scholars-association-2",
        ]

    def test_contact_data_is_dropped_with_documented_counts(self, workspace: Workspace) -> None:
        result = workspace.run(
            workspace.clubs_csv(club_row(name="Alpha Club")),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
        )
        published = (workspace.seeds_path).read_text(encoding="utf-8")
        assert "contact@brown.edu" not in published
        assert "A. Advisor" not in published
        dropped = dict(result.dropped_fields)
        assert dropped["contact_emails"] == 1
        assert dropped["advisor"] == 1
        assert set(dropped) == set(DROPPED_FIELD_COLUMNS)

    def test_zero_recurrences_emit(self, workspace: Workspace) -> None:
        result = workspace.run(
            workspace.clubs_csv(club_row()),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
        )
        assert result.recurrence_emissions == 0


class TestLinkageAndDefaultPlace:
    def test_linked_org_with_evidence_gets_default_place(self, workspace: Workspace) -> None:
        clubs = workspace.clubs_csv(club_row(name="Alpha Office"))
        groups = workspace.groups_json("Alpha Office", "Unrelated Office")
        events = workspace.events_csv(
            *(f"{n},E,Alpha Office,Sayles Hall,false" for n in range(3))
        )
        result = workspace.run(
            clubs, groups, events, resolver=StubResolver({"Sayles Hall": "sayles-hall"})
        )
        (row,) = result.rows
        assert row.default_place_id == "sayles-hall"
        evidence = result.default_place_evidence["alpha-office"]
        assert evidence.awarded and evidence.observations == 3
        sidecar = json.loads(workspace.sidecar_path.read_text(encoding="utf-8"))
        assert sidecar == {
            "schema_version": 1,
            "generated_at": "2026-07-29T12:00:00Z",
            "mappings": [
                {
                    "organization_id": "alpha-office",
                    "livewhale_group": "Alpha Office",
                    "match_method": "exact",
                    "score": 100.0,
                }
            ],
        }

    def test_insufficient_evidence_leaves_default_place_null(self, workspace: Workspace) -> None:
        clubs = workspace.clubs_csv(club_row(name="Alpha Office"))
        groups = workspace.groups_json("Alpha Office")
        events = workspace.events_csv(
            "1,E,Alpha Office,Sayles Hall,false",
            "2,E,Alpha Office,Sayles Hall,false",
        )
        result = workspace.run(
            clubs, groups, events, resolver=StubResolver({"Sayles Hall": "sayles-hall"})
        )
        (row,) = result.rows
        assert row.default_place_id is None
        assert result.default_place_evidence["alpha-office"].awarded is False


class TestGates:
    def test_below_minimum_organizations_publishes_nothing(self, workspace: Workspace) -> None:
        result = workspace.run(
            workspace.clubs_csv(club_row()),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
            min_organizations=2,
        )
        assert not result.gates.passed
        failed = {check.name for check in result.gates.checks if not check.passed}
        assert failed == {"organizations"}
        assert result.published_count is None
        assert result.sidecar_mappings is None
        assert not workspace.seeds_path.exists()
        assert not workspace.sidecar_path.exists()

    def test_unknown_vocabulary_fails_closed_and_reports_values(
        self, workspace: Workspace
    ) -> None:
        result = workspace.run(
            workspace.clubs_csv(
                club_row(name="Alpha Club"),
                club_row(name="Drifted Club", funding_category="Category 3"),
                club_row(name="Other Drift", group_type="Faculty reading circle"),
            ),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
        )
        assert not result.gates.passed
        failed = {check.name for check in result.gates.checks if not check.passed}
        assert failed == {"vocabulary"}
        assert result.unknown_vocabulary == (
            "funding_category='Category 3'",
            "group_type='Faculty reading circle'",
        )
        assert result.published_count is None
        assert not workspace.seeds_path.exists()

    def test_failed_gates_leave_existing_outputs_untouched(self, workspace: Workspace) -> None:
        workspace.seeds_path.parent.mkdir(parents=True)
        workspace.seeds_path.write_text("previous\n", encoding="utf-8")
        workspace.sidecar_path.write_text("{}", encoding="utf-8")
        workspace.run(
            workspace.clubs_csv(club_row()),
            workspace.groups_json("Unrelated Office"),
            workspace.events_csv(),
            min_organizations=99,
        )
        assert workspace.seeds_path.read_text(encoding="utf-8") == "previous\n"
        assert workspace.sidecar_path.read_text(encoding="utf-8") == "{}"


class TestRealExportRegression:
    """The measured Task 7 numbers over the real inputs."""

    @pytest.fixture(scope="class")
    def result(self, tmp_path_factory: pytest.TempPathFactory):
        workspace = Workspace(tmp_path_factory.mktemp("clubs-real"))
        return run_clubs_job(
            REAL_CSV,
            groups_path=REAL_GROUPS,
            events_csv_path=REAL_EVENTS,
            resolver=PlaceResolver.from_files(),
            seeds_path=workspace.seeds_path,
            sidecar_path=workspace.sidecar_path,
            staging_root=workspace.staging_root,
            generated_at=datetime(2026, 7, 29, 12, 0, tzinfo=UTC),
        ), workspace

    def test_gates_pass_and_457_organizations_publish(self, result) -> None:
        job_result, workspace = result
        assert MIN_ORGANIZATIONS == 400
        assert job_result.gates.passed
        assert job_result.published_count == 457
        assert job_result.duplicates_dropped == 0
        rows = [
            OrganizationRow.model_validate(json.loads(line))
            for line in workspace.seeds_path.read_text(encoding="utf-8").splitlines()
        ]
        assert len(rows) == 457
        identities = [model_identity(row) for row in rows]
        assert identities == sorted(identities)
        assert len(set(identities)) == len(identities)
        assert {row.kind for row in rows} == {"club"}
        assert {row.category for row in rows} == {None}
        assert {row.source for row in rows} == {"studentactivities", "gsc"}

    def test_no_livewhale_link_is_claimed(self, result) -> None:
        job_result, workspace = result
        methods = [d.method for d in job_result.link_decisions if d.method is not None]
        assert methods == []
        reasons: dict[str, int] = {}
        for decision in job_result.link_decisions:
            if decision.reason:
                reasons[decision.reason] = reasons.get(decision.reason, 0) + 1
        assert reasons == {
            "below-threshold": 445,
            "ambiguous-margin": 1,
            "degenerate-subset": 11,
        }
        sidecar = json.loads(workspace.sidecar_path.read_text(encoding="utf-8"))
        assert sidecar["schema_version"] == 1
        assert sidecar["mappings"] == []
        assert job_result.sidecar_mappings == 0

    def test_no_default_place_is_awarded(self, result) -> None:
        job_result, _ = result
        assert job_result.default_place_evidence == {}
        assert all(row.default_place_id is None for row in job_result.rows)

    def test_zero_recurrences_emit_from_the_real_export(self, result) -> None:
        job_result, _ = result
        assert job_result.recurrence_emissions == 0
