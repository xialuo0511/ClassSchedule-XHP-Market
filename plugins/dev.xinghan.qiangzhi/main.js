(function () {
  'use strict';

  var PLUGIN_ID = 'dev.xinghan.qiangzhi';
  var STATE_PREFIX = '__XHP_QIANGZHI_V1__:';
  var ROOT_ID = 'xhp-qz-root';
  var TOOLBAR_ID = 'xhp-qz-toolbar';
  var SUBMITTED_KEY = '__xhp_qz_submitted__';
  var AUTO_REFRESH_KEY = '__xhp_qz_session_refresh__:';
  var NAV_PATCH_KEY = '__xhp_qz_navigation_patched__';
  var MAX_SECTION_COUNT = 12;
  var COLOR_PALETTE = [
    '#DDEBFF', '#DDF4EE', '#F3E6FA', '#FFF0D8',
    '#FFE4E1', '#E7E5FF', '#DFF3F8', '#F1E8D8'
  ];

  if (typeof XHP === 'undefined') {
    console.error('[QiangZhi XHP] XHP bridge is unavailable');
    return;
  }

  var state = readState();
  var apiVersion = safeCallNumber('getApiVersion', 1);
  var runtimeMode = apiVersion >= 3 ? safeCallString('getRuntimeMode', 'web') : 'web';

  log('page=' + window.location.href + ', api=' + apiVersion + ', mode=' + runtimeMode);

  if (runtimeMode !== 'web') {
    failUnsupportedMode();
    return;
  }

  exposeTestApi();

  if (isBootstrapPage()) {
    renderBootstrap();
    return;
  }

  // Some modern WebViews clear window.name on cross-origin navigation.
  // The plugin only runs inside its dedicated WebView, so recover from the
  // current page instead of showing the bootstrap screen again.
  if (!state.targetUrl) {
    state.targetUrl = window.location.href;
    writeState(state);
  }

  installNavigationCompatibility();

  var sessionFailure = detectSessionFailure(document);
  if (sessionFailure && tryAutomaticSessionRefresh(sessionFailure)) return;
  if (!sessionFailure) clearAutomaticSessionRefreshMarker();

  installTargetToolbar(sessionFailure);

  function isBootstrapPage() {
    return window.location.href === 'about:blank' || window.location.hostname === 'example.com';
  }

  function failUnsupportedMode() {
    if (typeof XHP.failAction === 'function') {
      XHP.failAction('强智导入插件仅支持可见网页模式');
    }
  }

  function renderBootstrap() {
    removeById(ROOT_ID);
    removeById(TOOLBAR_ID);

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '' +
      '<style>' + baseCss() + '</style>' +
      '<div class="qz-page">' +
        '<div class="qz-card qz-bootstrap-card">' +
          '<div class="qz-eyebrow">XHP · 强智科技教务系统</div>' +
          '<h1>导入学校课表</h1>' +
          '<p class="qz-muted">输入学校教务系统的 HTTP 或 HTTPS 地址。插件只在当前 WebView 中读取课表页面，不保存账号、密码或 Cookie。</p>' +
          '<label class="qz-label" for="qz-url">教务系统网址</label>' +
          '<input id="qz-url" class="qz-input" type="url" inputmode="url" autocomplete="url" ' +
            'placeholder="https://jwxt.example.edu.cn/jsxsd/ 或 http://10.x.x.x/jsxsd/" value="' + escapeAttr(state.targetUrl || '') + '">' +
          '<div id="qz-url-error" class="qz-error" hidden></div>' +
          '<button id="qz-open" class="qz-button qz-primary" type="button">打开教务系统</button>' +
          '<div class="qz-note">支持 HTTP 与 HTTPS。HTTP 不加密账号和页面数据，仅应在可信校园网或 VPN 内使用。进入系统后请正常登录，再前往“学期理论课表”。</div>' +
        '</div>' +
      '</div>';

    appendToDocument(root);
    pinOverlayToVisualViewport(root);

    var input = document.getElementById('qz-url');
    var openButton = document.getElementById('qz-open');
    openButton.addEventListener('click', function () {
      var result = normalizeUserUrl(input.value);
      if (!result.ok) {
        showInlineError('qz-url-error', result.error);
        return;
      }
      state.targetUrl = result.url;
      state.lastPage = '';
      writeState(state);
      window.location.assign(result.url);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') openButton.click();
    });
  }

  function installTargetToolbar(sessionFailure) {
    removeById(TOOLBAR_ID);

    var table = findTimetableTable(document);
    var selectedWeek = selectedSpecificWeek(document);
    var loginPage = looksLikeLoginPage(document);
    var statusText;
    var primaryText;

    if (sessionFailure) {
      statusText = sessionFailure.message;
      primaryText = '重新进入登录页';
    } else if (table) {
      statusText = selectedWeek ? '当前仅显示第 ' + selectedWeek + ' 周' : '已识别课表页面';
      primaryText = selectedWeek ? '切换为全部周次' : '解析并导入';
    } else if (loginPage) {
      statusText = '请先完成登录；登录成功后再进入课表';
      primaryText = '我已登录，打开课表页';
    } else {
      statusText = '尚未识别到课表；可先完成统一认证或手动打开课表';
      primaryText = '尝试打开课表页';
    }

    var toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = '' +
      '<style>' + toolbarCss() + '</style>' +
      '<div class="qz-fab-panel">' +
        '<div class="qz-fab-title">强智课表导入</div>' +
        '<div id="qz-fab-status" class="qz-fab-status">' + escapeHtml(statusText) + '</div>' +
        '<button id="qz-parse" class="qz-fab-primary" type="button">' + escapeHtml(primaryText) + '</button>' +
        (sessionFailure ? '<button id="qz-reload" class="qz-fab-secondary" type="button">刷新当前页面</button>' : '') +
        '<button id="qz-reset" class="qz-fab-secondary" type="button">更换网址</button>' +
      '</div>';

    appendToDocument(toolbar);
    pinToolbarToVisualViewport(toolbar);

    document.getElementById('qz-parse').addEventListener('click', function () {
      if (sessionFailure) {
        navigateToLoginEntry();
        return;
      }
      var currentTable = findTimetableTable(document);
      var week = selectedSpecificWeek(document);
      if (currentTable && week) {
        if (!switchToAllWeeks(document)) {
          showToolbarStatus('无法自动切换，请在页面“周次”下拉框选择“（全部）”', true);
        }
        return;
      }
      if (currentTable) {
        openImportPreview();
        return;
      }
      navigateToTimetable();
    });

    var reloadButton = document.getElementById('qz-reload');
    if (reloadButton) {
      reloadButton.addEventListener('click', function () {
        clearAutomaticSessionRefreshMarker();
        window.location.reload();
      });
    }

    document.getElementById('qz-reset').addEventListener('click', function () {
      state = {};
      writeState(state);
      window.location.assign('https://example.com/');
    });
  }

  function installNavigationCompatibility() {
    if (window[NAV_PATCH_KEY]) return;
    window[NAV_PATCH_KEY] = true;

    var originalOpen = typeof window.open === 'function' ? window.open.bind(window) : null;
    window.open = function (url, target, features) {
      if (url) {
        try {
          var resolved = new URL(String(url), window.location.href);
          if (isWebProtocol(resolved.protocol)) {
            window.location.assign(resolved.href);
            return window;
          }
        } catch (_) {}
      }
      return originalOpen ? originalOpen(url, target, features) : null;
    };

    document.addEventListener('click', function (event) {
      var node = event.target;
      var anchor = node && node.closest ? node.closest('a[target="_blank"],a[target="new"]') : null;
      if (!anchor || !anchor.href) return;
      try {
        var resolved = new URL(anchor.href, window.location.href);
        if (!isWebProtocol(resolved.protocol)) return;
        event.preventDefault();
        window.location.assign(resolved.href);
      } catch (_) {}
    }, true);

    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.target) return;
      if (/^(_blank|new)$/i.test(form.target)) form.target = '_self';
    }, true);
  }

  function detectSessionFailure(doc) {
    var raw = cleanText(doc && doc.body ? doc.body.innerText : '');
    if (!raw) return null;

    var parsed = null;
    if (/^\s*\{[\s\S]*\}\s*$/.test(raw)) {
      try { parsed = JSON.parse(raw); } catch (_) {}
    }

    var flag = parsed && (parsed.flag1 != null ? parsed.flag1 : parsed.flag);
    var message = parsed && (parsed.msgContent || parsed.message || parsed.msg);
    if (String(flag) === '2' || /["']flag1["']\s*:\s*["']?2["']?/.test(raw)) {
      return {
        code: 'refresh_required',
        message: '教务系统要求刷新以建立登录会话；插件已自动刷新一次。若仍停留在此页，请重新进入登录页。',
        rawMessage: cleanText(message || '')
      };
    }

    if (/请先刷新网页|璇峰厛鍒锋柊缃戦〉|会话.{0,8}(失效|过期)|session.{0,8}(invalid|expired)/i.test(raw)) {
      return {
        code: 'session_expired',
        message: '登录会话未建立或已经失效，请重新进入登录页。',
        rawMessage: cleanText(message || raw)
      };
    }
    return null;
  }

  function tryAutomaticSessionRefresh(issue) {
    if (window.__QZ_XHP_DISABLE_AUTO_REFRESH__) return false;
    if (!issue || issue.code !== 'refresh_required') return false;
    var key = automaticRefreshStorageKey();
    try {
      if (window.sessionStorage.getItem(key) === '1') return false;
      window.sessionStorage.setItem(key, '1');
    } catch (_) {
      return false;
    }
    log('session refresh required; reloading once');
    window.setTimeout(function () { window.location.reload(); }, 180);
    return true;
  }

  function clearAutomaticSessionRefreshMarker() {
    try { window.sessionStorage.removeItem(automaticRefreshStorageKey()); } catch (_) {}
  }

  function automaticRefreshStorageKey() {
    return AUTO_REFRESH_KEY + window.location.origin + window.location.pathname;
  }

  function looksLikeLoginPage(doc) {
    if (!doc) return false;
    if (doc.querySelector('input[type="password"]')) return true;
    var text = cleanText((doc.title || '') + ' ' + (doc.body ? doc.body.innerText : ''));
    return /统一身份认证|用户登录|学生登录|教务系统登录|登录系统/.test(text);
  }

  function navigateToLoginEntry() {
    var url = buildLoginEntryUrl(window.location.href, state.targetUrl);
    if (!url) {
      showToolbarStatus('无法推断登录入口，请点击“更换网址”并输入学校提供的登录地址', true);
      return;
    }
    state.lastPage = window.location.href;
    writeState(state);
    window.location.replace(url);
  }

  function buildLoginEntryUrl(currentUrl, originalUrl) {
    var current = safeWebUrl(currentUrl);
    var original = safeWebUrl(originalUrl);

    if (original && current && original.hostname !== current.hostname && !/\/jsxsd\/.+/i.test(original.pathname)) return original.href;
    if (original && !/\/jsxsd\/.+/i.test(original.pathname) && !/xskb_list\.do/i.test(original.pathname)) {
      if (!/\.(do|action)$/i.test(original.pathname) || /login|logon|auth|sso/i.test(original.pathname)) {
        return original.href;
      }
    }

    var candidates = [current, original].filter(Boolean);
    for (var i = 0; i < candidates.length; i += 1) {
      var parsed = candidates[i];
      var match = parsed.pathname.match(/^(.*?\/jsxsd)(?:\/|$)/i);
      if (match) return parsed.origin + match[1].replace(/\/$/, '') + '/';
    }
    return current ? current.origin + '/' : (original ? original.origin + '/' : '');
  }

  function safeWebUrl(value) {
    try {
      var parsed = new URL(value);
      return isWebProtocol(parsed.protocol) && parsed.hostname ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function navigateToTimetable() {
    var url = buildCommonTimetableUrl(window.location.href, state.targetUrl);
    if (!url) {
      showToolbarStatus('无法推断课表地址，请在系统内手动打开“学期理论课表”', true);
      return;
    }
    state.lastPage = window.location.href;
    writeState(state);
    window.location.assign(url);
  }

  function openImportPreview() {
    var parsed;
    try {
      parsed = parseTimetable(document);
    } catch (error) {
      log('parse failed: ' + error.message);
      showToolbarStatus('解析失败：' + error.message, true);
      return;
    }

    if (!parsed.courses.length) {
      showToolbarStatus('没有识别到课程，请确认已选择“全部”周次', true);
      return;
    }
    renderImportDialog(parsed);
  }

  function renderImportDialog(parsed) {
    removeById(ROOT_ID);

    var currentSemester = getCurrentSemesterInfo();
    var hasCurrentSemester = !!currentSemester.startDate;
    var detected = parsed.semester;
    var suggestedWeeks = Math.max(parsed.maxWeek || 0, 16);
    var suggestedSections = Math.min(MAX_SECTION_COUNT, Math.max(parsed.maxSection || 0, currentSemester.sectionCount || 0, MAX_SECTION_COUNT));
    var suggestedStartDate = guessSemesterStartDate(detected.code || detected.name);
    var createChecked = true;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '' +
      '<style>' + baseCss() + '</style>' +
      '<div class="qz-overlay">' +
        '<div class="qz-card qz-dialog">' +
          '<button id="qz-dialog-close" class="qz-close" type="button" aria-label="关闭">×</button>' +
          '<div class="qz-eyebrow">解析完成</div>' +
          '<h2>确认导入方式</h2>' +
          '<div class="qz-summary">' +
            '<div><strong>' + parsed.courses.length + '</strong><span>门课程</span></div>' +
            '<div><strong>' + parsed.scheduleCount + '</strong><span>条安排</span></div>' +
            '<div><strong>' + parsed.maxWeek + '</strong><span>最大周次</span></div>' +
          '</div>' +
          '<div class="qz-detected">' +
            '<div>识别学期：<strong>' + escapeHtml(detected.name || '未识别') + '</strong></div>' +
            '<div class="qz-course-preview">' + escapeHtml(parsed.courses.slice(0, 6).map(function (c) { return c.name; }).join('、')) +
              (parsed.courses.length > 6 ? ' 等' : '') + '</div>' +
          '</div>' +
          '<div class="qz-choice-grid">' +
            '<label class="qz-choice">' +
              '<input type="radio" name="qz-mode" value="new" ' + (createChecked ? 'checked' : '') + '>' +
              '<span><b>创建新学期</b><small>新建学期并设为当前学期，不影响其他学期</small></span>' +
            '</label>' +
            '<label class="qz-choice ' + (hasCurrentSemester ? '' : 'qz-disabled') + '">' +
              '<input type="radio" name="qz-mode" value="current" ' + (hasCurrentSemester ? '' : 'disabled') + '>' +
              '<span><b>覆盖当前学期</b><small>' +
                (hasCurrentSemester ? ('当前：' + currentSemester.startDate + ' · ' + currentSemester.totalWeeks + ' 周') : 'App 尚未设置当前学期') +
              '</small></span>' +
            '</label>' +
          '</div>' +
          '<div id="qz-semester-fields" class="qz-fields">' +
            '<label class="qz-label">学期名称<input id="qz-sem-name" class="qz-input" value="' + escapeAttr(detected.name || '新学期') + '"></label>' +
            '<label class="qz-label">学期开始日期<input id="qz-sem-date" class="qz-input" type="date" value="' + escapeAttr(suggestedStartDate) + '"><small>已按学期编号估算，请按学校校历核对。</small></label>' +
            '<div class="qz-two-columns">' +
              '<label class="qz-label">总周数<input id="qz-sem-weeks" class="qz-input" type="number" min="1" max="60" value="' + suggestedWeeks + '"></label>' +
              '<label class="qz-label">每日节数<input id="qz-sem-sections" class="qz-input" type="number" min="1" max="12" value="' + suggestedSections + '"></label>' +
            '</div>' +
          '</div>' +
          '<div id="qz-submit-error" class="qz-error" hidden></div>' +
          '<button id="qz-submit" class="qz-button qz-primary" type="button">提交到课程表 App</button>' +
          '<div class="qz-note">提交后，App 还会显示一次原生确认框。覆盖模式会先清空当前学期课程，再写入本次结果。</div>' +
        '</div>' +
      '</div>';

    appendToDocument(root);
    pinOverlayToVisualViewport(root);

    document.getElementById('qz-dialog-close').addEventListener('click', function () {
      removeById(ROOT_ID);
    });

    var radios = Array.prototype.slice.call(document.querySelectorAll('input[name="qz-mode"]'));
    radios.forEach(function (radio) {
      radio.addEventListener('change', updateSemesterFieldsVisibility);
    });
    updateSemesterFieldsVisibility();

    document.getElementById('qz-submit').addEventListener('click', function () {
      if (window[SUBMITTED_KEY]) return;

      var mode = selectedMode();
      var totalWeeks;
      var sectionCount;
      var payload = { protocolVersion: 1, courses: [] };

      if (mode === 'new') {
        var semesterName = valueOf('qz-sem-name').trim();
        var startDate = valueOf('qz-sem-date').trim();
        totalWeeks = parsePositiveInt(valueOf('qz-sem-weeks'));
        sectionCount = parsePositiveInt(valueOf('qz-sem-sections'));

        if (!semesterName) return submitError('学期名称不能为空');
        if (!isIsoDate(startDate)) return submitError('请选择有效的学期开始日期');
        if (!totalWeeks || totalWeeks > 60) return submitError('总周数必须为 1–60');
        if (!sectionCount || sectionCount > MAX_SECTION_COUNT) return submitError('每日节数必须为 1–12');
        if (parsed.maxWeek > totalWeeks) return submitError('课程包含第 ' + parsed.maxWeek + ' 周，总周数不能更小');
        if (parsed.maxSection > sectionCount) return submitError('课程使用到第 ' + parsed.maxSection + ' 节，每日节数不能更小');

        payload.semester = {
          name: semesterName,
          startDate: startDate,
          totalWeeks: totalWeeks,
          sectionCount: sectionCount
        };
      } else {
        if (!hasCurrentSemester) return submitError('当前没有可覆盖的学期');
        totalWeeks = currentSemester.totalWeeks;
        sectionCount = currentSemester.sectionCount;
        if (parsed.maxWeek > totalWeeks) {
          return submitError('当前学期只有 ' + totalWeeks + ' 周，但课程包含第 ' + parsed.maxWeek + ' 周');
        }
        if (parsed.maxSection > sectionCount) {
          return submitError('当前学期只有 ' + sectionCount + ' 节，但课程使用到第 ' + parsed.maxSection + ' 节');
        }
      }

      payload.courses = buildPayloadCourses(parsed.courses, totalWeeks);
      if (!payload.courses.length) return submitError('没有可提交的课程');

      window[SUBMITTED_KEY] = true;
      document.getElementById('qz-submit').disabled = true;
      log('submitting courses=' + payload.courses.length + ', mode=' + mode);
      XHP.submitCourses(JSON.stringify(payload));
    });

    function updateSemesterFieldsVisibility() {
      document.getElementById('qz-semester-fields').hidden = selectedMode() !== 'new';
    }

    function selectedMode() {
      var checked = document.querySelector('input[name="qz-mode"]:checked');
      return checked ? checked.value : 'new';
    }

    function submitError(message) {
      showInlineError('qz-submit-error', message);
      return false;
    }
  }

  function parseTimetable(doc) {
    var table = findTimetableTable(doc);
    if (!table) throw new Error('未找到强智课表表格 #kbtable');

    var rows = Array.prototype.slice.call(table.rows || table.querySelectorAll('tr'));
    if (rows.length < 2) throw new Error('课表表格没有有效数据行');

    var headerMap = detectHeaderDayColumns(rows[0]);
    var rawEntries = [];
    var dataRowOrdinal = 0;

    rows.forEach(function (row, rowIndex) {
      if (rowIndex === 0) return;
      var cells = rowCells(row);
      var tdCells = cells.filter(function (cell) { return cell.tagName.toLowerCase() === 'td'; });
      if (!tdCells.length) return;

      dataRowOrdinal += 1;
      var fallbackSections = inferSectionsFromRow(row, dataRowOrdinal);

      if (headerMap.length) {
        headerMap.forEach(function (mapping) {
          var cell = cells[mapping.index];
          if (!cell || cell.tagName.toLowerCase() !== 'td') {
            cell = tdCells[mapping.day - 1];
          }
          parseCell(cell, mapping.day, fallbackSections, rawEntries);
        });
      } else {
        tdCells.slice(0, 7).forEach(function (cell, index) {
          parseCell(cell, index + 1, fallbackSections, rawEntries);
        });
      }
    });

    var deduped = dedupeRawEntries(rawEntries);
    var grouped = groupCourses(deduped);
    var maxWeek = 0;
    var maxSection = 0;
    var scheduleCount = 0;

    grouped.forEach(function (course) {
      course.schedules.forEach(function (schedule) {
        scheduleCount += 1;
        maxSection = Math.max(maxSection, schedule.endSection);
        if (schedule.weeks.length) maxWeek = Math.max(maxWeek, schedule.weeks[schedule.weeks.length - 1]);
      });
    });

    return {
      semester: detectSemester(doc),
      courses: grouped,
      maxWeek: maxWeek,
      maxSection: maxSection,
      scheduleCount: scheduleCount
    };
  }

  function parseCell(cell, dayOfWeek, fallbackSections, out) {
    if (!cell) return;
    var divs = Array.prototype.slice.call(cell.querySelectorAll('div.kbcontent'));
    if (!divs.length && /周|节/.test(cleanText(cell.textContent))) divs = [cell];

    divs.forEach(function (div) {
      splitCourseBlocks(div.innerHTML).forEach(function (blockHtml) {
        var entry = parseCourseBlock(blockHtml, dayOfWeek, fallbackSections);
        if (entry) out.push(entry);
      });
    });
  }

  function splitCourseBlocks(html) {
    var marker = '__XHP_QZ_SPLIT__';
    var normalized = String(html || '')
      .replace(/(?:<br\s*\/?\s*>\s*)?-{5,}(?:\s*<br\s*\/?\s*>)?/gi, marker)
      .replace(/(?:<br\s*\/?\s*>\s*)?—{5,}(?:\s*<br\s*\/?\s*>)?/gi, marker);
    return normalized.split(marker).map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function parseCourseBlock(blockHtml, dayOfWeek, fallbackSections) {
    var box = document.createElement('div');
    box.innerHTML = blockHtml;
    var lines = htmlLines(box);
    if (!lines.length) return null;

    var titled = Array.prototype.slice.call(box.querySelectorAll('[title]'));
    var teacher = textFromTitled(titled, ['老师', '教师']);
    var weekText = textFromTitled(titled, ['周次']);
    var sectionText = '';
    var location = textFromTitled(titled, ['教室', '地点', '上课地点']);

    if (!weekText) {
      weekText = firstMatching(lines, function (line) {
        return /\d/.test(line) && (/周/.test(line) || /单|双/.test(line));
      });
    }
    // “周次(节次)”是周次标签，不能把其中的 1-16(周) 当成节次。
    sectionText = firstMatching(lines, looksLikeExplicitSectionLine);
    var weeks = parseWeeks(weekText);
    var sections = parseSections(sectionText);
    if (!sections.length) sections = fallbackSections.slice();
    if (!weeks.length || !sections.length) return null;

    var metadataValues = [teacher, weekText, sectionText, location].filter(Boolean).map(cleanText);
    var name = firstMatching(lines, function (line) {
      var cleaned = cleanText(line).replace(/^P\s*/i, '').trim();
      return cleaned && cleaned !== 'P' && metadataValues.indexOf(cleaned) < 0 && !looksLikeWeekOrSection(cleaned);
    });
    name = cleanText(name).replace(/\s*P\s*$/, '').trim();
    if (!name || name === '&nbsp;') return null;

    var weekLineIndex = lines.findIndex(function (line) { return cleanText(line) === cleanText(weekText); });
    if (!teacher && weekLineIndex > 1) teacher = cleanText(lines[weekLineIndex - 1]);
    if (!location) {
      location = firstMatching(lines.slice(Math.max(1, weekLineIndex + 1)), function (line) {
        return /楼|室|馆|场|区|校区|教|实训|实验/.test(line) && !looksLikeWeekOrSection(line);
      });
    }

    return {
      name: name,
      teacher: cleanNullable(teacher),
      location: cleanNullable(location),
      dayOfWeek: dayOfWeek,
      startSection: sections[0],
      endSection: sections[sections.length - 1],
      weeks: weeks
    };
  }

  function parseWeeks(text) {
    var value = normalizeSymbols(text)
      .replace(/[\[【][^\]】]*[\]】]/g, ' ')
      .replace(/第/g, '')
      .replace(/\(周\)|（周）|周次|周/g, ' ');
    var odd = /单/.test(value);
    var even = /双/.test(value);
    value = value.replace(/单周?|双周?|每周/g, ' ');

    var tokens = value.match(/\d+\s*(?:-\s*\d+)?/g) || [];
    var weeks = [];
    tokens.forEach(function (token) {
      var nums = token.split('-').map(function (part) { return parseInt(part.trim(), 10); });
      if (nums.length >= 2 && nums[0] > 0 && nums[1] >= nums[0] && nums[1] <= 60) {
        for (var w = nums[0]; w <= nums[1]; w += 1) weeks.push(w);
      } else if (nums[0] > 0 && nums[0] <= 60) {
        weeks.push(nums[0]);
      }
    });

    weeks = uniqueSorted(weeks);
    if (odd) weeks = weeks.filter(function (week) { return week % 2 === 1; });
    if (even) weeks = weeks.filter(function (week) { return week % 2 === 0; });
    return weeks;
  }

  function parseSections(text) {
    var value = normalizeSymbols(text);
    var bracket = value.match(/[\[【]([^\]】]+)[\]】]/);
    if (bracket) value = bracket[1];
    value = value.replace(/第|节次|节|\s/g, '');

    var sections = [];
    if (/^\d+$/.test(value)) {
      if (value.length >= 4 && value.length % 2 === 0) {
        for (var i = 0; i < value.length; i += 2) {
          var pair = parseInt(value.slice(i, i + 2), 10);
          if (pair > 0 && pair <= MAX_SECTION_COUNT) sections.push(pair);
        }
      } else {
        var single = parseInt(value, 10);
        if (single > 0 && single <= MAX_SECTION_COUNT) sections.push(single);
      }
    } else {
      var numbers = (value.match(/\d+/g) || []).map(function (item) { return parseInt(item, 10); });
      if (numbers.length >= 2 && /-|至|~/.test(value)) {
        var start = numbers[0];
        var end = numbers[numbers.length - 1];
        if (start > 0 && end >= start && end <= MAX_SECTION_COUNT) {
          for (var s = start; s <= end; s += 1) sections.push(s);
        }
      } else {
        sections = numbers.filter(function (number) { return number > 0 && number <= MAX_SECTION_COUNT; });
      }
    }
    return uniqueSorted(sections);
  }

  function looksLikeExplicitSectionLine(line) {
    var value = normalizeSymbols(line).trim();
    return /^(?:第)?\s*[\[【]?\s*\d{1,2}(?:\s*[-,]\s*\d{1,2})*\s*[\]】]?\s*节(?:次)?$/.test(value);
  }

  function inferSectionsFromRow(row, ordinal) {
    var header = row.querySelector('th');
    var text = cleanText(header ? header.textContent : '');
    var digit = parseInt((text.match(/\d+/) || [])[0], 10);
    var largeIndex = digit || chineseOrdinal(text) || ordinal;
    var start = (largeIndex - 1) * 2 + 1;
    return [start, start + 1];
  }

  function chineseOrdinal(text) {
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    var match = text.match(/第?([一二三四五六七八九十]+)大?节/);
    if (!match) return 0;
    var token = match[1];
    if (map[token]) return map[token];
    if (token.indexOf('十') >= 0) {
      var parts = token.split('十');
      return (parts[0] ? map[parts[0]] : 1) * 10 + (parts[1] ? map[parts[1]] : 0);
    }
    return 0;
  }

  function detectHeaderDayColumns(headerRow) {
    return rowCells(headerRow).map(function (cell, index) {
      return { index: index, day: parseDayText(cell.textContent) };
    }).filter(function (item) { return item.day > 0; });
  }

  function parseDayText(text) {
    var value = cleanText(text);
    if (/一|1/.test(value)) return 1;
    if (/二|2/.test(value)) return 2;
    if (/三|3/.test(value)) return 3;
    if (/四|4/.test(value)) return 4;
    if (/五|5/.test(value)) return 5;
    if (/六|6/.test(value)) return 6;
    if (/日|天|七|7/.test(value)) return 7;
    return 0;
  }

  function rowCells(row) {
    return Array.prototype.slice.call(row.children).filter(function (node) {
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      return tag === 'th' || tag === 'td';
    });
  }

  function dedupeRawEntries(entries) {
    var seen = {};
    return entries.filter(function (entry) {
      var key = [entry.name, entry.teacher || '', entry.location || '', entry.dayOfWeek,
        entry.startSection, entry.endSection, entry.weeks.join(',')].join('|');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function groupCourses(entries) {
    var map = {};
    entries.forEach(function (entry) {
      var key = [entry.name, entry.teacher || ''].join('|');
      if (!map[key]) {
        map[key] = {
          name: entry.name,
          teacher: entry.teacher,
          color: COLOR_PALETTE[Math.abs(hashString(key)) % COLOR_PALETTE.length],
          schedules: []
        };
      }
      map[key].schedules.push({
        dayOfWeek: entry.dayOfWeek,
        startSection: entry.startSection,
        endSection: entry.endSection,
        weeks: entry.weeks.slice(),
        location: entry.location
      });
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function buildPayloadCourses(courses, totalWeeks) {
    return courses.map(function (course) {
      return {
        name: course.name,
        teacher: course.teacher,
        color: course.color,
        schedules: course.schedules.map(function (schedule) {
          var rule = weeksToRule(schedule.weeks, totalWeeks);
          return {
            dayOfWeek: schedule.dayOfWeek,
            startSection: schedule.startSection,
            endSection: schedule.endSection,
            weekRuleType: rule.type,
            weekNumbers: rule.weeks,
            location: schedule.location
          };
        }).map(function (schedule) {
          if (!schedule.weekNumbers) delete schedule.weekNumbers;
          return schedule;
        })
      };
    });
  }

  function weeksToRule(weeks, totalWeeks) {
    var sorted = uniqueSorted(weeks);
    if (sorted.length === totalWeeks && sorted[0] === 1 && sorted[sorted.length - 1] === totalWeeks && isContiguous(sorted)) {
      return { type: 'every' };
    }
    if (isContiguous(sorted)) {
      return { type: 'continuous', weeks: [sorted[0], sorted[sorted.length - 1]] };
    }
    var allOdds = range(1, totalWeeks).filter(function (w) { return w % 2 === 1; });
    var allEvens = range(1, totalWeeks).filter(function (w) { return w % 2 === 0; });
    if (arraysEqual(sorted, allOdds)) return { type: 'odd' };
    if (arraysEqual(sorted, allEvens)) return { type: 'even' };
    return { type: 'specified', weeks: sorted };
  }

  function detectSemester(doc) {
    var select = doc.querySelector('select#xnxq01id, select[name="xnxq01id"], select[name*="xnxq"]');
    var name = '';
    var code = '';
    if (select) {
      var option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      if (option) {
        name = cleanText(option.textContent || option.innerText);
        code = cleanText(option.value);
      }
    }
    if (!name) {
      var match = cleanText(doc.body ? doc.body.innerText : '').match(/20\d{2}\s*[-—]\s*20\d{2}\s*[-—]\s*[12]/);
      if (match) name = match[0].replace(/\s/g, '').replace(/—/g, '-');
    }
    if (!code) code = name;
    return { name: name || '强智教务导入学期', code: code || '' };
  }

  function findTimetableTable(doc) {
    return doc.querySelector('table#kbtable') || Array.prototype.slice.call(doc.querySelectorAll('table')).find(function (table) {
      return !!table.querySelector('.kbcontent');
    }) || null;
  }

  function selectedSpecificWeek(doc) {
    var select = doc.querySelector('select#zc, select[name="zc"]');
    if (!select) return 0;
    var value = parseInt(select.value, 10);
    return value > 0 ? value : 0;
  }

  function switchToAllWeeks(doc) {
    var select = doc.querySelector('select#zc, select[name="zc"]');
    if (!select) return false;
    var emptyOption = Array.prototype.slice.call(select.options).find(function (option) {
      return !option.value || /全部/.test(option.textContent);
    });
    if (!emptyOption) return false;
    select.value = emptyOption.value;
    var form = select.form || doc.querySelector('form#Form1, form[name="Form1"]');
    if (form && typeof form.submit === 'function') {
      form.submit();
      return true;
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function buildCommonTimetableUrl(currentUrl, originalUrl) {
    var candidates = [currentUrl, originalUrl].filter(Boolean);
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        var parsed = new URL(candidates[i]);
        if (!isWebProtocol(parsed.protocol)) continue;
        var match = parsed.pathname.match(/^(.*?\/jsxsd)(?:\/|$)/i);
        var base = match ? parsed.origin + match[1] : parsed.origin + '/jsxsd';
        return base.replace(/\/$/, '') + '/xskb/xskb_list.do';
      } catch (_) {}
    }
    return '';
  }

  function isWebProtocol(protocol) {
    return protocol === 'http:' || protocol === 'https:';
  }

  function normalizeUserUrl(raw) {
    var value = cleanText(raw);
    if (!value) return { ok: false, error: '请输入教务系统网址' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
      return { ok: false, error: '只支持 HTTP 或 HTTPS 教务系统网址' };
    }
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    try {
      var parsed = new URL(value);
      if (!isWebProtocol(parsed.protocol)) return { ok: false, error: '只支持 HTTP 或 HTTPS 教务系统网址' };
      if (!parsed.hostname) return { ok: false, error: '网址缺少有效域名' };
      return { ok: true, url: parsed.href };
    } catch (_) {
      return { ok: false, error: '网址格式无效' };
    }
  }

  function guessSemesterStartDate(code) {
    var match = String(code || '').match(/(20\d{2})\s*[-—]\s*(20\d{2})\s*[-—]\s*([12])/);
    var date;
    if (match) {
      var year = parseInt(match[3] === '1' ? match[1] : match[2], 10);
      date = match[3] === '1' ? new Date(year, 8, 1) : new Date(year, 1, 20);
    } else {
      date = new Date();
    }
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return localIsoDate(date);
  }

  function getCurrentSemesterInfo() {
    try {
      var info = JSON.parse(XHP.getSemesterInfo());
      return {
        totalWeeks: parseInt(info.totalWeeks, 10) || 0,
        sectionCount: parseInt(info.sectionCount, 10) || 0,
        startDate: info.startDate || null,
        currentWeek: parseInt(info.currentWeek, 10) || 0
      };
    } catch (_) {
      return { totalWeeks: 0, sectionCount: 0, startDate: null, currentWeek: 0 };
    }
  }

  function readState() {
    try {
      if (typeof window.name !== 'string' || window.name.indexOf(STATE_PREFIX) !== 0) return {};
      return JSON.parse(window.name.slice(STATE_PREFIX.length)) || {};
    } catch (_) {
      return {};
    }
  }

  function writeState(nextState) {
    window.name = STATE_PREFIX + JSON.stringify(nextState || {});
  }

  function htmlLines(element) {
    var clone = element.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('br')).forEach(function (br) {
      br.parentNode.replaceChild(document.createTextNode('\n'), br);
    });
    return String(clone.textContent || '')
      .split(/\n+/)
      .map(cleanText)
      .filter(function (line) { return line && line !== '&nbsp;' && !/^-{5,}$/.test(line); });
  }

  function textFromTitled(elements, keywords) {
    for (var i = 0; i < elements.length; i += 1) {
      var title = cleanText(elements[i].getAttribute('title'));
      if (keywords.some(function (keyword) { return title.indexOf(keyword) >= 0; })) {
        return cleanText(elements[i].textContent);
      }
    }
    return '';
  }

  function looksLikeWeekOrSection(text) {
    var value = cleanText(text);
    return (/\d/.test(value) && (/周|节|单|双|[\[【]/.test(value)));
  }

  function firstMatching(list, predicate) {
    for (var i = 0; i < list.length; i += 1) {
      if (predicate(list[i])) return list[i];
    }
    return '';
  }

  function normalizeSymbols(value) {
    return cleanText(value)
      .replace(/[，、]/g, ',')
      .replace(/[—–－~～至]/g, '-')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/【/g, '[')
      .replace(/】/g, ']');
  }

  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanNullable(value) {
    var cleaned = cleanText(value);
    return cleaned || null;
  }

  function uniqueSorted(values) {
    var seen = {};
    return values.filter(function (value) {
      if (!Number.isFinite(value) || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort(function (a, b) { return a - b; });
  }

  function isContiguous(values) {
    if (!values.length) return false;
    for (var i = 1; i < values.length; i += 1) {
      if (values[i] !== values[i - 1] + 1) return false;
    }
    return true;
  }

  function range(start, end) {
    var result = [];
    for (var i = start; i <= end; i += 1) result.push(i);
    return result;
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  function hashString(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash) + value.charCodeAt(i) | 0;
    return hash;
  }

  function parsePositiveInt(value) {
    var parsed = parseInt(value, 10);
    return parsed > 0 ? parsed : 0;
  }

  function isIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T00:00:00');
    return !Number.isNaN(date.getTime()) && localIsoDate(date) === value;
  }

  function localIsoDate(date) {
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function safeCallNumber(name, fallback) {
    try { return typeof XHP[name] === 'function' ? Number(XHP[name]()) : fallback; } catch (_) { return fallback; }
  }

  function safeCallString(name, fallback) {
    try { return typeof XHP[name] === 'function' ? String(XHP[name]()) : fallback; } catch (_) { return fallback; }
  }

  function valueOf(id) {
    var element = document.getElementById(id);
    return element ? String(element.value || '') : '';
  }

  function showInlineError(id, message) {
    var element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function showToolbarStatus(message, error) {
    var element = document.getElementById('qz-fab-status');
    if (!element) return;
    element.textContent = message;
    element.style.color = error ? '#B42318' : '#52606D';
  }

  function removeById(id) {
    var element = document.getElementById(id);
    if (element && typeof element.__xhpViewportCleanup === 'function') {
      element.__xhpViewportCleanup();
    }
    if (element && element.parentNode) element.parentNode.removeChild(element);
  }

  function appendToDocument(element) {
    // Keep plugin UI outside the target page's <body>. Some school/login pages
    // apply opacity, filters, transforms or broad `div` rules to body children,
    // which would otherwise make the injected card translucent or distorted.
    var parent = document.documentElement || document.body;
    parent.appendChild(element);
  }
  function visibleViewportRect() {
    var viewport = window.visualViewport;
    return {
      left: viewport ? viewport.offsetLeft : 0,
      top: viewport ? viewport.offsetTop : 0,
      width: viewport ? viewport.width : Math.min(window.innerWidth, document.documentElement.clientWidth),
      height: viewport ? viewport.height : Math.min(window.innerHeight, document.documentElement.clientHeight)
    };
  }

  function watchVisualViewport(element, update) {
    var frame = 0;
    var viewport = window.visualViewport;

    function schedule() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        frame = 0;
        if (element.isConnected) update();
      });
    }

    function cleanup() {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (viewport) {
        viewport.removeEventListener('resize', schedule);
        viewport.removeEventListener('scroll', schedule);
      }
    }

    element.__xhpViewportCleanup = cleanup;
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    if (viewport) {
      viewport.addEventListener('resize', schedule);
      viewport.addEventListener('scroll', schedule);
    }
    schedule();
  }

  function pinOverlayToVisualViewport(element) {
    watchVisualViewport(element, function () {
      var viewport = visibleViewportRect();
      element.classList.toggle('qz-visual-compact', viewport.width < 520);
      element.style.setProperty('position', 'fixed', 'important');
      element.style.setProperty('inset', 'auto', 'important');
      element.style.setProperty('left', viewport.left + 'px', 'important');
      element.style.setProperty('top', viewport.top + 'px', 'important');
      element.style.setProperty('width', viewport.width + 'px', 'important');
      element.style.setProperty('height', viewport.height + 'px', 'important');
    });
  }

  function pinToolbarToVisualViewport(element) {
    watchVisualViewport(element, function () {
      var viewport = visibleViewportRect();
      var panel = element.querySelector('.qz-fab-panel');
      var margin = 12;
      if (panel) {
        panel.style.setProperty(
          'width',
          Math.min(230, Math.max(176, viewport.width - margin * 2)) + 'px',
          'important'
        );
      }
      var bounds = element.getBoundingClientRect();
      element.style.setProperty('right', 'auto', 'important');
      element.style.setProperty('bottom', 'auto', 'important');
      element.style.setProperty(
        'left',
        viewport.left + Math.max(margin, viewport.width - bounds.width - margin) + 'px',
        'important'
      );
      element.style.setProperty(
        'top',
        viewport.top + Math.max(margin, viewport.height - bounds.height - margin) + 'px',
        'important'
      );
    });
  }


  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function log(message) {
    try { XHP.log('[QiangZhi] ' + message); } catch (_) {}
  }

  function exposeTestApi() {
    window.__QZ_XHP_INTERNALS__ = {
      parseTimetable: parseTimetable,
      parseWeeks: parseWeeks,
      parseSections: parseSections,
      weeksToRule: weeksToRule,
      buildCommonTimetableUrl: buildCommonTimetableUrl,
      buildLoginEntryUrl: buildLoginEntryUrl,
      detectSessionFailure: detectSessionFailure,
      looksLikeLoginPage: looksLikeLoginPage,
      normalizeUserUrl: normalizeUserUrl,
      isWebProtocol: isWebProtocol,
      renderBootstrap: renderBootstrap
    };
  }

  function baseCss() {
    return '' +
      '#' + ROOT_ID + ',#' + ROOT_ID + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;opacity:1!important;filter:none!important;-webkit-filter:none!important;mix-blend-mode:normal!important;text-shadow:none!important}' +
      '#' + ROOT_ID + '{all:initial!important;position:fixed!important;inset:0!important;display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;z-index:2147483646!important;color:#17212B!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;transform:none!important;isolation:isolate!important;pointer-events:auto!important}' +
      '#' + ROOT_ID + ' div{width:auto;margin:0;padding:0;background:transparent;border:0;border-radius:0;box-shadow:none;transform:none}' +
      '#' + ROOT_ID + ' p,#' + ROOT_ID + ' h1,#' + ROOT_ID + ' h2{width:auto;padding:0}' +
      '#' + ROOT_ID + ' .qz-page,#' + ROOT_ID + ' .qz-overlay{position:absolute!important;inset:0!important;display:flex!important;width:auto!important;height:auto!important;margin:0!important;align-items:center;justify-content:center;padding:20px;background:#F4F7FC!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;transform:none!important}' +
      '#' + ROOT_ID + ' .qz-page{background:linear-gradient(145deg,#EEF4FF,#F7F9FC 45%,#EEF8F5)!important}' +
      '#' + ROOT_ID + ' .qz-overlay{background:rgba(17,24,39,.62)!important;overflow:auto;align-items:flex-start;padding-top:28px;padding-bottom:28px}' +
      '#' + ROOT_ID + ' .qz-card{width:min(100%,540px)!important;max-width:540px!important;height:auto!important;margin:0!important;background:#FFF!important;border:1px solid rgba(17,24,39,.08)!important;border-radius:22px!important;box-shadow:0 24px 80px rgba(15,23,42,.28)!important;padding:24px!important;position:relative!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;transform:none!important;mix-blend-mode:normal!important;isolation:isolate!important}' +
      '#' + ROOT_ID + ' .qz-bootstrap-card{padding:30px}' +
      '#' + ROOT_ID + ' h1,#' + ROOT_ID + ' h2{margin:6px 0 10px;line-height:1.2;color:#0F172A}' +
      '#' + ROOT_ID + ' h1{font-size:30px}#' + ROOT_ID + ' h2{font-size:24px}' +
      '#' + ROOT_ID + ' .qz-eyebrow{font-size:12px;font-weight:750;letter-spacing:.08em;color:#3569D4;text-transform:uppercase}' +
      '#' + ROOT_ID + ' .qz-muted{font-size:14px;line-height:1.65;color:#52606D;margin:0 0 22px}' +
      '#' + ROOT_ID + ' .qz-label{display:block;font-size:13px;font-weight:650;color:#344054;margin:14px 0 7px}' +
      '#' + ROOT_ID + ' .qz-label small{display:block;font-size:11px;font-weight:400;color:#667085;margin-top:5px}' +
      '#' + ROOT_ID + ' .qz-input{display:block;width:100%;height:48px;border:1px solid #CDD5DF;border-radius:12px;background:#FFF;color:#17212B;padding:0 14px;font-size:15px;outline:none;margin-top:7px}' +
      '#' + ROOT_ID + ' .qz-input:focus{border-color:#4777E7;box-shadow:0 0 0 3px rgba(71,119,231,.14)}' +
      '#' + ROOT_ID + ' .qz-button{width:100%;height:50px;border:0;border-radius:13px;font-size:15px;font-weight:750;cursor:pointer;margin-top:18px}' +
      '#' + ROOT_ID + ' .qz-primary{background:#3569D4;color:#FFF;box-shadow:0 8px 22px rgba(53,105,212,.25)}' +
      '#' + ROOT_ID + ' .qz-button:disabled{opacity:.55!important;cursor:not-allowed}' +
      '#' + ROOT_ID + ' .qz-note{font-size:12px;line-height:1.55;color:#667085;margin-top:14px}' +
      '#' + ROOT_ID + ' .qz-error{font-size:13px;line-height:1.5;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:10px;padding:10px 12px;margin-top:12px}' +
      '#' + ROOT_ID + ' .qz-close{position:absolute;right:14px;top:12px;width:36px;height:36px;border:0;border-radius:50%;background:#F2F4F7;color:#475467;font-size:24px;line-height:30px;cursor:pointer}' +
      '#' + ROOT_ID + ' .qz-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}' +
      '#' + ROOT_ID + ' .qz-summary>div{background:#F7F9FC;border:1px solid #EAECF0;border-radius:13px;padding:12px;text-align:center}' +
      '#' + ROOT_ID + ' .qz-summary strong{display:block;font-size:22px;color:#1D4ED8}#' + ROOT_ID + ' .qz-summary span{font-size:11px;color:#667085}' +
      '#' + ROOT_ID + ' .qz-detected{background:#F8FAFC;border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#475467}' +
      '#' + ROOT_ID + ' .qz-course-preview{margin-top:5px;color:#667085}' +
      '#' + ROOT_ID + ' .qz-choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}' +
      '#' + ROOT_ID + ' .qz-choice{display:flex;gap:10px;align-items:flex-start;border:1px solid #D0D5DD;border-radius:14px;padding:13px;cursor:pointer;background:#FFF}' +
      '#' + ROOT_ID + ' .qz-choice:has(input:checked){border-color:#3569D4;background:#F0F5FF;box-shadow:0 0 0 2px rgba(53,105,212,.08)}' +
      '#' + ROOT_ID + ' .qz-choice input{margin-top:3px;accent-color:#3569D4}' +
      '#' + ROOT_ID + ' .qz-choice b{display:block;font-size:14px;color:#1D2939}#' + ROOT_ID + ' .qz-choice small{display:block;font-size:11px;line-height:1.45;color:#667085;margin-top:4px}' +
      '#' + ROOT_ID + ' .qz-disabled{opacity:.52!important;cursor:not-allowed}' +
      '#' + ROOT_ID + ' .qz-fields{margin-top:14px;padding-top:2px;border-top:1px solid #EAECF0}' +
      '#' + ROOT_ID + ' .qz-two-columns{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '#' + ROOT_ID + ' .qz-dialog{max-height:calc(100% - 16px)!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-page,#' + ROOT_ID + '.qz-visual-compact .qz-overlay{padding:8px!important;align-items:center!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-card{padding:16px!important;border-radius:18px!important;max-width:none!important}' +
      '#' + ROOT_ID + '.qz-visual-compact h1{font-size:24px!important}#' + ROOT_ID + '.qz-visual-compact h2{font-size:20px!important;margin:2px 0 8px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-eyebrow{font-size:10px!important}#' + ROOT_ID + '.qz-visual-compact .qz-muted{font-size:12px!important;line-height:1.5!important;margin-bottom:14px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-summary{gap:6px!important;margin:10px 0!important}#' + ROOT_ID + '.qz-visual-compact .qz-summary>div{padding:8px 4px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-summary strong{font-size:18px!important}#' + ROOT_ID + '.qz-visual-compact .qz-detected{padding:9px 10px!important;font-size:11px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-choice-grid{gap:6px!important;margin-top:10px!important}#' + ROOT_ID + '.qz-visual-compact .qz-choice{padding:9px!important;gap:7px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-choice b{font-size:12px!important}#' + ROOT_ID + '.qz-visual-compact .qz-choice small{font-size:10px!important;margin-top:2px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-fields{margin-top:9px!important}#' + ROOT_ID + '.qz-visual-compact .qz-label{font-size:11px!important;margin:8px 0 4px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-input{height:40px!important;font-size:13px!important;margin-top:4px!important}#' + ROOT_ID + '.qz-visual-compact .qz-button{height:44px!important;font-size:13px!important;margin-top:12px!important}' +
      '#' + ROOT_ID + '.qz-visual-compact .qz-note{font-size:10px!important;line-height:1.4!important;margin-top:8px!important}#' + ROOT_ID + '.qz-visual-compact .qz-close{width:32px!important;height:32px!important;right:10px!important;top:9px!important;font-size:21px!important}' +
      '@media(max-width:520px){#' + ROOT_ID + ' .qz-card{padding:20px;border-radius:18px}#' + ROOT_ID + ' .qz-choice-grid{grid-template-columns:1fr}#' + ROOT_ID + ' .qz-summary{gap:6px}#' + ROOT_ID + ' .qz-summary>div{padding:10px 6px}}';
  }

  function toolbarCss() {
    return '' +
      '#' + TOOLBAR_ID + ',#' + TOOLBAR_ID + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;opacity:1!important;filter:none!important;-webkit-filter:none!important;mix-blend-mode:normal!important;text-shadow:none!important}' +
      '#' + TOOLBAR_ID + '{all:initial!important;position:fixed!important;right:14px!important;bottom:18px!important;display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;z-index:2147483645!important;color:#17212B!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;transform:none!important;isolation:isolate!important;pointer-events:auto!important}' +
      '#' + TOOLBAR_ID + ' div{margin:0;padding:0;border:0;box-shadow:none;transform:none}' +
      '#' + TOOLBAR_ID + ' .qz-fab-panel{width:230px!important;margin:0!important;padding:14px!important;background:#FFF!important;border:1px solid rgba(17,24,39,.12)!important;border-radius:17px!important;box-shadow:0 14px 45px rgba(15,23,42,.25)!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
      '#' + TOOLBAR_ID + ' .qz-fab-title{font-size:14px;font-weight:750;color:#0F172A}' +
      '#' + TOOLBAR_ID + ' .qz-fab-status{font-size:11px;line-height:1.45;color:#52606D;margin:4px 0 10px}' +
      '#' + TOOLBAR_ID + ' button{width:100%;height:38px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer}' +
      '#' + TOOLBAR_ID + ' .qz-fab-primary{border:0;background:#3569D4;color:#FFF}' +
      '#' + TOOLBAR_ID + ' .qz-fab-secondary{border:1px solid #D0D5DD;background:#FFF;color:#475467;margin-top:7px}';
  }
})();
