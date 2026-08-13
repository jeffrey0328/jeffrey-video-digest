const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const i18n = require("../i18n.js");

function loadSidepanelUiCopy() {
  const sandbox = {
    console,
    YTD_I18N: i18n,
    chrome: {
      storage: {
        local: {
          async get() {
            return {};
          },
          async set() {},
        },
        onChanged: { addListener() {} },
      },
      runtime: { onMessage: { addListener() {} }, sendMessage() {} },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
    },
    document: {
      addEventListener() {},
      documentElement: { lang: "en" },
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({
        style: {},
        classList: { toggle() {} },
        setAttribute() {},
      }),
    },
    window: { getSelection: () => null, close() {} },
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  const helpers = sandbox.__YTD_TRANSCRIPT_TESTING__;
  return {
    UI_COPY: helpers.UI_COPY,
    t: (language, key, params) => {
      helpers.applySidepanelLanguage(language);
      return helpers.t(key, params);
    },
  };
}

test("sidepanel UI copy covers English and Simplified Chinese with matching keys", () => {
  const { UI_COPY, t } = loadSidepanelUiCopy();
  assert.deepEqual(
    Object.keys(UI_COPY.en).sort(),
    Object.keys(UI_COPY["zh-CN"]).sort(),
  );
  assert.equal(t("en", "tabTranscript"), "Transcript");
  assert.equal(t("zh-CN", "tabTranscript"), "字幕");
  assert.equal(t("zh-CN", "followPlayback"), "跟随播放");
  assert.match(t("zh-CN", "originalWithLang", { language: "en" }), /原文（en）/);
});

test("sidepanel HTML wires the language slider and static i18n hooks", () => {
  const html = read("sidepanel.html");
  assert.match(html, /id="languageSlider"[\s\S]*role="switch"/);
  assert.match(html, /src="i18n\.js"/);
  assert.match(html, /data-i18n="tabTranscript"/);
  assert.match(html, /data-i18n="welcomeTitle"/);
  assert.match(html, /data-i18n="followPlayback"/);
  assert.doesNotMatch(html, /data-language="en"/);
});

test("shared i18n slider state maps zh-CN to aria-checked true", () => {
  const slider = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const labels = ["en", "zh-CN"].map((language) => ({
    language,
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
    },
    attributes: {},
    getAttribute(name) {
      return name === "data-lang-side" ? this.language : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  }));
  const doc = {
    querySelectorAll(selector) {
      if (selector.includes("language-switch") || selector.includes("#languageSlider")) {
        return [slider];
      }
      if (selector.includes("[data-lang-side]")) return labels;
      return [];
    },
  };

  i18n.updateLanguageSliderState(doc, "zh-CN");
  assert.equal(slider.attributes["aria-checked"], "true");
  assert.equal(i18n.checkedToLanguage(true), "zh-CN");
  assert.equal(i18n.languageToChecked("en"), false);
});
