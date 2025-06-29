(async function (page) {
  // 全局国际化对象
  let i18n = null;
  let isI18nReady = false;

  // 初始化国际化
  async function initI18n() {
    try {
      // 动态加载i18n.js
      if (typeof window.i18n === "undefined") {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("src/js/i18n.js");
        document.head.appendChild(script);

        // 等待脚本加载
        await new Promise((resolve) => {
          script.onload = resolve;
        });
      }

      i18n = new I18n();
      await i18n.init();
      isI18nReady = true;
      console.log("Content script 国际化初始化完成");
    } catch (error) {
      console.error("Content script 国际化初始化失败:", error);
      isI18nReady = false;
    }
  }

  // 带国际化的toast函数
  const toast = (messageKey, type = "info", params = {}) => {
    let message;
    if (isI18nReady && i18n) {
      message = i18n.t(messageKey, params);
    } else {
      message = messageKey; // 回退到原始文本
    }
    console.log(`[VISA-CHECKER ${type.toUpperCase()}]:`, message);
    // 可以添加更好的通知显示
  };

  // 带国际化的通知函数
  const throwNotification = async (titleKey, messageKey, params = {}) => {
    let title, message;
    if (isI18nReady && i18n) {
      title = i18n.t(titleKey, params);
      message = i18n.t(messageKey, params);
    } else {
      title = titleKey;
      message = messageKey;
    }

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

  // 核心配置变量
  let $username = null,
    $password = null,
    $appid = null,
    $apptCenter = null,
    $apptCenters = [], // 多个预约中心
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
    $visaType = "niv", // 默认非移民签证
    $autoSubmit = false; // 自动提交开关

  // 工具函数
  const delay = async ($delay = 2000) =>
    await new Promise((r) => setTimeout(r, $delay));

  const headers = { "x-requested-with": "XMLHttpRequest" };

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
  const isAddressPage = !!page.match(
    /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/schedule\/\d{1,}\/addresses/
  );

  // 从URL判断签证类型
  const currentVisaType = page.match(/\/(niv|iv)\//)?.[1] || "niv";

  // 获取scheduleId - 改进版本
  const getScheduleId = () => {
    // 首先尝试从URL获取
    const urlMatch = window.location.pathname.match(/schedule\/(\d+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    // 如果在仪表板页面，尝试从预约链接获取
    if (isDashboard) {
      const appointmentLinks = document.querySelectorAll(
        "p.consular-appt [href], .ready_to_schedule p.delivery [href]"
      );
      if (appointmentLinks.length > 0) {
        const firstLink = appointmentLinks[0];
        const linkMatch = firstLink.href.match(/schedule\/(\d+)/);
        if (linkMatch) {
          return linkMatch[1];
        }
      }
    }

    // 最后尝试从已存储的appid获取
    return $appid;
  };

  const scheduleId = getScheduleId();

  if (scheduleId) {
    window.scheduleIdFromPage = scheduleId;
    console.log("Schedule ID (from URL):", scheduleId);
  }

  // 随机延迟函数 - 模拟人类操作
  const randomDelay = async (baseMs = 2000, varianceMs = 1000) => {
    const variance = Math.random() * varianceMs;
    const totalDelay = baseMs + variance;
    console.log(`随机延迟: ${Math.round(totalDelay)}ms`);
    await new Promise((r) => setTimeout(r, totalDelay));
  };

  // 生成随机检查间隔
  const getRandomInterval = (baseInterval) => {
    // 基础间隔 + 随机波动 (±20%)
    const variance = baseInterval * 0.2;
    const randomVariance = (Math.random() - 0.5) * 2 * variance;
    const finalInterval = baseInterval + randomVariance;

    // 确保最小间隔不少于30秒
    return Math.max(finalInterval, 30000);
  };

  // 核心预约检查函数 - 支持多中心
  async function checkMultipleCenters($centers, $ascCenter) {
    if (!$centers || $centers.length === 0) {
      toast("toast_messages.center_not_set", "error");
      return;
    }

    toast("toast_messages.checking_centers", "info", {
      count: $centers.length,
    });

    for (let i = 0; i < $centers.length; i++) {
      const center = $centers[i];

      try {
        toast("toast_messages.checking_center", "info", { center: center });
        await getNewDate(0, center, $ascCenter);

        // 在检查不同中心之间添加随机延迟 (2-5秒)
        if (i < $centers.length - 1) {
          await randomDelay(2000, 3000);
        }
      } catch (error) {
        console.error(`检查中心 ${center} 时出错:`, error);
        toast("toast_messages.checking_center_failed", "error", {
          center: center,
          error: error.message,
        });
      }
    }

    toast("toast_messages.all_centers_complete", "info");
  }

  // 核心预约检查函数
  async function getNewDate($delay, $center, $ascCenter) {
    try {
      if (!$center) {
        toast("toast_messages.center_not_set", "error");
        return;
      }

      const appointmentUrl = `${page}/days/${$center}.json?appointments[expedite]=false`;

      toast("toast_messages.checking_center", "info", { center: $center });

      const response = await fetch(appointmentUrl, {
        headers,
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status >= 500) {
          toast("toast_messages.server_error", "warning", {
            status: response.status,
          });
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const $dates = await response.json();

      if (!Array.isArray($dates) || $dates.length === 0) {
        toast("toast_messages.no_available_dates");
        return;
      }

      // 过滤和排序日期
      let availableDates = $dates
        .map((d) => d.date)
        .filter((d) => dateValidityCheck($start, $end, d))
        .sort((a, b) => new Date(a) - new Date(b));

      if (availableDates.length === 0) {
        toast("toast_messages.no_dates_in_range");
        return;
      }

      let latestDate = availableDates[0];

      // 检查是否比当前预约更早
      if ($apptDate && new Date(latestDate) >= new Date($apptDate)) {
        toast("toast_messages.found_date_not_earlier", "info", {
          date: latestDate,
          currentDate: $apptDate,
        });
        return;
      }

      toast("toast_messages.found_earlier_date", "success", {
        date: latestDate,
      });

      // 获取该日期的可用时间
      const timesUrl = `${page}/times/${$center}.json?date=${latestDate}&appointments[expedite]=false`;
      const timesResponse = await fetch(timesUrl, { headers });

      if (!timesResponse.ok) {
        throw new Error(`获取时间失败: ${timesResponse.status}`);
      }

      const $times = await timesResponse.json();

      if (!$times.available_times || $times.available_times.length === 0) {
        toast("toast_messages.no_available_times", "warning", {
          date: latestDate,
        });
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
        "notifications.found_earlier_appointment",
        "notifications.found_earlier_appointment"
      );
    } catch (error) {
      console.error("检查预约时出错:", error);
      toast("toast_messages.auth_failed", "error");

      // 如果是认证错误，停止检查
      if (error.message.includes("401") || error.message.includes("403")) {
        stopMonitoring();
        toast("toast_messages.auth_failed", "error");
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

        if ($autoSubmit) {
          // 自动提交模式
          toast("toast_messages.form_filled_auto_submit", "success");

          // 等待随机延迟后自动提交
          await randomDelay(3000, 2000); // 3-5秒随机延迟

          // 最后一次验证表单
          if (validateForm()) {
            toast("toast_messages.auto_submitting", "info");
            submitBtn.click();

            // 停止监控，避免重复提交
            stopMonitoring();

            await throwNotification(
              "notifications.auto_submitted",
              "notifications.auto_submitted"
            );
          } else {
            toast("toast_messages.form_validation_failed", "warning");
          }
        } else {
          // 手动提交模式
          toast("toast_messages.form_filled", "success");
        }
      }
    } catch (error) {
      console.error("填写表单时出错:", error);
      toast("toast_messages.form_validation_failed", "error");
    }
  }

  // 验证表单是否填写完整
  function validateForm() {
    try {
      const dateField = document.getElementById(
        "appointments_consulate_appointment_date"
      );
      const timeField = document.getElementById(
        "appointments_consulate_appointment_time"
      );
      const centerField = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );

      // 检查必填字段
      if (!dateField || !dateField.value) {
        console.log("日期字段未填写");
        return false;
      }

      if (!timeField || !timeField.value) {
        console.log("时间字段未填写");
        return false;
      }

      if (!centerField || !centerField.value) {
        console.log("预约中心字段未填写");
        return false;
      }

      // 如果有ASC字段，也需要验证
      const ascDateField = document.getElementById(
        "appointments_asc_appointment_date"
      );
      if (ascDateField) {
        const ascTimeField = document.getElementById(
          "appointments_asc_appointment_time"
        );
        const ascCenterField = document.getElementById(
          "appointments_asc_appointment_facility_id"
        );

        if (
          !ascDateField.value ||
          !ascTimeField?.value ||
          !ascCenterField?.value
        ) {
          console.log("ASC预约字段未完整填写");
          return false;
        }
      }

      console.log("表单验证通过");
      return true;
    } catch (error) {
      console.error("表单验证失败:", error);
      return false;
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
          // 更精确的日期时间匹配，支持 "29 April, 2026, 10:15" 格式
          const fullText = element.textContent.trim();
          console.log("检查预约元素文本:", fullText);

          // 匹配 "Consular Appointment: 29 April, 2026, 10:15 Vancouver local time"
          const appointmentMatch = fullText.match(
            /Consular Appointment:\s*(.+?)\s+(?:Vancouver|local time)/i
          );
          if (appointmentMatch) {
            const appointmentInfo = appointmentMatch[1].trim();

            // 解析日期时间 "29 April, 2026, 10:15"
            const dateTimeMatch = appointmentInfo.match(
              /(\d{1,2})\s+(\w+),\s+(\d{4}),\s+(\d{1,2}:\d{2})/
            );
            if (dateTimeMatch) {
              const [, day, monthName, year, time] = dateTimeMatch;

              // 月份名称转数字
              const monthNames = [
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
              ];
              const monthIndex = monthNames.findIndex(
                (m) => m.toLowerCase() === monthName.toLowerCase()
              );

              if (monthIndex !== -1) {
                const formattedDate = `${year}-${String(
                  monthIndex + 1
                ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                console.log("解析到预约信息:", {
                  date: formattedDate,
                  time: time,
                  fullText: appointmentInfo,
                });

                return {
                  date: formattedDate,
                  time: time,
                  fullText: appointmentInfo,
                };
              }
            }
          }

          // 备用匹配方式 - 简单的日期时间匹配
          const dateText = element.textContent.match(
            /(\w+\s+\d{1,2},\s+\d{4})/
          );
          const timeText = element.textContent.match(/(\d{1,2}:\d{2})/);

          if (dateText) {
            const appointmentDate = new Date(dateText[1]);
            if (!isNaN(appointmentDate.getTime())) {
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

      console.log(`当前预约信息: ${JSON.stringify(appointmentInfo)}`);
      toast(`当前预约: ${appointmentInfo.fullText}`, "info");
    }
  }

  // 启动监控
  function startMonitoring() {
    if ($checkInterval) return;

    $active = true;
    toast("notifications.monitoring_started", "success");

    // 立即检查一次
    if ($apptCenters.length > 0) {
      checkMultipleCenters($apptCenters, $ascCenter);
    } else if ($apptCenter) {
      // 兼容单中心模式
      getNewDate(0, $apptCenter, $ascCenter);
    }

    // 设置定期检查
    $checkInterval = setInterval(() => {
      if ($active) {
        // 生成随机间隔
        const randomInterval = getRandomInterval($timer);
        console.log(
          `下次检查将在 ${Math.round(randomInterval / 1000)} 秒后进行`
        );

        setTimeout(() => {
          if ($active) {
            if ($apptCenters.length > 0) {
              checkMultipleCenters($apptCenters, $ascCenter);
            } else if ($apptCenter) {
              getNewDate(0, $apptCenter, $ascCenter);
            }
            updateAppointmentInfo(); // 添加预约信息更新
          }
        }, randomInterval - $timer);
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
    toast("notifications.monitoring_stopped", "info");

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
        "__as", // 自动提交配置
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
      $autoSubmit = storage.__as || false;

      // 处理多中心配置
      if (
        $apptCenter &&
        typeof $apptCenter === "string" &&
        $apptCenter.includes(",")
      ) {
        // 如果存储的是逗号分隔的字符串，转换为数组
        $apptCenters = $apptCenter.split(",").map((center) => center.trim());
        console.log("检测到多中心配置:", $apptCenters);
      } else if ($apptCenter) {
        // 单中心配置
        $apptCenters = [$apptCenter];
      }

      console.log("配置已加载:", {
        username: $username ? "已设置" : "未设置",
        apptCenter: $apptCenter,
        apptCenters: $apptCenters,
        apptDate: $apptDate,
        visaType: $visaType,
        active: $active,
        autoSubmit: $autoSubmit,
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

    console.log("页面初始化 - 当前页面类型:", {
      isLoggedOut,
      isSignIn,
      isDashboard,
      isAppointment,
      isAddressPage,
      isConfirmation,
      currentPath: page,
    });

    // 更新预约信息
    updateAppointmentInfo();

    // 处理不同页面类型
    if (isLoggedOut) {
      // 在首页，点击登录链接
      toast("检测到首页，寻找登录链接...", "info");
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
      toast("检测到登录页面，开始自动登录...", "info");
      await handleSignInPage();
      return;
    }

    if (isDashboard) {
      // 处理仪表板页面，选择预约
      toast("检测到仪表板页面，获取预约信息...", "info");
      await handleDashboardPage();
      return;
    }

    if (isAppointment) {
      // 处理预约页面，这是主要的监控页面
      toast("检测到预约页面，准备监控...", "info");
      await handleAppointmentPage();
      return;
    }

    if (isAddressPage) {
      // 处理地址页面，直接跳转到预约页面
      toast("检测到地址页面，跳转到预约页面...", "info");
      await handleAddressPage();
      return;
    }

    if (isConfirmation) {
      // 预约确认页面，等待后跳转
      toast("检测到确认页面，等待后返回仪表板...", "info");
      await delay(10000);
      location.href = page.replace(/schedule.*/, "");
      return;
    }

    toast("未识别的页面类型，等待手动操作...", "warning");
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

    // 首先获取当前预约信息
    updateAppointmentInfo();

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
    } else if ($appid) {
      // 使用已保存的预约ID
      selectedLink = Array.from(appointmentLinks).find((link) =>
        link.href.includes($appid)
      );
    } else {
      // 选择第一个预约链接
      selectedLink = appointmentLinks[0];
    }

    if (selectedLink) {
      // 从链接中提取scheduleId
      const linkMatch = selectedLink.href.match(/schedule\/(\d+)/);
      if (linkMatch) {
        $appid = linkMatch[1];
        window.scheduleIdFromPage = $appid;
        console.log("从仪表板链接获取到 Schedule ID:", $appid);
      } else {
        // 备用方法：提取所有数字
        $appid = selectedLink.href.replace(/\D/g, "");
      }

      await chrome.storage.local.set({ __id: $appid });

      // 获取预约日期信息（从当前页面解析）
      const appointmentInfo = getCurrentAppointmentInfo();
      if (appointmentInfo) {
        $apptDate = appointmentInfo.date;
        await chrome.storage.local.set({
          __ad: appointmentInfo.date,
          __at: appointmentInfo.time,
          __af: appointmentInfo.fullText,
        });

        toast(`已获取当前预约信息: ${appointmentInfo.fullText}`, "success");
      }

      // 直接跳转到预约调度页面，而不是地址页面
      let appointmentUrl = selectedLink.getAttribute("href");

      // 如果链接指向地址页面，改为指向预约页面
      if (appointmentUrl.includes("/addresses/")) {
        appointmentUrl = appointmentUrl
          .replace("/addresses/delivery", "/appointment")
          .replace("/addresses/consulate", "/appointment");
      }

      // 确保链接指向appointment页面
      if (!appointmentUrl.includes("/appointment")) {
        appointmentUrl = appointmentUrl.replace(/\/[^\/]*$/, "/appointment");
      }

      toast(`正在跳转到预约页面: ${appointmentUrl}`, "info");
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

    // 获取预约中心选项
    const centers = getAppointmentCenters();
    if (centers && centers.length > 0) {
      toast(`已获取 ${centers.length} 个预约中心选项`, "success");
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

  // 处理地址页面
  async function handleAddressPage() {
    toast("检测到地址页面，正在跳转到预约页面...", "info");
    await delay(1000);

    // 从当前URL构建预约页面URL
    const appointmentUrl = location.pathname.replace(
      /\/addresses\/[^\/]*$/,
      "/appointment"
    );
    location.href = appointmentUrl;
  }

  // 获取预约中心选项
  function getAppointmentCenters() {
    try {
      const centerSelect = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );
      if (!centerSelect) {
        console.log("未找到预约中心选择器");
        return null;
      }

      const centers = [];
      const options = centerSelect.querySelectorAll("option");

      options.forEach((option) => {
        const value = option.value;
        const text = option.textContent.trim();
        const isSelected = option.selected;

        if (value && text) {
          centers.push({
            value: value,
            text: text,
            selected: isSelected,
          });
        }
      });

      console.log("获取到预约中心选项:", centers);

      // 保存到storage供popup使用
      chrome.storage.local.set({ __centers: centers });

      return centers;
    } catch (error) {
      console.error("获取预约中心选项失败:", error);
      return null;
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
      if (request.centers && Array.isArray(request.centers)) {
        // 多中心模式
        $apptCenters = request.centers;
        $apptCenter = request.centers[0]; // 保持兼容性
      } else if (request.center) {
        // 单中心模式（兼容）
        $apptCenter = request.center;
        $apptCenters = [request.center];
      }

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
        apptCenters: $apptCenters,
        apptDate: $apptDate,
        scheduleId: scheduleId,
        visaType: $visaType,
        autoSubmit: $autoSubmit,
        currentPage: {
          isSignIn,
          isDashboard,
          isAppointment,
          isConfirmation,
          isAddressPage,
          isLoggedOut,
        },
      });
    }

    if (request.action === "get_centers") {
      const centers = getAppointmentCenters();
      return sendResponse({ centers: centers });
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
      if (request.autoSubmit !== undefined) {
        $autoSubmit = request.autoSubmit;
        chrome.storage.local.set({ __as: $autoSubmit });
      }
      return sendResponse({ success: true });
    }

    sendResponse(true);
  });

  // 启动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => {
      await initI18n();
      init();
    });
  } else {
    (async () => {
      await initI18n();
      init();
    })();
  }

  // 测试预约信息解析（开发阶段使用）
  function testAppointmentParsing() {
    // 模拟HTML结构进行测试
    const testHTML = `
      <p class="consular-appt">
        <strong>Consular Appointment</strong>
        <span>:</span>
        " 29 April, 2026, 10:15 Vancouver local time at Vancouver — "
      </p>
    `;

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = testHTML;
    document.body.appendChild(tempDiv);

    const result = getCurrentAppointmentInfo();
    console.log("测试解析结果:", result);

    document.body.removeChild(tempDiv);
    return result;
  }

  // 在开发模式下可以调用 testAppointmentParsing() 进行测试
})(location.pathname);
