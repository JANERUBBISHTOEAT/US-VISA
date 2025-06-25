(() => {
  // 让 popup.js 可以从 content.js 获取 scheduleId
  const urlMatch = window.location.pathname.match(/schedule\/(\d+)/);
  const scheduleId = urlMatch ? urlMatch[1] : null;

  if (scheduleId) {
    window.scheduleIdFromPage = scheduleId;
    console.log("Schedule ID (from URL):", scheduleId);
  } else {
    console.error("未能从URL中提取 scheduleId");
  }
})();
