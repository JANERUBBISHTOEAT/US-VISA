// 国际化工具类
class I18n {
  constructor() {
    this.currentLanguage = "zh-Hans"; // 默认简体中文
    this.translations = {};
    this.fallbackLanguage = "en";

    // 支持的语言列表
    this.supportedLanguages = {
      "zh-Hans": "简体中文",
      "zh-Hant": "繁體中文",
      en: "English",
      fr: "Français",
    };
  }

  // 初始化国际化
  async init() {
    // 从存储中获取用户选择的语言
    try {
      const storage = await chrome.storage.local.get(["__lang"]);
      if (storage.__lang && this.supportedLanguages[storage.__lang]) {
        this.currentLanguage = storage.__lang;
      } else {
        // 尝试从浏览器语言自动检测
        this.currentLanguage = this.detectBrowserLanguage();
      }
    } catch (error) {
      console.error("获取语言设置失败:", error);
    }

    // 加载翻译文件
    await this.loadTranslations(this.currentLanguage);

    // 如果当前语言不是英文，也加载英文作为备用
    if (this.currentLanguage !== this.fallbackLanguage) {
      await this.loadTranslations(this.fallbackLanguage);
    }
  }

  // 检测浏览器语言
  detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || "en";

    // 直接匹配
    if (this.supportedLanguages[browserLang]) {
      return browserLang;
    }

    // 匹配语言代码前缀
    const langPrefix = browserLang.split("-")[0];

    // 特殊处理中文
    if (langPrefix === "zh") {
      // 根据地区码判断简繁体
      if (
        browserLang.includes("TW") ||
        browserLang.includes("HK") ||
        browserLang.includes("MO")
      ) {
        return "zh-Hant";
      } else {
        return "zh-Hans";
      }
    }

    // 其他语言的匹配
    const matchedLang = Object.keys(this.supportedLanguages).find((lang) =>
      lang.startsWith(langPrefix)
    );

    return matchedLang || this.fallbackLanguage;
  }

  // 加载翻译文件
  async loadTranslations(language) {
    try {
      const response = await fetch(
        chrome.runtime.getURL(`locales/${language}.json`)
      );
      const translations = await response.json();

      if (!this.translations[language]) {
        this.translations[language] = {};
      }

      this.translations[language] = translations;
      console.log(`已加载 ${language} 语言包`);
    } catch (error) {
      console.error(`加载 ${language} 语言包失败:`, error);
    }
  }

  // 设置语言
  async setLanguage(language) {
    if (!this.supportedLanguages[language]) {
      console.error("不支持的语言:", language);
      return false;
    }

    this.currentLanguage = language;

    // 保存到存储
    try {
      await chrome.storage.local.set({ __lang: language });
    } catch (error) {
      console.error("保存语言设置失败:", error);
    }

    // 如果翻译文件未加载，先加载
    if (!this.translations[language]) {
      await this.loadTranslations(language);
    }

    return true;
  }

  // 获取翻译文本
  t(key, params = {}) {
    let translation = this.getNestedValue(
      this.translations[this.currentLanguage],
      key
    );

    // 如果当前语言没有找到，使用备用语言
    if (!translation && this.currentLanguage !== this.fallbackLanguage) {
      translation = this.getNestedValue(
        this.translations[this.fallbackLanguage],
        key
      );
    }

    // 如果还是没有找到，返回键名
    if (!translation) {
      console.log(`翻译缺失: ${key}`);
      return key;
    }

    // 参数替换
    return this.interpolate(translation, params);
  }

  // 获取嵌套对象的值
  getNestedValue(obj, path) {
    if (!obj || !path) return null;

    const keys = path.split(".");
    let current = obj;

    for (const key of keys) {
      if (current[key] === undefined) {
        return null;
      }
      current = current[key];
    }

    return current;
  }

  // 字符串插值
  interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }

  // 获取当前语言
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  // 获取支持的语言列表
  getSupportedLanguages() {
    return this.supportedLanguages;
  }

  // 获取当前语言的显示名称
  getCurrentLanguageName() {
    return (
      this.supportedLanguages[this.currentLanguage] || this.currentLanguage
    );
  }
}

// 创建全局实例
const i18n = new I18n();

// 导出给其他文件使用
if (typeof module !== "undefined" && module.exports) {
  module.exports = { I18n, i18n };
}
