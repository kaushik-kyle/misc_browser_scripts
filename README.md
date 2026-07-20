# Declutter LinkedIn

This repository contains a Tampermonkey/Greasemonkey userscript that removes LinkedIn clutter: news, ads, premium upsells, promoted posts, and (optionally) hides the home feed.

- **Script file**: [Declutter_Linkedin-updated.js](Declutter_Linkedin-updated.js)

**What it does**
- **Remove LinkedIn News**: hides news modules and story links.
- **Remove Premium upsells**: hides premium badges, links and upsell sections.
- **Remove promoted posts**: hides sponsored/promoted posts on the home feed.
- **Remove games/puzzles**: hides games and puzzles links/sections.
- **Hide feed (optional)**: completely hides the home feed and shows a banner with instructions to re-enable.

**Installation**
1. Install Tampermonkey (or Greasemonkey) in your browser.
2. Open the script file in the extension or add it as a new userscript using the contents of [Declutter_Linkedin-updated.js](Declutter_Linkedin-updated.js).
3. The script runs on any URL matching `https://www.linkedin.com/*` and executes at `document-start`.

Alternatively, the script references an upstream install/update endpoint:
- `downloadURL`: https://update.greasyfork.org/scripts/520957/Declutter%20LinkedIn.user.js
- `updateURL`: https://update.greasyfork.org/scripts/520957/Declutter%20LinkedIn.meta.js

**Settings / Usage**
- Toggle options via the Tampermonkey/Greasemonkey menu (registered menu commands):
	- Hide feed (home page only) — default: disabled
	- Remove LinkedIn News — default: enabled
	- Remove Premium upsells — default: enabled
	- Remove promoted posts — default: enabled
	- Remove games/puzzles — default: enabled
- Some options apply only to the home feed to avoid hiding content on other LinkedIn sections (Jobs, Search, etc.).

**Customization**
- The script contains a small CONFIG block near the top for polling and debug toggles.
- To change defaults permanently, edit the corresponding values in [Declutter_Linkedin-updated.js](Declutter_Linkedin-updated.js) before installing.

**Technical notes**
- Uses GM_getValue/GM_setValue and GM_registerMenuCommand for persistent settings and menu toggles.
- Detects SPA navigation and re-applies filtering via polling + a MutationObserver.
- Applies scoped CSS so feed-hiding never bleeds onto other LinkedIn pages.


