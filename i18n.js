/**
 * Shared UI language helpers for Settings, Side Panel, and trusted pages.
 * Content scripts cannot read chrome.storage (TRUSTED_CONTEXTS); they ask
 * the background for the preferred language instead.
 */
var YTD_I18N = (() => {
  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const PREVIEW_STORAGE_PREFIX = "youtubeDigestPreview:";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

  const NUDGE_COPY = Object.freeze({
    en: Object.freeze({
      dialogLabel: "Open Jeffrey Video Digest",
      openLabel: "Open Jeffrey Video Digest side panel",
      title: "Jeffrey Video Digest",
      action: "Open side panel",
      dismissLabel: "Dismiss",
    }),
    "zh-CN": Object.freeze({
      dialogLabel: "打开 Jeffrey Video Digest",
      openLabel: "打开 Jeffrey Video Digest 侧边栏",
      title: "Jeffrey Video Digest",
      action: "打开侧边栏",
      dismissLabel: "关闭",
    }),
  });

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : "en";
  }

  function languageToChecked(language) {
    return normalizeLanguage(language) === "zh-CN";
  }

  function checkedToLanguage(checked) {
    return checked ? "zh-CN" : "en";
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  function applyStaticI18n(doc, language, translate) {
    const normalizedLanguage = normalizeLanguage(language);

    for (const element of doc.querySelectorAll("[data-i18n]")) {
      element.textContent = translate(normalizedLanguage, element.dataset.i18n);
    }
    for (const element of doc.querySelectorAll("[data-i18n-html]")) {
      element.innerHTML = translate(
        normalizedLanguage,
        element.dataset.i18nHtml,
      );
    }
    for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
      element.setAttribute(
        "aria-label",
        translate(normalizedLanguage, element.dataset.i18nAriaLabel),
      );
    }
    for (const element of doc.querySelectorAll("[data-i18n-title]")) {
      element.setAttribute(
        "title",
        translate(normalizedLanguage, element.dataset.i18nTitle),
      );
    }
    for (const element of doc.querySelectorAll("[data-i18n-placeholder]")) {
      element.setAttribute(
        "placeholder",
        translate(normalizedLanguage, element.dataset.i18nPlaceholder),
      );
    }
  }

  function updateLanguageSliderState(root, language) {
    const normalizedLanguage = normalizeLanguage(language);
    const checked = languageToChecked(normalizedLanguage);
    const doc = root.document || root;

    for (const slider of doc.querySelectorAll(
      '.language-switch[role="switch"], #languageSlider',
    )) {
      slider.setAttribute("aria-checked", String(checked));
    }

    for (const label of doc.querySelectorAll("[data-lang-side]")) {
      const active = label.getAttribute("data-lang-side") === normalizedLanguage;
      label.classList.toggle("is-active", active);
      label.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  function bindLanguageSlider(root, { getLanguage, setLanguage }) {
    const doc = root.document || root;
    const slider =
      doc.getElementById("languageSlider") ||
      doc.querySelector('.language-switch[role="switch"]');
    if (!slider) return () => {};

    const sync = () => updateLanguageSliderState(doc, getLanguage());

    const onActivate = async () => {
      const next = checkedToLanguage(!languageToChecked(getLanguage()));
      await setLanguage(next);
    };

    slider.addEventListener("click", (event) => {
      event.preventDefault();
      void onActivate();
    });

    slider.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      void onActivate();
    });

    for (const label of doc.querySelectorAll("[data-lang-side]")) {
      label.addEventListener("click", async () => {
        const language = label.getAttribute("data-lang-side");
        if (!language || language === getLanguage()) return;
        await setLanguage(language);
      });
    }

    sync();
    return sync;
  }

  function translateNudge(language, key) {
    const normalizedLanguage = normalizeLanguage(language);
    return (
      NUDGE_COPY[normalizedLanguage][key] ?? NUDGE_COPY.en[key] ?? ""
    );
  }

  function watchLanguagePreference(chromeApi, onChange) {
    const storage = chromeApi?.storage;
    if (!storage?.onChanged?.addListener) return () => {};

    const listener = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!Object.hasOwn(changes, LANGUAGE_STORAGE_KEY)) return;
      onChange(normalizeLanguage(changes[LANGUAGE_STORAGE_KEY].newValue));
    };
    storage.onChanged.addListener(listener);
    return () => storage.onChanged.removeListener?.(listener);
  }

  return {
    LANGUAGE_STORAGE_KEY,
    NUDGE_COPY,
    PREVIEW_STORAGE_PREFIX,
    SUPPORTED_LANGUAGES,
    applyStaticI18n,
    bindLanguageSlider,
    checkedToLanguage,
    createStorageAdapter,
    languageToChecked,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    translateNudge,
    updateLanguageSliderState,
    watchLanguagePreference,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_I18N;
}
