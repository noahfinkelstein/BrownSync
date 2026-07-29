"""CAB Fall 2026 course meetings, ingested from the user-provided export.

Live acquisition (`cab.brown.edu` fose search/details) is blocked by an AWS
WAF bot challenge — a declared fixture gap since Task 3. The pipeline in this
package consumes the hash-pinned export
``ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv``
instead, keeping the plan's parser rigor, identity rules, and fail-closed
publication gates unchanged.
"""
