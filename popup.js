let isRunning = false;
let currentTab = null;

// 初始化页面
document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentStatus();
  await loadDefaultSettings();
  setupEventListeners();
});

// 加载默认设置
async function loadDefaultSettings() {
  try {
    const storage = await chrome.storage.local.get(["__il"]);
    if (storage.__il) {
      document.getElementById("locationNumb").value = storage.__il;
    }
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
  document.getElementById("locationDisplay").textContent =
    status.apptCenter || "-";
  document.getElementById("currentDateDisplay").textContent =
    status.apptDate || "-";
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
      const locationNum = document.getElementById("locationNumb").value.trim();
      const intervalMinutes = parseInt(
        document.getElementById("intervalSelect").value
      );

      if (!locationNum || isNaN(locationNum)) {
        alert("请输入有效的地点编号！");
        return;
      }

      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: "start_monitoring",
          center: locationNum,
          interval: intervalMinutes * 60 * 1000,
        });

        if (response && response.success) {
          isRunning = true;
          document.getElementById("status").textContent = "状态：监控中...";
          document.getElementById("toggleBtn").textContent = "停止监控";
          document.getElementById("locationDisplay").textContent = locationNum;

          showNotification(
            "监控已启动",
            `正在监控地点 ${locationNum}，检查间隔 ${intervalMinutes} 分钟`
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
    const storage = await chrome.storage.local.get(["__un", "__pw", "__il"]);

    if (storage.__un) {
      document.getElementById("usernameInput").value = storage.__un;
    }
    if (storage.__pw) {
      document.getElementById("passwordInput").value = storage.__pw;
    }
    if (storage.__il) {
      document.getElementById("centerInput").value = storage.__il;
    }
  } catch (error) {
    console.error("加载配置失败:", error);
  }
}

// 保存配置
async function saveConfig() {
  const username = document.getElementById("usernameInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();
  const center = document.getElementById("centerInput").value.trim();

  if (!username || !password) {
    alert("请填写用户名和密码");
    return;
  }

  try {
    // 保存到storage
    await chrome.storage.local.set({
      __un: username,
      __pw: password,
      __il: center,
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
          center: center,
        });
        console.log("配置已发送给content script");
      } catch (msgError) {
        console.log("无法发送配置给content script，但本地存储成功");
      }
    }

    showNotification("配置已保存", "用户配置已更新");
    hideConfig();

    // 更新显示的默认中心
    if (center) {
      document.getElementById("locationNumb").value = center;
    }
  } catch (error) {
    console.error("保存配置失败:", error);
    alert("保存配置失败: " + error.message);
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
      document.getElementById("locationNumb").value = "";
      document.getElementById("usernameInput").value = "";
      document.getElementById("passwordInput").value = "";
      document.getElementById("centerInput").value = "";

      // 清除显示信息
      document.getElementById("scheduleDisplay").textContent = "-";
      document.getElementById("locationDisplay").textContent = "-";
      document.getElementById("currentDateDisplay").textContent = "-";

      showNotification("扩展已重置", "所有数据已清除");
    } catch (error) {
      console.error("重置失败:", error);
      alert("重置失败: " + error.message);
    }
  }
}
