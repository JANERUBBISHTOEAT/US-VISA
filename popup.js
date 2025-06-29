let isRunning = false;
let currentTab = null;

// 初始化页面
document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentStatus();
  setupEventListeners();
});

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

    // 从content script获取状态
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "get_status",
    });

    if (response) {
      updateUI(response);
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
    } else {
      // 停止监控
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: "stop_monitoring",
      });

      if (response && response.success) {
        isRunning = false;
        document.getElementById("status").textContent = "状态：未启动";
        document.getElementById("toggleBtn").textContent = "开始监控";

        showNotification("监控已停止", "预约监控已停止");
      }
    }
  } catch (error) {
    console.error("切换监控状态失败:", error);
    alert("操作失败，请确保在美签预约页面");
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

    // 发送给content script
    if (currentTab) {
      await chrome.tabs.sendMessage(currentTab.id, {
        action: "set_config",
        username: username,
        password: password,
        center: center,
      });
    }

    showNotification("配置已保存", "用户配置已更新");
    hideConfig();
  } catch (error) {
    console.error("保存配置失败:", error);
    alert("保存配置失败");
  }
}

// 显示通知
function showNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
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

      if (currentTab) {
        await chrome.tabs.sendMessage(currentTab.id, {
          action: "stop_monitoring",
        });
      }

      // 重新加载状态
      await loadCurrentStatus();

      showNotification("扩展已重置", "所有数据已清除");
    } catch (error) {
      console.error("重置失败:", error);
    }
  }
}
