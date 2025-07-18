let isRunning = false;
let currentTab = null;

// 国际化相关变量
let isI18nReady = false;
let isInitialLoadComplete = false; // 标记初始加载是否完成

// 初始化页面
document.addEventListener("DOMContentLoaded", async () => {
  await initializeI18n();
  await loadCurrentStatus();
  await loadDefaultSettings();
  setupEventListeners();
  await refreshAppointmentCenters();

  // 标记初始加载完成，现在可以开始自动保存
  isInitialLoadComplete = true;
  console.log("初始加载完成，启用自动保存功能");
});

// 初始化国际化
async function initializeI18n() {
  try {
    await i18n.init();
    isI18nReady = true;

    // 设置语言选择器的当前值
    document.getElementById("languageSelect").value = i18n.getCurrentLanguage();

    // 更新所有文本
    updateAllTexts();

    console.log("国际化初始化完成，当前语言:", i18n.getCurrentLanguage());
  } catch (error) {
    console.error("国际化初始化失败:", error);
    isI18nReady = false;
  }
}

// 更新所有文本
function updateAllTexts() {
  if (!isI18nReady) return;

  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const params = element.getAttribute("data-i18n-params");

    let translatedText;
    if (params) {
      try {
        const parsedParams = JSON.parse(params);
        translatedText = i18n.t(key, parsedParams);
      } catch (error) {
        translatedText = i18n.t(key);
      }
    } else {
      translatedText = i18n.t(key);
    }

    element.textContent = translatedText;
  });

  // 更新特殊元素
  updateSpecialElements();
}

// 更新特殊元素（如选项、占位符等）
function updateSpecialElements() {
  if (!isI18nReady) return;

  // 更新语言选择器的标题
  const langSelect = document.getElementById("languageSelect");
  if (langSelect) {
    langSelect.title = i18n.t("form.language") + " / Select Language";
  }

  // 更新选项文本
  updateSelectOptions();

  // 更新占位符
  updatePlaceholders();

  // 更新按钮文本
  updateButtons();
}

// 更新选项文本
function updateSelectOptions() {
  if (!isI18nReady) return;

  // 更新检查间隔选项
  const intervalSelect = document.getElementById("intervalSelect");
  if (intervalSelect) {
    const options = intervalSelect.querySelectorAll("option");
    options.forEach((option) => {
      const value = option.value;
      // 构建正确的键名，处理包含点号的值
      let key;
      if (value === "0.5") {
        key = "intervals.half_minutes";
      } else if (value === "1") {
        key = "intervals.1_minute";
      } else {
        key = `intervals.${value}_minutes`;
      }

      // 使用方括号语法安全地获取翻译
      const translatedText = i18n.t(key);
      option.textContent = translatedText;
    });
  }

  // 更新签证类型选项
  const visaTypeSelect = document.getElementById("visaTypeSelect");
  if (visaTypeSelect) {
    const options = visaTypeSelect.querySelectorAll("option");
    options.forEach((option) => {
      const value = option.value;
      option.textContent = i18n.t(`visa_types.${value}`);
    });
  }

  // 更新预约中心的默认选项
  const locationSelect = document.getElementById("locationSelect");
  if (locationSelect) {
    const defaultOption = locationSelect.querySelector('option[value=""]');
    if (defaultOption) {
      defaultOption.textContent = i18n.t("form.please_select");
    }
  }
}

// 更新占位符
function updatePlaceholders() {
  if (!isI18nReady) return;

  // 更新所有带有 data-i18n-placeholder 属性的元素占位符
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    element.placeholder = i18n.t(key);
  });

  // 特殊处理用户名输入框（保持固定格式）
  const usernameInput = document.getElementById("usernameInput");
  if (usernameInput) {
    usernameInput.placeholder = "your-email@example.com";
  }
}

// 更新按钮文本
function updateButtons() {
  if (!isI18nReady) return;

  // 主要按钮会根据状态动态更新，在updateUI中处理

  // 配置面板按钮
  const configBtn = document.getElementById("configBtn");
  if (configBtn) configBtn.textContent = i18n.t("ui.settings");

  const saveConfigBtn = document.getElementById("saveConfigBtn");
  if (saveConfigBtn) saveConfigBtn.textContent = i18n.t("ui.save");

  const cancelConfigBtn = document.getElementById("cancelConfigBtn");
  if (cancelConfigBtn) cancelConfigBtn.textContent = i18n.t("ui.cancel");

  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) resetBtn.textContent = i18n.t("ui.reset");

  const refreshBtn = document.getElementById("refreshCentersBtn");
  if (refreshBtn) refreshBtn.textContent = i18n.t("ui.refresh");
}

// 加载默认设置
async function loadDefaultSettings() {
  try {
    const storage = await chrome.storage.local.get([
      "__il",
      "__vt",
      "__centers",
      "__as", // 自动提交设置
      "__timer", // 检查间隔设置
    ]);

    if (storage.__vt) {
      document.getElementById("visaTypeSelect").value = storage.__vt;
    }

    // 加载检查间隔设置
    if (storage.__timer) {
      document.getElementById("intervalSelect").value = storage.__timer;
    }

    // 加载自动提交设置
    if (storage.__as !== undefined) {
      document.getElementById("autoSubmitToggle").checked = storage.__as;
    }

    // 加载预约中心选项
    await loadAppointmentCenters(storage.__centers, storage.__il);
  } catch (error) {
    console.error("加载默认设置失败:", error);
  }
}

// 设置事件监听器
function setupEventListeners() {
  document
    .getElementById("toggleBtn")
    .addEventListener("click", toggleMonitoring);
  document.getElementById("configBtn").addEventListener("click", showConfig);
  document
    .getElementById("saveConfigBtn")
    .addEventListener("click", saveConfig);
  document
    .getElementById("cancelConfigBtn")
    .addEventListener("click", hideConfig);
  document.getElementById("resetBtn").addEventListener("click", resetExtension);

  // 语言切换
  document
    .getElementById("languageSelect")
    .addEventListener("change", async function (e) {
      const selectedLanguage = e.target.value;
      if (await i18n.setLanguage(selectedLanguage)) {
        updateAllTexts();
        console.log("语言已切换到:", selectedLanguage);
      }
    });

  // 预约中心刷新按钮
  document
    .getElementById("refreshCentersBtn")
    .addEventListener("click", refreshAppointmentCenters); // 自动提交开关
  document
    .getElementById("autoSubmitToggle")
    .addEventListener("change", async function (e) {
      const autoSubmit = e.target.checked;
      chrome.storage.local.set({ __as: autoSubmit });

      // 同时通知content script
      if (currentTab?.url?.includes("ais.usvisa-info.com")) {
        try {
          await chrome.tabs.sendMessage(currentTab.id, {
            action: "set_config",
            autoSubmit: autoSubmit,
          });
        } catch (error) {
          console.log("无法发送自动提交设置给content script:", error);
        }
      }

      console.log("自动提交设置:", autoSubmit ? "已开启" : "已关闭");

      // 立即更新状态显示
      await loadCurrentStatus();
    });

  // 检查间隔选择变化事件
  document
    .getElementById("intervalSelect")
    .addEventListener("change", async function (e) {
      const intervalMinutes = parseFloat(e.target.value);
      await chrome.storage.local.set({ __timer: intervalMinutes });

      // 同时通知content script
      if (currentTab?.url?.includes("ais.usvisa-info.com")) {
        try {
          await chrome.tabs.sendMessage(currentTab.id, {
            action: "set_config",
            interval: intervalMinutes * 60 * 1000, // 转换为毫秒
          });
        } catch (error) {
          console.log("无法发送间隔设置给content script:", error);
        }
      }

      console.log("检查间隔设置:", intervalMinutes + " 分钟");
    });

  // 预约中心选择变化事件
  document
    .getElementById("locationSelect")
    .addEventListener("change", function (e) {
      const selectedOptions = Array.from(e.target.selectedOptions);
      const selectedValues = selectedOptions
        .map((opt) => opt.value)
        .filter((val) => val);
      const selectedTexts = selectedOptions
        .map((opt) => opt.text)
        .filter(
          (text) =>
            text !==
            (isI18nReady ? i18n.t("form.please_select") : "请选择预约中心...")
        );

      if (selectedValues.length > 0) {
        // 只允许选择一个中心
        const selectedValue = selectedValues[0];
        const selectedText = selectedTexts[0];

        // 自动保存选择
        chrome.storage.local.set({
          __il: selectedValue,
          __selectedCenters: selectedText,
        });
        console.log("已选择预约中心:", selectedText);

        // 立即更新地点显示
        const mockStatus = {
          apptCenter: selectedValue,
        };
        updateLocationDisplay(mockStatus);
      }
    });

  // 添加实时保存功能
  setupAutoSave();
}

// 加载当前状态
async function loadCurrentStatus() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentTab = tab;

    // 检查是否在美签网站
    if (!tab.url || !tab.url.includes("ais.usvisa-info.com")) {
      const statusText = isI18nReady
        ? i18n.t("status_messages.visit_website")
        : "状态：请先打开美签网站";
      document.getElementById("status").textContent = statusText;

      // 即使不在美签网站，也加载本地存储的基本信息
      await loadBasicInfoFromStorage();
      return;
    }

    // 从content script获取状态
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "get_status",
      });

      if (response) {
        updateUI(response);
      } else {
        const statusText = isI18nReady
          ? i18n.t("status_messages.waiting")
          : "状态：等待页面加载...";
        document.getElementById("status").textContent = statusText;

        // 尝试从本地存储加载基本信息
        await loadBasicInfoFromStorage();
      }
    } catch (msgError) {
      console.log("无法连接到content script，可能页面还在加载");
      const statusText = isI18nReady
        ? i18n.t("status_messages.waiting")
        : "状态：等待页面加载...";
      document.getElementById("status").textContent = statusText;

      // 等待一段时间后重试
      setTimeout(async () => {
        try {
          const retryResponse = await chrome.tabs.sendMessage(tab.id, {
            action: "get_status",
          });
          if (retryResponse) {
            updateUI(retryResponse);
          }
        } catch (retryError) {
          console.log("重试连接失败:", retryError);
          // 如果还是失败，尝试从本地存储加载基本信息
          await loadBasicInfoFromStorage();
        }
      }, 2000);
    }
  } catch (error) {
    console.error("加载状态失败:", error);
    const statusText = isI18nReady
      ? i18n.t("status_messages.not_connected")
      : "状态：未连接";
    document.getElementById("status").textContent = statusText;
  }
}

// 更新UI显示
function updateUI(status) {
  isRunning = status.active || false;

  // 使用国际化的状态文本
  if (isI18nReady) {
    document.getElementById("status").textContent = isRunning
      ? i18n.t("status_messages.monitoring")
      : i18n.t("status_messages.not_started");
    document.getElementById("toggleBtn").textContent = isRunning
      ? i18n.t("ui.stop_monitoring")
      : i18n.t("ui.start_monitoring");
  } else {
    // 回退到默认文本
    document.getElementById("status").textContent = isRunning
      ? "状态：监控中..."
      : "状态：未启动";
    document.getElementById("toggleBtn").textContent = isRunning
      ? "停止监控"
      : "开始监控";
  }

  document.getElementById("scheduleDisplay").textContent =
    status.scheduleId || "-";

  // 使用新的地点显示函数
  updateLocationDisplay(status);

  document.getElementById("currentDateDisplay").textContent =
    status.apptDate || "-";

  // 显示页面状态（使用国际化）
  let pageStatus = isI18nReady ? i18n.t("page_types.unknown") : "未知页面";
  if (status.currentPage && isI18nReady) {
    if (status.currentPage.isSignIn) pageStatus = i18n.t("page_types.login");
    else if (status.currentPage.isDashboard)
      pageStatus = i18n.t("page_types.dashboard");
    else if (status.currentPage.isAppointment)
      pageStatus = i18n.t("page_types.appointment");
    else if (status.currentPage.isConfirmation)
      pageStatus = i18n.t("page_types.confirmation");
    else if (status.currentPage.isAddressPage)
      pageStatus = i18n.t("page_types.address");
    else if (status.currentPage.isLoggedOut)
      pageStatus = i18n.t("page_types.homepage");
  } else if (status.currentPage) {
    // 回退到中文
    if (status.currentPage.isSignIn) pageStatus = "登录页面";
    else if (status.currentPage.isDashboard) pageStatus = "仪表板";
    else if (status.currentPage.isAppointment) pageStatus = "预约页面";
    else if (status.currentPage.isConfirmation) pageStatus = "确认页面";
    else if (status.currentPage.isAddressPage) pageStatus = "地址页面";
    else if (status.currentPage.isLoggedOut) pageStatus = "首页";
  }

  document.getElementById("monitorStatus").textContent = pageStatus;

  // 更新自动提交状态显示（使用国际化）
  const autoSubmitStatus = isI18nReady
    ? status.autoSubmit
      ? i18n.t("info_values.enabled")
      : i18n.t("info_values.disabled")
    : status.autoSubmit
    ? "开启"
    : "关闭";
  document.getElementById("autoSubmitStatus").textContent = autoSubmitStatus;
  document.getElementById("autoSubmitStatus").style.color = status.autoSubmit
    ? "#e74c3c"
    : "#27ae60";

  // 更新签证类型显示
  if (status.visaType && isI18nReady) {
    const visaTypeText = i18n.t(`visa_types.${status.visaType}`);
    console.log("当前签证类型:", visaTypeText);
  }
}

// 切换监控状态
async function toggleMonitoring() {
  if (!isRunning) {
    // 启动监控流程 - 这里才会触发跳转
    await startMonitoringFlow();
  } else {
    // 停止监控
    await stopMonitoring();
  }
}

// 启动监控流程
async function startMonitoringFlow() {
  try {
    console.log("=== 开始监控流程 ===");

    // 重新获取当前标签页信息，确保currentTab是最新的
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentTab = tab;

    console.log("当前标签页:", currentTab ? currentTab.url : "无标签页");

    // 首先检查是否有保存的账号配置
    const storage = await chrome.storage.local.get(["__un", "__pw", "__vt"]);
    console.log("配置检查 - 用户名:", storage.__un ? "已设置" : "未设置");
    console.log("配置检查 - 密码:", storage.__pw ? "已设置" : "未设置");
    console.log("配置检查 - 签证类型:", storage.__vt || "未设置");

    if (!storage.__un || !storage.__pw) {
      console.log("配置不完整，显示配置面板");
      alert(
        isI18nReady
          ? i18n.t("alerts.fill_credentials")
          : "请先在设置中配置账号信息"
      );
      showConfig(); // 显示配置面板
      return;
    }

    // 获取选择的预约中心
    const locationSelect = document.getElementById("locationSelect");
    const selectedValue = locationSelect.value;

    const hasSelectedCenter = selectedValue && selectedValue.trim() !== "";
    console.log("选择的预约中心:", selectedValue);
    console.log("是否选择了中心:", hasSelectedCenter);

    // ===== 新的监控流程逻辑 =====
    // 1. 首先设置导航流程标记，无论当前在哪个页面都将导航到reschedule页面
    console.log("设置导航流程标记...");
    await chrome.storage.local.set({
      __navigationFlow: true,
      __targetIsMonitoring: true, // 标记最终目标是监控
      __selectedCentersForTarget: hasSelectedCenter ? [selectedValue] : null, // 目标页面需要的中心配置
    });

    // 2. 检查当前是否在美签网站
    const isOnVisaSite =
      currentTab?.url?.includes("ais.usvisa-info.com") ?? false;
    console.log("是否在美签网站:", isOnVisaSite);

    if (!isOnVisaSite) {
      // 2a. 不在美签网站，打开登录页面开始完整导航流程
      console.log("不在美签网站，开始完整导航流程");
      showNotification("notifications.navigating", "notifications.navigating");
      await startAutoNavigationFlow(storage.__vt);
      return;
    }

    // 2b. 在美签网站上，检查当前页面类型并开始导航
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: "get_status",
      });

      if (response?.currentPage?.isAppointment) {
        // 3. 已经在reschedule页面，检查是否选择了中心
        console.log("已在reschedule页面，检查中心选择状态");

        if (hasSelectedCenters) {
          // 3a. 在reschedule页面且已选择中心，清除导航标记并开始监控
          console.log("在reschedule页面且已选择中心，直接开始监控");
          await chrome.storage.local.remove([
            "__navigationFlow",
            "__targetIsMonitoring",
            "__selectedCentersForTarget",
          ]);
          await startRealMonitoring([selectedValue]);
          return;
        } else {
          // 3b. 在reschedule页面但没选择中心，清除导航标记并提示用户
          console.log("在reschedule页面但未选择中心，提示用户选择");
          await chrome.storage.local.remove([
            "__navigationFlow",
            "__targetIsMonitoring",
            "__selectedCentersForTarget",
          ]);
          alert(
            isI18nReady
              ? i18n.t("alerts.select_appointment_center")
              : "请选择至少一个预约中心！"
          );
          return;
        }
      } else {
        // 4. 不在reschedule页面，通知content script开始导航
        console.log("不在reschedule页面，发送导航指令");
        showNotification(
          "notifications.navigating",
          "notifications.navigating"
        );
        await chrome.tabs.sendMessage(currentTab.id, {
          action: "start_navigation_to_appointment",
          targetIsMonitoring: true,
          selectedCenters: hasSelectedCenter ? [selectedValue] : null,
        });
        return;
      }
    } catch (error) {
      // 5. 无法连接到content script，开始完整导航流程
      console.log("无法连接到content script，开始完整导航流程");
      showNotification("notifications.navigating", "notifications.navigating");
      await startAutoNavigationFlow(storage.__vt);
      return;
    }
  } catch (error) {
    console.error("启动监控流程失败:", error);
    alert("操作失败: " + error.message);
  }
}

// 开始真正的监控
async function startRealMonitoring(selectedValues) {
  try {
    const intervalMinutes = parseFloat(
      document.getElementById("intervalSelect").value
    );

    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: "start_monitoring",
      center: selectedValues[0],
      interval: intervalMinutes * 60 * 1000,
    });

    if (response?.success) {
      isRunning = true;

      // 更新UI
      const statusText = isI18nReady
        ? i18n.t("status_messages.monitoring")
        : "状态：监控中...";
      const buttonText = isI18nReady
        ? i18n.t("ui.stop_monitoring")
        : "停止监控";

      document.getElementById("status").textContent = statusText;
      document.getElementById("toggleBtn").textContent = buttonText;

      // 显示选中的预约中心名称
      const mockStatus = {
        apptCenter: selectedValues[0],
      };
      updateLocationDisplay(mockStatus);

      showNotification(
        "notifications.monitoring_started",
        "notifications.monitoring_started"
      );

      console.log("监控已启动，选择的中心:", selectedValues[0]);
    } else {
      alert(
        isI18nReady
          ? i18n.t("alerts.no_centers_selected")
          : "启动监控失败，请确保在正确的页面"
      );
    }
  } catch (msgError) {
    console.error("发送监控消息失败:", msgError);
    alert(
      isI18nReady
        ? i18n.t("alerts.connection_failed")
        : "无法连接到页面，请刷新页面后重试"
    );
  }
}

// 停止监控
async function stopMonitoring() {
  try {
    if (currentTab?.url?.includes("ais.usvisa-info.com")) {
      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: "stop_monitoring",
        });

        if (response?.success) {
          console.log("监控已通过消息停止");
        }
      } catch (msgError) {
        console.error("发送停止消息失败:", msgError);
        // 即使消息发送失败，也更新UI状态
      }
    }

    // 更新UI状态
    isRunning = false;
    const statusText = isI18nReady
      ? i18n.t("status_messages.not_started")
      : "状态：未启动";
    const buttonText = isI18nReady ? i18n.t("ui.start_monitoring") : "开始监控";

    document.getElementById("status").textContent = statusText;
    document.getElementById("toggleBtn").textContent = buttonText;

    // 清除自动启动标记
    await chrome.storage.local.remove([
      "__autoStartMonitoring",
      "__selectedCentersForMonitoring",
    ]);

    showNotification(
      "notifications.monitoring_stopped",
      "notifications.monitoring_stopped"
    );
  } catch (error) {
    console.error("停止监控失败:", error);
  }
}

// 显示配置面板
function showConfig() {
  document.getElementById("mainPanel").style.display = "none";
  document.getElementById("configPanel").style.display = "block";

  // 加载保存的配置
  loadSavedConfig();
}

// 隐藏配置面板
function hideConfig() {
  document.getElementById("configPanel").style.display = "none";
  document.getElementById("mainPanel").style.display = "block";
}

// 加载保存的配置
async function loadSavedConfig() {
  try {
    // 临时禁用自动保存，防止加载过程中触发保存
    const wasInitialLoadComplete = isInitialLoadComplete;
    isInitialLoadComplete = false;

    const storage = await chrome.storage.local.get(["__un", "__pw", "__vt"]);

    if (storage.__un) {
      document.getElementById("usernameInput").value = storage.__un;
    }
    if (storage.__pw) {
      document.getElementById("passwordInput").value = storage.__pw;
    }
    if (storage.__vt) {
      document.getElementById("visaTypeSelect").value = storage.__vt;
    }

    // 恢复自动保存状态
    setTimeout(() => {
      isInitialLoadComplete = wasInitialLoadComplete;
    }, 100); // 短暂延迟，确保所有值都已设置完毕
  } catch (error) {
    console.error("加载配置失败:", error);
    // 即使出错也要恢复自动保存状态
    isInitialLoadComplete = true;
  }
}

// 保存配置
async function saveConfig() {
  const username = document.getElementById("usernameInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();
  const visaType = document.getElementById("visaTypeSelect").value;

  // if (!username || !password) {
  //   alert(
  //     isI18nReady
  //       ? i18n.t("alerts.fill_username_password")
  //       : "请填写用户名和密码"
  //   );
  //   return;
  // }

  try {
    // 保存到storage
    await chrome.storage.local.set({
      __un: username,
      __pw: password,
      __vt: visaType,
    });

    // 尝试发送给content script（如果可用）
    if (currentTab?.url?.includes("ais.usvisa-info.com")) {
      try {
        await chrome.tabs.sendMessage(currentTab.id, {
          action: "set_config",
          username: username,
          password: password,
          visaType: visaType,
        });
        console.log("配置已发送给content script");
      } catch (msgError) {
        console.log("无法发送配置给content script，但本地存储成功");
      }
    }

    showNotification(
      "notifications.config_saved",
      "notifications.config_saved"
    );
    hideConfig();

    console.log("配置已保存，点击'开始监控'将自动跳转到相应页面");
  } catch (error) {
    console.error("保存配置失败:", error);
    alert(
      isI18nReady
        ? i18n.t("alerts.save_config_failed")
        : "保存配置失败: " + error.message
    );
  }
}

// 设置自动保存功能
function setupAutoSave() {
  const inputs = [
    "usernameInput",
    "passwordInput",
    "visaTypeSelect",
    "intervalSelect",
  ];

  inputs.forEach((inputId) => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener("input", debounce(autoSaveConfig, 500));
      input.addEventListener("change", autoSaveConfig);
    }
  });
}

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 自动保存配置
async function autoSaveConfig() {
  try {
    // 防止在初始加载期间触发保存
    if (!isInitialLoadComplete) {
      console.log("初始加载中，跳过自动保存");
      return;
    }

    const username = document.getElementById("usernameInput").value.trim();
    const password = document.getElementById("passwordInput").value.trim();
    const visaType = document.getElementById("visaTypeSelect").value;
    const intervalMinutes = parseFloat(
      document.getElementById("intervalSelect").value
    );

    // 获取当前存储的数据，避免空值覆盖已保存的数据
    const currentStorage = await chrome.storage.local.get([
      "__un",
      "__pw",
      "__vt",
      "__timer",
    ]);

    const updateData = {};

    // 只有当新值不为空时才更新，避免空值覆盖已保存的数据
    if (username || !currentStorage.__un) {
      updateData.__un = username;
    }
    if (password || !currentStorage.__pw) {
      updateData.__pw = password;
    }
    if (visaType || !currentStorage.__vt) {
      updateData.__vt = visaType;
    }
    if (!isNaN(intervalMinutes) && intervalMinutes > 0) {
      updateData.__timer = intervalMinutes;
    }

    // 只有当有数据需要更新时才执行保存
    if (Object.keys(updateData).length > 0) {
      await chrome.storage.local.set(updateData);
      console.log("配置已自动保存:", updateData);
    }
  } catch (error) {
    console.error("自动保存失败:", error);
  }
}

// 显示通知
function showNotification(titleKey, messageKey, params = {}) {
  let title, message;

  if (isI18nReady) {
    title = i18n.t(titleKey, params);
    message = i18n.t(messageKey, params);
  } else {
    // 降级处理：如果国际化未就绪，使用键名
    title = titleKey;
    message = messageKey;
  }

  if (chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
      title: title,
      message: message,
    });
  }
  console.log(`[${title}] ${message}`);
}

// 前往登录页面
async function goToLogin() {
  try {
    const storage = await chrome.storage.local.get(["__vt"]);
    const visaType = storage.__vt || "niv";
    const loginUrl = `https://ais.usvisa-info.com/en-ca/${visaType}/users/sign_in`;

    chrome.tabs.create({ url: loginUrl });
    showNotification("页面跳转", "正在打开登录页面");
  } catch (error) {
    console.error("跳转登录页面失败:", error);
    alert("跳转失败: " + error.message);
  }
}

// 前往预约页面
async function goToSchedule() {
  try {
    const storage = await chrome.storage.local.get(["__vt", "__id"]);
    const visaType = storage.__vt || "niv";

    if (storage.__id) {
      // 如果有预约ID，直接跳转到预约页面
      const scheduleUrl = `https://ais.usvisa-info.com/en-ca/${visaType}/schedule/${storage.__id}/appointment`;
      chrome.tabs.create({ url: scheduleUrl });
      showNotification("页面跳转", "正在打开预约页面");
    } else {
      // 没有预约ID，跳转到仪表板
      const dashboardUrl = `https://ais.usvisa-info.com/en-ca/${visaType}`;
      chrome.tabs.create({ url: dashboardUrl });
      showNotification("页面跳转", "正在打开仪表板，请选择预约");
    }
  } catch (error) {
    console.error("跳转预约页面失败:", error);
    alert("跳转失败: " + error.message);
  }
}

// 重置扩展
async function resetExtension() {
  const confirmMessage = isI18nReady
    ? i18n.t("alerts.confirm_reset")
    : "确定要重置扩展吗？这将清除所有保存的数据。";

  if (confirm(confirmMessage)) {
    try {
      await chrome.storage.local.clear();

      if (currentTab?.url?.includes("ais.usvisa-info.com")) {
        try {
          await chrome.tabs.sendMessage(currentTab.id, {
            action: "stop_monitoring",
          });
        } catch (error) {
          console.log("无法发送停止消息，但存储已清除");
        }
      }

      // 重新加载状态
      isRunning = false;
      document.getElementById("status").textContent = isI18nReady
        ? i18n.t("status_messages.not_started")
        : "状态：未启动";
      document.getElementById("toggleBtn").textContent = isI18nReady
        ? i18n.t("ui.start_monitoring")
        : "开始监控";

      // 清除表单
      document.getElementById("locationSelect").innerHTML =
        '<option value="">请选择预约中心...</option>';
      document.getElementById("usernameInput").value = "";
      document.getElementById("passwordInput").value = "";
      document.getElementById("visaTypeSelect").value = "niv";
      document.getElementById("autoSubmitToggle").checked = false;

      // 清除显示信息
      document.getElementById("scheduleDisplay").textContent = "-";
      document.getElementById("locationDisplay").textContent = "-";
      document.getElementById("currentDateDisplay").textContent = "-";
      document.getElementById("monitorStatus").textContent = isI18nReady
        ? i18n.t("status_messages.waiting_to_start")
        : "待启动";
      document.getElementById("autoSubmitStatus").textContent = isI18nReady
        ? i18n.t("info_values.disabled")
        : "关闭";
      document.getElementById("autoSubmitStatus").style.color = "#27ae60";

      showNotification(
        "notifications.extension_reset",
        "notifications.all_data_cleared"
      );
    } catch (error) {
      console.error("重置失败:", error);
      alert(
        isI18nReady
          ? i18n.t("alerts.reset_failed")
          : "重置失败: " + error.message
      );
    }
  }
}

// 加载预约中心选项
async function loadAppointmentCenters(savedCenters, selectedValue) {
  console.log("loadAppointmentCenters 调用，参数:", {
    savedCenters: savedCenters ? `${savedCenters.length} 个中心` : "无数据",
    selectedValue,
    currentTab: currentTab?.url,
  });

  const locationSelect = document.getElementById("locationSelect");

  // 清空现有选项（除了默认选项）
  locationSelect.innerHTML = isI18nReady
    ? `<option value="">${i18n.t("form.please_select")}</option>`
    : '<option value="">请选择预约中心...</option>';

  let centers = savedCenters;

  // 尝试从当前标签页获取
  if (
    currentTab &&
    currentTab.url &&
    currentTab.url.includes("ais.usvisa-info.com")
  ) {
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: "get_centers",
      });

      if (response?.centers) {
        centers = response.centers;
        if (Array.isArray(centers) && centers.length > 0) {
          // 如果获取到中心数据，保存到local storage
          await chrome.storage.local.set({ __centers: centers });
          console.log("从页面获取并保存预约中心选项:", centers.length);
        }
      }
    } catch (error) {
      console.log("无法从页面获取预约中心选项:", error);
    }
  }

  // 如果仍然没有中心数据，尝试从local storage加载
  if (!centers || !Array.isArray(centers) || centers.length === 0) {
    console.log("没有传入的centers数据，尝试从localStorage加载");
    try {
      const storage = await chrome.storage.local.get(["__centers"]);
      console.log("localStorage查询结果:", storage);
      if (
        storage.__centers &&
        Array.isArray(storage.__centers) &&
        storage.__centers.length > 0
      ) {
        centers = storage.__centers;
        console.log("从local storage加载预约中心选项:", centers.length);
      } else {
        console.log("local storage中无预约中心数据，尝试其他方式获取");
      }
    } catch (error) {
      console.log("从local storage获取预约中心选项失败:", error);
    }
  } else {
    console.log("使用传入的centers数据:", centers.length);
  }

  // 填充选项
  if (centers?.length > 0) {
    centers.forEach((center) => {
      const option = document.createElement("option");
      option.value = center.value;
      option.textContent = `${center.text} (${center.value})`;

      if (selectedValue && selectedValue === center.value) {
        option.selected = true;
      } else if (selectedValue === center.value) {
        // 单选模式：如果值匹配则选中
        option.selected = true;
      } else if (center.selected) {
        option.selected = true;
      }

      locationSelect.appendChild(option);
    });

    console.log(`已加载 ${centers.length} 个预约中心选项`);
  } else {
    // 如果没有数据，添加提示选项
    const option = document.createElement("option");
    option.value = "";
    option.textContent = isI18nReady
      ? i18n.t("form.visit_appointment_page_first")
      : "请先访问预约页面获取中心选项";
    option.disabled = true;
    locationSelect.appendChild(option);
    console.log("无预约中心数据，显示提示信息");
  }
}

// 刷新预约中心选项
async function refreshAppointmentCenters() {
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: "get_centers",
    });

    if (response?.centers) {
      const storage = await chrome.storage.local.get(["__il"]);
      await loadAppointmentCenters(response.centers, storage.__il);
      showNotification(
        "notifications.centers_updated",
        "notifications.centers_updated"
      );
    } else {
      showNotification(
        "notifications.update_failed",
        "alerts.open_appointment_page"
      );
    }
  } catch (error) {
    console.error("刷新预约中心选项失败:", error);
    showNotification("notifications.update_failed", "alerts.connection_failed");
  }

  // Fallback到从localStorage加载
  try {
    const storage = await chrome.storage.local.get(["__centers", "__il"]);
    if (
      storage.__centers &&
      Array.isArray(storage.__centers) &&
      storage.__centers.length > 0
    ) {
      await loadAppointmentCenters(storage.__centers, storage.__il);
      console.log("从localStorage成功加载centers:", storage.__centers.length);
    } else {
      console.log("localStorage中没有可用的centers数据");
    }
  } catch (error) {
    console.error("从localStorage加载centers失败:", error);
  }
}

// 启动自动导航流程
async function startAutoNavigationFlow(visaType) {
  try {
    console.log("=== 开始自动导航流程 ===");
    console.log("签证类型:", visaType);

    const storage = await chrome.storage.local.get(["__un", "__pw"]);
    console.log("存储检查 - 用户名:", storage.__un ? "已设置" : "未设置");
    console.log("存储检查 - 密码:", storage.__pw ? "已设置" : "未设置");

    if (!storage.__un || !storage.__pw) {
      console.log("凭据不完整，显示通知");
      showNotification("alerts.fill_credentials", "alerts.fill_credentials");
      return;
    }

    // 设置导航流程标记
    console.log("设置导航流程标记...");
    await chrome.storage.local.set({ __navigationFlow: true });
    console.log("导航流程标记已设置");

    // 根据签证类型构建登录URL
    const loginUrl = `https://ais.usvisa-info.com/en-ca/${visaType}/users/sign_in`;
    console.log("构建的登录URL:", loginUrl);

    showNotification("notifications.navigating", "notifications.navigating");

    // 打开登录页面
    console.log("尝试创建新标签页...");
    chrome.tabs.create({ url: loginUrl }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error("创建标签页错误:", chrome.runtime.lastError);
        return;
      }

      if (tab) {
        console.log("新标签页创建成功，ID:", tab.id);
        console.log("新标签页URL:", tab.url);

        // 监听标签页更新，跟踪导航流程
        trackNavigationProgress(tab.id, visaType);
      } else {
        console.error("创建标签页失败：tab为null");
      }
    });

    console.log("=== 自动导航流程请求完成 ===");
  } catch (error) {
    console.error("自动导航失败:", error);
    console.error("错误详情:", error.stack);
    showNotification("alerts.operation_failed", "alerts.operation_failed");
  }
}

// 跟踪导航进度
function trackNavigationProgress(tabId, visaType) {
  const checkInterval = setInterval(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);

      if (!tab.url) return;

      // 检查页面状态
      if (tab.url.includes("/users/sign_in")) {
        showNotification("page_types.login", "page_types.login");
      } else if (tab.url.includes("/groups/")) {
        showNotification("page_types.dashboard", "page_types.dashboard");
      } else if (tab.url.includes("/appointment")) {
        showNotification("page_types.appointment", "page_types.appointment");
        clearInterval(checkInterval);
      }
    } catch (error) {
      console.log("标签页可能已关闭:", error);
      clearInterval(checkInterval);
    }
  }, 2000);

  // 5分钟后停止跟踪
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 300000);
}

// 从本地存储加载基本信息
async function loadBasicInfoFromStorage() {
  try {
    const storage = await chrome.storage.local.get([
      "__id", // scheduleId
      "__il", // appointment center
      "__al", // centers array
      "__as", // auto submit
      "__ad", // appointment date
      "__active", // monitoring status
    ]);

    // 更新预约ID显示
    document.getElementById("scheduleDisplay").textContent =
      storage.__id || "-";

    // 更新自动提交状态
    const autoSubmitStatus = isI18nReady
      ? storage.__as
        ? i18n.t("info_values.enabled")
        : i18n.t("info_values.disabled")
      : storage.__as
      ? "开启"
      : "关闭";
    document.getElementById("autoSubmitStatus").textContent = autoSubmitStatus;
    document.getElementById("autoSubmitStatus").style.color = storage.__as
      ? "#e74c3c"
      : "#27ae60";

    // 更新当前预约日期
    if (storage.__ad) {
      document.getElementById("currentDateDisplay").textContent = storage.__ad;
    }

    // 更新地点显示
    const mockStatus = {
      apptCenter: storage.__il,
    };
    updateLocationDisplay(mockStatus);

    // 更新监控状态
    if (storage.__active !== undefined) {
      isRunning = storage.__active;
      const statusText = isI18nReady
        ? isRunning
          ? i18n.t("status_messages.monitoring")
          : i18n.t("status_messages.not_started")
        : isRunning
        ? "状态：监控中..."
        : "状态：未启动";

      document.getElementById("status").textContent = statusText;

      const buttonText = isI18nReady
        ? isRunning
          ? i18n.t("ui.stop_monitoring")
          : i18n.t("ui.start_monitoring")
        : isRunning
        ? "停止监控"
        : "开始监控";

      document.getElementById("toggleBtn").textContent = buttonText;
    }

    console.log("已从本地存储加载基本信息");
  } catch (error) {
    console.error("从本地存储加载信息失败:", error);
  }
}

// 获取预约中心的显示名称
function getCenterDisplayName(centerValue, locationSelect) {
  if (!centerValue) return "";

  const option = Array.from(locationSelect.options).find(
    (opt) => opt.value === centerValue
  );

  if (option?.text) {
    // 清理显示文本，统一格式
    let displayText = option.text.trim();

    // 处理不同的格式，统一为 "名称(ID)" 的格式
    // 例如："Toronto (94)" -> "Toronto(94)"
    // 例如："Toronto - 94" -> "Toronto(94)"
    // 例如："94" -> "中心(94)"

    // 首先移除多余的空格和标点
    displayText = displayText.replace(/\s*[-\s]\s*(\d+)\s*/, "($1)");
    displayText = displayText.replace(/\s*\(\s*(\d+)\s*\)\s*/, "($1)");

    // 如果只是数字，尝试找到更友好的名称
    if (/^\d+$/.test(displayText)) {
      const centerLabel = isI18nReady ? i18n.t("form.center") : "中心";
      displayText = `${centerLabel}(${displayText})`;
    }

    // 如果文本太长，适当缩短但保留关键信息
    if (displayText.length > 15) {
      const match = displayText.match(/^(.{8,12})[^(]*(\(\d+\))$/);
      if (match) {
        displayText = match[1].trim() + match[2];
      }
    }

    return displayText;
  }

  // 如果找不到选项，返回格式化的原值
  return /^\d+$/.test(centerValue) ? `${centerValue}` : centerValue;
}

// 更新地点显示
function updateLocationDisplay(status) {
  const locationSelect = document.getElementById("locationSelect");
  let displayText = "-";

  if (status.apptCenter) {
    // 单中心模式
    const centerName = getCenterDisplayName(status.apptCenter, locationSelect);
    if (centerName) {
      displayText = centerName;
    }
  }

  document.getElementById("locationDisplay").textContent = displayText;

  // 如果文本太长，添加title属性显示完整内容
  const locationDisplayElement = document.getElementById("locationDisplay");
  if (displayText.length > 20) {
    locationDisplayElement.title = displayText;
    // 可以选择截断显示
    // locationDisplayElement.textContent = displayText.substring(0, 18) + "...";
  } else {
    locationDisplayElement.title = "";
  }
}
