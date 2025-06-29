(async function (page) {
  // 核心配置变量
  let $username = null,
    $password = null,
    $appid = null,
    $apptCenter = null,
    $apptDate = null,
    $ascCenter = null,
    $ascReverse = false,
    $start = null,
    $end = null,
    $active = false,
    $failed = false,
    $resets = 0,
    $timer = 60000, // 默认1分钟检查间隔
    $version = "2.0.0",
    $checkInterval = null,
    $visaType = "niv"; // 默认非移民签证

  // 工具函数
  const delay = async ($delay = 2000) =>
    await new Promise((r) => setTimeout(r, $delay));

  const toast = (html, type = "info") => {
    console.log(`[VISA-CHECKER ${type.toUpperCase()}]:`, html);
    // 可以添加更好的通知显示
  };

  const headers = { "x-requested-with": "XMLHttpRequest" };

  const throwNotification = async (title, message) => {
    try {
      // 通过background script发送通知
      chrome.runtime.sendMessage({
        action: "notification",
        title: title,
        message: message,
      });
    } catch (error) {
      console.log("发送通知失败:", error);
    }
    console.log(`[NOTIFICATION] ${title}: ${message}`);
  };

  // 日期验证函数
  const dateValidityCheck = (start, end, checkDate) => {
    if (!start || !end || !checkDate) return true;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const targetDate = new Date(checkDate);
    return targetDate >= startDate && targetDate <= endDate;
  };

  // 页面类型检测
  const nav = navigator ? navigator.language : "xx-xx";
  const isSignIn = !!page.match(/^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/users\/sign_in/);
  const isLoggedOut = !!page.match(/^\/[a-z]{2}-[a-z]{2}\/(n|)iv$/);
  const isDashboard = !!page.match(
    /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/groups\/\d{1,}/
  );
  const isAppointment = !!page.match(
    /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/schedule\/\d{1,}\/appointment$/
  );
  const isConfirmation = !!page.match(
    /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/schedule\/\d{1,}\/appointment\/instructions$/
  );

  // 从URL判断签证类型
  const currentVisaType = page.match(/\/(niv|iv)\//)?.[1] || "niv";

  // 获取scheduleId
  const urlMatch = window.location.pathname.match(/schedule\/(\d+)/);
  const scheduleId = urlMatch ? urlMatch[1] : null;

  if (scheduleId) {
    window.scheduleIdFromPage = scheduleId;
    console.log("Schedule ID (from URL):", scheduleId);
  }

  // 核心预约检查函数
  async function getNewDate($delay, $center, $ascCenter) {
    try {
      if (!$center) {
        toast("预约中心未设置", "error");
        return;
      }

      const appointmentUrl = `${page}/days/${$center}.json?appointments[expedite]=false`;

      toast(`检查预约中心 ${$center} 的可用日期...`);

      const response = await fetch(appointmentUrl, {
        headers,
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status >= 500) {
          toast(`服务器错误 (${response.status})，将重试...`, "warning");
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const $dates = await response.json();

      if (!Array.isArray($dates) || $dates.length === 0) {
        toast("暂无可用预约日期");
        return;
      }

      // 过滤和排序日期
      let availableDates = $dates
        .map((d) => d.date)
        .filter((d) => dateValidityCheck($start, $end, d))
        .sort((a, b) => new Date(a) - new Date(b));

      if (availableDates.length === 0) {
        toast("在指定日期范围内没有可用预约");
        return;
      }

      let latestDate = availableDates[0];

      // 检查是否比当前预约更早
      if ($apptDate && new Date(latestDate) >= new Date($apptDate)) {
        toast(`找到日期 ${latestDate}，但不早于当前预约 ${$apptDate}`);
        return;
      }

      toast(`🎉 找到更早的预约日期: ${latestDate}!`, "success");

      // 获取该日期的可用时间
      const timesUrl = `${page}/times/${$center}.json?date=${latestDate}&appointments[expedite]=false`;
      const timesResponse = await fetch(timesUrl, { headers });

      if (!timesResponse.ok) {
        throw new Error(`获取时间失败: ${timesResponse.status}`);
      }

      const $times = await timesResponse.json();

      if (!$times.available_times || $times.available_times.length === 0) {
        toast(`日期 ${latestDate} 没有可用时间`, "warning");
        return;
      }

      let selectedTime = $times.available_times[0];

      // 如果在预约页面，自动填写表单
      if (
        isAppointment &&
        document.getElementById("appointments_consulate_appointment_date")
      ) {
        await fillAppointmentForm(
          latestDate,
          selectedTime,
          $center,
          $ascCenter
        );
      }

      // 发送通知
      await throwNotification(
        "发现更早预约!",
        `找到 ${latestDate} ${selectedTime} 的预约。请尽快确认！`
      );
    } catch (error) {
      console.error("检查预约时出错:", error);
      toast(`检查预约失败: ${error.message}`, "error");

      // 如果是认证错误，停止检查
      if (error.message.includes("401") || error.message.includes("403")) {
        stopMonitoring();
        toast("认证失败，请重新登录", "error");
      }
    }
  }

  // 填写预约表单
  async function fillAppointmentForm(date, time, center, ascCenter) {
    try {
      // 填写领事馆预约
      const dateField = document.getElementById(
        "appointments_consulate_appointment_date"
      );
      const timeField = document.getElementById(
        "appointments_consulate_appointment_time"
      );
      const centerField = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );

      if (dateField) dateField.value = date;
      if (centerField) centerField.value = center;

      if (timeField) {
        timeField.innerHTML = `<option value='${time}'>${time}</option>`;
        timeField.value = time;
      }

      // 如果有ASC预约字段
      if (ascCenter && document.getElementById("asc-appointment-fields")) {
        await handleASCAppointment(date, time, center, ascCenter);
      }

      // 启用提交按钮
      const submitBtn = document.getElementById("appointments_submit");
      if (submitBtn) {
        submitBtn.removeAttribute("disabled");
        toast("表单已自动填写，请检查并提交", "success");
      }
    } catch (error) {
      console.error("填写表单时出错:", error);
      toast(`填写表单失败: ${error.message}`, "error");
    }
  }

  // 处理ASC预约
  async function handleASCAppointment(
    consularDate,
    consularTime,
    center,
    ascCenter
  ) {
    try {
      const ascDatesUrl = `${page}/days/${ascCenter}.json?consulate_id=${center}&consulate_date=${consularDate}&consulate_time=${consularTime}&appointments[expedite]=false`;

      const response = await fetch(ascDatesUrl, { headers });
      if (!response.ok) return;

      const $ascDates = await response.json();
      if (!$ascDates || $ascDates.length === 0) return;

      // 根据$ascReverse选择日期
      let selectedAscDate;
      if ($ascReverse) {
        // 选择最接近领事馆预约的日期
        selectedAscDate = $ascDates.sort(
          (a, b) =>
            Math.abs(new Date(a.date) - new Date(consularDate)) -
            Math.abs(new Date(b.date) - new Date(consularDate))
        )[0].date;
      } else {
        // 选择最早可用日期
        selectedAscDate = $ascDates.sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        )[0].date;
      }

      // 获取ASC时间
      const ascTimesUrl = `${page}/times/${ascCenter}.json?date=${selectedAscDate}&consulate_id=${center}&consulate_date=${consularDate}&consulate_time=${consularTime}&appointments[expedite]=false`;
      const timesResponse = await fetch(ascTimesUrl, { headers });

      if (timesResponse.ok) {
        const $ascTimes = await timesResponse.json();
        if ($ascTimes.available_times && $ascTimes.available_times.length > 0) {
          const selectedAscTime = $ascTimes.available_times[0];

          // 填写ASC字段
          const ascDateField = document.getElementById(
            "appointments_asc_appointment_date"
          );
          const ascTimeField = document.getElementById(
            "appointments_asc_appointment_time"
          );
          const ascCenterField = document.getElementById(
            "appointments_asc_appointment_facility_id"
          );

          if (ascDateField) ascDateField.value = selectedAscDate;
          if (ascCenterField) ascCenterField.value = ascCenter;
          if (ascTimeField) {
            ascTimeField.innerHTML = `<option value='${selectedAscTime}'>${selectedAscTime}</option>`;
            ascTimeField.value = selectedAscTime;
          }
        }
      }
    } catch (error) {
      console.error("处理ASC预约时出错:", error);
    }
  }

  // 获取当前预约时间和详情
  function getCurrentAppointmentInfo() {
    try {
      // 在仪表板页面查找预约信息
      if (isDashboard) {
        const appointmentElements = document.querySelectorAll(
          ".consular-appt, .ready_to_schedule"
        );

        for (const element of appointmentElements) {
          // 查找日期文本
          const dateText = element.textContent.match(
            /(\w+\s+\d{1,2},\s+\d{4})/
          );
          const timeText = element.textContent.match(/(\d{1,2}:\d{2})/);

          if (dateText) {
            const appointmentDate = new Date(dateText[1]);
            const formattedDate =
              appointmentDate.getFullYear() +
              "-" +
              String(appointmentDate.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(appointmentDate.getDate()).padStart(2, "0");

            const timeStr = timeText ? timeText[1] : "";

            return {
              date: formattedDate,
              time: timeStr,
              fullText: dateText[1] + (timeStr ? " " + timeStr : ""),
            };
          }
        }
      }

      // 在预约页面查找当前选中的日期时间
      if (isAppointment) {
        const dateField = document.getElementById(
          "appointments_consulate_appointment_date"
        );
        const timeField = document.getElementById(
          "appointments_consulate_appointment_time"
        );

        if (dateField && dateField.value) {
          return {
            date: dateField.value,
            time: timeField ? timeField.value : "",
            fullText:
              dateField.value +
              (timeField && timeField.value ? " " + timeField.value : ""),
          };
        }
      }

      return null;
    } catch (error) {
      console.error("获取预约信息失败:", error);
      return null;
    }
  }

  // 定期更新预约信息
  function updateAppointmentInfo() {
    const appointmentInfo = getCurrentAppointmentInfo();
    if (appointmentInfo) {
      $apptDate = appointmentInfo.date;
      chrome.storage.local.set({
        __ad: appointmentInfo.date,
        __at: appointmentInfo.time,
        __af: appointmentInfo.fullText,
      });

      toast(`当前预约: ${appointmentInfo.fullText}`, "info");
    }
  }

  // 启动监控
  function startMonitoring() {
    if ($checkInterval) return;

    $active = true;
    toast("开始监控预约...", "success");

    // 立即检查一次
    getNewDate(0, $apptCenter, $ascCenter);

    // 设置定期检查
    $checkInterval = setInterval(() => {
      if ($active) {
        getNewDate(0, $apptCenter, $ascCenter);
        updateAppointmentInfo(); // 添加预约信息更新
      }
    }, $timer);

    // 保存状态
    chrome.storage.local.set({
      __active: true,
      __timer: $timer,
    });
  }

  // 停止监控
  function stopMonitoring() {
    if ($checkInterval) {
      clearInterval($checkInterval);
      $checkInterval = null;
    }

    $active = false;
    toast("已停止监控", "info");

    chrome.storage.local.set({ __active: false });
  }

  // 初始化配置
  async function loadConfiguration() {
    try {
      const storage = await chrome.storage.local.get([
        "__un",
        "__pw",
        "__id",
        "__ad",
        "__at",
        "__af",
        "__il",
        "__al",
        "__ar",
        "__st",
        "__en",
        "__active",
        "__timer",
        "__it",
        "__vt",
      ]);

      $username = storage.__un;
      $password = storage.__pw;
      $appid = storage.__id;
      $apptDate = storage.__ad;
      $apptCenter = storage.__il;
      $ascCenter = storage.__al;
      $ascReverse = storage.__ar || false;
      $start = storage.__st;
      $end = storage.__en;
      $active = storage.__active || false;
      $timer = storage.__timer || 60000;
      $visaType = storage.__vt || currentVisaType || "niv";

      console.log("配置已加载:", {
        username: $username ? "已设置" : "未设置",
        apptCenter: $apptCenter,
        apptDate: $apptDate,
        visaType: $visaType,
        active: $active,
      });

      // 同步签证类型到存储
      if (currentVisaType && currentVisaType !== $visaType) {
        $visaType = currentVisaType;
        await chrome.storage.local.set({ __vt: $visaType });
      }
    } catch (error) {
      console.error("加载配置失败:", error);
    }
  }

  // 页面初始化逻辑
  async function init() {
    await loadConfiguration();

    // 更新预约信息
    updateAppointmentInfo();

    // 处理不同页面类型
    if (isLoggedOut) {
      // 在首页，点击登录链接
      const signInLink = document.querySelector(
        ".homeSelectionsContainer a[href*='/sign_in']"
      );
      if (signInLink) {
        await delay(1000);
        signInLink.click();
      }
      return;
    }

    if (isSignIn) {
      // 处理登录页面
      await handleSignInPage();
      return;
    }

    if (isDashboard) {
      // 处理仪表板页面，选择预约
      await handleDashboardPage();
      return;
    }

    if (isAppointment) {
      // 处理预约页面，这是主要的监控页面
      await handleAppointmentPage();
      return;
    }

    if (isConfirmation) {
      // 预约确认页面，等待后跳转
      await delay(10000);
      location.href = page.replace(/schedule.*/, "");
      return;
    }
  }

  // 处理登录页面
  async function handleSignInPage() {
    if (!$username || !$password) {
      toast("需要设置用户名和密码", "warning");
      return;
    }

    await delay(1000);

    const emailField = document.getElementById("user_email");
    const passwordField = document.getElementById("user_password");
    const policyCheckbox = document.querySelector('[for="policy_confirmed"]');
    const submitBtn = document.querySelector(
      "#sign_in_form input[type=submit]"
    );

    if (emailField && passwordField && submitBtn) {
      emailField.value = $username;
      passwordField.value = $password;

      if (policyCheckbox) {
        policyCheckbox.click();
      }

      await delay(500);
      submitBtn.click();

      toast("正在登录...", "info");
    }
  }

  // 处理仪表板页面
  async function handleDashboardPage() {
    await delay(2000);

    // 查找预约链接
    const appointmentLinks = document.querySelectorAll(
      "p.consular-appt [href], .ready_to_schedule p.delivery [href]"
    );

    if (appointmentLinks.length === 0) {
      toast("未找到预约链接", "error");
      return;
    }

    let selectedLink;
    if (appointmentLinks.length === 1) {
      selectedLink = appointmentLinks[0];
      $appid = selectedLink.href.replace(/\D/g, "");
    } else if ($appid) {
      // 使用已保存的预约ID
      selectedLink = Array.from(appointmentLinks).find((link) =>
        link.href.includes($appid)
      );
    }

    if (selectedLink) {
      await chrome.storage.local.set({ __id: $appid });

      // 获取预约日期
      const appointmentElement =
        selectedLink.closest("tr") || selectedLink.closest(".panel");
      if (appointmentElement) {
        const dateMatch = appointmentElement.textContent.match(
          /\d{1,2} \w{1,}, \d{4}/
        );
        if (dateMatch) {
          const apptDate = new Date(dateMatch[0]);
          $apptDate =
            apptDate.getFullYear() +
            "-" +
            String(apptDate.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(apptDate.getDate()).padStart(2, "0");

          await chrome.storage.local.set({ __ad: $apptDate });
        }
      }

      // 跳转到预约页面
      const appointmentUrl = selectedLink
        .getAttribute("href")
        .replace("/addresses/delivery", "/appointment");
      location.href = appointmentUrl;
    }
  }

  // 处理预约页面
  async function handleAppointmentPage() {
    await delay(1000);

    // 检查是否需要提交表单
    const applicantForm = document.querySelector(`form[action*="${page}"]`);
    if (applicantForm && applicantForm.method.toLowerCase() === "get") {
      applicantForm.submit();
      return;
    }

    // 确保有预约日期时间选择器
    if (!document.getElementById("consulate_date_time")) {
      toast("页面加载中，请稍候...", "info");
      setTimeout(() => handleAppointmentPage(), 2000);
      return;
    }

    // 设置预约中心
    if (!$apptCenter) {
      const centerSelect = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );
      if (centerSelect) {
        $apptCenter = centerSelect.value;
        await chrome.storage.local.set({ __il: $apptCenter });
      }
    }

    // 设置ASC中心
    if (!$ascCenter && document.getElementById("asc-appointment-fields")) {
      const ascSelect = document.getElementById(
        "appointments_asc_appointment_facility_id"
      );
      if (ascSelect) {
        $ascCenter = ascSelect.value;
        await chrome.storage.local.set({ __al: $ascCenter });
      }
    }

    // 设置日期范围
    if (!$end || !$start) {
      if (!$end) {
        $end = $apptDate || new Date().toISOString().split("T")[0];
        await chrome.storage.local.set({ __en: $end });
      }
      if (!$start) {
        $start = new Date().toISOString().split("T")[0];
        await chrome.storage.local.set({ __st: $start });
      }
    }

    toast(`预约页面已就绪。当前预约日期: ${$apptDate || "未设置"}`, "success");

    // 如果已激活，开始监控
    if ($active) {
      startMonitoring();
    }
  }

  // 消息监听
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.ping) {
      return sendResponse({ pong: true });
    }

    if (request.action === "start_monitoring") {
      $apptCenter = request.center;
      $timer = request.interval || 60000;
      startMonitoring();
      return sendResponse({ success: true });
    }

    if (request.action === "stop_monitoring") {
      stopMonitoring();
      return sendResponse({ success: true });
    }

    if (request.action === "get_status") {
      // 实时更新预约信息
      updateAppointmentInfo();

      return sendResponse({
        active: $active,
        apptCenter: $apptCenter,
        apptDate: $apptDate,
        scheduleId: scheduleId,
        visaType: $visaType,
        currentPage: {
          isSignIn,
          isDashboard,
          isAppointment,
          isConfirmation,
        },
      });
    }

    if (request.action === "set_config") {
      if (request.username) {
        $username = request.username;
        chrome.storage.local.set({ __un: $username });
      }
      if (request.password) {
        $password = request.password;
        chrome.storage.local.set({ __pw: $password });
      }
      if (request.center) {
        $apptCenter = request.center;
        chrome.storage.local.set({ __il: $apptCenter });
      }
      if (request.visaType) {
        $visaType = request.visaType;
        chrome.storage.local.set({ __vt: $visaType });
      }
      return sendResponse({ success: true });
    }

    sendResponse(true);
  });

  // 启动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(location.pathname);
