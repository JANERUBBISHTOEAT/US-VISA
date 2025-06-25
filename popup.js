document.getElementById("startBtn").addEventListener("click", async () => {
  const locationNum = document.getElementById("locationNumb").value.trim();

  if (!locationNum || isNaN(locationNum)) {
    alert("请输入有效的地点数字！");
    return;
  }

  // 获取当前 tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 注入并执行主监控逻辑，传入 locationNum
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (locationNumber) => {
      const match = window.location.pathname.match(/\/schedule\/(\d+)/);
      const scheduleId = match ? match[1] : null;
      if (!scheduleId) {
        console.error("未能获取 scheduleId");
        return;
      }

      const baseUrl = `https://ais.usvisa-info.com/en-ca/niv/schedule/${scheduleId}/appointment/days/`;

      async function checkAppointments() {
        try {
          const res = await fetch(
            `${baseUrl}${locationNumber}.json?appointments[expedite]=false`,
            {
              method: "GET",
              credentials: "include",
              headers: {
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest",
              },
            }
          );

          if (!res.ok) {
            console.warn("请求失败:", res.status);
            return;
          }

          const data = await res.json();
          if (data.length > 0) {
            console.log("🟢 可预约日期：");
            console.log(`${data[0].date} - ${data[0].business_day}`);
            if (data.length > 1) {
              const last = data[data.length - 1];
              console.log(`${last.date} - ${last.business_day}`);
            }
          } else {
            console.log("暂无可预约时间...");
          }
        } catch (err) {
          console.error("请求出错：", err);
        }
      }

      console.log(
        `开始监控 Schedule ${scheduleId}, Location ${locationNumber}`
      );
      checkAppointments();
      setInterval(checkAppointments, 60000);
    },
    args: [parseInt(locationNum)],
  });
});
