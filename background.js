// US Visa Appointment Scheduler Background Service Worker

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("US Visa Scheduler installed:", details.reason);

  if (details.reason === "install") {
    // 首次安装时的初始化
    await chrome.storage.local.set({
      __version: "2.0.0",
      __active: false,
      __timer: 120000, // 默认2分钟
      __fq: 2, // 默认频率2分钟
      __cr: 0, // credits
      __pl: 0, // plan level
    });

    // 打开欢迎页面或设置页面
    chrome.tabs.create({
      url: "https://ais.usvisa-info.com/",
    });
  }
});

// 处理来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request);

  if (request.action === "ping") {
    sendResponse({ pong: true });
    return true;
  }

  if (request.action === "notification") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon48.png"),
      title: request.title || "US Visa Scheduler",
      message: request.message || "通知消息",
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "open_tab") {
    chrome.tabs.create({
      url: request.url,
    });
    sendResponse({ success: true });
    return true;
  }

  sendResponse({ success: false });
  return true;
});

// 处理通知点击
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log("Notification clicked:", notificationId);

  // 聚焦到活动的美签页面
  chrome.tabs.query(
    {
      url: "https://ais.usvisa-info.com/*",
    },
    (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    }
  );
});

// 扩展启动时恢复状态
chrome.runtime.onStartup.addListener(async () => {
  console.log("Extension startup - checking for active monitoring...");

  const storage = await chrome.storage.local.get(["__active", "__version"]);

  if (storage.__active) {
    console.log("Monitoring was active, attempting to restore...");

    // 查找美签页面并发送恢复消息
    chrome.tabs.query(
      {
        url: "https://ais.usvisa-info.com/*",
      },
      (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs
            .sendMessage(tab.id, {
              action: "restore_monitoring",
            })
            .catch((err) => {
              console.log("Could not restore monitoring on tab:", tab.id);
            });
        });
      }
    );
  }
});

// 处理扩展图标点击
chrome.action.onClicked.addListener((tab) => {
  // 检查是否在美签网站
  if (tab.url && tab.url.includes("ais.usvisa-info.com")) {
    // 在美签网站，打开popup（这个由default_popup处理）
    return;
  } else {
    // 不在美签网站，打开美签网站
    chrome.tabs.create({
      url: "https://ais.usvisa-info.com/",
    });
  }
});

// 定时清理过期数据
setInterval(async () => {
  try {
    const storage = await chrome.storage.local.get(["__last_clean"]);
    const lastClean = storage.__last_clean || 0;
    const now = Date.now();

    // 每24小时清理一次
    if (now - lastClean > 24 * 60 * 60 * 1000) {
      await chrome.storage.local.set({ __last_clean: now });

      // 清理临时数据但保留用户配置
      const keepKeys = [
        "__un",
        "__pw",
        "__il",
        "__al",
        "__version",
        "__active",
        "__timer",
      ];
      const allData = await chrome.storage.local.get(null);
      const toRemove = Object.keys(allData).filter(
        (key) => !keepKeys.includes(key) && key.startsWith("temp_")
      );

      if (toRemove.length > 0) {
        await chrome.storage.local.remove(toRemove);
        console.log("Cleaned up temporary data:", toRemove.length, "items");
      }
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}, 60 * 60 * 1000); // 每小时检查一次

console.log("US Visa Scheduler background service worker loaded");
