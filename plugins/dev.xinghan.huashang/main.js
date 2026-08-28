(function () {
  'use strict';

  var HUASHANG_ORIGIN = 'https://jwxt.gzhs.edu.cn';
  // Strong-Wisdom must first enter the /jsxsd/ root so the server can create
  // the login session cookie. Opening xskb_list.do directly without that cookie
  // returns {\"flag1\":2,\"msgContent\":\"请先刷新网页\"}.
  var LOGIN_ENTRY_URL = HUASHANG_ORIGIN + '/jsxsd/';
  var TIMETABLE_URL = HUASHANG_ORIGIN + '/jsxsd/xskb/xskb_list.do';
  var CALENDAR_URL = HUASHANG_ORIGIN + '/jsxsd/jxzl/jxzl_query';
  var PLUGIN_VERSION = '1.0.2';
  var MAX_SECTION_COUNT = 13;
  var RUN_KEY = '__xhp_huashang_import_running__';
  var SUBMITTED_KEY = '__xhp_huashang_import_submitted__';
  var REDIRECT_KEY = '__xhp_huashang_redirect_count__';
  var STATUS_ID = 'xhp-huashang-status';
  var CAMPUS_DIALOG_ID = 'xhp-huashang-campus-dialog';
  var DEBUG_BUTTON_ID = 'xhp-huashang-debug-button';
  var DEBUG_DIALOG_ID = 'xhp-huashang-debug-dialog';
  var TEST_MODE = !!window.__XHP_HUASHANG_TEST_MODE__;
  var COLOR_PALETTE = [
    '#DDEBFF', '#DDF4EE', '#F3E6FA', '#FFF0D8',
    '#FFE4E1', '#E7E5FF', '#DFF3F8', '#F1E8D8'
  ];

  // The Huashang timetable groups physical rows differently after section 8.
  // These labels are only a fallback: the detailed "周次(节次)" field remains
  // authoritative whenever it contains an explicit bracketed section list.
  var HUASHANG_ROW_SECTIONS = {
    '第一二节': [1, 2],
    '第三四节': [3, 4],
    '第五六节': [5, 6],
    '第七八节': [7, 8],
    '第九十十一节': [9, 10, 11],
    '第十二十三节': [12, 13]
  };

  var KNOWN_SEMESTER_STARTS = {
    '2026-2027-1': '2026-08-31'
  };

  var SECTION_TIMES = {
    guangzhou: [
      section(1, '08:30', '09:15'),
      section(2, '09:20', '10:05'),
      section(3, '10:20', '11:05'),
      section(4, '11:10', '11:55'),
      section(5, '14:10', '14:55'),
      section(6, '15:00', '15:45'),
      section(7, '16:00', '16:45'),
      section(8, '16:50', '17:35'),
      section(9, '18:45', '19:30'),
      section(10, '19:40', '20:25'),
      section(11, '20:35', '21:20'),
      section(12, '21:30', '22:15'),
      section(13, '22:25', '23:10')
    ],
    zhaoqing: [
      section(1, '08:40', '09:25'),
      section(2, '09:30', '10:15'),
      section(3, '10:30', '11:15'),
      section(4, '11:20', '12:05'),
      section(5, '14:00', '14:45'),
      section(6, '14:50', '15:35'),
      section(7, '15:45', '16:30'),
      section(8, '16:35', '17:20'),
      section(9, '18:45', '19:30'),
      section(10, '19:40', '20:25'),
      section(11, '20:35', '21:20'),
      section(12, '21:30', '22:15'),
      section(13, '22:25', '23:10')
    ]
  };

  var CAMPUS_RULES = {
    guangzhou: [
      /广州校区|增城校区|增城/i,
      /励志楼|厚德楼|创新楼|启智楼|博学楼|创科楼|院士楼|弘美楼/i,
      /华科中心|华科A\d|华商会议展览中心|会展-/i
    ],
    zhaoqing: [
      /肇庆校区|四会校区|四会/i,
      /(?:^|[^0-9])(?:6|7|8|16|17|27)号楼(?:[^0-9]|$)/i
    ]
  };

  if (typeof XHP === 'undefined') {
    console.error('[Huashang XHP] XHP bridge is unavailable');
    return;
  }

  var apiVersion = safeCallNumber('getApiVersion', 1);
  var runtimeMode = apiVersion >= 3 ? safeCallString('getRuntimeMode', 'web') : 'web';
  var activation = safeJsonCall('getActivationContext', { mode: runtimeMode, actionId: null });

  exposeTestApi();
  log('page=' + window.location.href + ', mode=' + runtimeMode + ', action=' + (activation.actionId || 'none'));

  if (TEST_MODE) return;

  if (runtimeMode === 'web') {
    handleWeb();
  } else {
    fail('当前插件仅支持可见网页登录导入');
  }

  function handleWeb() {
    installNavigationCompatibility();

    var sessionIssue = detectSessionFailure(document);
    if (sessionIssue) {
      clearRedirectCount();
      // Do not reload the failing timetable URL. The generic Strong-Wisdom
      // plugin returns to /jsxsd/ here, which is the endpoint that creates a
      // fresh JSESSIONID and displays the actual login page.
      if (!isLoginEntryPage()) {
        renderStatus('教务系统尚未建立登录会话，正在进入登录页……', false);
        window.setTimeout(function () { navigateToLoginEntry(true); }, 120);
        return;
      }
      renderStatus(sessionIssue, true, '重新进入登录页', function () {
        navigateToLoginEntry(true);
      });
      return;
    }

    if (looksLikeLoginPage(document)) {
      clearRedirectCount();
      renderStatus('请完成教务系统登录；登录成功后会自动读取并提交当前学期课表。', false);
      return;
    }

    if (!findTimetableTable(document)) {
      renderStatus('登录状态有效，正在打开当前学期课表……', false);
      navigateToTimetableOrFail();
      return;
    }

    clearRedirectCount();
    installDebugExporter();
    renderStatus('已识别课表，正在自动解析……', false);
    window.setTimeout(function () { runImport(); }, 120);
  }

  function navigateToLoginEntry(replaceHistory) {
    clearRedirectCount();
    window.setTimeout(function () {
      if (replaceHistory) window.location.replace(LOGIN_ENTRY_URL);
      else window.location.assign(LOGIN_ENTRY_URL);
    }, 20);
  }

  function isLoginEntryPage() {
    try {
      var url = new URL(window.location.href);
      var path = url.pathname.replace(/\/+$/, '');
      return url.origin === HUASHANG_ORIGIN && path === '/jsxsd';
    } catch (_) {
      return false;
    }
  }

  function navigateToTimetableOrFail() {
    var count = readRedirectCount();
    if (count >= 2) {
      renderStatus('未能自动进入课表页面，请重新登录后再试。', true, '重新登录', function () {
        navigateToLoginEntry(true);
      });
      return;
    }
    writeRedirectCount(count + 1);
    window.setTimeout(function () { window.location.assign(TIMETABLE_URL); }, 180);
  }

  function runImport() {
    if (window[RUN_KEY] || window[SUBMITTED_KEY]) return;
    window[RUN_KEY] = true;

    try {
      var selectedWeek = selectedSpecificWeek(document);
      if (selectedWeek && switchToAllWeeks(document)) {
        window[RUN_KEY] = false;
        return;
      }

      var parsed = parseTimetable(document);
      if (!parsed.courses.length) throw new Error('没有识别到课程，请确认教务系统当前学期已有课表');

      var currentSemester = getCurrentSemesterInfo();
      var calendarResult = readAcademicCalendar(parsed.semester.code);
      var semesterMeta = calendarResult.meta || fallbackSemesterMeta(parsed, currentSemester);
      var selectedTimeModeCampus = detectCampusFromTimeMode(document);
      var campus = selectedTimeModeCampus
        ? {
            campus: selectedTimeModeCampus,
            scores: { zhaoqing: 0, guangzhou: 0, unknown: 0 },
            examples: { zhaoqing: [], guangzhou: [], unknown: [] },
            mixed: false,
            tied: false
          }
        : detectCampus(parsed.courses);
      if (campus.campus === 'unknown' || campus.mixed || campus.tied) {
        window[RUN_KEY] = false;
        renderCampusChooser(parsed, currentSemester, semesterMeta, calendarResult, campus);
        return;
      }
      submitImport(
        parsed,
        currentSemester,
        semesterMeta,
        calendarResult,
        campus.campus,
        selectedTimeModeCampus ? 'time-mode' : 'location'
      );
    } catch (error) {
      window[RUN_KEY] = false;
      log('import failed: ' + (error && error.message ? error.message : String(error)));
      renderStatus(
        '自动导入失败：' + (error && error.message ? error.message : '未知错误'),
        true,
        '重试',
        function () {
          removeStatus();
          runImport();
        }
      );
    }
  }

  function submitImport(parsed, currentSemester, semesterMeta, calendarResult, campusKey, source) {
    if (window[SUBMITTED_KEY]) return;
    var campus = { campus: campusKey, mixed: false, tied: false };
    var payload = buildImportPayload(parsed, currentSemester, semesterMeta, campus);

    window[SUBMITTED_KEY] = true;
    window[RUN_KEY] = false;
    removeCampusChooser();
    log(
      'submit courses=' + payload.courses.length +
      ', schedules=' + parsed.scheduleCount +
      ', semester=' + semesterMeta.name +
      ', campus=' + campusKey +
      ', campusSource=' + source +
      ', calendar=' + (calendarResult.exact ? 'exact' : 'fallback')
    );

    var status = campusStatusText(campus);
    if (!calendarResult.exact) status += '；校历读取失败，已使用可用的学期信息';
    toast(status);
    XHP.submitCourses(JSON.stringify(payload));
  }

  function renderCampusChooser(parsed, currentSemester, semesterMeta, calendarResult, detected) {
    removeCampusChooser();
    var root = document.createElement('div');
    root.id = CAMPUS_DIALOG_ID;
    root.innerHTML = '' +
      '<style>' + campusDialogCss() + '</style>' +
      '<div class="hs-campus-mask">' +
        '<div class="hs-campus-card" role="dialog" aria-modal="true" aria-labelledby="hs-campus-title">' +
          '<div class="hs-campus-kicker">广州华商学院 · 双校区作息</div>' +
          '<h2 id="hs-campus-title">选择你的上课校区</h2>' +
          '<p>课表地点未能可靠区分校区。选择后会自动写入对应的 13 节上课时间，不会修改课程地点。</p>' +
          '<label class="hs-campus-option">' +
            '<input type="radio" name="hs-campus" value="guangzhou">' +
            '<span><b>广州校区</b><small>第 1 节 08:30 开始 · 下午第 5 节 14:10</small></span>' +
          '</label>' +
          '<label class="hs-campus-option">' +
            '<input type="radio" name="hs-campus" value="zhaoqing">' +
            '<span><b>肇庆校区</b><small>第 1 节 08:40 开始 · 下午第 5 节 14:00</small></span>' +
          '</label>' +
          '<div id="hs-campus-error" class="hs-campus-error" hidden>请先选择上课校区</div>' +
          '<div class="hs-campus-actions">' +
            '<button id="hs-campus-cancel" class="hs-campus-secondary" type="button">稍后再导入</button>' +
            '<button id="hs-campus-submit" class="hs-campus-primary" type="button">按此校区导入</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.documentElement || document.body).appendChild(root);

    document.getElementById('hs-campus-cancel').addEventListener('click', function () {
      removeCampusChooser();
      renderStatus('已取消本次导入；重新进入课表页面后可再次选择校区。', false, '重新解析', function () {
        removeStatus();
        runImport();
      });
    });
    document.getElementById('hs-campus-submit').addEventListener('click', function () {
      var selected = root.querySelector('input[name="hs-campus"]:checked');
      var error = document.getElementById('hs-campus-error');
      if (!selected) {
        error.hidden = false;
        return;
      }
      error.hidden = true;
      submitImport(parsed, currentSemester, semesterMeta, calendarResult, selected.value, 'manual');
    });
  }

  function removeCampusChooser() {
    var existing = document.getElementById(CAMPUS_DIALOG_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function campusDialogCss() {
    return '' +
      '#' + CAMPUS_DIALOG_ID + ',#' + CAMPUS_DIALOG_ID + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}' +
      '#' + CAMPUS_DIALOG_ID + '{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;color:#17212B!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-mask{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:16px!important;background:rgba(15,23,42,.58)!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-card{width:min(100%,430px)!important;max-height:calc(100% - 24px)!important;overflow:auto!important;padding:22px!important;background:#FFF!important;border:1px solid rgba(15,23,42,.1)!important;border-radius:22px!important;box-shadow:0 24px 70px rgba(15,23,42,.32)!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-kicker{font-size:11px!important;font-weight:750!important;letter-spacing:.06em!important;color:#3569D4!important}' +
      '#' + CAMPUS_DIALOG_ID + ' h2{margin:6px 0 8px!important;font-size:22px!important;line-height:1.3!important;color:#0F172A!important}' +
      '#' + CAMPUS_DIALOG_ID + ' p{margin:0 0 15px!important;font-size:13px!important;line-height:1.55!important;color:#52606D!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-option{display:flex!important;align-items:flex-start!important;gap:10px!important;margin-top:10px!important;padding:13px!important;border:1px solid #D0D5DD!important;border-radius:14px!important;background:#FFF!important;cursor:pointer!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-option:has(input:checked){border-color:#3569D4!important;background:#F0F5FF!important;box-shadow:0 0 0 2px rgba(53,105,212,.1)!important}' +
      '#' + CAMPUS_DIALOG_ID + ' input{margin-top:3px!important;accent-color:#3569D4!important}' +
      '#' + CAMPUS_DIALOG_ID + ' b{display:block!important;font-size:15px!important;color:#1D2939!important}' +
      '#' + CAMPUS_DIALOG_ID + ' small{display:block!important;margin-top:3px!important;font-size:11px!important;line-height:1.45!important;color:#667085!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-error{margin-top:10px!important;font-size:12px!important;color:#B42318!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-actions{display:grid!important;grid-template-columns:1fr 1.25fr!important;gap:9px!important;margin-top:18px!important}' +
      '#' + CAMPUS_DIALOG_ID + ' button{height:44px!important;border-radius:12px!important;font-size:13px!important;font-weight:700!important;cursor:pointer!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-secondary{border:1px solid #D0D5DD!important;background:#FFF!important;color:#475467!important}' +
      '#' + CAMPUS_DIALOG_ID + ' .hs-campus-primary{border:0!important;background:#3569D4!important;color:#FFF!important;box-shadow:0 8px 20px rgba(53,105,212,.22)!important}';
  }

  function installDebugExporter() {
    if (document.getElementById(DEBUG_BUTTON_ID)) return;
    var button = document.createElement('button');
    button.id = DEBUG_BUTTON_ID;
    button.type = 'button';
    button.textContent = '导出调试数据';
    button.setAttribute('style', [
      'all:initial',
      'position:fixed',
      'left:12px',
      'bottom:12px',
      'z-index:2147483646',
      'height:40px',
      'padding:0 14px',
      'border:1px solid rgba(53,105,212,.24)',
      'border-radius:12px',
      'background:#fff',
      'box-shadow:0 10px 28px rgba(15,23,42,.2)',
      'color:#2457b8',
      'font:700 12px/40px -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif',
      'cursor:pointer'
    ].join('!important;') + '!important');
    button.addEventListener('click', renderDebugDialog);
    (document.documentElement || document.body).appendChild(button);
  }

  function renderDebugDialog() {
    removeDebugDialog();
    var root = document.createElement('div');
    root.id = DEBUG_DIALOG_ID;
    root.innerHTML = '' +
      '<style>' + debugDialogCss() + '</style>' +
      '<div class="hs-debug-mask">' +
        '<div class="hs-debug-card" role="dialog" aria-modal="true" aria-labelledby="hs-debug-title">' +
          '<div class="hs-debug-kicker">华商插件 · 页面诊断</div>' +
          '<h2 id="hs-debug-title">导出调试数据</h2>' +
          '<p>默认只保留课表结构、节次、周次、学期和时间模式。不会导出 Cookie、账号、密码或网址参数。</p>' +
          '<label class="hs-debug-private"><input id="hs-debug-private" type="checkbox"><span>包含完整课表文字（可能包含课程、教师和地点，仅在你愿意提供时勾选）</span></label>' +
          '<textarea id="hs-debug-output" readonly spellcheck="false"></textarea>' +
          '<div class="hs-debug-actions">' +
            '<button id="hs-debug-close" class="hs-debug-secondary" type="button">关闭</button>' +
            '<button id="hs-debug-copy" class="hs-debug-primary" type="button">复制 JSON</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.documentElement || document.body).appendChild(root);

    var output = root.querySelector('#hs-debug-output');
    var privateToggle = root.querySelector('#hs-debug-private');
    function refresh() {
      try {
        output.value = JSON.stringify(buildDebugSnapshot(document, privateToggle.checked), null, 2);
      } catch (error) {
        output.value = JSON.stringify({ error: String(error && error.message ? error.message : error) }, null, 2);
      }
    }
    refresh();
    privateToggle.addEventListener('change', refresh);
    root.querySelector('#hs-debug-close').addEventListener('click', removeDebugDialog);
    root.querySelector('#hs-debug-copy').addEventListener('click', function () {
      copyDebugText(output.value, output);
    });
  }

  function debugDialogCss() {
    return '' +
      '#' + DEBUG_DIALOG_ID + ',#' + DEBUG_DIALOG_ID + ' *{box-sizing:border-box!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif!important}' +
      '#' + DEBUG_DIALOG_ID + '{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;color:#17212b!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-mask{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:14px!important;background:rgba(15,23,42,.6)!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-card{width:min(100%,520px)!important;max-height:calc(100% - 20px)!important;display:flex!important;flex-direction:column!important;padding:20px!important;background:#fff!important;border:1px solid rgba(15,23,42,.1)!important;border-radius:22px!important;box-shadow:0 24px 70px rgba(15,23,42,.35)!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-kicker{font-size:11px!important;font-weight:750!important;letter-spacing:.06em!important;color:#3569d4!important}' +
      '#' + DEBUG_DIALOG_ID + ' h2{margin:5px 0 7px!important;font-size:21px!important;line-height:1.3!important;color:#0f172a!important}' +
      '#' + DEBUG_DIALOG_ID + ' p{margin:0 0 11px!important;font-size:12px!important;line-height:1.55!important;color:#52606d!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-private{display:flex!important;align-items:flex-start!important;gap:8px!important;margin-bottom:10px!important;padding:10px!important;border-radius:12px!important;background:#fff8e8!important;color:#7a4b00!important;font-size:11px!important;line-height:1.45!important}' +
      '#' + DEBUG_DIALOG_ID + ' input{margin-top:2px!important;accent-color:#3569d4!important}' +
      '#' + DEBUG_DIALOG_ID + ' textarea{width:100%!important;min-height:210px!important;height:48vh!important;resize:none!important;padding:11px!important;border:1px solid #d0d5dd!important;border-radius:13px!important;background:#f8fafc!important;color:#344054!important;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace!important;outline:none!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-actions{display:grid!important;grid-template-columns:1fr 1.3fr!important;gap:9px!important;margin-top:12px!important}' +
      '#' + DEBUG_DIALOG_ID + ' button{height:43px!important;border-radius:12px!important;font-size:13px!important;font-weight:700!important;cursor:pointer!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-secondary{border:1px solid #d0d5dd!important;background:#fff!important;color:#475467!important}' +
      '#' + DEBUG_DIALOG_ID + ' .hs-debug-primary{border:0!important;background:#3569d4!important;color:#fff!important;box-shadow:0 8px 20px rgba(53,105,212,.22)!important}';
  }

  function buildDebugSnapshot(doc, includePrivateText) {
    var table = findTimetableTable(doc);
    var snapshot = {
      format: 'huashang-xhp-debug-v1',
      pluginVersion: PLUGIN_VERSION,
      capturedAt: new Date().toISOString(),
      page: safePageIdentity(),
      semester: detectSemester(doc),
      includePrivateText: !!includePrivateText,
      controls: collectDebugControls(doc),
      table: table ? collectDebugTable(table, includePrivateText) : null
    };
    if (table && includePrivateText) snapshot.table.outerHTML = table.outerHTML;
    return snapshot;
  }

  function safePageIdentity() {
    try {
      var url = new URL(window.location.href);
      return { origin: url.origin, path: url.pathname };
    } catch (_) {
      return { origin: HUASHANG_ORIGIN, path: '' };
    }
  }

  function collectDebugControls(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('select')).map(function (select) {
      var option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      return {
        id: cleanText(select.id),
        name: cleanText(select.name),
        selectedText: cleanText(option ? option.textContent : ''),
        selectedValue: cleanText(option ? option.value : '')
      };
    });
  }

  function collectDebugTable(table, includePrivateText) {
    var rows = Array.prototype.slice.call(table.rows || table.querySelectorAll('tr'));
    return {
      id: cleanText(table.id),
      className: cleanText(table.className),
      rowCount: rows.length,
      rows: rows.map(function (row, rowIndex) {
        return {
          rowIndex: rowIndex,
          cells: rowCells(row).map(function (cell, cellIndex) {
            var lines = htmlLines(cell).map(function (line, lineIndex) {
              return debugLine(line, includePrivateText, lineIndex);
            });
            return {
              cellIndex: cellIndex,
              tag: String(cell.tagName || '').toLowerCase(),
              rowSpan: parseInt(cell.rowSpan || cell.getAttribute('rowspan') || 1, 10),
              colSpan: parseInt(cell.colSpan || cell.getAttribute('colspan') || 1, 10),
              className: cleanText(cell.className),
              lines: lines,
              titled: Array.prototype.slice.call(cell.querySelectorAll('[title]')).map(function (element, titledIndex) {
                return {
                  title: cleanText(element.getAttribute('title')),
                  text: debugLine(element.textContent, includePrivateText, titledIndex)
                };
              })
            };
          })
        };
      })
    };
  }

  function debugLine(value, includePrivateText, index) {
    var text = cleanText(value);
    if (includePrivateText || isDebugStructuralText(text)) return text;
    return text ? '<内容已脱敏:' + (index + 1) + '>' : '';
  }

  function isDebugStructuralText(text) {
    if (!text) return true;
    return /星期[一二三四五六日天]|第?[一二三四五六七八九十百\d]+(?:[-—至][一二三四五六七八九十百\d]+)?大?节|\d{1,2}(?::\d{2})?\s*[-—至]\s*\d{1,2}(?::\d{2})?|\d[\d,，、\-—\s]*(?:周|节)|学年|学期|时间模式|广州校区|肇庆校区|全部周|单双周/i.test(text);
  }

  function copyDebugText(text, textarea) {
    function fallbackCopy() {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_) {}
      toast(copied ? '调试数据已复制，请粘贴保存为 JSON 后发送' : '自动复制失败，请长按文本全选复制');
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () {
        toast('调试数据已复制，请粘贴保存为 JSON 后发送');
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function removeDebugDialog() {
    var existing = document.getElementById(DEBUG_DIALOG_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function buildImportPayload(parsed, currentSemester, semesterMeta, campus) {
    var totalWeeks = Math.max(semesterMeta.totalWeeks || 0, parsed.maxWeek || 0, 1);
    var payload = {
      protocolVersion: 1,
      courses: buildPayloadCourses(parsed.courses, totalWeeks)
    };

    if (shouldCreateSemester(currentSemester, semesterMeta, parsed)) {
      payload.semester = {
        name: semesterMeta.name,
        startDate: semesterMeta.startDate,
        totalWeeks: totalWeeks,
        sectionCount: MAX_SECTION_COUNT
      };
    }

    if (campus.campus === 'zhaoqing' || campus.campus === 'guangzhou') {
      payload.sectionTimes = SECTION_TIMES[campus.campus].map(copySection);
    }
    return payload;
  }

  function shouldCreateSemester(current, target, parsed) {
    if (!current.startDate) return true;
    if (current.sectionCount > 0 && current.sectionCount !== MAX_SECTION_COUNT) return true;
    if (current.sectionCount > 0 && current.sectionCount < parsed.maxSection) return true;
    if (current.totalWeeks > 0 && current.totalWeeks < parsed.maxWeek) return true;

    var distance = Math.abs(daysBetween(current.startDate, target.startDate));
    if (distance <= 14) return false;
    if (current.currentWeek > 0) return false;
    return true;
  }

  function readAcademicCalendar(semesterCode) {
    if (!semesterCode) return { exact: false, meta: null };
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CALENDAR_URL, false);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      xhr.send('xnxq01id=' + encodeURIComponent(semesterCode));
      if (xhr.status && (xhr.status < 200 || xhr.status >= 400)) {
        throw new Error('校历请求返回 HTTP ' + xhr.status);
      }

      var doc = new DOMParser().parseFromString(xhr.responseText || '', 'text/html');
      if (looksLikeLoginPage(doc)) throw new Error('校历请求被重定向到登录页');
      var calendarTable = doc.querySelector('table#kbtable');
      if (!calendarTable) throw new Error('校历页面未找到 #kbtable');
      var dates = Array.prototype.slice.call(calendarTable.querySelectorAll('[title]'))
        .map(function (element) { return cleanText(element.getAttribute('title')); })
        .filter(isIsoDate)
        .sort();
      if (dates.length < 2) throw new Error('校历页面未包含完整日期');

      var startDate = KNOWN_SEMESTER_STARTS[semesterCode] || dates[0];
      var endDate = dates[dates.length - 1];
      var totalWeeks = Math.max(1, Math.ceil((daysBetween(startDate, endDate) + 1) / 7));
      return {
        exact: true,
        meta: {
          code: semesterCode,
          name: normalizeSemesterName(semesterCode),
          startDate: startDate,
          endDate: endDate,
          totalWeeks: totalWeeks
        }
      };
    } catch (error) {
      log('calendar fallback: ' + error.message);
      return { exact: false, meta: null };
    }
  }

  function fallbackSemesterMeta(parsed, current) {
    var code = parsed.semester.code || parsed.semester.name || '';
    if (current.startDate && current.currentWeek > 0) {
      return {
        code: code,
        name: parsed.semester.name || normalizeSemesterName(code),
        startDate: current.startDate,
        totalWeeks: Math.max(current.totalWeeks || 0, parsed.maxWeek || 0, 18)
      };
    }
    return {
      code: code,
      name: parsed.semester.name || normalizeSemesterName(code),
      startDate: guessSemesterStartDate(code),
      totalWeeks: Math.max(parsed.maxWeek || 0, 18)
    };
  }

  function detectCampus(courses) {
    var scores = { zhaoqing: 0, guangzhou: 0, unknown: 0 };
    var examples = { zhaoqing: [], guangzhou: [], unknown: [] };

    courses.forEach(function (course) {
      course.schedules.forEach(function (schedule) {
        var location = cleanText(schedule.location || '');
        var campus = classifyLocation(location);
        var weight = Math.max(1, schedule.weeks ? schedule.weeks.length : 1);
        scores[campus] += weight;
        if (location && examples[campus].indexOf(location) < 0 && examples[campus].length < 3) {
          examples[campus].push(location);
        }
      });
    });

    var campus = 'unknown';
    if (scores.zhaoqing > scores.guangzhou && scores.zhaoqing > 0) campus = 'zhaoqing';
    if (scores.guangzhou > scores.zhaoqing && scores.guangzhou > 0) campus = 'guangzhou';

    return {
      campus: campus,
      scores: scores,
      examples: examples,
      mixed: scores.zhaoqing > 0 && scores.guangzhou > 0,
      tied: scores.zhaoqing > 0 && scores.zhaoqing === scores.guangzhou
    };
  }

  function detectCampusFromTimeMode(doc) {
    if (!doc || !doc.querySelector) return '';
    var select = doc.querySelector('select#kbjcmsid, select[name="kbjcmsid"]');
    if (!select) return '';
    var selected = select.options && select.selectedIndex >= 0
      ? select.options[select.selectedIndex]
      : null;
    var text = cleanText(selected ? selected.textContent : '');
    if (/广州|增城/.test(text)) return 'guangzhou';
    if (/肇庆|四会/.test(text)) return 'zhaoqing';
    return '';
  }

  function classifyLocation(location) {
    var value = cleanText(location);
    if (!value) return 'unknown';
    if (matchesAny(value, CAMPUS_RULES.zhaoqing)) return 'zhaoqing';
    if (matchesAny(value, CAMPUS_RULES.guangzhou)) return 'guangzhou';
    return 'unknown';
  }

  function matchesAny(value, rules) {
    return rules.some(function (rule) { return rule.test(value); });
  }

  function campusStatusText(result) {
    if (result.campus === 'zhaoqing') {
      return result.mixed
        ? '检测到跨校区课程，已按你选择的肇庆校区设置节次时间'
        : '已识别肇庆校区并设置 13 节上课时间';
    }
    if (result.campus === 'guangzhou') {
      return result.mixed
        ? '检测到跨校区课程，已按你选择的广州校区设置节次时间'
        : '已识别广州校区并设置 13 节上课时间';
    }
    if (result.tied) return '两个校区课程占比相同，未覆盖 App 的节次时间';
    return '未能从上课地点识别校区，未覆盖 App 的节次时间';
  }

  function parseTimetable(doc) {
    var table = findTimetableTable(doc);
    if (!table) throw new Error('未找到强智课表表格 #kbtable');

    var grid = buildTableGrid(table);
    if (grid.length < 2) throw new Error('课表表格没有有效数据行');
    var headerRowIndex = findHeaderRowIndex(grid);
    if (headerRowIndex < 0) throw new Error('未识别到星期表头，请确认打开的是学生课表页面');
    var headerMap = detectHeaderDayColumnsFromGrid(grid[headerRowIndex]);
    if (headerMap.length < 5) throw new Error('课表星期列不完整，已停止导入以避免重复课程');
    var rawEntries = [];
    var dataRowOrdinal = 0;

    grid.forEach(function (gridRow, rowIndex) {
      if (rowIndex <= headerRowIndex || !rowLooksLikeSection(gridRow, headerMap)) return;
      dataRowOrdinal += 1;
      var fallbackSections = inferSectionsFromGridRow(gridRow, headerMap, dataRowOrdinal);
      headerMap.forEach(function (mapping) {
        var reference = gridRow[mapping.index];
        if (!reference || !reference.origin || !isTableCell(reference.cell, 'td')) return;
        parseCell(reference.cell, mapping.day, fallbackSections, rawEntries);
      });
    });

    var deduped = dedupeRawEntries(rawEntries);
    if (deduped.length > 80) {
      throw new Error('识别到异常多的课程块（' + deduped.length + ' 条），已停止导入以避免生成 180 门重复课程');
    }
    var grouped = groupCourses(deduped);
    if (grouped.length > 50) {
      throw new Error('识别到异常多的课程（' + grouped.length + ' 门），请确认已打开“学期理论课表”并选择全部周次');
    }
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

  function buildTableGrid(table) {
    var rows = Array.prototype.slice.call(table.rows || table.querySelectorAll('tr'));
    var grid = [];
    rows.forEach(function (row, rowIndex) {
      if (!grid[rowIndex]) grid[rowIndex] = [];
      var logicalColumn = 0;
      rowCells(row).forEach(function (cell) {
        while (grid[rowIndex][logicalColumn]) logicalColumn += 1;
        var rowSpan = Math.max(1, parseInt(cell.rowSpan || cell.getAttribute('rowspan') || 1, 10));
        var colSpan = Math.max(1, parseInt(cell.colSpan || cell.getAttribute('colspan') || 1, 10));
        for (var rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          var targetRow = rowIndex + rowOffset;
          if (!grid[targetRow]) grid[targetRow] = [];
          for (var colOffset = 0; colOffset < colSpan; colOffset += 1) {
            grid[targetRow][logicalColumn + colOffset] = {
              cell: cell,
              origin: rowOffset === 0 && colOffset === 0,
              rowSpan: rowSpan,
              colSpan: colSpan
            };
          }
        }
        logicalColumn += colSpan;
      });
    });
    return grid;
  }

  function findHeaderRowIndex(grid) {
    for (var rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      if (detectHeaderDayColumnsFromGrid(grid[rowIndex]).length >= 5) return rowIndex;
    }
    return -1;
  }

  function detectHeaderDayColumnsFromGrid(gridRow) {
    var result = [];
    (gridRow || []).forEach(function (reference, index) {
      if (!reference || !reference.cell) return;
      var day = parseDayText(reference.cell.textContent);
      if (day > 0 && !result.some(function (item) { return item.day === day; })) {
        result.push({ index: index, day: day });
      }
    });
    return result.sort(function (left, right) { return left.day - right.day; });
  }

  function rowLooksLikeSection(gridRow, headerMap) {
    var firstDayColumn = headerMap[0].index;
    var headerText = uniqueGridCells((gridRow || []).slice(0, firstDayColumn))
      .map(function (reference) { return cleanText(reference.cell.textContent); })
      .join(' ');
    if (/第?\s*(?:\d{1,2}|[一二三四五六七八九十]+)\s*(?:[-—~至]\s*\d{1,2})?\s*(?:大?节|节次)/.test(headerText)) return true;
    return headerMap.some(function (mapping) {
      var reference = gridRow[mapping.index];
      return !!(reference && reference.origin && reference.cell && reference.cell.querySelector('div.kbcontent'));
    });
  }

  function inferSectionsFromGridRow(gridRow, headerMap, ordinal) {
    var firstDayColumn = headerMap[0].index;
    var headerText = uniqueGridCells((gridRow || []).slice(0, firstDayColumn))
      .map(function (reference) { return cleanText(reference.cell.textContent); })
      .join(' ');
    var mapped = parseHuashangSectionHeader(headerText);
    if (mapped.length) return mapped;
    var explicit = headerText.match(/第?\s*(\d{1,2})(?:\s*[-—~至]\s*(\d{1,2}))?\s*节/);
    if (explicit) {
      var start = parseInt(explicit[1], 10);
      var end = parseInt(explicit[2] || explicit[1], 10);
      return range(start, end).filter(validSectionIndex);
    }
    var largeIndex = chineseOrdinal(headerText);
    if (!largeIndex) {
      var numericLarge = headerText.match(/第?\s*(\d{1,2})\s*大节/);
      largeIndex = numericLarge ? parseInt(numericLarge[1], 10) : 0;
    }
    largeIndex = largeIndex || ordinal;
    var pairStart = (largeIndex - 1) * 2 + 1;
    return [pairStart, pairStart + 1].filter(validSectionIndex);
  }

  function parseHuashangSectionHeader(text) {
    var normalized = cleanText(text).replace(/\s+/g, '').replace(/[:：]/g, '');
    var keys = Object.keys(HUASHANG_ROW_SECTIONS);
    for (var index = 0; index < keys.length; index += 1) {
      if (normalized.indexOf(keys[index]) >= 0) return HUASHANG_ROW_SECTIONS[keys[index]].slice();
    }
    return [];
  }

  function uniqueGridCells(references) {
    var cells = [];
    return references.filter(function (reference) {
      if (!reference || !reference.cell || cells.indexOf(reference.cell) >= 0) return false;
      cells.push(reference.cell);
      return true;
    });
  }

  function isTableCell(cell, expectedTag) {
    return !!cell && !!cell.tagName && cell.tagName.toLowerCase() === expectedTag;
  }

  function validSectionIndex(value) {
    return value > 0 && value <= MAX_SECTION_COUNT;
  }

  function parseCell(cell, dayOfWeek, fallbackSections, out) {
    if (!cell) return;
    var divs = Array.prototype.slice.call(cell.querySelectorAll('div.kbcontent')).filter(function (div) {
      return !div.parentElement || !div.parentElement.closest || !div.parentElement.closest('div.kbcontent');
    });
    if (!divs.length && /周|节/.test(cleanText(cell.textContent))) divs = [cell];

    var seenBlocks = {};
    divs.forEach(function (div) {
      splitCourseBlocks(div.innerHTML).forEach(function (blockHtml) {
        var blockKey = cleanText(blockHtml.replace(/<[^>]+>/g, ' '));
        if (!blockKey || seenBlocks[blockKey]) return;
        seenBlocks[blockKey] = true;
        var entry = parseCourseBlock(blockHtml, dayOfWeek, fallbackSections);
        if (entry) out.push(entry);
      });
    });
  }

  function splitCourseBlocks(html) {
    var marker = '__XHP_HUASHANG_SPLIT__';
    return String(html || '')
      .replace(/(?:<br\s*\/?\s*>\s*)?-{5,}(?:\s*<br\s*\/?\s*>)?/gi, marker)
      .replace(/(?:<br\s*\/?\s*>\s*)?—{5,}(?:\s*<br\s*\/?\s*>)?/gi, marker)
      .split(marker)
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
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
    sectionText = preferredSectionText(weekText, lines);

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

  function preferredSectionText(weekText, lines) {
    var combined = normalizeSymbols(weekText || '');
    if (/[\[【][^\]】]*\d{1,2}[^\]】]*节[^\]】]*[\]】]/.test(combined)) return weekText;
    return firstMatching(lines || [], looksLikeExplicitSectionLine);
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
        for (var week = nums[0]; week <= nums[1]; week += 1) weeks.push(week);
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
          for (var sectionIndex = start; sectionIndex <= end; sectionIndex += 1) sections.push(sectionIndex);
        }
      } else {
        sections = numbers.filter(function (number) { return number > 0 && number <= MAX_SECTION_COUNT; });
      }
    }
    return uniqueSorted(sections);
  }

  function looksLikeExplicitSectionLine(line) {
    var value = normalizeSymbols(line).trim();
    return /^(?:第)?\s*[\[【]?\s*\d{1,2}(?:\s*[-,]\s*\d{1,2})*\s*节(?:次)?\s*[\]】]?$/.test(value);
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
      var key = [
        entry.name, entry.teacher || '', entry.location || '', entry.dayOfWeek,
        entry.startSection, entry.endSection, entry.weeks.join(',')
      ].join('|');
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
      var scheduleKey = [
        entry.dayOfWeek,
        entry.startSection,
        entry.endSection,
        entry.location || ''
      ].join('|');
      var existing = map[key].schedules.find(function (schedule) {
        return schedule.__key === scheduleKey;
      });
      if (existing) {
        existing.weeks = uniqueSorted(existing.weeks.concat(entry.weeks));
      } else {
        map[key].schedules.push({
          __key: scheduleKey,
          dayOfWeek: entry.dayOfWeek,
          startSection: entry.startSection,
          endSection: entry.endSection,
          weeks: entry.weeks.slice(),
          location: entry.location
        });
      }
    });
    return Object.keys(map).map(function (key) {
      map[key].schedules.forEach(function (schedule) { delete schedule.__key; });
      return map[key];
    });
  }

  function buildPayloadCourses(courses, totalWeeks) {
    return courses.map(function (course) {
      return {
        name: course.name,
        teacher: course.teacher,
        color: course.color,
        schedules: course.schedules.map(function (schedule) {
          var rule = weeksToRule(schedule.weeks, totalWeeks);
          var result = {
            dayOfWeek: schedule.dayOfWeek,
            startSection: schedule.startSection,
            endSection: schedule.endSection,
            weekRuleType: rule.type,
            location: schedule.location
          };
          if (rule.weeks) result.weekNumbers = rule.weeks;
          return result;
        })
      };
    });
  }

  function weeksToRule(weeks, totalWeeks) {
    var sorted = uniqueSorted(weeks);
    if (
      sorted.length === totalWeeks && sorted[0] === 1 &&
      sorted[sorted.length - 1] === totalWeeks && isContiguous(sorted)
    ) return { type: 'every' };
    if (isContiguous(sorted)) return { type: 'continuous', weeks: [sorted[0], sorted[sorted.length - 1]] };

    var allOdds = range(1, totalWeeks).filter(function (week) { return week % 2 === 1; });
    var allEvens = range(1, totalWeeks).filter(function (week) { return week % 2 === 0; });
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
    return {
      name: normalizeSemesterName(name || code) || '广州华商学院当前学期',
      code: code || ''
    };
  }

  function normalizeSemesterName(value) {
    var match = cleanText(value).match(/(20\d{2})\s*[-—]\s*(20\d{2})\s*[-—]\s*([12])/);
    if (!match) return cleanText(value) || '广州华商学院当前学期';
    return match[1] + '-' + match[2] + '-' + match[3];
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

  function looksLikeLoginPage(doc) {
    if (!doc) return false;
    if (doc.querySelector('input[type="password"]')) return true;
    var text = cleanText((doc.title || '') + ' ' + (doc.body ? doc.body.innerText : ''));
    return /统一身份认证|用户登录|学生登录|教务系统登录|登录系统|验证码/.test(text) && !findTimetableTable(doc);
  }

  function detectSessionFailure(doc) {
    var raw = cleanText(doc && doc.body ? doc.body.innerText : '');
    if (!raw) return '';

    var parsed = null;
    if (/^\s*\{[\s\S]*\}\s*$/.test(raw)) {
      try { parsed = JSON.parse(raw); } catch (_) {}
    }
    var flag = parsed && (parsed.flag1 != null ? parsed.flag1 : parsed.flag);

    if (String(flag) === '2' || /["']flag1["']\s*:\s*["']?2["']?/.test(raw)) {
      return '教务系统要求先从登录入口建立新会话，请重新登录。';
    }
    if (/请先刷新网页|璇峰厛鍒锋柊缃戦〉|会话.{0,8}(失效|过期)|session.{0,8}(invalid|expired)/i.test(raw)) {
      return '登录会话未建立或已经失效，请重新登录。';
    }
    return '';
  }

  function installNavigationCompatibility() {
    if (window.__xhp_huashang_navigation_patched__) return;
    window.__xhp_huashang_navigation_patched__ = true;

    var originalOpen = typeof window.open === 'function' ? window.open.bind(window) : null;
    window.open = function (url, target, features) {
      if (url) {
        try {
          var resolved = new URL(String(url), window.location.href);
          if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
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
      event.preventDefault();
      window.location.assign(anchor.href);
    }, true);
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

  function guessSemesterStartDate(code) {
    var known = KNOWN_SEMESTER_STARTS[String(code || '').trim()];
    if (known) return known;
    var match = String(code || '').match(/(20\d{2})\s*[-—]\s*(20\d{2})\s*[-—]\s*([12])/);
    var date;
    if (match) {
      var year = parseInt(match[3] === '1' ? match[1] : match[2], 10);
      date = match[3] === '1' ? new Date(year, 8, 1) : new Date(year, 1, 20);
      if (match[3] === '1') {
        while (date.getDay() !== 1) date.setDate(date.getDate() - 1);
        return localIsoDate(date);
      }
    } else {
      date = new Date();
    }
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return localIsoDate(date);
  }

  function section(index, start, end) {
    return { sectionIndex: index, startTime: start, endTime: end };
  }

  function copySection(item) {
    return {
      sectionIndex: item.sectionIndex,
      startTime: item.startTime,
      endTime: item.endTime
    };
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
    return /\d/.test(value) && (/周|节|单|双|[\[【]/.test(value));
  }

  function firstMatching(list, predicate) {
    for (var i = 0; i < list.length; i += 1) if (predicate(list[i])) return list[i];
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

  function arraysEqual(left, right) {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
    return true;
  }

  function hashString(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash) + value.charCodeAt(i) | 0;
    return hash;
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

  function daysBetween(startIso, endIso) {
    var start = new Date(startIso + 'T00:00:00Z').getTime();
    var end = new Date(endIso + 'T00:00:00Z').getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.round((end - start) / 86400000);
  }

  function safeCallNumber(name, fallback) {
    try { return typeof XHP[name] === 'function' ? Number(XHP[name]()) : fallback; }
    catch (_) { return fallback; }
  }

  function safeCallString(name, fallback) {
    try { return typeof XHP[name] === 'function' ? String(XHP[name]()) : fallback; }
    catch (_) { return fallback; }
  }

  function safeJsonCall(name, fallback) {
    try {
      return typeof XHP[name] === 'function' ? JSON.parse(XHP[name]()) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readRedirectCount() {
    try { return parseInt(window.sessionStorage.getItem(REDIRECT_KEY), 10) || 0; }
    catch (_) { return 0; }
  }

  function writeRedirectCount(value) {
    try { window.sessionStorage.setItem(REDIRECT_KEY, String(value)); }
    catch (_) {}
  }

  function clearRedirectCount() {
    try { window.sessionStorage.removeItem(REDIRECT_KEY); }
    catch (_) {}
  }

  function renderStatus(message, error, buttonText, onClick) {
    removeStatus();
    var root = document.createElement('div');
    root.id = STATUS_ID;
    root.innerHTML = '' +
      '<style>' +
        '#' + STATUS_ID + ',#' + STATUS_ID + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}' +
        '#' + STATUS_ID + '{position:fixed;z-index:2147483647;right:12px;bottom:12px;width:min(330px,calc(100vw - 24px));padding:14px;border:1px solid rgba(15,23,42,.13);border-radius:15px;background:#fff;box-shadow:0 16px 44px rgba(15,23,42,.28);color:#17212b}' +
        '#' + STATUS_ID + ' .title{font-size:14px;font-weight:750;margin-bottom:5px}' +
        '#' + STATUS_ID + ' .message{font-size:12px;line-height:1.55;color:' + (error ? '#b42318' : '#52606d') + '}' +
        '#' + STATUS_ID + ' button{width:100%;height:38px;margin-top:10px;border:0;border-radius:10px;background:#3569d4;color:#fff;font-size:12px;font-weight:700}' +
      '</style>' +
      '<div class="title">华商课表导入</div>' +
      '<div class="message"></div>' +
      (buttonText ? '<button type="button"></button>' : '');
    root.querySelector('.message').textContent = message;
    if (buttonText) {
      var button = root.querySelector('button');
      button.textContent = buttonText;
      button.addEventListener('click', onClick);
    }
    (document.documentElement || document.body).appendChild(root);
  }

  function removeStatus() {
    var current = document.getElementById(STATUS_ID);
    if (current && current.parentNode) current.parentNode.removeChild(current);
  }

  function toast(message) {
    try { if (typeof XHP.toast === 'function') XHP.toast(message); }
    catch (_) {}
  }

  function fail(message) {
    try {
      if (typeof XHP.failAction === 'function') XHP.failAction(message);
      else XHP.cancel(message);
    } catch (_) {}
  }

  function log(message) {
    try { XHP.log('[Huashang] ' + message); }
    catch (_) {}
  }

  function exposeTestApi() {
    window.__HUASHANG_XHP_INTERNALS__ = {
      SECTION_TIMES: SECTION_TIMES,
      classifyLocation: classifyLocation,
      detectCampus: detectCampus,
      detectCampusFromTimeMode: detectCampusFromTimeMode,
      parseWeeks: parseWeeks,
      parseSections: parseSections,
      preferredSectionText: preferredSectionText,
      parseHuashangSectionHeader: parseHuashangSectionHeader,
      looksLikeExplicitSectionLine: looksLikeExplicitSectionLine,
      weeksToRule: weeksToRule,
      normalizeSemesterName: normalizeSemesterName,
      guessSemesterStartDate: guessSemesterStartDate,
      daysBetween: daysBetween,
      shouldCreateSemester: shouldCreateSemester,
      buildImportPayload: buildImportPayload,
      parseTimetable: parseTimetable,
      buildTableGrid: buildTableGrid,
      groupCourses: groupCourses,
      detectSessionFailure: detectSessionFailure,
      isLoginEntryPage: isLoginEntryPage,
      MAX_SECTION_COUNT: MAX_SECTION_COUNT,
      LOGIN_ENTRY_URL: LOGIN_ENTRY_URL,
      TIMETABLE_URL: TIMETABLE_URL
    };
  }
})();
