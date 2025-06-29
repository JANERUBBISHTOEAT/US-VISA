let isRunning = false;
let currentTab = null;

// 初始化页面
document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentStatus();
  await loadDefaultSettings();
  setupEventListeners();

  // 尝试加载预约中心选项
  await refreshAppointmentCenters();
});

// 加载默认设置
async function loadDefaultSettings() {
  try {
    const storage = await chrome.storage.local.get([
      "__il",
      "__vt",
      "__centers",
      "__as", // 自动提交设置
    ]);

    if (storage.__vt) {
      document.getElementById("visaTypeSelect").value = storage.__vt;
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
      if (
        currentTab &&
        currentTab.url &&
        currentTab.url.includes("ais.usvisa-info.com")
      ) {
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
        .filter((text) => text !== "请选择预约中心...");

      if (selectedValues.length > 0) {
        // 自动保存选择（多个值用逗号分隔）
        chrome.storage.local.set({
          __il: selectedValues.join(","),
          __selectedCenters: selectedTexts.join(", "),
        });
        console.log("已选择预约中心:", selectedTexts.join(", "));
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
      document.getElementById("status").textContent = "状态：请先打开美签网站";
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
        document.getElementById("status").textContent = "状态：等待页面加载...";
      }
    } catch (msgError) {
      console.log("无法连接到content script，可能页面还在加载");
      document.getElementById("status").textContent = "状态：等待页面加载...";

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
        }
      }, 2000);
    }
  } catch (error) {
    console.error("加载状态失败:", error);
    document.getElementById("status").textContent = "状态：未连接";
  }
}

// 更新UI显示
function updateUI(status) {
  isRunning = status.active || false;

  document.getElementById("status").textContent = isRunning
    ? "状态：监控中..."
    : "状态：未启动";
  document.getElementById("toggleBtn").textContent = isRunning
    ? "停止监控"
    : "开始监控";
  document.getElementById("scheduleDisplay").textContent =
    status.scheduleId || "-";

  // 显示预约中心信息
  if (status.apptCenters && status.apptCenters.length > 0) {
    // 多中心模式 - 尝试找到对应的中心名称
    const locationSelect = document.getElementById("locationSelect");
    const centerNames = status.apptCenters.map((centerValue) => {
      const option = Array.from(locationSelect.options).find(
        (opt) => opt.value === centerValue
      );
      return option ? option.text : centerValue;
    });
    document.getElementById("locationDisplay").textContent =
      centerNames.join(", ");
  } else if (status.apptCenter) {
    // 检查是否为逗号分隔的多中心字符串
    const locationSelect = document.getElementById("locationSelect");

    if (status.apptCenter.includes(",")) {
      // 多中心模式 - 解析逗号分隔的字符串
      const centerValues = status.apptCenter.split(",").map((v) => v.trim());
      const centerNames = centerValues.map((centerValue) => {
        const option = Array.from(locationSelect.options).find(
          (opt) => opt.value === centerValue
        );
        return option ? option.text : centerValue;
      });
      document.getElementById("locationDisplay").textContent =
        centerNames.join(", ");
    } else {
      // 单中心模式
      const option = Array.from(locationSelect.options).find(
        (opt) => opt.value === status.apptCenter
      );
      if (option) {
        document.getElementById("locationDisplay").textContent = option.text;
      } else {
        document.getElementById("locationDisplay").textContent =
          status.apptCenter;
      }
    }
  } else {
    document.getElementById("locationDisplay").textContent = "-";
  }

  document.getElementById("currentDateDisplay").textContent =
    status.apptDate || "-";

  // 显示页面状态
  let pageStatus = "未知页面";
  if (status.currentPage) {
    if (status.currentPage.isSignIn) pageStatus = "登录页面";
    else if (status.currentPage.isDashboard) pageStatus = "仪表板";
    else if (status.currentPage.isAppointment) pageStatus = "预约页面";
    else if (status.currentPage.isConfirmation) pageStatus = "确认页面";
    else if (status.currentPage.isAddressPage) pageStatus = "地址页面";
    else if (status.currentPage.isLoggedOut) pageStatus = "首页";
  }

  document.getElementById("monitorStatus").textContent = pageStatus;

  // 更新自动提交状态显示
  const autoSubmitStatus = status.autoSubmit ? "开启" : "关闭";
  document.getElementById("autoSubmitStatus").textContent = autoSubmitStatus;
  document.getElementById("autoSubmitStatus").style.color = status.autoSubmit
    ? "#e74c3c"
    : "#27ae60";

  // 更新签证类型显示
  if (status.visaType) {
    const visaTypeText = status.visaType === "niv" ? "非移民签证" : "移民签证";
    console.log("当前签证类型:", visaTypeText);
  }
}

// 切换监控状态
async function toggleMonitoring() {
  if (!currentTab) {
    alert("请先打开美签预约页面");
    return;
  }

  // 检查是否在美签网站
  if (!currentTab.url || !currentTab.url.includes("ais.usvisa-info.com")) {
    alert("请在美签网站 (ais.usvisa-info.com) 上使用此功能");
    return;
  }

  try {
    if (!isRunning) {
      // 启动监控
      const locationSelect = document.getElementById("locationSelect");
      const selectedOptions = Array.from(locationSelect.selectedOptions);
      const selectedValues = selectedOptions
        .map((opt) => opt.value)
        .filter((val) => val);
      const intervalMinutes = parseInt(
        document.getElementById("intervalSelect").value
      );

      if (selectedValues.length === 0) {
        alert("请选择至少一个预约中心！");
        return;
      }

      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: "start_monitoring",
          centers: selectedValues, // 发送多个中心
          interval: intervalMinutes * 60 * 1000,
        });

        if (response && response.success) {
          isRunning = true;
          document.getElementById("status").textContent = "状态：监控中...";
          document.getElementById("toggleBtn").textContent = "停止监控";

          // 显示选中的预约中心名称
          const selectedTexts = selectedOptions
            .map((opt) => opt.text)
            .filter((text) => text !== "请选择预约中心...");
          document.getElementById("locationDisplay").textContent =
            selectedTexts.join(", ");

          showNotification(
            "监控已启动",
            `正在监控 ${selectedValues.length} 个中心，检查间隔 ${intervalMinutes} 分钟`
          );
        } else {
          alert("启动监控失败，请确保在正确的页面");
        }
      } catch (msgError) {
        console.error("发送监控消息失败:", msgError);
        alert("无法连接到页面，请刷新页面后重试");
      }
    } else {
      // 停止监控
      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: "stop_monitoring",
        });

        if (response && response.success) {
          isRunning = false;
          document.getElementById("status").textContent = "状态：未启动";
          document.getElementById("toggleBtn").textContent = "开始监控";

          showNotification("监控已停止", "预约监控已停止");
        }
      } catch (msgError) {
        console.error("发送停止消息失败:", msgError);
        // 即使消息发送失败，也更新UI状态
        isRunning = false;
        document.getElementById("status").textContent = "状态：未启动";
        document.getElementById("toggleBtn").textContent = "开始监控";
      }
    }
  } catch (error) {
    console.error("切换监控状态失败:", error);
    alert("操作失败: " + error.message);
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
  } catch (error) {
    console.error("加载配置失败:", error);
  }
}

// 保存配置
async function saveConfig() {
  const username = document.getElementById("usernameInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();
  const visaType = document.getElementById("visaTypeSelect").value;

  if (!username || !password) {
    alert("请填写用户名和密码");
    return;
  }

  try {
    // 保存到storage
    await chrome.storage.local.set({
      __un: username,
      __pw: password,
      __vt: visaType,
      __autoFlow: true, // 标记需要自动流程
    });

    // 尝试发送给content script（如果可用）
    if (
      currentTab &&
      currentTab.url &&
      currentTab.url.includes("ais.usvisa-info.com")
    ) {
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

    showNotification("配置已保存", "正在自动引导到登录页面...");
    hideConfig();

    // 启动自动导航流程
    await startAutoNavigationFlow(visaType);
  } catch (error) {
    console.error("保存配置失败:", error);
    alert("保存配置失败: " + error.message);
  }
}

// 设置自动保存功能
function setupAutoSave() {
  const inputs = ["usernameInput", "passwordInput", "visaTypeSelect"];

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
    const username = document.getElementById("usernameInput").value.trim();
    const password = document.getElementById("passwordInput").value.trim();
    const visaType = document.getElementById("visaTypeSelect").value;

    await chrome.storage.local.set({
      __un: username,
      __pw: password,
      __vt: visaType,
    });

    console.log("配置已自动保存");
  } catch (error) {
    console.error("自动保存失败:", error);
  }
}

// 显示通知
function showNotification(title, message) {
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
  if (confirm("确定要重置扩展吗？这将清除所有保存的数据。")) {
    try {
      await chrome.storage.local.clear();

      if (
        currentTab &&
        currentTab.url &&
        currentTab.url.includes("ais.usvisa-info.com")
      ) {
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
      document.getElementById("status").textContent = "状态：未启动";
      document.getElementById("toggleBtn").textContent = "开始监控";

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
      document.getElementById("monitorStatus").textContent = "待启动";
      document.getElementById("autoSubmitStatus").textContent = "关闭";
      document.getElementById("autoSubmitStatus").style.color = "#27ae60";

      showNotification("扩展已重置", "所有数据已清除");
    } catch (error) {
      console.error("重置失败:", error);
      alert("重置失败: " + error.message);
    }
  }
}

// 加载预约中心选项
async function loadAppointmentCenters(savedCenters, selectedValue) {
  const locationSelect = document.getElementById("locationSelect");

  // 清空现有选项（除了默认选项）
  locationSelect.innerHTML = '<option value="">请选择预约中心...</option>';

  let centers = savedCenters;

  // 如果没有保存的中心数据，尝试从当前标签页获取
  if (
    !centers &&
    currentTab &&
    currentTab.url &&
    currentTab.url.includes("ais.usvisa-info.com")
  ) {
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: "get_centers",
      });

      if (response && response.centers) {
        centers = response.centers;
        // 保存到storage
        await chrome.storage.local.set({ __centers: centers });
      }
    } catch (error) {
      console.log("无法从页面获取预约中心选项:", error);
    }
  }

  // 填充选项
  if (centers && centers.length > 0) {
    centers.forEach((center) => {
      const option = document.createElement("option");
      option.value = center.value;
      option.textContent = `${center.text} (${center.value})`;

      if (selectedValue && selectedValue === center.value) {
        option.selected = true;
      } else if (selectedValue && selectedValue.includes(",")) {
        // 支持多选时的选中状态
        const selectedValues = selectedValue.split(",");
        if (selectedValues.includes(center.value)) {
          option.selected = true;
        }
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
    option.textContent = "请先访问预约页面获取中心选项";
    option.disabled = true;
    locationSelect.appendChild(option);
  }
}

// 刷新预约中心选项
async function refreshAppointmentCenters() {
  if (
    currentTab &&
    currentTab.url &&
    currentTab.url.includes("ais.usvisa-info.com")
  ) {
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: "get_centers",
      });

      if (response && response.centers) {
        const storage = await chrome.storage.local.get(["__il"]);
        await loadAppointmentCenters(response.centers, storage.__il);
        showNotification(
          "预约中心选项已更新",
          `获取到 ${response.centers.length} 个预约中心`
        );
      } else {
        showNotification("更新失败", "当前页面没有预约中心选项");
      }
    } catch (error) {
      console.error("刷新预约中心选项失败:", error);
      showNotification("更新失败", "无法连接到页面");
    }
  } else {
    showNotification("更新失败", "请先在美签预约页面上刷新");
  }
}

// 启动自动导航流程
async function startAutoNavigationFlow(visaType) {
  try {
    const storage = await chrome.storage.local.get(["__un", "__pw"]);

    if (!storage.__un || !storage.__pw) {
      showNotification("配置错误", "请先设置用户名和密码");
      return;
    }

    // 根据签证类型构建登录URL
    const loginUrl = `https://ais.usvisa-info.com/en-ca/${visaType}/users/sign_in`;

    showNotification("开始自动导航", "正在打开登录页面...");

    // 打开登录页面
    chrome.tabs.create({ url: loginUrl }, (tab) => {
      if (tab) {
        // 监听标签页更新，跟踪导航流程
        trackNavigationProgress(tab.id, visaType);
      }
    });
  } catch (error) {
    console.error("自动导航失败:", error);
    showNotification("导航失败", error.message);
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
        showNotification("导航状态", "已到达登录页面，正在自动登录...");
      } else if (tab.url.includes("/groups/")) {
        showNotification("导航状态", "已登录，正在获取预约信息...");
      } else if (tab.url.includes("/appointment")) {
        showNotification("导航状态", "已到达预约页面，准备开始监控");
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
