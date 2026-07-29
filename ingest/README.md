# brownsync-ingest

Python 3.12 ingestion package for BrownSync. Task 9 expands this README;
for now it records the gazetteer's data licensing.

## Gazetteer data attribution

The campus gazetteer merges a curated catalog
(`brownsync_ingest/gazetteer/aliases.yaml`) with building footprints,
centroids, addresses, and element ids extracted from OpenStreetMap via the
Overpass API (recorded offline fixture:
`fixtures/recorded/overpass/college-hill-buildings.json`).

Building footprints and addresses are © OpenStreetMap contributors and are
licensed under the Open Database License (ODbL) 1.0 —
<https://www.openstreetmap.org/copyright>. Rows derived from OSM carry
`source="osm"` and an `osm_id` of the form `way/<id>` or `relation/<id>`;
the same attribution string is exposed programmatically as
`CatalogBuild.attribution`. Any redistribution of the generated
`places.ndjson` seed must preserve this attribution.

Curated-only entries (outdoor spaces, dining venues inside larger
buildings, and off-bbox athletic venues) carry `source="curated"` with
hand-maintained coordinates.
