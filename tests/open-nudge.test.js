const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentScript = fs.readFileSync(
  path.resolve(__dirname, "..", "content.js"),
  "utf8",
);

class FakeElement {
  constructor({ id = "" } = {}) {
    this.id = id;
    this.isConnected = false;
    this.parentElement = null;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._innerHTML = "";
    this.offsetWidth = 200;
    this.offsetHeight = 48;
    this._rect = { left: 80, top: 120, right: 180, bottom: 156, width: 100, height: 36 };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    const classMatches = [...this._innerHTML.matchAll(/class="([^"]+)"/g)];
    for (const match of classMatches) {
      const child = new FakeElement();
      child.className = match[1];
      if (match[1] === "ytd-coach-dont-show-input") {
        child.checked = /\schecked(?:\s|>|\/)/.test(this._innerHTML);
        child.type = "checkbox";
      }
      this.appendChild(child);
    }
  }

  get textContent() {
    return this._innerHTML.replace(/<[^>]+>/g, "");
  }

  set textContent(value) {
    this._innerHTML = String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    this.children = [];
  }

  querySelector(selector) {
    if (!selector.startsWith(".")) return null;
    const className = selector.slice(1);
    return (
      this.children.find((child) => child.className === className) || null
    );
  }

  querySelectorAll(selector) {
    if (!selector.startsWith(".")) return [];
    const className = selector.slice(1);
    return this.children.filter((child) => child.className === className);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  appendChild(child) {
    child.parentElement?.removeChild(child);
    this.children.push(child);
    child.parentElement = this;
    child.isConnected = true;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentElement = null;
    child.isConnected = false;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }
}

function createHarness({
  dismissed = false,
  permanentlyDismissed = false,
  pathname = "/watch",
  uiLanguage = "en",
  withTargets = true,
} = {}) {
  const storage = new Map();
  const localStorageMap = new Map();
  if (dismissed) storage.set("ytd_sidepanel_nudge_dismissed", "1");
  if (permanentlyDismissed) localStorageMap.set("ytd_coach_marks_dismissed", true);

  const documentElement = new FakeElement();
  documentElement.isConnected = true;
  documentElement.clientWidth = 1280;
  documentElement.clientHeight = 720;
  const elements = [];
  const messages = [];
  const windowListeners = {};

  const document = {
    readyState: "loading",
    body: new FakeElement(),
    documentElement,
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getElementById(id) {
      return elements.find((element) => element.id === id && element.isConnected);
    },
    createElement() {
      const element = new FakeElement();
      elements.push(element);
      return element;
    },
  };

  const context = vm.createContext({
    console,
    document,
    Math,
    window: {
      location: { pathname },
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener(type, listener, options) {
        windowListeners[`${type}:${Boolean(options?.capture || options === true)}`] =
          listener;
      },
      removeEventListener() {},
      getComputedStyle() {
        return { display: "flex", visibility: "visible", position: "relative" };
      },
    },
    requestAnimationFrame(fn) {
      if (typeof fn === "function") fn();
      return 1;
    },
    sessionStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        async sendMessage(message, callback) {
          messages.push(message);
          if (message?.action === "getUiLanguage") {
            const result = { language: uiLanguage };
            if (typeof callback === "function") callback(result);
            return result;
          }
          if (message?.action === "getCoachMarksDismissed") {
            const result = {
              dismissed:
                localStorageMap.get("ytd_coach_marks_dismissed") === true ||
                localStorageMap.get("ytd_coach_marks_dismissed") === "1",
            };
            if (typeof callback === "function") callback(result);
            return result;
          }
          if (message?.action === "setCoachMarksDismissed") {
            localStorageMap.set("ytd_coach_marks_dismissed", true);
            const result = { success: true };
            if (typeof callback === "function") callback(result);
            return result;
          }
          const result = { success: true };
          if (typeof callback === "function") callback(result);
          return result;
        },
      },
      storage: {
        local: {
          async get(key) {
            if (key && typeof key === "string") {
              return { [key]: localStorageMap.get(key) };
            }
            return Object.fromEntries(localStorageMap.entries());
          },
          async set(values) {
            for (const [key, value] of Object.entries(values || {})) {
              localStorageMap.set(key, value);
            }
          },
        },
      },
    },
    MutationObserver: class {
      observe() {}
    },
    setTimeout(fn) {
      if (typeof fn === "function") fn();
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  });

  vm.runInContext(contentScript, context);

  if (withTargets && pathname.includes("/watch")) {
    const digest = document.createElement();
    digest.id = "ytd-digest-button";
    digest._rect = {
      left: 220,
      top: 420,
      right: 320,
      bottom: 456,
      width: 100,
      height: 36,
    };
    documentElement.appendChild(digest);
    context.ytdDigestButton = digest;

    const note = document.createElement();
    note.id = "ytd-note-button";
    note._rect = {
      left: 980,
      top: 96,
      right: 1060,
      bottom: 132,
      width: 80,
      height: 36,
    };
    documentElement.appendChild(note);
    context.ytdNoteButton = note;
  }

  return {
    context,
    documentElement,
    elements,
    messages,
    storage,
    localStorageMap,
  };
}

test("coach marks draw callouts and connectors for Digest and Note", async () => {
  const harness = createHarness();
  await harness.context.showCoachMarks();

  const root = harness.elements.find(
    (el) => el.id === "ytd-coach-marks" && el.isConnected,
  );
  assert.ok(root);

  const callouts = root.children.filter(
    (child) => child.className === "ytd-coach-callout",
  );
  const lines = root.children.filter(
    (child) => child.className === "ytd-coach-line",
  );
  assert.equal(callouts.length, 2);
  assert.equal(lines.length, 2);
  assert.match(
    callouts.map((callout) => callout.textContent).join("\n"),
    /Digest — open the side panel/,
  );
  assert.match(
    callouts.map((callout) => callout.textContent).join("\n"),
    /Note — save a timestamped note/,
  );
  assert.ok(
    lines.every((line) =>
      String(line.style.cssText || "").includes("rotate("),
    ),
  );

  const digest = harness.elements.find((el) => el.id === "ytd-digest-button");
  const note = harness.elements.find((el) => el.id === "ytd-note-button");
  assert.equal(digest.style.zIndex, "100001");
  assert.equal(note.style.zIndex, "100001");
  assert.equal(note.style.opacity, "1");
});

test("coach marks use Chinese callout copy when UI language is zh-CN", async () => {
  const harness = createHarness({ uiLanguage: "zh-CN" });
  await harness.context.showCoachMarks();

  const root = harness.elements.find((el) => el.id === "ytd-coach-marks");
  const callouts = root.children.filter(
    (child) => child.className === "ytd-coach-callout",
  );
  const text = callouts.map((callout) => callout.textContent).join("\n");
  assert.match(text, /打开侧边栏/);
  assert.match(text, /保存带时间戳的笔记/);
  assert.equal(root.attributes["aria-label"], "Jeffrey Video Digest 控件");
});

test("dismissed coach marks stay hidden for the session", async () => {
  const harness = createHarness({ dismissed: true });
  await harness.context.showCoachMarks();
  assert.equal(
    harness.elements.some((el) => el.id === "ytd-coach-marks" && el.isConnected),
    false,
  );
});

test("dismiss button hides coach marks without opening the panel", async () => {
  const harness = createHarness();
  await harness.context.showCoachMarks();

  const dismissBar = harness.elements
    .find((el) => el.id === "ytd-coach-marks")
    ?.children.find((child) => child.className === "ytd-coach-dismiss-bar");
  const dismissBtn = dismissBar.querySelector(".ytd-coach-dismiss");
  await dismissBtn.listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(
    harness.messages.some((message) => message.action === "openSidePanel"),
    false,
  );
  assert.equal(harness.storage.get("ytd_sidepanel_nudge_dismissed"), "1");
  assert.equal(harness.localStorageMap.get("ytd_coach_marks_dismissed"), undefined);
  assert.equal(
    harness.elements.some((el) => el.id === "ytd-coach-marks" && el.isConnected),
    false,
  );
});

test("Got it with don't-show-again checked persists forever", async () => {
  const harness = createHarness();
  await harness.context.showCoachMarks();

  const dismissBar = harness.elements
    .find((el) => el.id === "ytd-coach-marks")
    ?.children.find((child) => child.className === "ytd-coach-dismiss-bar");
  const checkbox = dismissBar.querySelector(".ytd-coach-dont-show-input");
  const gotIt = dismissBar.querySelector(".ytd-coach-got-it");
  assert.equal(checkbox.checked, true);
  await gotIt.listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(harness.localStorageMap.get("ytd_coach_marks_dismissed"), true);
  assert.equal(harness.storage.get("ytd_sidepanel_nudge_dismissed"), "1");
});

test("permanently dismissed coach marks stay hidden across sessions", async () => {
  const harness = createHarness({ permanentlyDismissed: true });
  await harness.context.showCoachMarks();
  assert.equal(
    harness.elements.some((el) => el.id === "ytd-coach-marks" && el.isConnected),
    false,
  );
});

test("coach marks are not shown outside watch pages", async () => {
  const harness = createHarness({ pathname: "/" });
  await harness.context.showCoachMarks();
  assert.equal(
    harness.elements.some((el) => el.id === "ytd-coach-marks" && el.isConnected),
    false,
  );
});

test("coach marks are not shown when no interactive targets exist", async () => {
  const harness = createHarness({ withTargets: false });
  await harness.context.showCoachMarks();
  assert.equal(
    harness.elements.some((el) => el.id === "ytd-coach-marks" && el.isConnected),
    false,
  );
});

test("callout layout keeps connector endpoints near the control", () => {
  const harness = createHarness({ withTargets: false });
  const layout = harness.context.resolveCoachCalloutLayout(
    { left: 200, top: 400, right: 300, bottom: 436, width: 100, height: 36 },
    "below",
    200,
    48,
  );
  assert.equal(layout.fromX, 250);
  assert.equal(layout.fromY, 436);
  assert.equal(layout.toY, layout.top);
});
