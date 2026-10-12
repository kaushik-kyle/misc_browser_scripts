# misc_browser_scripts

Userscripts for tweaking sites I use. Runs in Tampermonkey, Violentmonkey, or a similar userscript manager.

## Scripts

| Script | Site | Version | What it does | Install |
| --- | --- | --- | --- | --- |
| [Declutter LinkedIn](#declutter-linkedin) | `linkedin.com` | 3.2.0 | Hides LinkedIn News, Premium upsells, promoted posts, games/puzzles; can hide the home feed | [Install](https://raw.githubusercontent.com/kaushik-kyle/misc_browser_scripts/main/Declutter_Linkedin-updated.user.js) |
| [Instagram Seek Bar](#instagram-seek-bar-reels--feed) | `instagram.com` | 1.1.0 | Adds a click/drag seek line to reels and feed videos | [Install](https://raw.githubusercontent.com/kaushik-kyle/misc_browser_scripts/main/Instagram_Video_Seek_Timeline.user.js) |

## Installing a script

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) from your browser's extension store.
2. **Chrome / Edge only:** go to `chrome://extensions` → your script manager → **Details** and turn on **Allow User Scripts**. On older Chrome versions, turn on **Developer mode** at the top right of `chrome://extensions` instead.
3. Click **Install** in the table above. The script manager opens an install page; confirm it.
4. Reload the target site.

**Updates:** the script manager remembers the URL a script was installed from and checks it for a higher `@version`. You can also trigger a check from the manager's dashboard.

**Manual install:** if the install page doesn't open, open the `.user.js` file, copy all of it, then in the manager choose **Create a new script**, paste over the template, and save.

### Greasemonkey 4 (Firefox)

Greasemonkey 4 only offers the async `GM.*` API, not `GM_getValue` / `GM_setValue` / `GM_registerMenuCommand`:

- **Instagram Seek Bar** (`@grant none`) should work.
- **Declutter LinkedIn** won't run. Use Tampermonkey or Violentmonkey on Firefox for it.

---

## Declutter LinkedIn

**File:** [`Declutter_Linkedin-updated.user.js`](Declutter_Linkedin-updated.user.js)

A patched copy of [Declutter LinkedIn by August4067](https://greasyfork.org/scripts/520957) (MIT). The upstream update URLs were removed, so installing it from here won't pull in the upstream version.

| Setting | Default | What gets hidden |
| --- | --- | --- |
| Remove LinkedIn News | on | News module, "Top stories", news story links |
| Remove Premium upsells | on | Premium links, badges, and "Try Premium" cards |
| Remove promoted posts | on | "Promoted" posts in the home feed |
| Remove games/puzzles | on | Games links and "Today's puzzles" |
| Hide feed | off | The whole home feed (replaced by a "Feed hidden" banner). Other pages are unaffected. |

**Changing settings:** while on LinkedIn, click the script manager's toolbar icon and toggle the ✓/✗ entries, then refresh the page.

**Limitations:** some rules match English UI text, so they won't fire if LinkedIn is set to another language. LinkedIn changes its markup often; if something reappears, a selector probably broke.

---

## Instagram Seek Bar (Reels + Feed)

**File:** [`Instagram_Video_Seek_Timeline.user.js`](Instagram_Video_Seek_Timeline.user.js)

- Adds a thin red progress line (with buffered range) to the bottom edge of reels, feed videos, and the post dialog.
- Click to jump, or drag to scrub with a time popup.
- Clicking the line won't pause, like, or open the post.
- Hidden on small previews and when something (comments, dialogs, nav) covers the video.

Line thickness, grab-area height, and the minimum video size are constants at the top of the file.

---

## License

Declutter LinkedIn is MIT-licensed by its original author (see the script header). The repo doesn't have a license file covering the other script.
