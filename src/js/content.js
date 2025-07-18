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
      logI18n("log_messages.i18n_init_complete", "info");
    } catch (error) {
      console.error("Content script 国际化初始化失败:", error);
      logI18n("log_messages.i18n_init_failed", "error");
      isI18nReady = false;
    }
  }

  // 统一的国际化日志函数
  const logI18n = (messageKey, type = "info", params = {}) => {
    let message;
    if (isI18nReady && i18n) {
      try {
        message = i18n.t(messageKey, params);
      } catch (error) {
        message = messageKey; // 如果翻译失败，回退到原始键
      }
    } else {
      message = messageKey; // 回退到原始文本
    }

    const prefix = `[VISA-CHECKER ${type.toUpperCase()}]`;
    console.log(prefix, message);

    return message; // 返回消息供其他用途使用
  };

  // 带国际化的toast函数 - 同时输出到控制台
  const toast = (messageKey, type = "info", params = {}) => {
    const message = logI18n(messageKey, type, params);
    // 可以添加更好的通知显示
    return message;
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
      logI18n("log_messages.send_notification_failed", "error", {
        error: error.message,
      });
    }

    logI18n("log_messages.notification_sent", "info", { title, message });
  };

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
    $visaType = "niv", // 默认非移民签证
    $autoSubmit = false, // 自动提交开关
    $isSoftBanned = false, // 软封禁状态
    $softBanCount = 0, // 连续软封禁计数
    $originalTimer = 60000, // 原始检查间隔（用于恢复）
    $softBanMultiplier = 1; // 软封禁间隔倍数

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
    logI18n("log_messages.schedule_id_from_url", "info", { scheduleId });
  }

  // 随机延迟函数 - 模拟人类操作
  const randomDelay = async (baseMs = 2000, varianceMs = 1000) => {
    const variance = Math.random() * varianceMs;
    const totalDelay = baseMs + variance;
    logI18n("log_messages.random_delay", "info", {
      delay: Math.round(totalDelay),
    });
    await new Promise((r) => setTimeout(r, totalDelay));
  };

  // 生成随机检查间隔 - 支持时区感知的频率控制和软封禁处理
  const getRandomInterval = (baseInterval) => {
    // 如果处于软封禁状态，使用延长的间隔
    if ($isSoftBanned) {
      const softBanInterval = getSoftBanInterval(baseInterval);
      logI18n("log_messages.soft_ban_interval_applied", "warning", {
        baseInterval: Math.round(baseInterval / 1000),
        softBanInterval: Math.round(softBanInterval / 1000),
        banCount: $softBanCount,
        multiplier: $softBanMultiplier,
      });
      return softBanInterval;
    }

    // 基础间隔 + 随机波动 (±20%)
    const variance = baseInterval * 0.2;
    const randomVariance = (Math.random() - 0.5) * 2 * variance;
    let finalInterval = baseInterval + randomVariance;

    // 应用时区感知的频率控制
    finalInterval = applyTimezoneBasedRateLimit(finalInterval);

    // 确保最小间隔不少于30秒
    return Math.max(finalInterval, 30000);
  };

  // 软封禁间隔计算
  const getSoftBanInterval = (baseInterval) => {
    // 软封禁时的间隔策略：
    // 第1次软封禁：30分钟
    // 第2次软封禁：1小时
    // 第3次及以上：2小时 + 每次额外增加30分钟
    let hourlyMultiplier;

    if ($softBanCount === 1) {
      hourlyMultiplier = 0.5; // 30分钟
    } else if ($softBanCount === 2) {
      hourlyMultiplier = 1; // 1小时
    } else {
      hourlyMultiplier = 2 + ($softBanCount - 2) * 0.5; // 2小时 + 额外时间
    }

    const softBanInterval = 60 * 60 * 1000 * hourlyMultiplier; // 转换为毫秒

    // 添加 ±10% 的随机变化
    const variance = softBanInterval * 0.1;
    const randomVariance = (Math.random() - 0.5) * 2 * variance;

    return Math.max(softBanInterval + randomVariance, 31 * 60 * 1000); // 最少30分钟
  };

  // 检测软封禁状态
  const detectSoftBan = (availableTimes) => {
    const wasPreviouslySoftBanned = $isSoftBanned;

    // 如果时间数组为空或null，认为是软封禁
    if (!availableTimes || availableTimes.length === 0) {
      if (!$isSoftBanned) {
        // 首次检测到软封禁
        $isSoftBanned = true;
        $softBanCount++;
        $softBanMultiplier = Math.pow(2, $softBanCount - 1); // 指数增长

        logI18n("log_messages.soft_ban_detected", "warning", {
          banCount: $softBanCount,
          multiplier: $softBanMultiplier,
        });

        toast("toast_messages.soft_ban_detected", "warning", {
          banCount: $softBanCount,
        });
      }
      return true;
    } else {
      // 有可用时间，检查是否从软封禁状态恢复
      if ($isSoftBanned) {
        $isSoftBanned = false;

        logI18n("log_messages.soft_ban_recovered", "success", {
          previousBanCount: $softBanCount,
        });

        toast("toast_messages.soft_ban_recovered", "success");

        // 重置软封禁计数（可选：也可以保持计数以防短期内再次封禁）
        // $softBanCount = 0;
      }
      return false;
    }
  };

  // 重置软封禁状态（当长时间正常运行时调用）
  const resetSoftBanStatus = () => {
    if ($softBanCount > 0) {
      const resetHours = 12; // 12小时后重置软封禁计数
      setTimeout(() => {
        if (!$isSoftBanned) {
          // 只有在当前不是软封禁状态时才重置
          $softBanCount = Math.max(0, $softBanCount - 1);
          $softBanMultiplier = Math.max(1, $softBanMultiplier / 2);

          logI18n("log_messages.soft_ban_count_reset", "info", {
            newBanCount: $softBanCount,
            newMultiplier: $softBanMultiplier,
          });
        }
      }, resetHours * 60 * 60 * 1000);
    }
  };

  // 时区感知的频率限制 - 美签网站在美国东部时间工作时间内限制更严格
  const applyTimezoneBasedRateLimit = (baseInterval) => {
    try {
      // 获取美国东部时间（ET - Eastern Time）
      // 美国东部时间会根据夏令时自动调整（EST/EDT）
      const easternTime = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
      });
      const etDate = new Date(easternTime);
      const etHour = etDate.getHours();

      // 美签网站的业务时间通常是美东时间 9:00 AM - 5:00 PM (工作日)
      // 在业务时间内使用更保守的频率
      const isBusinessHours = etHour >= 9 && etHour < 17;
      const isWeekday = etDate.getDay() >= 1 && etDate.getDay() <= 5; // 周一到周五

      let multiplier = 1.0;

      if (isWeekday && isBusinessHours) {
        // 工作日的业务时间：增加 50-100% 的延迟
        multiplier = 1.5 + Math.random() * 0.5; // 1.5x - 2.0x
        logI18n("log_messages.business_hours_rate_limit", "info", {
          etHour: etHour,
          multiplier: multiplier.toFixed(2),
        });
      } else if (isWeekday) {
        // 工作日的非业务时间：增加 20-50% 的延迟
        multiplier = 1.2 + Math.random() * 0.3; // 1.2x - 1.5x
        logI18n("log_messages.after_hours_rate_limit", "info", {
          etHour: etHour,
          multiplier: multiplier.toFixed(2),
        });
      } else {
        // 周末：使用基本间隔或稍微减少
        multiplier = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
        logI18n("log_messages.weekend_rate_limit", "info", {
          etHour: etHour,
          multiplier: multiplier.toFixed(2),
        });
      }

      const adjustedInterval = baseInterval * multiplier;

      logI18n("log_messages.timezone_adjusted_interval", "info", {
        baseInterval: Math.round(baseInterval / 1000),
        adjustedInterval: Math.round(adjustedInterval / 1000),
        easternTime: easternTime,
        etHour: etHour,
        isBusinessHours: isBusinessHours,
        isWeekday: isWeekday,
      });

      return adjustedInterval;
    } catch (error) {
      logI18n("log_messages.timezone_calculation_failed", "warning", {
        error: error.message,
      });
      // 如果时区计算失败，返回原始间隔
      return baseInterval;
    }
  };

  // 核心预约检查函数 - 支持多中心
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

      // 检测软封禁状态
      const isSoftBanned = detectSoftBan($times.available_times);

      if (isSoftBanned) {
        // 如果检测到软封禁，记录但不停止监控，只是延长间隔
        toast("toast_messages.soft_ban_no_times", "warning", {
          date: latestDate,
          center: $center,
        });
        return;
      }

      if (!$times.available_times || $times.available_times.length === 0) {
        toast("toast_messages.no_available_times", "warning", {
          date: latestDate,
        });
        return;
      }

      // 如果有可用时间且之前处于软封禁状态，触发恢复逻辑
      if ($times.available_times.length > 0) {
        detectSoftBan($times.available_times); // 这会处理恢复逻辑
        resetSoftBanStatus(); // 开始重置计时器
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
      logI18n("toast_messages.auth_failed", "error");
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
          await randomDelay(500, 200); // 0.3-0.7秒随机延迟

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
      logI18n("toast_messages.form_validation_failed", "error");
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
        const fieldName =
          isI18nReady && i18n ? i18n.t("field_names.date") : "date";
        logI18n("log_messages.form_validation_field_missing", "warning", {
          field: fieldName,
        });
        return false;
      }

      if (!timeField || !timeField.value) {
        const fieldName =
          isI18nReady && i18n ? i18n.t("field_names.time") : "time";
        logI18n("log_messages.form_validation_field_missing", "warning", {
          field: fieldName,
        });
        return false;
      }

      if (!centerField || !centerField.value) {
        const fieldName =
          isI18nReady && i18n ? i18n.t("field_names.center") : "center";
        logI18n("log_messages.form_validation_field_missing", "warning", {
          field: fieldName,
        });
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
          const fieldName =
            isI18nReady && i18n
              ? i18n.t("field_names.asc_appointment")
              : "asc_appointment";
          logI18n("log_messages.form_validation_field_missing", "warning", {
            field: fieldName,
          });
          return false;
        }
      }

      logI18n("log_messages.form_validation_passed", "info");
      return true;
    } catch (error) {
      logI18n("toast_messages.form_validation_failed", "error");
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
      logI18n("log_messages.get_appointment_info_failed", "error", {
        error: error.message,
      });
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
          logI18n("log_messages.checking_appointment_element", "debug", {
            fullText,
          });

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

                logI18n("log_messages.parsed_appointment_info", "info", {
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
      logI18n("log_messages.get_appointment_info_failed", "error", {
        error: error.message,
      });
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

      logI18n("log_messages.current_appointment_info", "info", {
        appointmentInfo: JSON.stringify(appointmentInfo),
      });
      toast("toast_messages.current_appointment_info", "info", {
        appointment: appointmentInfo.fullText,
      });
    }
  }

  // 启动监控
  // 启动监控
  function startMonitoring() {
    if ($checkInterval) return;

    // 只有在reschedule页面才能启动真正的监控
    if (!isAppointment) {
      logI18n("log_messages.monitoring_can_only_start_on_reschedule", "error");
      toast("alerts.open_appointment_page", "error");
      return;
    }

    // 确保已选择预约中心
    if (!hasSelectedCenter() && !$apptCenter) {
      logI18n("log_messages.must_select_center_to_start", "error");
      toast("alerts.select_center", "error");
      return;
    }

    $active = true;
    $originalTimer = $timer; // 保存原始间隔
    toast("notifications.monitoring_started", "success");

    // 创建监控上下文，用于页面导航后的状态恢复
    const monitoringContext = {
      apptCenter: $apptCenter,
      scheduleId: getScheduleId(),
      visaType: $visaType,
      timestamp: Date.now(),
      startedFromReschedule: true,
      originalTimer: $originalTimer,
      softBanState: {
        isSoftBanned: $isSoftBanned,
        softBanCount: $softBanCount,
        softBanMultiplier: $softBanMultiplier,
      },
    };

    logI18n("log_messages.creating_monitoring_context", "info", {
      context: JSON.stringify(monitoringContext),
    });

    // 启动页面监控，确保不离开reschedule页面
    startPageMonitoring();

    // 立即检查一次（只有在reschedule页面且选择了中心才进行fetch）
    if ($apptCenter) {
      getNewDate(0, $apptCenter, $ascCenter);
    }

    // 设置定期检查
    $checkInterval = setInterval(() => {
      if ($active) {
        // 再次确认仍在reschedule页面
        if (!isAppointment) {
          logI18n("log_messages.left_reschedule_page", "warning", {
            currentPath: "not appointment",
          });
          stopMonitoring();
          return;
        }

        // 生成随机间隔（现在会考虑软封禁状态）
        const randomInterval = getRandomInterval($timer);

        // 记录下次检查时间，区分正常和软封禁状态
        if ($isSoftBanned) {
          logI18n("log_messages.next_check_soft_ban", "warning", {
            intervalMinutes: Math.round(randomInterval / 60000),
            banCount: $softBanCount,
          });
        } else {
          logI18n("log_messages.next_check_in", "info", {
            interval: Math.round(randomInterval / 1000),
          });
        }

        setTimeout(() => {
          if ($active && isAppointment) {
            if ($apptCenter) {
              getNewDate(0, $apptCenter, $ascCenter);
            }
            updateAppointmentInfo(); // 添加预约信息更新
          }
        }, randomInterval - $timer);
      }
    }, $timer);

    // 保存状态和监控上下文
    chrome.storage.local.set({
      __active: true,
      __timer: Math.round($timer / 60 / 1000), // 将毫秒转换为分钟保存
      __monitoringContext: monitoringContext, // 持久化监控上下文
      __softBanState: {
        isSoftBanned: $isSoftBanned,
        softBanCount: $softBanCount,
        softBanMultiplier: $softBanMultiplier,
        originalTimer: $originalTimer,
      },
    });

    logI18n("log_messages.monitoring_started", "info");
  }

  // 启动页面监控 - 确保监控期间不离开reschedule页面
  function startPageMonitoring() {
    // 监听页面变化事件
    let pageCheckInterval = setInterval(() => {
      if (!$active) {
        clearInterval(pageCheckInterval);
        return;
      }

      // 检查当前页面是否还是reschedule页面
      const currentPath = location.pathname;
      const currentIsAppointment = !!currentPath.match(
        /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/schedule\/\d{1,}\/appointment$/
      );
      if (!currentIsAppointment) {
        logI18n("log_messages.left_reschedule_page", "info", { currentPath });

        // 检查是否是确认页面（预约成功）
        const isConfirmationPage = !!currentPath.match(
          /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/schedule\/\d{1,}\/appointment\/instructions$/
        );

        if (isConfirmationPage) {
          logI18n("log_messages.confirmation_page_appointment_success", "info");
          stopMonitoring();
          toast("notifications.monitoring_stopped", "success");
          return;
        }

        // 检查当前是否有有效的center选择用于监控
        const hasValidCenterForMonitoring =
          $apptCenter && $apptCenter.trim() !== "";

        if (!hasValidCenterForMonitoring) {
          logI18n("log_messages.no_valid_center_during_monitoring", "warning");
          stopMonitoring();
          toast("alerts.select_center", "warning");
          return;
        }

        logI18n("log_messages.valid_center_during_monitoring", "info");

        // 检查是否退出登录
        const isLoggedOutPage = !!currentPath.match(
          /^\/[a-z]{2}-[a-z]{2}\/(n|)iv$/
        );
        const isSignInPage = !!currentPath.match(
          /^\/[a-z]{2}-[a-z]{2}\/(n|)iv\/users\/sign_in/
        );

        if (isLoggedOutPage || isSignInPage) {
          logI18n("log_messages.logout_detected_relogin", "info");
          toast("toast_messages.auth_failed", "info");

          // 使用监控上下文进行导航，不需要设置额外的导航标志
          // 监控上下文已经包含了所有必要的信息

          // 重新加载页面开始导航流程
          setTimeout(() => {
            location.reload();
          }, 1000);

          return;
        }

        // 其他情况，尝试导航回reschedule页面
        logI18n("log_messages.other_case_navigate_back", "info");
        toast("notifications.navigating", "info");

        // 监控上下文已经包含了恢复监控所需的所有信息
        // 不需要设置额外的导航标志

        const scheduleId = getScheduleId();
        if (scheduleId) {
          const appointmentUrl = `/en-ca/${$visaType}/schedule/${scheduleId}/appointment`;
          location.href = appointmentUrl;
        } else {
          // 如果没有scheduleId，通过仪表板导航
          const dashboardUrl = currentPath.replace(/schedule.*/, "");
          location.href = dashboardUrl;
        }
      }
    }, 5000); // 每5秒检查一次页面状态
  }

  // 停止监控
  function stopMonitoring() {
    if ($checkInterval) {
      clearInterval($checkInterval);
      $checkInterval = null;
    }

    $active = false;
    toast("notifications.monitoring_stopped", "info");

    // 彻底清除所有监控相关状态和标志
    chrome.storage.local.set({
      __active: false,
    });

    // 清除监控上下文和所有导航标志
    chrome.storage.local.remove([
      "__monitoringContext",
      "__navigationFlow",
      "__targetIsMonitoring",
      "__selectedCentersForTarget",
      "__maintainMonitoring",
      "__softBanState",
    ]);

    // 重置软封禁状态（可选：也可以保持状态以便下次启动时继续使用）
    // $isSoftBanned = false;
    // $softBanCount = 0;
    // $softBanMultiplier = 1;

    logI18n("log_messages.monitoring_completely_stopped", "info");
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
      $timer = storage.__timer ? storage.__timer * 60 * 1000 : 60000; // 将分钟转换为毫秒
      $visaType = storage.__vt || currentVisaType || "niv";
      $autoSubmit = storage.__as || false;

      // 恢复软封禁状态
      if (storage.__softBanState) {
        $isSoftBanned = storage.__softBanState.isSoftBanned || false;
        $softBanCount = storage.__softBanState.softBanCount || 0;
        $softBanMultiplier = storage.__softBanState.softBanMultiplier || 1;
        $originalTimer = storage.__softBanState.originalTimer || $timer;
      }

      // 处理预约中心配置
      if ($apptCenter) {
        // 单中心配置
        logI18n("log_messages.detected_configured_center", "info", {
          center: $apptCenter,
        });
      }

      logI18n("log_messages.config_loaded", "info", {
        hasUsername: $username
          ? isI18nReady && i18n
            ? i18n.t("info_values.enabled")
            : "set"
          : isI18nReady && i18n
          ? i18n.t("info_values.disabled")
          : "not set",
        apptCenter: $apptCenter,
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
      logI18n("log_messages.config_load_failed", "error", {
        error: error.message,
      });
    }
  }

  // 页面初始化逻辑
  async function init() {
    await loadConfiguration();

    // 清理过期的监控上下文
    await cleanupExpiredMonitoringContext();

    logI18n("log_messages.page_init", "info");

    // 更新预约信息但不开始任何自动操作
    updateAppointmentInfo();

    // 检查导航流程标记
    const storage = await chrome.storage.local.get([
      "__navigationFlow",
      "__targetIsMonitoring",
      "__selectedCentersForTarget",
      "__maintainMonitoring",
      "__monitoringContext", // 新增：监控上下文
    ]);

    // 检查是否有活跃的监控状态需要维护
    // 注意：不再依赖 $active 状态，因为它可能在页面刷新时不准确
    // 只有在有明确的监控上下文时才恢复监控
    const shouldMaintainMonitoring = false; // 移除自动维护逻辑

    // 检查是否有持久化的监控上下文
    const hasMonitoringContext = storage.__monitoringContext;

    logI18n("log_messages.monitoring_context_check", "info", {
      active: $active,
      apptCenter: $apptCenter,
      shouldMaintainMonitoring: shouldMaintainMonitoring,
      hasMonitoringContext: hasMonitoringContext,
    });

    if (storage.__navigationFlow) {
      logI18n("log_messages.navigation_flow_detected", "info");
      await handleNavigationFlow(storage);
    } else if (hasMonitoringContext && !isAppointment) {
      // 如果有监控上下文但不在reschedule页面，需要导航回去
      logI18n(
        "log_messages.monitoring_context_detected_need_navigation",
        "info"
      );

      const monitoringContext = storage.__monitoringContext;
      logI18n("log_messages.monitoring_context_details", "info", {
        context: JSON.stringify(monitoringContext),
      });

      // 恢复监控配置
      if (monitoringContext.apptCenter) {
        $apptCenter = monitoringContext.apptCenter;
      }

      if (isLoggedOut) {
        logI18n("log_messages.logged_out_need_relogin", "info");

        // 直接重新加载页面，init()会检测到监控上下文并处理导航
        location.reload();
        return;
      } else {
        // 在美签网站但不在reschedule页面，直接导航
        logI18n("log_messages.on_visa_site_but_not_reschedule", "info");

        // 导航到reschedule页面
        toast("notifications.navigating", "info");
        const scheduleId = getScheduleId() || monitoringContext.scheduleId;
        if (scheduleId) {
          const appointmentUrl = `/en-ca/${$visaType}/schedule/${scheduleId}/appointment`;
          location.href = appointmentUrl;
        } else {
          // 如果没有scheduleId，重新加载页面让 init() 处理导航
          location.reload();
        }
        return;
      }
    } else {
      logI18n("log_messages.no_navigation_flow", "info");
      // 不进行任何自动操作，只准备环境
      if (isAppointment) {
        logI18n("log_messages.on_reschedule_page_preparing", "info");
        await prepareAppointmentPageForMonitoring();

        // 只有在有有效的监控上下文时才恢复监控
        if (hasMonitoringContext) {
          const monitoringContext = storage.__monitoringContext;
          logI18n("log_messages.detected_valid_monitoring_context", "info");

          // 恢复监控配置
          if (monitoringContext.apptCenter) {
            $apptCenter = monitoringContext.apptCenter;
          }

          setTimeout(() => {
            startMonitoring();
            toast("notifications.monitoring_started", "success");
          }, 2000);
        }
      }

      // 重要：不自动启动监控，除非有明确的监控上下文
      // 用户必须手动点击"开始监控"才会触发监控和fetch操作
      logI18n("log_messages.page_initialized_waiting", "info");
    }
  }

  // 处理导航流程 - 只有在明确的跳转意图时才执行
  async function handleNavigationFlow(storage) {
    const targetIsMonitoring = storage.__targetIsMonitoring;
    const selectedCentersForTarget = storage.__selectedCentersForTarget;
    const maintainMonitoring = storage.__maintainMonitoring; // 是否为了维护现有监控

    logI18n("log_messages.navigation_flow_processing", "info", {
      targetIsMonitoring,
      maintainMonitoring,
    });

    // 处理不同页面类型的自动跳转
    if (isLoggedOut) {
      // 在首页，点击登录链接
      toast("log_messages.homepage_detected_finding_login", "info");
      const signInLink = document.querySelector(
        ".homeSelectionsContainer a[href*='/sign_in']"
      );
      if (signInLink) {
        await delay(500);
        signInLink.click();
      }
      return;
    }

    if (isSignIn) {
      // 处理登录页面
      toast("log_messages.login_page_detected_auto_login", "info");
      await handleSignInPage();
      return;
    }

    if (isDashboard) {
      // 处理仪表板页面，跳转到预约页面
      toast("log_messages.dashboard_detected_jump_appointment", "info");
      await handleDashboardPage();
      return;
    }

    if (isAppointment) {
      // 到达reschedule页面，这是目标页面
      toast("log_messages.appointment_page_reached", "success");

      // 清除导航流程标记，因为已到达目标页面
      await chrome.storage.local.remove([
        "__navigationFlow",
        "__targetIsMonitoring",
        "__selectedCentersForTarget",
        "__maintainMonitoring",
      ]);

      // 准备监控环境
      await prepareAppointmentPageForMonitoring();

      // 检查页面中心选择状态
      const currentlyHasSelectedCenter = hasSelectedCenter();
      const currentSelectedCenters = getSelectedCenters();

      // 优先使用用户之前配置的中心，而不是页面当前选择的中心
      const effectiveSelectedCenter = $apptCenter || currentSelectedCenters[0];
      const effectiveHasSelectedCenter = !!effectiveSelectedCenter;

      logI18n("log_messages.checking_center_selection_status", "info");

      // 决定下一步操作
      if (targetIsMonitoring || maintainMonitoring) {
        if (effectiveHasSelectedCenter) {
          // 有有效的中心选择（优先使用配置的中心），自动开始监控
          logI18n("log_messages.valid_center_selection_auto_start", "info");
          $apptCenter = effectiveSelectedCenter;

          // 如果页面选择与配置不一致，更新页面选择
          if (
            currentSelectedCenters.length === 0 ||
            currentSelectedCenters[0] !== effectiveSelectedCenter
          ) {
            const centerSelect = document.getElementById(
              "appointments_consulate_appointment_facility_id"
            );
            if (centerSelect) {
              logI18n("log_messages.sync_page_selection", "info", {
                firstConfiguredCenter: effectiveSelectedCenter,
              });
              centerSelect.value = effectiveSelectedCenter;
              centerSelect.dispatchEvent(
                new Event("change", { bubbles: true })
              );
            }
          }

          // 延迟一下再开始监控，确保页面完全加载
          setTimeout(() => {
            startMonitoring();
            if (maintainMonitoring) {
              toast("notifications.monitoring_started", "success");
            } else {
              toast("notifications.monitoring_started", "success");
            }
          }, 3000);
        } else if (
          selectedCentersForTarget &&
          selectedCentersForTarget.length > 0
        ) {
          // 页面未选择中心，但用户在popup中已选择，尝试设置并开始监控
          logI18n("log_messages.page_no_center_user_selected", "info");

          try {
            const centerSelect = document.getElementById(
              "appointments_consulate_appointment_facility_id"
            );

            if (centerSelect) {
              // 设置第一个选择的中心
              centerSelect.value = selectedCentersForTarget[0];

              // 触发change事件
              centerSelect.dispatchEvent(
                new Event("change", { bubbles: true })
              );

              $apptCenter = selectedCentersForTarget[0];

              await chrome.storage.local.set({
                __il: selectedCentersForTarget[0],
              });

              // 延迟开始监控
              setTimeout(() => {
                startMonitoring();
                toast("notifications.monitoring_started", "success");
              }, 3000);
            } else {
              toast("alerts.fill_credentials", "warning");
            }
          } catch (error) {
            logI18n("log_messages.set_center_failed", "error", {
              error: error.message,
            });
            toast("alerts.operation_failed", "warning");
          }
        } else {
          // 目标是监控但没选择中心，提示用户
          toast("alerts.select_center", "warning");
        }
      } else {
        // 目标不是监控，只是导航，提示用户手动操作
        toast("notifications.navigating", "info");
      }
      return;
    }

    if (isAddressPage) {
      // 处理地址页面，直接跳转到预约页面
      toast("log_messages.address_page_detected", "info");
      await handleAddressPage();
      return;
    }

    if (isConfirmation) {
      // 处理确认页面，返回到预约页面
      toast("log_messages.confirmation_page_detected", "info");
      await handleConfirmationPage();
      return;
    }

    // 其他页面类型，尝试通用导航
    logI18n("log_messages.unrecognized_page_generic_navigation", "info");
    await handleGenericNavigation();
  }

  // 处理登录页面
  async function handleSignInPage() {
    await delay(500);

    const emailField = document.getElementById("user_email");
    const passwordField = document.getElementById("user_password");
    const policyCheckbox = document.querySelector('[for="policy_confirmed"]');
    const submitBtn = document.querySelector(
      "#sign_in_form input[type=submit]"
    );

    if (emailField && passwordField && submitBtn) {
      // 首先尝试触发浏览器自动填充
      toast("log_messages.browser_auto_fill_check", "info");

      // 模拟用户交互来触发自动填充
      emailField.focus();
      emailField.click();

      // 触发input事件，有些浏览器需要这个来启动自动填充
      emailField.dispatchEvent(new Event("input", { bubbles: true }));
      emailField.dispatchEvent(new Event("change", { bubbles: true }));

      await delay(500);

      // 切换到密码字段也可能触发自动填充
      passwordField.focus();
      passwordField.click();
      passwordField.dispatchEvent(new Event("input", { bubbles: true }));
      passwordField.dispatchEvent(new Event("change", { bubbles: true }));

      // 等待更长时间让自动填充完成
      await delay(500);

      // 检查是否已经自动填充
      const hasAutoFilled =
        emailField.value.trim() !== "" && passwordField.value.trim() !== "";

      if (hasAutoFilled) {
        logI18n("log_messages.auto_fill_detected", "success");
        logI18n("log_messages.using_auto_filled_credentials", "info", {
          email: emailField.value,
        });
      } else {
        // 浏览器没有自动填充，使用存储的凭据
        if (!$username || !$password) {
          toast("log_messages.need_username_password", "warning");
          return;
        }

        logI18n("log_messages.no_auto_fill_using_stored", "info");
        emailField.value = $username;
        passwordField.value = $password;

        // 触发变化事件，确保表单识别到值的变化
        emailField.dispatchEvent(new Event("input", { bubbles: true }));
        emailField.dispatchEvent(new Event("change", { bubbles: true }));
        passwordField.dispatchEvent(new Event("input", { bubbles: true }));
        passwordField.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // 勾选政策确认
      if (policyCheckbox) {
        policyCheckbox.click();
      }

      await delay(500);
      submitBtn.click();

      toast("log_messages.signing_in", "info");
    }
  }

  // 处理仪表板页面
  async function handleDashboardPage() {
    await delay(500);

    // 首先获取当前预约信息
    updateAppointmentInfo();

    // 查找预约链接
    const appointmentLinks = document.querySelectorAll(
      "p.consular-appt [href], .ready_to_schedule p.delivery [href]"
    );

    if (appointmentLinks.length === 0) {
      toast("log_messages.dashboard_no_appointment_links", "error");
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
        logI18n("log_messages.dashboard_schedule_id_extracted", "info", {
          scheduleId: $appid,
        });
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

        toast("log_messages.dashboard_appointment_info_obtained", "success", {
          fullText: appointmentInfo.fullText,
        });
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

      toast("log_messages.dashboard_jumping_to_appointment", "info", {
        url: appointmentUrl,
      });
      location.href = appointmentUrl;
    }
  }

  // 处理地址页面
  async function handleAddressPage() {
    toast("log_messages.address_page_detected", "info");
    await delay(500);

    // 从当前URL构建预约页面URL
    const appointmentUrl = location.pathname.replace(
      /\/addresses\/[^\/]*$/,
      "/appointment"
    );
    location.href = appointmentUrl;
  }

  // 处理确认页面
  async function handleConfirmationPage() {
    toast("log_messages.confirmation_page_detected", "info");
    await delay(2000);

    // 从当前URL构建预约页面URL
    const appointmentUrl = location.pathname.replace(
      /\/appointment\/.*$/,
      "/appointment"
    );
    location.href = appointmentUrl;
  }

  // 处理通用导航
  async function handleGenericNavigation() {
    toast("log_messages.generic_navigation_attempt", "info");

    // 如果有scheduleId，直接构建预约URL
    const currentScheduleId = getScheduleId();
    if (currentScheduleId) {
      const appointmentUrl = `/en-ca/${$visaType}/schedule/${currentScheduleId}/appointment`;
      location.href = appointmentUrl;
      return;
    }

    // 否则尝试回到仪表板
    const dashboardUrl = location.pathname.replace(/schedule.*/, "");
    location.href = dashboardUrl;
  }

  // 准备预约页面用于监控（不自动开始监控）
  async function prepareAppointmentPageForMonitoring() {
    await delay(500);

    // 获取并保存当前预约信息
    updateAppointmentInfo();

    // 获取当前预约日期
    const currentDateField = document.getElementById(
      "appointments_consulate_appointment_date"
    );
    if (currentDateField && currentDateField.value) {
      $apptDate = currentDateField.value;
      await chrome.storage.local.set({ __ad: $apptDate });
    }

    // 处理预约中心选择 - 不覆盖用户之前的设置
    const centerSelect = document.getElementById(
      "appointments_consulate_appointment_facility_id"
    );

    if (centerSelect) {
      const pageSelectedCenter = centerSelect.value;

      logI18n("log_messages.center_config_priority", "info", {
        pageSelectedCenter,
        apptCenter: $apptCenter,
      });

      // 如果页面有选择中心，但用户之前没有配置过中心，则保存页面的选择
      if (pageSelectedCenter && (!$apptCenter || $apptCenter.trim() === "")) {
        logI18n("log_messages.save_page_selection", "info");
        $apptCenter = pageSelectedCenter;
        await chrome.storage.local.set({ __il: pageSelectedCenter });
      }
      // 如果用户之前已经配置了中心，保持用户的配置不变
      else if ($apptCenter && $apptCenter.trim() !== "") {
        logI18n("log_messages.keep_user_config", "info");
        // 设置页面选择为配置的中心
        if (centerSelect.value !== $apptCenter) {
          logI18n("log_messages.set_page_to_configured", "info", {
            configuredCenter: $apptCenter,
          });
          centerSelect.value = $apptCenter;
          centerSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      // 如果页面和配置都没有选择，记录状态但不做操作
      else {
        logI18n("log_messages.page_and_config_no_selection", "info");
      }
    }

    // 获取ASC中心（如果有）
    const ascSelect = document.getElementById(
      "appointments_asc_appointment_facility_id"
    );
    if (ascSelect && ascSelect.value) {
      $ascCenter = ascSelect.value;
      await chrome.storage.local.set({ __al: $ascCenter });
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

    toast("log_messages.reschedule_page_ready", "success", {
      apptDate:
        $apptDate ||
        (isI18nReady && i18n
          ? i18n.t("status_messages.not_started")
          : "not set"),
    });
    logI18n("log_messages.page_preparation_complete", "info");
    logI18n("log_messages.final_center_config", "info", {
      apptCenter: $apptCenter,
    });
  }

  // 获取预约中心选项
  function getAppointmentCenters() {
    try {
      const centerSelect = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );

      if (!centerSelect) {
        // console.log("未找到预约中心选择器");
        return [];
      }

      const centers = [];
      const options = centerSelect.querySelectorAll("option");

      options.forEach((option, index) => {
        if (option.value && option.value.trim() !== "") {
          centers.push({
            value: option.value.trim(),
            text: option.textContent.trim(),
            selected: option.selected,
            index: index,
          });
        }
      });

      // console.log(`获取到 ${centers.length} 个预约中心选项:`, centers);
      return centers;
    } catch (error) {
      console.error("获取预约中心选项失败:", error);
      return [];
    }
  }

  // 检查是否已选择预约中心（包括配置的中心和页面选择的中心）
  function hasSelectedCenter() {
    try {
      // 首先检查是否有配置的中心
      if ($apptCenter && $apptCenter.trim() !== "") {
        logI18n("log_messages.detected_configured_center", "info", {
          center: $apptCenter,
        });
        return true;
      }

      // 然后检查页面是否有选择
      const centerSelect = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );

      if (!centerSelect) {
        console.log("未找到预约中心选择器");
        return false;
      }

      const hasPageSelection =
        centerSelect.value && centerSelect.value.trim() !== "";
      if (hasPageSelection) {
        logI18n("log_messages.detected_page_selected_center", "info", {
          center: centerSelect.value,
        });
      }

      return hasPageSelection;
    } catch (error) {
      console.error("检查预约中心选择状态失败:", error);
      return false;
    }
  }

  // 获取当前选择的预约中心（优先返回配置的中心）
  function getSelectedCenters() {
    try {
      // 首先返回配置的中心
      if ($apptCenter && $apptCenter.trim() !== "") {
        console.log("返回配置的预约中心:", $apptCenter);
        return [$apptCenter];
      }

      // 然后检查页面选择
      const centerSelect = document.getElementById(
        "appointments_consulate_appointment_facility_id"
      );

      if (!centerSelect || !centerSelect.value) {
        console.log("无配置中心且页面无选择");
        return [];
      }

      // 如果是多选模式（虽然目前美签网站是单选）
      if (centerSelect.multiple) {
        const selectedOptions = Array.from(centerSelect.selectedOptions);
        const pageSelection = selectedOptions
          .map((option) => option.value.trim())
          .filter((val) => val);
        console.log("返回页面多选的预约中心:", pageSelection);
        return pageSelection;
      } else {
        // 单选模式
        const pageSelection = centerSelect.value.trim()
          ? [centerSelect.value.trim()]
          : [];
        if (pageSelection.length > 0) {
          console.log("返回页面单选的预约中心:", pageSelection);
        }
        return pageSelection;
      }
    } catch (error) {
      console.error("获取选择的预约中心失败:", error);
      return [];
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
      if (request.center) {
        // 单中心模式
        $apptCenter = request.center;
      }

      $timer = request.interval || 60000;
      // 保存间隔设置（转换为分钟）
      chrome.storage.local.set({
        __timer: Math.round($timer / 60 / 1000),
      });
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

    if (request.action === "start_navigation_to_appointment") {
      // popup.js请求开始导航到预约页面
      console.log("收到导航到预约页面的请求");

      // 设置导航流程标记（如果还没有设置）
      chrome.storage.local.set({
        __navigationFlow: true,
        __targetIsMonitoring: request.targetIsMonitoring || false,
        __selectedCentersForTarget: request.selectedCenters || null,
      });

      // 立即开始导航处理
      handleNavigationFlow({
        __navigationFlow: true,
        __targetIsMonitoring: request.targetIsMonitoring || false,
        __selectedCentersForTarget: request.selectedCenters || null,
      });

      return sendResponse({ success: true });
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

  // 清理过期的监控上下文
  async function cleanupExpiredMonitoringContext() {
    try {
      const storage = await chrome.storage.local.get(["__monitoringContext"]);
      if (storage.__monitoringContext) {
        const context = storage.__monitoringContext;
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时

        // 如果监控上下文超过24小时，清除它
        if (now - context.timestamp > maxAge) {
          logI18n("log_messages.expired_monitoring_context_cleaned", "info");
          await chrome.storage.local.remove(["__monitoringContext"]);
          return true; // 已清除
        }
      }
      return false; // 未清除
    } catch (error) {
      console.error("清理监控上下文失败:", error);
      return false;
    }
  }

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
    logI18n("log_messages.appointment_parsing_test", "info", { result });

    document.body.removeChild(tempDiv);
    return result;
  }

  // 在开发模式下可以调用 testAppointmentParsing() 进行测试
})(location.pathname);
