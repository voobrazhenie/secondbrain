/* Documents to start a test from. Small on purpose: these are here to exercise
 * the page, not to stand in for anybody's real routine — which is exactly why
 * there is no routine in this repository any more. */

export const SECTION_KEYS = [
  "exercise", "dailyplan", "jobs", "streams", "ideas", "finance", "opportunities"
];

export const sections = on => Object.fromEntries(SECTION_KEYS.map(k => [k, on.includes(k)]));

export const routine = (startDate = "2026-01-01") => ({
  schemaVersion: 1,
  startDate,
  principles: null,
  oneOffs: null,
  daily: [
    { title: "Meds", emoji: "\u{1F48A}", items: [
      { id: "m-one", emoji: "\u{1F48A}", text: "One", detail: "As prescribed.", xp: 10 },
      { id: "m-two", emoji: "\u{1F48A}", text: "Two", xp: 10 }
    ] },
    { title: "Recover", emoji: "\u{1F319}", items: [
      { id: "r-sleep", emoji: "\u{1F634}", text: "Sleep", xp: 20 }
    ] }
  ]
});

export const person = (uid, email, name = null) => [`profiles/${uid}`, { email, name }];
export const admin = uid => [`admins/${uid}`, { email: "admin@example.com" }];
export const features = (uid, on, extras) => [
  `features/${uid}`,
  extras ? { sections: sections(on), extras } : { sections: sections(on) }
];
export const plan = (uid, value = routine()) => [`users/${uid}/config/plan`, value];
