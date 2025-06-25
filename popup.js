let isRunning = false;
let intervalId = null;

document.getElementById("toggleBtn").addEventListener("click", async () => {
  const locationNum = document.getElementById("locationNumb").value.trim();

  if (!locationNum || isNaN(locationNum)) {
    alert("请输入有效的地点编号！");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 获取 scheduleId
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        const match = window.location.pathname.match(/schedule\/(\d+)/);
        return match ? match[1] : null;
      },
    },
    async (result) => {
      const scheduleId = result[0].result;
      if (!scheduleId) {
        alert("无法获取 scheduleId，请确保当前页面是预约页面");
        return;
      }

      document.getElementById("scheduleDisplay").textContent = scheduleId;
      document.getElementById("locationDisplay").textContent = locationNum;

      // 切换状态
      isRunning = !isRunning;

      document.getElementById("status").textContent = isRunning
        ? "状态：监控中..."
        : "状态：未启动";
      document.getElementById("toggleBtn").textContent = isRunning
        ? "停止监控"
        : "开始监控";

      // 执行或停止监控逻辑
      if (isRunning) {
        // 启动监控：注入循环代码
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (scheduleId, locationNumber) => {
            if (window._visaCheckerTimer)
              clearInterval(window._visaCheckerTimer);

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
                console.clear();
                console.log(
                  `📅 ScheduleID: ${scheduleId}, 地点: ${locationNumber}`
                );
                if (data.length > 0) {
                  console.log("🟢 可预约日期：");
                  data.forEach((d) =>
                    console.log(`${d.date} - 工作日: ${d.business_day}`)
                  );
                } else {
                  console.log("暂无可预约时间...");
                }
              } catch (err) {
                console.error("请求出错：", err);
              }
            }

            checkAppointments(); // 第一次立即请求
            window._visaCheckerTimer = setInterval(checkAppointments, 60000); // 每分钟请求
          },
          args: [scheduleId, parseInt(locationNum)],
        });
      } else {
        // 停止监控：注入取消逻辑
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window._visaCheckerTimer) {
              clearInterval(window._visaCheckerTimer);
              window._visaCheckerTimer = null;
              console.log("已停止监控");
            }
          },
        });
      }
    }
  );
});
