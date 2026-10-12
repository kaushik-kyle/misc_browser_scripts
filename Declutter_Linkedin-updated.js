// ==UserScript==
// @name         Declutter LinkedIn
// @namespace    August4067
// @version      3.1.2
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
// @downloadURL https://update.greasyfork.org/scripts/520957/Declutter%20LinkedIn.user.js
// @updateURL https://update.greasyfork.org/scripts/520957/Declutter%20LinkedIn.meta.js
// ==/UserScript==

/* jshint esversion: 8 */
/* eslint-env es2017 */

(function () {
  "use strict";

  // ============================================
  // CONFIGURATION
  // ============================================

  const CONFIG = {
    pollInterval: 2000,
    throttleDelay: 100,
    debug: false,
  };

  const SETTINGS_CONFIG = {
    hideFeed: {
      displayName: "Hide feed (home page only)",
      default: false,
    },
    removeNews: {
      displayName: "Remove LinkedIn News",
      default: true,
    },
    removePremiumUpsells: {
      displayName: "Remove Premium upsells",
      default: true,
    },
    removePromotedPosts: {
      displayName: "Remove promoted posts",
      default: true,
    },
    removeGames: {
      displayName: "Remove games/puzzles",
      default: true,
    },
  };

  // ============================================
  // SETTINGS
  // ============================================

  class Setting {
    constructor(name, config) {
      this.name = name;
      this.displayName = config.displayName;
      this.default = config.default;
    }
    get value() { return GM_getValue(this.name, this.default); }
    set value(val) { GM_setValue(this.name, val); }
    toggle() { this.value = !this.value; }
  }

  const Settings = Object.fromEntries(
    Object.entries(SETTINGS_CONFIG).map(([name, config]) => [
      name, new Setting(name, config),
    ])
  );

  // ============================================
  // UTILITIES
  // ============================================

  function debug(message, ...args) {
    if (CONFIG.debug) console.log(`[Declutter LinkedIn] ${message}`, ...args);
  }

  // Safety guard: refuses to hide a container that looks like "basically
  // the whole page" rather than a small upsell card. Prevents ancestor-
  // climbing logic from nuking large sections (e.g. on /jobs/view/ pages
  // where a Premium badge can sit inside a long chain of single-child
  // wrapper divs).
  const OVERSIZED_DESCENDANT_THRESHOLD = 200;
  function looksLikeWholePage(el) {
    if (!el) return true;
    if (el === document.body || el === document.documentElement) return true;
    if (el.matches('main, [role="main"]')) return true;
    if (el.querySelector('main, [role="main"]')) return true;
    if (el.querySelectorAll("*").length > OVERSIZED_DESCENDANT_THRESHOLD) return true;
    return false;
  }

  // True ONLY on the home/feed page.
  // Identified by: path is / or /feed or /feed/*
  // AND the page does NOT have a path prefix belonging to another section.
  function isHomeFeed() {
    const path = location.pathname;
    if (path === "/" || path === "/feed" || path === "/feed/") return true;
    if (path.startsWith("/feed/")) return true;
    return false;
  }

  // Marks <html> with a real-time attribute reflecting the current page.
  // This is a second, independent gate (on top of scoping selectors to
  // [data-testid="mainFeed"]) so that feed-hiding CSS can never leak onto
  // other pages (e.g. /jobs) even if LinkedIn reuses component types/testids
  // across sections.
  function applyPageScopeAttr() {
    const root = document.documentElement;
    if (!root) return;
    if (isHomeFeed()) {
      root.setAttribute("data-dl-home-feed", "1");
    } else {
      root.removeAttribute("data-dl-home-feed");
    }
  }

  // ============================================
  // CSS INJECTION
  // ============================================

  function injectStyles() {
    applyPageScopeAttr();

    let style = document.getElementById("declutter-linkedin-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "declutter-linkedin-styles";
      (document.head || document.documentElement).appendChild(style);
    }

    const hideFeedActive = Settings.hideFeed.value && isHomeFeed();
    const hideGames = GM_getValue("removeGames", true);

    style.textContent = `
      /* ── Premium upsell links (nav area only — doesn't touch feed cards) ── */
      a[href*="/premium/products/"],
      a[href*="/premium/my-premium/"],
      li:has(> a[href*="/premium/products/"]),
      li:has(> a[href*="/premium/my-premium/"]),
      [data-view-name="seeker-next-best-action-card"],
      [data-view-name="premium-upsell-link"] {
        display: none !important;
      }

      /* ── Games / puzzles ── */
      ${hideGames ? `a[href*="/games/"] { display: none !important; }` : ""}

      /* ── Hide feed: gated on BOTH the mainFeed container AND the live
             home-feed page attribute, so it can never bleed onto /jobs or
             any other section even if a component/testid is reused there. ── */
      ${hideFeedActive ? `
        /* The feed post list — unique to the home page */
        html[data-dl-home-feed="1"] [data-testid="mainFeed"] [role="listitem"] {
          display: none !important;
        }
        /* Share box at the top */
        html[data-dl-home-feed="1"] [data-testid="mainFeed"] ~ * .share-box-feed-entry__closed-share-box,
        html[data-dl-home-feed="1"] [data-testid="mainFeed"] [data-component-type="LazyColumn"][role="list"] > [data-lazy-mount-id] {
          display: none !important;
        }
        /* Show the banner */
        #dl-feed-hidden-banner {
          display: flex !important;
        }
      ` : `
        #dl-feed-hidden-banner {
          display: none !important;
        }
      `}
    `;
  }

  injectStyles();

  // ============================================
  // FEED HIDDEN BANNER
  // ============================================

  function ensureFeedBanner() {
    if (document.getElementById("dl-feed-hidden-banner")) return;

    // Wait for the feed list to exist — it has a unique testid
    const feedList = document.querySelector('[data-testid="mainFeed"]');
    if (!feedList) return;

    const banner = document.createElement("div");
    banner.id = "dl-feed-hidden-banner";
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

    // Insert before the feed list
    feedList.parentNode.insertBefore(banner, feedList);
    debug("Feed hidden banner inserted");
  }

  // ============================================
  // MAIN DECLUTTER LOGIC
  // ============================================

  const Declutterer = {
    // Walk up from el to find the narrowest meaningful card container.
    _findCard(el) {
      let card = el.closest("[componentkey]");
      if (!card) return null;
      let parent = card.parentElement?.closest("[componentkey]");
      while (parent) { card = parent; parent = card.parentElement?.closest("[componentkey]"); }
      // Cap the climb through single-child wrapper divs — unbounded climbing
      // can walk all the way up a layout chain and select a huge ancestor.
      let target = card;
      let cur = card.parentElement;
      let climbs = 0;
      const MAX_CLIMB = 3;
      while (cur && cur !== document.body && cur.children.length === 1 && climbs < MAX_CLIMB) {
        if (cur.matches('main, [role="main"]')) break;
        target = cur;
        cur = cur.parentElement;
        climbs++;
      }
      return target;
    },

    removeNews() {
      if (!Settings.removeNews.value) return;

      document.querySelectorAll("p").forEach((p) => {
        if (p.dataset.dlHidden) return;
        if (p.textContent.trim() === "LinkedIn News") {
          const container = p.closest("[componentkey]");
          if (container && !container.dataset.dlHidden) {
            container.style.setProperty("display", "none", "important");
            container.dataset.dlHidden = "1";
            debug("Hidden LinkedIn News section");
          }
        }
      });

      document.querySelectorAll('a[href*="/news/story/"]').forEach((a) => {
        if (!a.dataset.dlHidden) {
          a.style.setProperty("display", "none", "important");
          a.dataset.dlHidden = "1";
        }
      });

      document.querySelectorAll("p").forEach((p) => {
        if (p.dataset.dlHidden) return;
        if (p.textContent.trim() === "Top stories") {
          p.style.setProperty("display", "none", "important");
          p.dataset.dlHidden = "1";
        }
      });

      document.querySelectorAll("button").forEach((btn) => {
        if (btn.dataset.dlHidden) return;
        const text = btn.textContent.trim();
        if (
          (text === "Show more" || text === "Show more news") &&
          btn.closest("[componentkey]")?.querySelector('a[href*="/news/story/"]')
        ) {
          btn.style.setProperty("display", "none", "important");
          btn.dataset.dlHidden = "1";
        }
      });
    },

    removeGames() {
      if (!Settings.removeGames.value) return;

      document.querySelectorAll("p").forEach((p) => {
        if (p.dataset.dlHidden) return;
        const text = p.textContent.trim();
        if (text === "Today\u2019s puzzles" || text === "Today's puzzles") {
          const container = p.closest("[componentkey]") || p.parentElement;
          let target = container;
          let cur = container?.parentElement;
          let climbs = 0;
          const MAX_CLIMB = 3;
          while (cur && cur !== document.body && cur.children.length === 1 && climbs < MAX_CLIMB) {
            if (cur.matches('main, [role="main"]')) break;
            target = cur;
            cur = cur.parentElement;
            climbs++;
          }
          if (target && !target.dataset.dlHidden && !looksLikeWholePage(target)) {
            target.style.setProperty("display", "none", "important");
            target.dataset.dlHidden = "1";
            debug("Hidden games/puzzles section");
          }
        }
      });

      document.querySelectorAll('a[href*="/games/"]').forEach((a) => {
        if (!a.dataset.dlHidden) {
          a.style.setProperty("display", "none", "important");
          a.dataset.dlHidden = "1";
        }
      });
    },

    removePromotedPosts() {
      if (!Settings.removePromotedPosts.value) return;

      // Only operate on the home feed — job cards on /jobs also say "Promoted"
      // and we must never hide those.
      if (!isHomeFeed()) return;

      document.querySelectorAll("p").forEach((p) => {
        if (p.dataset.dlHidden) return;
        if (p.textContent.trim() === "Promoted") {
          // Confirm this is inside the main feed list, not a jobs card
          const inFeed = p.closest('[data-testid="mainFeed"]');
          if (!inFeed) return;
          const post = p.closest('[role="listitem"]');
          if (post && !post.dataset.dlHidden) {
            post.style.setProperty("display", "none", "important");
            post.dataset.dlHidden = "1";
            debug("Hidden promoted post");
          }
        }
      });
    },

    _findPremiumContainer(el) {
      const carouselItem = el.closest('li[data-testid="carousel-child-container"]');
      if (carouselItem) return carouselItem;
      const listItem = el.closest('[role="listitem"]');
      if (listItem) return listItem;
      const component = el.closest("[componentkey]");
      if (component) return component;
      return this._findCard(el);
    },

    removePremiumUpsells() {
      if (!Settings.removePremiumUpsells.value) return;

      // Premium badge SVGs — skip ones inside feed posts or job cards
      document.querySelectorAll(
        "svg#premium-badge-v2-xsmall, svg#premium-chip-v2-small"
      ).forEach((svg) => {
        // Skip if inside any listitem (feed posts, job cards)
        if (svg.closest('[role="listitem"]')) return;
        const container = svg.closest("section") || svg.closest("[componentkey]");
        if (container && !container.dataset.dlHidden && !looksLikeWholePage(container)) {
          container.style.setProperty("display", "none", "important");
          container.dataset.dlHidden = "1";
          debug("Hidden Premium upsell (badge section)");
        }
      });

      // Premium links
      document
        .querySelectorAll('a[href*="/premium/products/"], a[href*="/premium/my-premium/"]')
        .forEach((a) => {
          // Skip if inside a jobs sidebar nav (let CSS handle it) or a listitem
          if (a.closest('[role="listitem"]')) return;
          const card = this._findPremiumContainer(a);
          if (card && !card.dataset.dlHidden && !looksLikeWholePage(card)) {
            card.style.setProperty("display", "none", "important");
            card.dataset.dlHidden = "1";
            debug("Hidden Premium upsell (link)");
          }
        });

      // Text-content fallback — only on home feed sidebar
      if (!isHomeFeed()) return;
      document.querySelectorAll("p").forEach((p) => {
        if (p.dataset.dlHidden) return;
        const text = p.textContent.trim();
        if (
          /^try (premium|recruiter)/i.test(text) ||
          /^unlock all with premium/i.test(text) ||
          /^claim premium/i.test(text) ||
          /^your premium features$/i.test(text)
        ) {
          const card = this._findPremiumContainer(p);
          if (card && !card.dataset.dlHidden && !looksLikeWholePage(card)) {
            card.style.setProperty("display", "none", "important");
            card.dataset.dlHidden = "1";
            debug("Hidden Premium upsell (text)");
          }
        }
      });
    },
  };

  // ============================================
  // PROCESSING
  // ============================================

  function processPage() {
    try {
      debug("Processing:", location.pathname);

      // Rebuild CSS on every call — handles SPA navigation
      injectStyles();

      if (Settings.hideFeed.value && isHomeFeed()) {
        ensureFeedBanner();
      }

      Declutterer.removeNews();
      Declutterer.removeGames();
      Declutterer.removePromotedPosts();
      Declutterer.removePremiumUpsells();
    } catch (err) {
      debug("Error:", err);
    }
  }

  // ============================================
  // MENU
  // ============================================

  function setupMenu() {
    for (const [, setting] of Object.entries(Settings)) {
      GM_registerMenuCommand(
        `${setting.value ? "\u2713" : "\u2717"} ${setting.displayName}`,
        () => {
          setting.toggle();
          injectStyles();
          const state = setting.value ? "enabled" : "disabled";
          const note = setting.name === "hideFeed"
            ? "\nApplies to the home feed only — Jobs, Search, and all other pages are unaffected.\nRefresh to apply."
            : "\nRefresh to apply.";
          alert(`${setting.displayName} ${state}.${note}`);
        }
      );
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function setupMutationObserver() {
    let timeoutId = null;
    const observer = new MutationObserver((mutations) => {
      let added = false;
      for (const m of mutations) { if (m.addedNodes.length > 0) { added = true; break; } }
      if (added && !timeoutId) {
        timeoutId = setTimeout(() => { processPage(); timeoutId = null; }, CONFIG.throttleDelay);
      }
    });
    const target = document.documentElement || document.body;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  function init() {
    setupMenu();
    setupMutationObserver();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", processPage);
    } else {
      processPage();
    }
  }

  try { init(); } catch (e) { console.error("[Declutter LinkedIn] Init failed:", e); }

  // ============================================
  // SPA NAVIGATION POLLING
  // ============================================

  let lastUrl = location.href;
  let pollTimer = null;

  function startPolling(interval) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const cur = location.href;
      if (cur !== lastUrl) {
        debug(`Navigation: ${lastUrl} → ${cur}`);
        lastUrl = cur;
        applyPageScopeAttr();
        injectStyles();
      }
      processPage();
    }, interval);
  }

  document.addEventListener("visibilitychange", () => {
    startPolling(document.hidden ? CONFIG.pollInterval * 4 : CONFIG.pollInterval);
  });

  startPolling(CONFIG.pollInterval);
})();