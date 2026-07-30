(() => {
  const source = JSON.parse(document.body.innerText);
  const stripHtml = (value) => {
    const container = document.createElement("div");
    container.innerHTML = value || "";
    return (container.textContent || "").replace(/\s+/g, " ").trim();
  };
  const extractEmails = (value) => [
    ...new Set(
      String(value || "")
        .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [],
    ),
  ];

  return JSON.stringify(
    source.map((event) => ({
      event_id: event.id,
      title: event.title || "",
      source_url: event.url || "",
      start_date_iso: event.date_iso || "",
      end_date_iso: event.date2_iso || "",
      display_date: event.date || "",
      display_time: event.date_time || "",
      timezone: event.timezone || "",
      all_day: Boolean(event.is_all_day),
      repeats: event.repeats || "",
      repeats_until: event.repeats_until || "",
      series_start: event.repeats_start || "",
      series_end: event.repeats_end || "",
      canceled: Boolean(event.is_canceled),
      online: Boolean(event.is_online),
      online_type: event.online_type || "",
      online_url: event.online_url || "",
      location: event.location || event.location_title || "",
      latitude: event.location_latitude ?? "",
      longitude: event.location_longitude ?? "",
      cost: event.cost || "",
      organizer: event.group || "",
      event_types: (event.event_types || []).join(" | "),
      audiences: (event.event_types_audience || []).join(" | "),
      campus_categories: (event.event_types_campus || []).join(" | "),
      tags: (event.tags || []).join(" | "),
      contact: stripHtml(event.contact_info),
      contact_emails: extractEmails(event.contact_info).join(" | "),
      registration_available: Boolean(event.has_registration),
      registration_limit: event.registration_limit ?? "",
      wait_list_available: Boolean(event.has_wait_list),
      thumbnail_url: event.thumbnail || event.image || "",
      thumbnail_alt: event.thumbnail_alt || "",
      api_source_url: "https://events.brown.edu/live/json/events",
    })),
  );
})()
