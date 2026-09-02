# Design guide

Read this before building a page or changing how something looks. `theme.css` is
the source of truth for colours, strokes and shadows; this file is for what a
stylesheet cannot say: what a new page needs in order to be part of the app, how
interactions behave, who it is for, and the rules arrived at by getting them
wrong.

## Who it is for

- **Nikita's taste, across several rounds:** compact, gamified, playful,
  stylish. Not corporate, not skeuomorphic. He has iterated through Figma
  mockups, Pinterest references and direct HTML before landing here — don't
  propose a new visual direction without knowing that history exists, and ask
  what changed his mind before if it matters.
- **He is not a designer by trade but has specific taste**, and will say
  directly what is off. Take that literally rather than as a vague signal.
- **The app has more than one person in it now.** A screen is not only his: a
  new person opens on an empty list, with the points, the priority card and the
  streaks switched off, and without the sections nobody has given them. That
  empty version is what a beta tester meets first, so check it — it is the
  screen most likely to look unfinished and least likely to get looked at.

## Making a new page

A section is a folder with an `index.html` in it. There is no build step, so
everything below is copied from an existing page rather than generated.

**In the head.** Without these a section opens in the browser's own bar instead
of inside the installed app, with the close and share controls over the page.
Exercise and Admin shipped without them; `tests/head.test.mjs` now fails if a
page is missing any.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#…">           <!-- the page's own background -->
<link rel="manifest" href="../manifest.webmanifest">
<link rel="apple-touch-icon" href="../icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Second Brain">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="stylesheet" href="../theme.css">
```

`apple-mobile-web-app-status-bar-style` is `default` on a light page and
`black-translucent` on a dark one — `admin/` is the only dark page, and a light
status bar would put black text on black.

**Sign-in.** Use `shared/firebase.js`; do not write another copy of the popup
and its redirect fallback. It also records the profile card that makes the
person visible in `admin/`, so a page that rolls its own sign-in leaves them
invisible there.

```js
const fbLib = await import("../shared/firebase.js");
const fb = await fbLib.connect();          // throws with code "no-config"
fbLib.watchAuth(fb, user => onAuth(user));
```

**The gate.** Every page is signed-in only. Put `id="wrap" data-auth="checking"`
on the page wrapper and hide the content until it is `"in"`:

```css
#wrap:not([data-auth="in"]) .thelist{ display:none }
```

Nothing personal may be on screen before Firebase has said who is looking, and
the markup ships as `checking` so a cached page cannot flash the last person's
data.

**Storage.** Nothing about an account goes on the device. No `localStorage`
copies — not the list, not the settings, not which sections are folded up. It
lives in memory while the page is open and in Firestore between visits;
Firebase's own offline cache is what makes it work with no signal, and that one
is filed under the document path so it can never be handed to the next account.
Breaking this put one person's day and task list into another account, twice.

**A new section is off by default.** Add it to `shared/sections.js` and it
appears in `admin/` as a checkbox and on the home page as a card, for whoever is
given it.

## The look

- Neo-brutalist: `--stroke` thick borders, squared corners, hard zero-blur
  shadows, solid colour blocks. No gradients, no rounded corners, no blur.
- Palette lives in `theme.css`. `--grey` is deliberately aliased to `--ink`:
  muted text renders solid black. `--faint` is the only real grey, and it is for
  neutral surfaces only — never muted text on `--yellow`, `--teal`, `--pink`,
  `--lime` or `--ink`. Use full contrast there and lean on size and weight.
- One column width for every section: `--page-width`.
- Every page opens with the `.crumbs` breadcrumb — `SECOND BRAIN` links home,
  the filled chip is where you are.
- Glyphs: no new emoji, no directional arrows. `▾` / `▴` on a card that opens
  and closes is the one exception.
- Dark pages are for tools, not for sections. `admin/` is black so there is
  never a moment's doubt about whether you are looking at the app or at
  everybody's settings.

## Interactions

- **Touch targets ≥ 44px.**
- **Cards are not buttons.** A row on a list has no press effect — no shift, no
  shadow change. What answers the tap is the thing the tap does: the tick
  arriving. Buttons still press.
- **Swipe left reveals Delete; the button deletes.** The card slides off a tray
  underneath and stays there until the button is tapped or the card is tapped
  shut. It commits nothing on its own. The pattern this replaced deleted once a
  finger crossed a third of the screen, which put the point of no return in the
  middle of a gesture. `dailyplan/` and `opportunities/` both do it this way;
  copy one of them.
- **Long press edits**, and a drag or a long press must never also fire the tap.
- **Undo, not confirm.** A destructive action happens and offers a toast with
  UNDO, rather than asking first.
- **Refresh on return.** A home-screen app is never really closed, so re-read
  on `visibilitychange` — throttled, and never while a dialog or an edit is
  open, since a re-render would take the open field with it.

## The trap that keeps catching us

`hidden` means hidden, but the browser's own rule for it is the weakest there
is, so any page rule that sets a display beats it. `theme.css` carries
`[hidden]{display:none!important}` for exactly this. When a test asks whether
something is hidden, it has to read computed style — asserting the property
passed for a page that was painting every switched-off button.
