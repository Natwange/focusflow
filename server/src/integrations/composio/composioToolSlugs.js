/** Composio action slugs — override via env if toolkit versions change. */
const TOOL_SLUGS = {
  googlecalendar: {
    createEvent:
      process.env.COMPOSIO_SLUG_GOOGLECALENDAR_CREATE_EVENT ||
      "GOOGLECALENDAR_CREATE_EVENT",
    listEvents:
      process.env.COMPOSIO_SLUG_GOOGLECALENDAR_LIST_EVENTS ||
      "GOOGLECALENDAR_FIND_EVENT",
  },
  gmail: {
    sendEmail:
      process.env.COMPOSIO_SLUG_GMAIL_SEND_EMAIL || "GMAIL_SEND_EMAIL",
    createDraft:
      process.env.COMPOSIO_SLUG_GMAIL_CREATE_DRAFT || "GMAIL_CREATE_EMAIL_DRAFT",
  },
  notion: {
    createPage:
      process.env.COMPOSIO_SLUG_NOTION_CREATE_PAGE || "NOTION_CREATE_NOTION_PAGE",
  },
};

const SUPPORTED_TOOLKITS = Object.freeze(["googlecalendar", "gmail", "notion"]);

function isSupportedToolkit(toolkit) {
  return SUPPORTED_TOOLKITS.includes(String(toolkit ?? "").toLowerCase());
}

module.exports = {
  TOOL_SLUGS,
  SUPPORTED_TOOLKITS,
  isSupportedToolkit,
};
