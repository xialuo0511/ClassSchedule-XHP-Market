(function () {
  'use strict';

  var GDUFE_ORIGIN = 'http://jwxt.gdufe.edu.cn';
  // Strong-Wisdom must first enter the /jsxsd/ root so the server can create
  // the login session cookie. Opening xskb_list.do directly without that cookie
  // returns {\"flag1\":2,\"msgContent\":\"请先刷新网页\"}.
  var LOGIN_ENTRY_URL = GDUFE_ORIGIN + '/jsxsd/';
  var TIMETABLE_URL = GDUFE_ORIGIN + '/jsxsd/xskb/xskb_list.do';
  var CALENDAR_URL = GDUFE_ORIGIN + '/jsxsd/jxzl/jxzl_query';
  var MAX_SECTION_COUNT = 12;
  var RUN_KEY = '__xhp_gdufe_import_running__';
  var SUBMITTED_KEY = '__xhp_gdufe_import_submitted__';
  var REDIRECT_KEY = '__xhp_gdufe_redirect_count__';
  var STATUS_ID = 'xhp-gdufe-status';
  var TEST_MODE = !!window.__XHP_GDUFE_TEST_MODE__;
  var COLOR_PALETTE = [
    '#DDEBFF', '#DDF4EE', '#F3E6FA', '#FFF0D8',
    '#FFE4E1', '#E7E5FF', '#DFF3F8', '#F1E8D8'
  ];

  var SECTION_TIMES = {
    sanshui: [
      section(1, '08:30', '09:15'),
      section(2, '09:15', '10:00'),
      section(3, '10:20', '11:05'),
      section(4, '11:05', '11:50'),
      section(5, '14:00', '14:45'),
      section(6, '14:45', '15:30'),
      section(7, '15:50', '16:30'),
      section(8, '16:35', '17:20'),
      section(9, '18:30', '19:15'),
      section(10, '19:15', '20:00'),
      section(11, '20:20', '21:05'),
      section(12, '21:05', '21:50')
    ],
    guangzhou: [
      section(1, '08:00', '08:45'),
      section(2, '08:55', '09:40'),
      section(3, '10:00', '10:45'),
      section(4, '10:55', '11:40'),
      section(5, '14:10', '14:55'),
      section(6, '15:05', '15:50'),
      section(7, '16:10', '16:55'),
      section(8, '17:05', '17:50'),
      section(9, '18:40', '19:25'),
      section(10, '19:35', '20:20'),
      section(11, '20:30', '21:15'),
      section(12, '21:25', '22:10')
    ]
  };

  var CAMPUS_RULES = {
    sanshui: [
      /三水校区|佛山校区|三水/i,
      /厚德楼|励学楼|拓新楼|笃行楼/i,
      /(?:^|[^A-Z0-9])(?:SJ1|SJ2|SJ3|SS1)(?:[^A-Z0-9]|$)/i
    ],
    guangzhou: [
      /广州校区|广州/i,
      /第一教学楼|第三教学楼|经管实验楼|实验楼|综合楼/i,
      /(?:^|[^A-Z0-9])(?:J1|B4|B5|S1|Z1)(?:[^A-Z0-9]|$)/i,
      /北四|北五/i
    ]
  };

  if (typeof XHP === 'undefined') {
    console.error('[GDUFE XHP] XHP bridge is unavailable');
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
      return url.origin === GDUFE_ORIGIN && path === '/jsxsd';
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
      var campus = detectCampus(parsed.courses);
      var payload = buildImportPayload(parsed, currentSemester, semesterMeta, campus);

      window[SUBMITTED_KEY] = true;
      log(
        'submit courses=' + payload.courses.length +
        ', semester=' + semesterMeta.name +
        ', campus=' + campus.campus +
        ', calendar=' + (calendarResult.exact ? 'exact' : 'fallback')
      );

      var status = campusStatusText(campus);
      if (!calendarResult.exact) status += '；校历读取失败，已使用可用的学期信息';
      toast(status);
      XHP.submitCourses(JSON.stringify(payload));
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

  function buildImportPayload(parsed, currentSemester, semesterMeta, campus) {
    var totalWeeks = Math.max(semesterMeta.totalWeeks || 0, parsed.maxWeek || 0, 1);
    var payload = {
      protocolVersion: 1,
      courses: buildPayloadCourses(parsed.courses, totalWeeks)
    };

    // Always provide the complete semester definition. ClassSchedule 1.4 lets the user decide
    // whether this definition replaces the current semester or creates a separate semester.
    payload.semester = {
      name: semesterMeta.name,
      startDate: semesterMeta.startDate,
      totalWeeks: totalWeeks,
      sectionCount: MAX_SECTION_COUNT
    };

    if (campus.campus === 'sanshui' || campus.campus === 'guangzhou') {
      payload.sectionTimes = SECTION_TIMES[campus.campus].map(copySection);
    }
    return payload;
  }

  function shouldCreateSemester(current, target, parsed) {
    if (!current.startDate) return true;
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

      var startDate = dates[0];
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
    var scores = { sanshui: 0, guangzhou: 0, unknown: 0 };
    var examples = { sanshui: [], guangzhou: [], unknown: [] };

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
    if (scores.sanshui > scores.guangzhou && scores.sanshui > 0) campus = 'sanshui';
    if (scores.guangzhou > scores.sanshui && scores.guangzhou > 0) campus = 'guangzhou';

    return {
      campus: campus,
      scores: scores,
      examples: examples,
      mixed: scores.sanshui > 0 && scores.guangzhou > 0,
      tied: scores.sanshui > 0 && scores.sanshui === scores.guangzhou
    };
  }

  function classifyLocation(location) {
    var value = cleanText(location);
    if (!value) return 'unknown';
    if (matchesAny(value, CAMPUS_RULES.sanshui)) return 'sanshui';
    if (matchesAny(value, CAMPUS_RULES.guangzhou)) return 'guangzhou';
    return 'unknown';
  }

  function matchesAny(value, rules) {
    return rules.some(function (rule) { return rule.test(value); });
  }

  function campusStatusText(result) {
    if (result.campus === 'sanshui') {
      return result.mixed
        ? '检测到跨校区课程，已按占比更多的三水校区设置节次时间'
        : '已识别三水校区并设置 12 节上课时间';
    }
    if (result.campus === 'guangzhou') {
      return result.mixed
        ? '检测到跨校区课程，已按占比更多的广州校区设置节次时间'
        : '已识别广州校区并设置 12 节上课时间';
    }
    if (result.tied) return '两个校区课程占比相同，未覆盖 App 的节次时间';
    return '未能从上课地点识别校区，未覆盖 App 的节次时间';
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
          if (!cell || cell.tagName.toLowerCase() !== 'td') cell = tdCells[mapping.day - 1];
          parseCell(cell, mapping.day, fallbackSections, rawEntries);
        });
      } else {
        tdCells.slice(0, 7).forEach(function (cell, index) {
          parseCell(cell, index + 1, fallbackSections, rawEntries);
        });
      }
    });

    var grouped = groupCourses(dedupeRawEntries(rawEntries));
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
    var marker = '__XHP_GDUFE_SPLIT__';
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
      name: normalizeSemesterName(name || code) || '广东财经大学当前学期',
      code: code || ''
    };
  }

  function normalizeSemesterName(value) {
    var match = cleanText(value).match(/(20\d{2})\s*[-—]\s*(20\d{2})\s*[-—]\s*([12])/);
    if (!match) return cleanText(value) || '广东财经大学当前学期';
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
    if (window.__xhp_gdufe_navigation_patched__) return;
    window.__xhp_gdufe_navigation_patched__ = true;

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
      '<div class="title">广东财经大学课表导入</div>' +
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
    try { XHP.log('[GDUFE] ' + message); }
    catch (_) {}
  }

  function exposeTestApi() {
    window.__GDUFE_XHP_INTERNALS__ = {
      SECTION_TIMES: SECTION_TIMES,
      classifyLocation: classifyLocation,
      detectCampus: detectCampus,
      parseWeeks: parseWeeks,
      parseSections: parseSections,
      weeksToRule: weeksToRule,
      normalizeSemesterName: normalizeSemesterName,
      guessSemesterStartDate: guessSemesterStartDate,
      daysBetween: daysBetween,
      shouldCreateSemester: shouldCreateSemester,
      buildImportPayload: buildImportPayload,
      parseTimetable: parseTimetable,
      detectSessionFailure: detectSessionFailure,
      isLoginEntryPage: isLoginEntryPage,
      LOGIN_ENTRY_URL: LOGIN_ENTRY_URL,
      TIMETABLE_URL: TIMETABLE_URL
    };
  }
})();
