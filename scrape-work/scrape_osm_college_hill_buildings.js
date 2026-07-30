(() => {
  const query =
    "[out:json][timeout:60];way[building](41.820,-71.410,41.834,-71.393);out tags center;";
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  return fetch("/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: query }).toString(),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((payload) =>
      JSON.stringify({
        osm_timestamp: payload.osm3s?.timestamp_osm_base || "",
        generator: payload.generator || "",
        license: "OpenStreetMap contributors, ODbL",
        query,
        items: (payload.elements || []).map((element) => {
          const tags = element.tags || {};
          const name = normalizeText(tags.name);
          const operator = normalizeText(tags.operator);
          const owner = normalizeText(tags.owner);
          const brownRelevant =
            /brown university/i.test(`${name} ${operator} ${owner}`) ||
            ["university", "college", "dormitory"].includes(tags.building) ||
            tags.amenity === "university";
          return {
            osm_type: element.type || "",
            osm_id: element.id || "",
            name,
            brown_relevant_hint: brownRelevant,
            building_type: normalizeText(tags.building),
            amenity: normalizeText(tags.amenity),
            operator,
            owner,
            address_number: normalizeText(tags["addr:housenumber"]),
            address_street: normalizeText(tags["addr:street"]),
            address_city: normalizeText(tags["addr:city"]),
            address_state: normalizeText(tags["addr:state"]),
            address_postcode: normalizeText(tags["addr:postcode"]),
            levels: normalizeText(tags["building:levels"]),
            wikidata: normalizeText(tags.wikidata),
            wikipedia: normalizeText(tags.wikipedia),
            website: normalizeText(tags.website),
            latitude: element.center?.lat ?? "",
            longitude: element.center?.lon ?? "",
            osm_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
            source_url: "https://overpass-api.de/",
            license: "OpenStreetMap contributors, ODbL",
          };
        }),
      }),
    );
})()
