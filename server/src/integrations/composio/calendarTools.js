const { executeComposioAction } = require("./composioClient");
const { getActiveConnectedAccountId } = require("./connectionService");
const { TOOL_SLUGS } = require("./composioToolSlugs");
const { logComposioApprovalEvent } = require("./composioTracing");

const TOOLKIT = "googlecalendar";

function buildEventPreview(event) {
  return {
    summary: event.summary,
    description: event.description ?? null,
    start: event.startTime,
    end: event.endTime ?? null,
    location: event.location ?? null,
  };
}

function toComposioEventArgs(event) {
  return {
    summary: event.summary,
    description: event.description,
    start_datetime: event.startTime,
    end_datetime: event.endTime,
    location: event.location,
    timezone: event.timezone,
  };
}

async function runCalendarCreateEvent(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Google Calendar is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const events = Array.isArray(args.events) && args.events.length > 0
    ? args.events
    : [
        {
          summary: args.summary,
          description: args.description,
          startTime: args.startTime,
          endTime: args.endTime,
          location: args.location,
          timezone: args.timezone,
        },
      ];

  const preview = events.map(buildEventPreview);
  const isBulk = events.length > 1;
  const pendingType = isBulk ? "calendar_bulk_create" : "calendar_create_event";

  if (!args.confirmed) {
    return {
      ok: true,
      data: {
        preview,
        eventCount: events.length,
        pendingConfirmation: {
          type: pendingType,
          events,
          eventCount: events.length,
        },
      },
      summary: isBulk
        ? `Preview: ${events.length} calendar events ready. Say "yes, schedule them" to confirm.`
        : `Preview: "${events[0].summary}" on ${events[0].startTime}. Say "yes, schedule it" to confirm.`,
    };
  }

  logComposioApprovalEvent({
    type: pendingType,
    userId,
    approved: true,
  });

  const created = [];
  for (const event of events) {
    const result = await executeComposioAction(
      userId,
      TOOLKIT,
      TOOL_SLUGS.googlecalendar.createEvent,
      toComposioEventArgs(event),
      { connectedAccountId: accountId }
    );
    if (!result.ok) {
      return {
        ok: false,
        summary: result.summary || result.error,
        error: result.error,
        data: { created, failedEvent: buildEventPreview(event) },
      };
    }
    created.push(buildEventPreview(event));
  }

  return {
    ok: true,
    data: { created, eventCount: created.length },
    summary:
      created.length === 1
        ? `Created calendar event "${created[0].summary}".`
        : `Created ${created.length} calendar events.`,
  };
}

async function runCalendarListEvents(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Google Calendar is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const result = await executeComposioAction(
    userId,
    TOOLKIT,
    TOOL_SLUGS.googlecalendar.listEvents,
    {
      time_min: args.timeMin,
      time_max: args.timeMax,
      query: args.query,
      max_results: args.limit ?? 10,
    },
    { connectedAccountId: accountId }
  );

  if (!result.ok) {
    return { ok: false, summary: result.summary, error: result.error };
  }

  return {
    ok: true,
    data: result.data,
    summary: "Listed calendar events.",
  };
}

module.exports = {
  runCalendarCreateEvent,
  runCalendarListEvents,
};
