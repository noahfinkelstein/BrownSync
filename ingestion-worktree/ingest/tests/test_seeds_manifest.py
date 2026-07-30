"""Seeds-manifest tests: last-writer publication, hashes, mixed-generation rejection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from brownsync_ingest.seeds_manifest import (
    MANIFEST_NAME,
    publish_seeds_manifest,
    validate_seeds_manifest,
)


def write_artifact(seeds_dir: Path, name: str, content: str) -> Path:
    seeds_dir.mkdir(parents=True, exist_ok=True)
    path = seeds_dir / name
    path.write_text(content, encoding="utf-8")
    return path


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TestPublish:
    def test_document_carries_generation_timestamp_and_per_artifact_hashes(
        self, tmp_path: Path
    ) -> None:
        seeds = tmp_path / "seeds"
        write_artifact(seeds, "places.ndjson", '{"id":"sayles-hall"}\n')
        write_artifact(seeds, "athletics_venues.json", '{"schema_version":1}\n')

        document = publish_seeds_manifest(
            seeds,
            ["places.ndjson", "athletics_venues.json"],
            tmp_path / "staging",
            generation="abc123",
            generated_at="2026-07-29T00:00:00Z",
        )

        on_disk = json.loads((seeds / MANIFEST_NAME).read_text(encoding="utf-8"))
        assert on_disk == document
        assert on_disk["schema_version"] == 1
        assert on_disk["generation"] == "abc123"
        assert on_disk["generated_at"] == "2026-07-29T00:00:00Z"
        assert sorted(on_disk["artifacts"]) == [
            "athletics_venues.json",
            "places.ndjson",
        ]
        for name, entry in on_disk["artifacts"].items():
            path = seeds / name
            assert entry["sha256"] == sha256_of(path)
            assert entry["bytes"] == path.stat().st_size

    def test_default_generation_is_unique_per_publication(self, tmp_path: Path) -> None:
        seeds = tmp_path / "seeds"
        write_artifact(seeds, "places.ndjson", "{}\n")
        first = publish_seeds_manifest(seeds, ["places.ndjson"], tmp_path / "staging")
        second = publish_seeds_manifest(seeds, ["places.ndjson"], tmp_path / "staging")
        assert first["generation"] != second["generation"]
        assert first["generated_at"].endswith("Z")

    def test_missing_artifact_blocks_publication_and_leaves_manifest_untouched(
        self, tmp_path: Path
    ) -> None:
        seeds = tmp_path / "seeds"
        write_artifact(seeds, "places.ndjson", "{}\n")
        previous = publish_seeds_manifest(
            seeds, ["places.ndjson"], tmp_path / "staging", generation="gen-a"
        )
        with pytest.raises(FileNotFoundError):
            publish_seeds_manifest(
                seeds,
                ["places.ndjson", "course_meetings.ndjson"],
                tmp_path / "staging",
                generation="gen-b",
            )
        on_disk = json.loads((seeds / MANIFEST_NAME).read_text(encoding="utf-8"))
        assert on_disk == previous

    def test_no_staged_leftovers(self, tmp_path: Path) -> None:
        seeds = tmp_path / "seeds"
        staging = tmp_path / "staging"
        write_artifact(seeds, "places.ndjson", "{}\n")
        publish_seeds_manifest(seeds, ["places.ndjson"], staging)
        assert list(staging.iterdir()) == []


class TestValidate:
    def publish(self, tmp_path: Path) -> Path:
        seeds = tmp_path / "seeds"
        write_artifact(seeds, "places.ndjson", '{"id":"sayles-hall"}\n')
        write_artifact(seeds, "course_meetings.ndjson", '{"id":"202610-1-0"}\n')
        publish_seeds_manifest(
            seeds,
            ["places.ndjson", "course_meetings.ndjson"],
            tmp_path / "staging",
            generation="gen-a",
        )
        return seeds

    def test_fresh_bundle_is_valid(self, tmp_path: Path) -> None:
        seeds = self.publish(tmp_path)
        validation = validate_seeds_manifest(seeds)
        assert validation.ok
        assert validation.errors == ()
        assert validation.generation == "gen-a"

    def test_missing_manifest_is_rejected(self, tmp_path: Path) -> None:
        seeds = tmp_path / "seeds"
        seeds.mkdir()
        validation = validate_seeds_manifest(seeds)
        assert not validation.ok
        assert any("manifest" in error for error in validation.errors)
        assert validation.generation is None

    def test_rewritten_artifact_is_rejected_as_mixed_generation(
        self, tmp_path: Path
    ) -> None:
        seeds = self.publish(tmp_path)
        # a newer, interrupted generation replaced one artifact but never
        # reached the manifest: the set on disk is mixed
        write_artifact(seeds, "places.ndjson", '{"id":"newer-generation"}\n')
        validation = validate_seeds_manifest(seeds)
        assert not validation.ok
        assert any(
            "mixed-generation" in error and "places.ndjson" in error
            for error in validation.errors
        )
        # the previous manifest stays authoritative for what it recorded
        assert validation.generation == "gen-a"

    def test_deleted_artifact_is_rejected(self, tmp_path: Path) -> None:
        seeds = self.publish(tmp_path)
        (seeds / "course_meetings.ndjson").unlink()
        validation = validate_seeds_manifest(seeds)
        assert not validation.ok
        assert any("course_meetings.ndjson" in error for error in validation.errors)

    def test_expected_artifacts_must_match_exactly(self, tmp_path: Path) -> None:
        seeds = self.publish(tmp_path)
        validation = validate_seeds_manifest(
            seeds,
            expected_artifacts=[
                "places.ndjson",
                "course_meetings.ndjson",
                "athletics_venues.json",
            ],
        )
        assert not validation.ok
        assert any("athletics_venues.json" in error for error in validation.errors)

    def test_corrupt_manifest_json_is_rejected(self, tmp_path: Path) -> None:
        seeds = self.publish(tmp_path)
        (seeds / MANIFEST_NAME).write_text("{not json", encoding="utf-8")
        validation = validate_seeds_manifest(seeds)
        assert not validation.ok
        assert validation.generation is None

    def test_manifest_schema_is_enforced(self, tmp_path: Path) -> None:
        seeds = self.publish(tmp_path)
        document = json.loads((seeds / MANIFEST_NAME).read_text(encoding="utf-8"))
        del document["generation"]
        (seeds / MANIFEST_NAME).write_text(json.dumps(document), encoding="utf-8")
        validation = validate_seeds_manifest(seeds)
        assert not validation.ok
