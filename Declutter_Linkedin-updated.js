// ==UserScript==
// @name         Declutter LinkedIn
// @namespace    August4067
// @version      3.2.0
// @description  Remove news, ads, clutter, and optionally hide the home feed only
// @author       August4067
// @license      MIT
// @match        https://www.linkedin.com/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @icon         https://www.linkedin.com/favicon.ico
// ==/UserScript==
// NOTE: @downloadURL / @updateURL removed on purpose, so Tampermonkey does not
// auto-update this patched copy back to the upstream version.

/* jshint esversion: 11 */
/* eslint-env es2020 */

(function () {
  "use strict";

  // ============================================
  // CONFIGURATION
  // ============================================

  const CONFIG = {
    debounceMs: 250,      // wait for LinkedIn to finish a burst of DOM changes
    maxPendingRoots: 300, // above this, do one full scan instead of queueing nodes
    maxLabelLength: 120,  // labels we look for are short, so skip long post text
    debug: false,
  };

  const SETTINGS_CONFIG = {
    hideFeed: { displayName: "Hide feed (home page only)", default: false },
    removeNews: { displayName: "Remove LinkedIn News", default: true },
    removePremiumUpsells: { displayName: "Remove Premium upsells", default: true },
    removePromotedPosts: { displayName: "Remove promoted posts", default: true },
    removeGames: { displayName: "Remove games/puzzles", default: true },
  };

  const STYLE_ID = "declutter-linkedin-styles";
  const BANNER_ID = "dl-feed-hidden-banner";
  const PAGE_ATTR = "data-dl-home-feed";
  const OVERSIZED_DESCENDANT_THRESHOLD = 200;
  const PREMIUM_TEXT =
    /^(?:try (?:premium|recruiter)|unlock all with premium|claim premium|your premium features$)/i;

  // Settings are read once per page load. Toggling from the menu asks for a
  // refresh anyway, so there is no need to hit GM storage on every pass.
  const S = {};
  for (const [key, cfg] of Object.entries(SETTINGS_CONFIG)) {
    S[key] = GM_getValue(key, cfg.default);
  }

  // ============================================
  // UTILITIES
  // ============================================

  function debug(message, ...args) {
    if (CONFIG.debug) console.log(`[Declutter LinkedIn] ${message}`, ...args);
  }

  function isHomeFeed() {
    const path = location.pathname;
    return path === "/" || path === "/feed" || path.startsWith("/feed/");
  }

  // Toggles an attribute on <html>. All page-specific CSS is gated on it, so the
  // stylesheet itself never has to be rewritten on SPA navigation.
  function updatePageAttr() {
    const root = document.documentElement;
    if (!root) return;
    const want = isHomeFeed();
    const has = root.getAttribute(PAGE_ATTR) === "1";
    if (want && !has) root.setAttribute(PAGE_ATTR, "1");
    else if (!want && has) root.removeAttribute(PAGE_ATTR);
  }

  // Refuses to hide a container that looks like "basically the whole page".
  // Bounded walk: stops counting at the threshold instead of collecting
  // every descendant with querySelectorAll("*").
  const tooBig = new WeakSet();
  function looksLikeWholePage(el) {
    if (!el) return true;
    if (tooBig.has(el)) return true;
    if (el === document.body || el === document.documentElement) return true;
    if (el.matches('main, [role="main"]') || el.querySelector('main, [role="main"]')) {
      tooBig.add(el);
      return true;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let count = 0;
    while (walker.nextNode()) {
      if (++count > OVERSIZED_DESCENDANT_THRESHOLD) {
        tooBig.add(el);
        return true;
      }
    }
    return false;
  }

  function hide(el, reason) {
    if (!el || el.dataset.dlHidden) return;
    el.style.setProperty("display", "none", "important");
    el.dataset.dlHidden = "1";
    debug(`Hidden ${reason}`);
  }

  function hideSafe(el, reason) {
    if (!el || el.dataset.dlHidden || looksLikeWholePage(el)) return;
    hide(el, reason);
  }

  // Runs fn on root (if it matches) and on every matching descendant.
  function each(root, selector, fn) {
    if (root.matches && root.matches(selector)) fn(root);
    root.querySelectorAll(selector).forEach(fn);
  }

  // Climbs through up to 3 single-child wrapper divs.
  function climbWrappers(el) {
    let target = el;
    let cur = el?.parentElement;
    let climbs = 0;
    while (cur && cur !== document.body && cur.children.length === 1 && climbs < 3) {
      if (cur.matches('main, [role="main"]')) break;
      target = cur;
      cur = cur.parentElement;
      climbs++;
    }
    return target;
  }

  function findCard(el) {
    let card = el.closest("[componentkey]");
    if (!card) return null;
    let parent = card.parentElement?.closest("[componentkey]");
    while (parent) {
      card = parent;
      parent = card.parentElement?.closest("[componentkey]");
    }
    return climbWrappers(card);
  }

  function findPremiumContainer(el) {
    return (
      el.closest('li[data-testid="carousel-child-container"]') ||
      el.closest('[role="listitem"]') ||
      el.closest("[componentkey]") ||
      findCard(el)
    );
  }

  // ============================================
  // CSS (built once, never rewritten)
  // ============================================

  function buildCss() {
    const parts = [`#${BANNER_ID} { display: none !important; }`];

    if (S.removePremiumUpsells) {
      parts.push(`
        a[href*="/premium/products/"],
        a[href*="/premium/my-premium/"],
        li:has(> a[href*="/premium/products/"]),
        li:has(> a[href*="/premium/my-premium/"]),
        [data-view-name="seeker-next-best-action-card"],
        [data-view-name="premium-upsell-link"] { display: none !important; }
      `);
    }

    if (S.removeGames) {
      parts.push(`a[href*="/games/"] { display: none !important; }`);
    }

    if (S.hideFeed) {
      // Hide the WHOLE feed container, not the individual posts. Hiding only
      // the posts leaves LinkedIn's infinite-scroll trigger on screen, so it
      // keeps fetching and rendering posts nobody can see.
      parts.push(`
        html[${PAGE_ATTR}="1"] [data-testid="mainFeed"],
        html[${PAGE_ATTR}="1"] .share-box-feed-entry__closed-share-box { display: none !important; }
        html[${PAGE_ATTR}="1"] #${BANNER_ID} { display: flex !important; }
      `);
    }

    return parts.join("\n");
  }

  const CSS = buildCss();

  // Only touches the DOM if the <style> is missing.
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================
  // FEED HIDDEN BANNER
  // ============================================

  function ensureFeedBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const feedList = document.querySelector('[data-testid="mainFeed"]');
    if (!feedList || !feedList.parentNode) return;

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "display:none",
      "align-items:center",
      "justify-content:center",
      "flex-direction:column",
      "gap:12px",
      "padding:32px 24px",
      "margin:8px 0",
      "background:var(--color-background-container,#fff)",
      "border:1px solid var(--color-border-faint,#e0e0e0)",
      "border-radius:8px",
      "font-family:inherit",
      "color:var(--color-text-low-emphasis,#666)",
      "text-align:center",
    ].join(";");

    banner.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" style="opacity:0.5">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
                 a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8
                 a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
      <span style="font-size:14px;font-weight:600;">Feed hidden</span>
      <span style="font-size:13px;">
        Turn off <em>Hide feed</em> in the Tampermonkey menu to show posts again.
      </span>
    `;

    feedList.parentNode.insertBefore(banner, feedList);
    debug("Feed hidden banner inserted");
  }

  // ============================================
  // SCANNING (one pass per subtree)
  // ============================================

  function scan(root, home) {
    // --- Text labels on <p> elements, single pass ---
    each(root, "p", (p) => {
      if (p.dataset.dlHidden) return;
      const raw = p.textContent;
      if (!raw || raw.length > CONFIG.maxLabelLength) return;
      const text = raw.trim();

      if (S.removeNews) {
        if (text === "LinkedIn News") {
          hideSafe(p.closest("[componentkey]"), "LinkedIn News section");
          return;
        }
        if (text === "Top stories") {
          hide(p, "Top stories label");
          return;
        }
      }

      if (S.removeGames && (text === "Today\u2019s puzzles" || text === "Today's puzzles")) {
        hideSafe(climbWrappers(p.closest("[componentkey]") || p.parentElement), "games section");
        return;
      }

      // Home feed only: job cards on /jobs also say "Promoted".
      if (S.removePromotedPosts && home && text === "Promoted") {
        if (p.closest('[data-testid="mainFeed"]')) {
          hide(p.closest('[role="listitem"]'), "promoted post");
        }
        return;
      }

      if (S.removePremiumUpsells && home && PREMIUM_TEXT.test(text)) {
        hideSafe(findPremiumContainer(p), "Premium upsell (text)");
      }
    });

    // --- News links and their "Show more" buttons ---
    if (S.removeNews) {
      each(root, 'a[href*="/news/story/"]', (a) => hide(a, "news story link"));

      each(root, "button", (btn) => {
        if (btn.dataset.dlHidden) return;
        const raw = btn.textContent;
        if (!raw || raw.length > 40) return;
        const text = raw.trim();
        if (
          (text === "Show more" || text === "Show more news") &&
          btn.closest("[componentkey]")?.querySelector('a[href*="/news/story/"]')
        ) {
          hide(btn, "news Show more button");
        }
      });
    }

    // --- Premium badges and links outside feed posts / job cards ---
    if (S.removePremiumUpsells) {
      each(root, "svg#premium-badge-v2-xsmall, svg#premium-chip-v2-small", (svg) => {
        if (svg.closest('[role="listitem"]')) return;
        hideSafe(svg.closest("section") || svg.closest("[componentkey]"), "Premium upsell (badge)");
      });

      each(root, 'a[href*="/premium/products/"], a[href*="/premium/my-premium/"]', (a) => {
        if (a.closest('[role="listitem"]')) return;
        hideSafe(findPremiumContainer(a), "Premium upsell (link)");
      });
    }
  }

  // ============================================
  // SCHEDULING
  // ============================================

  let lastUrl = location.href;
  let fullScan = true;      // first run scans the whole page
  const pending = new Set(); // subtrees added since the last run
  let timer = null;

  function checkNavigation() {
    if (location.href === lastUrl) return;
    debug(`Navigation: ${lastUrl} -> ${location.href}`);
    lastUrl = location.href;
    updatePageAttr();
    fullScan = true;
    pending.clear();
  }

  // Background tabs do no work. They just remember to do one full scan
  // when they become visible again.
  function parkWhileHidden() {
    fullScan = true;
    pending.clear();
  }

  function schedule() {
    if (timer !== null) return;
    if (document.hidden) {
      parkWhileHidden();
      return;
    }
    timer = setTimeout(run, CONFIG.debounceMs);
  }

  function run() {
    timer = null;
    if (document.hidden) {
      parkWhileHidden();
      return;
    }
    try {
      ensureStyle();
      updatePageAttr();
      const home = isHomeFeed();
      if (S.hideFeed && home) ensureFeedBanner();

      if (fullScan) {
        if (!document.body) return; // next mutation will reschedule
        fullScan = false;
        pending.clear();
        scan(document.body, home);
      } else {
        const roots = Array.from(pending);
        pending.clear();
        for (const r of roots) {
          if (r.isConnected) scan(r, home);
        }
      }
    } catch (err) {
      debug("Error:", err);
    }
  }

  // Watches only for added nodes. Our own changes are inline styles and
  // data attributes (not observed), plus the one-off <style> and banner,
  // which are ignored, so the script can no longer re-trigger itself.
  const observer = new MutationObserver((mutations) => {
    checkNavigation();
    if (document.hidden) {
      parkWhileHidden();
      return;
    }
    if (!fullScan) {
      outer: for (const m of mutations) {
        for (const node of m.addedNodes) {
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (!el || el.id === STYLE_ID || el.id === BANNER_ID) continue;
          pending.add(el);
          if (pending.size > CONFIG.maxPendingRoots) {
            fullScan = true;
            pending.clear();
            break outer;
          }
        }
      }
    }
    if (fullScan || pending.size > 0) schedule();
  });

  // ============================================
  // MENU
  // ============================================

  function setupMenu() {
    for (const [key, cfg] of Object.entries(SETTINGS_CONFIG)) {
      GM_registerMenuCommand(`${S[key] ? "\u2713" : "\u2717"} ${cfg.displayName}`, () => {
        const next = !GM_getValue(key, cfg.default);
        GM_setValue(key, next);
        const note =
          key === "hideFeed"
            ? "\nApplies to the home feed only. Jobs, Search, and all other pages are unaffected.\nRefresh to apply."
            : "\nRefresh to apply.";
        alert(`${cfg.displayName} ${next ? "enabled" : "disabled"}.${note}`);
      });
    }
  }

  // ============================================
  // INITIALISATION
  // ============================================

  try {
    updatePageAttr();
    ensureStyle();
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule();
    });
    window.addEventListener("popstate", () => {
      checkNavigation();
      schedule();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }

    setupMenu();
  } catch (e) {
    console.error("[Declutter LinkedIn] Init failed:", e);
  }
})();