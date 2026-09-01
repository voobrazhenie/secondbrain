/* The sections a person can be given, in the order the home page lists them.
 *
 * One list, read by the home page to decide which cards to show and by the
 * admin pages to draw the checkboxes. Adding a section here is what puts it in
 * both places; `key` is what gets stored in features/{uid}, so it must not
 * change once a section has been switched on for somebody. */
export const SECTIONS = [
  { key: "exercise",      label: "Exercise",       path: "exercise/" },
  { key: "dailyplan",     label: "DailyPlan",      path: "dailyplan/" },
  { key: "jobs",          label: "Job search",     path: "jobs/" },
  { key: "streams",       label: "Streams",        path: "streams/" },
  { key: "ideas",         label: "Startup ideas",  path: "ideas/" },
  { key: "finance",       label: "Finance",        path: "finance/" },
  { key: "opportunities", label: "Opportunities",  path: "opportunities/" }
];

/* Nothing on, which is what an account with no features document gets. A new
   person sees an empty home page until somebody turns a section on for them —
   deliberately, so an invitation is a decision rather than a default. */
export const noSections = () => Object.fromEntries(SECTIONS.map(s => [s.key, false]));
