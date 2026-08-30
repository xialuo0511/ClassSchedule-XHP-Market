(function () {
  'use strict';

  var host = window.location.hostname.toLowerCase();
  var school = host.indexOf('gdou.edu.cn') >= 0 ? {
    id: 'dev.xinghan.gdou', name: '广东海洋大学', origin: 'https://jw.gdou.edu.cn'
  } : {
    id: 'dev.xinghan.jyu', name: '嘉应学院', origin: 'https://jwcjwxt.jyu.edu.cn'
  };
  var loginUrl = school.origin + '/xtgl/login_slogin.html';
  var timetablePath = '/kbcx/xskbcx_cxXsKb.html';
  var timetableUrl = school.origin + timetablePath + '?gnmkdm=N2151';
  var toolbarId = 'xhp-zf-toolbar';
  var dialogId = 'xhp-zf-dialog';
  var submitted = false;

  if (typeof XHP === 'undefined') return;
  exposeTestApi();
  if (!window.__ZF_XHP_DISABLE_BOOTSTRAP__) {
    installNavigationCompatibility();
    installToolbar();
  }

  function installToolbar() {
    remove(toolbarId);
    var onTimetable = window.location.pathname.indexOf(timetablePath) >= 0;
    var loginPage = !!document.querySelector('input[type="password"]');
    var root = document.createElement('div');
    root.id = toolbarId;
    root.innerHTML = '<style>' + toolbarCss() + '</style><div class="zf-card">' +
      '<b>' + escapeHtml(school.name) + '课表导入</b>' +
      '<p>' + (onTimetable ? '已进入个人课表页面' : loginPage ? '请先完成学校账号登录' : '登录后可打开个人课表') + '</p>' +
      '<button id="xhp-zf-primary">' + (onTimetable ? '读取并导入' : '打开个人课表') + '</button>' +
      (loginPage ? '' : '<button id="xhp-zf-login" class="secondary">重新登录</button>') +
      '</div>';
    (document.documentElement || document.body).appendChild(root);
    document.getElementById('xhp-zf-primary').onclick = function () {
      if (onTimetable) loadAndPreview();
      else window.location.assign(timetableUrl);
    };
    var login = document.getElementById('xhp-zf-login');
    if (login) login.onclick = function () { window.location.assign(loginUrl); };
  }

  function loadAndPreview() {
    setStatus('正在读取课表…', false);
    readRecords().then(function (result) {
      var parsed = parseRecords(result.records, result.semester);
      if (!parsed.courses.length) throw new Error('没有识别到课程，请确认当前学期已有个人课表');
      renderPreview(parsed);
      setStatus('已识别 ' + parsed.courses.length + ' 门课程', false);
    }).catch(function (error) {
      setStatus('读取失败：' + (error.message || String(error)), true);
    });
  }

  function readRecords() {
    var direct = findEmbeddedRecords();
    if (direct.length) return Promise.resolve({ records: direct, semester: detectSemester(document) });
    var semester = detectSemester(document);
    var body = [
      'xnm=' + encodeURIComponent(semester.yearCode || ''),
      'xqm=' + encodeURIComponent(semester.termCode || ''),
      'kzlx=ck'
    ].join('&');
    return fetch(timetableUrl, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: body
    }).then(function (response) {
      if (!response.ok) throw new Error('教务系统返回 HTTP ' + response.status);
      return response.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (_) { data = null; }
      var records = extractRecordArray(data);
      if (!records.length) records = parseDocumentRecords(document);
      if (!records.length && /login_slogin|用户登录|统一身份认证/.test(text)) {
        throw new Error('登录状态已失效，请重新登录');
      }
      return { records: records, semester: semester };
    });
  }

  function findEmbeddedRecords() {
    var candidates = [window.kbList, window.courseList, window.xsKbList];
    for (var i = 0; i < candidates.length; i += 1) {
      if (Array.isArray(candidates[i]) && candidates[i].length) return candidates[i];
    }
    return [];
  }

  function extractRecordArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    var keys = ['kbList', 'list', 'rows', 'data'];
    for (var i = 0; i < keys.length; i += 1) {
      var value = data[keys[i]];
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.rows)) return value.rows;
      if (value && Array.isArray(value.kbList)) return value.kbList;
    }
    return [];
  }

  function parseDocumentRecords(doc) {
    var blocks = Array.prototype.slice.call(doc.querySelectorAll('.timetable_con,[data-kcmc],.kbcontent'));
    return blocks.map(function (block) {
      var text = clean(block.innerText || block.textContent);
      var cell = block.closest('td');
      return {
        kcmc: block.getAttribute('data-kcmc') || firstLine(text),
        xm: attrOrMatch(block, 'data-jsxm', text, /(?:教师|老师)[:：]\s*([^\s]+)/),
        cdmc: attrOrMatch(block, 'data-cdmc', text, /(?:地点|教室)[:：]\s*([^\n]+)/),
        zcd: attrOrMatch(block, 'data-zcd', text, /(\d+(?:[-,，、]\d+)*(?:周)?(?:\([^)]*\))?)/),
        jcs: block.getAttribute('data-jcs') || inferSectionsFromCell(cell, text),
        xqj: block.getAttribute('data-xqj') || inferDayFromCell(cell)
      };
    }).filter(function (item) { return clean(item.kcmc) && parseInt(item.xqj, 10) > 0; });
  }

  function parseRecords(records, semester) {
    if (!Array.isArray(records) || records.length > 500) throw new Error('课表数据数量异常，已停止导入');
    var raw = [];
    records.forEach(function (item) {
      var name = clean(item.kcmc || item.courseName || item.kcName);
      var day = parseInt(item.xqj || item.weekDay || item.dayOfWeek, 10);
      var sections = parseSections(item.jcs || item.jc || item.sections || item.section);
      var weeks = parseWeeks(item.zcd || item.zcs || item.weeks || item.weekDescription);
      if (!name || day < 1 || day > 7 || !sections.length || !weeks.length) return;
      raw.push({
        name: name,
        teacher: cleanNullable(item.xm || item.jsxm || item.teacherName || item.teacher),
        location: cleanNullable(item.cdmc || item.jxcdmc || item.location),
        dayOfWeek: day,
        startSection: sections[0],
        endSection: sections[sections.length - 1],
        weeks: weeks
      });
    });
    var deduped = dedupe(raw);
    var grouped = groupCourses(deduped);
    if (grouped.length > 100) throw new Error('识别到的课程数量异常，请勿继续导入');
    return {
      courses: grouped,
      semester: semester || {},
      maxWeek: maximum(deduped, function (item) { return Math.max.apply(Math, item.weeks); }),
      maxSection: maximum(deduped, function (item) { return item.endSection; })
    };
  }

  function renderPreview(parsed) {
    remove(dialogId);
    var current = getCurrentSemester();
    var name = parsed.semester.name || school.name + '当前学期';
    var startDate = current.currentWeek > 0 && current.startDate ? current.startDate : guessStartDate(parsed.semester);
    var weeks = Math.max(parsed.maxWeek || 0, current.totalWeeks || 0, 18);
    var sections = Math.max(parsed.maxSection || 0, current.sectionCount || 0, 12);
    var root = document.createElement('div');
    root.id = dialogId;
    root.innerHTML = '<style>' + dialogCss() + '</style><div class="zf-mask"><div class="zf-dialog">' +
      '<div class="eyebrow">解析完成</div><h2>核对学期信息</h2>' +
      '<p class="summary">已识别 <b>' + parsed.courses.length + '</b> 门课程，最高第 <b>' + parsed.maxSection + '</b> 节</p>' +
      '<label>导入方式<select id="zf-mode"><option value="new">创建新学期</option>' +
        (current.startDate ? '<option value="current">覆盖当前学期</option>' : '') + '</select></label>' +
      '<label>学期名称<input id="zf-name" value="' + escapeAttr(name) + '"></label>' +
      '<label>开学日期<input id="zf-date" type="date" value="' + escapeAttr(startDate) + '"><small>学校页面未提供校历时仅作估算，请按校历核对。</small></label>' +
      '<div class="grid"><label>总周数<input id="zf-weeks" type="number" min="1" max="60" value="' + weeks + '"></label>' +
      '<label>每日节数<input id="zf-sections" type="number" min="1" max="20" value="' + sections + '"></label></div>' +
      '<div class="actions"><button id="zf-cancel" class="secondary">取消</button><button id="zf-submit">导入</button></div>' +
      '</div></div>';
    (document.documentElement || document.body).appendChild(root);
    document.getElementById('zf-mode').onchange = function () {
      var disabled = this.value === 'current';
      ['zf-name', 'zf-date', 'zf-weeks', 'zf-sections'].forEach(function (id) { document.getElementById(id).disabled = disabled; });
    };
    document.getElementById('zf-cancel').onclick = function () { remove(dialogId); };
    document.getElementById('zf-submit').onclick = function () { submit(parsed); };
  }

  function submit(parsed) {
    if (submitted) return;
    var mode = value('zf-mode');
    var totalWeeks = positive(value('zf-weeks'));
    var sectionCount = positive(value('zf-sections'));
    var startDate = value('zf-date');
    if (mode === 'new' && (!value('zf-name') || !isIsoDate(startDate) || !totalWeeks || !sectionCount)) {
      setStatus('请完整填写并核对学期信息', true); return;
    }
    var payload = {
      protocolVersion: 1,
      courses: parsed.courses.map(function (course) {
        return {
          name: course.name,
          teacher: course.teacher,
          schedules: course.schedules.map(function (schedule) {
            var rule = weeksToRule(schedule.weeks, mode === 'new' ? totalWeeks : Math.max(parsed.maxWeek, totalWeeks));
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
      })
    };
    if (mode === 'new') payload.semester = {
      name: value('zf-name'), startDate: startDate, totalWeeks: totalWeeks, sectionCount: sectionCount
    };
    submitted = true;
    XHP.submitCourses(JSON.stringify(payload));
  }

  function detectSemester(doc) {
    var year = selected(doc, ['#xnm', '[name="xnm"]']);
    var term = selected(doc, ['#xqm', '[name="xqm"]']);
    var yearText = year.text || year.value;
    var yearMatch = yearText.match(/(20\d{2})(?:\s*[-—]\s*(20\d{2}))?/);
    var termNumber = /第二|下/.test(term.text) || term.value === '12' ? 2 : 1;
    var name = yearMatch ? yearMatch[1] + '-' + (yearMatch[2] || (parseInt(yearMatch[1], 10) + 1)) + '-' + termNumber : '';
    return { name: name, yearCode: year.value, termCode: term.value, termNumber: termNumber };
  }

  function parseWeeks(input) {
    if (Array.isArray(input)) return uniqueNumbers(input);
    var text = normalize(input).replace(/\[[^\]]*\]/g, '');
    var odd = /单周|\(单\)/.test(text), even = /双周|\(双\)/.test(text);
    text = text.replace(/周|单周|双周|\([^)]*\)/g, '');
    var result = [];
    text.split(',').forEach(function (part) {
      var match = part.match(/(\d+)\s*-\s*(\d+)/);
      if (match) for (var i = +match[1]; i <= +match[2]; i += 1) result.push(i);
      else if (/\d+/.test(part)) result.push(parseInt(part, 10));
    });
    result = uniqueNumbers(result);
    return result.filter(function (week) { return (!odd || week % 2 === 1) && (!even || week % 2 === 0); });
  }

  function parseSections(input) {
    if (Array.isArray(input)) return uniqueNumbers(input);
    var text = normalize(input).replace(/节/g, '');
    var result = [];
    text.split(',').forEach(function (part) {
      var numbers = (part.match(/\d+/g) || []).map(Number);
      if (numbers.length === 2) for (var i = numbers[0]; i <= numbers[1]; i += 1) result.push(i);
      else numbers.forEach(function (number) { result.push(number); });
    });
    return uniqueNumbers(result);
  }

  function dedupe(items) {
    var seen = {};
    return items.filter(function (item) {
      var key = [item.name, item.teacher, item.location, item.dayOfWeek, item.startSection, item.endSection, item.weeks.join(',')].join('|');
      if (seen[key]) return false; seen[key] = true; return true;
    });
  }

  function groupCourses(items) {
    var groups = {};
    items.forEach(function (item) {
      var key = item.name + '|' + (item.teacher || '');
      if (!groups[key]) groups[key] = { name: item.name, teacher: item.teacher, schedules: [] };
      groups[key].schedules.push({ dayOfWeek: item.dayOfWeek, startSection: item.startSection, endSection: item.endSection, weeks: item.weeks, location: item.location });
    });
    return Object.keys(groups).map(function (key) { return groups[key]; });
  }

  function weeksToRule(weeks, totalWeeks) {
    var sorted = uniqueNumbers(weeks), all = range(1, totalWeeks);
    if (same(sorted, all)) return { type: 'every' };
    if (same(sorted, all.filter(function (x) { return x % 2; }))) return { type: 'odd' };
    if (same(sorted, all.filter(function (x) { return x % 2 === 0; }))) return { type: 'even' };
    if (contiguous(sorted)) return { type: 'continuous', weeks: [sorted[0], sorted[sorted.length - 1]] };
    return { type: 'specified', weeks: sorted };
  }

  function getCurrentSemester() {
    try { return JSON.parse(XHP.getSemesterInfo()); }
    catch (_) { return { currentWeek: 0, totalWeeks: 0, sectionCount: 0, startDate: null }; }
  }

  function guessStartDate(semester) {
    var match = (semester.name || '').match(/(20\d{2})-(20\d{2})-([12])/);
    var date = match ? new Date(+(match[3] === '1' ? match[1] : match[2]), match[3] === '1' ? 8 : 1, 1) : new Date();
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return localDate(date);
  }

  function selected(doc, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var select = doc.querySelector(selectors[i]);
      if (select) {
        var option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        return { value: clean(select.value), text: clean(option ? option.textContent : '') };
      }
    }
    return { value: '', text: '' };
  }

  function inferDayFromCell(cell) {
    if (!cell) return 0;
    var value = cell.getAttribute('data-xqj') || cell.getAttribute('data-week') || '';
    if (value) return parseInt(value, 10) || 0;
    return Math.max(0, Array.prototype.indexOf.call(cell.parentNode.children, cell));
  }

  function inferSectionsFromCell(cell, text) {
    if (!cell) return '';
    var value = cell.getAttribute('data-jcs') || cell.getAttribute('data-section');
    if (value) return value;
    var match = text.match(/第?\s*(\d+)\s*[-~至]\s*(\d+)\s*节/);
    return match ? match[1] + '-' + match[2] : '';
  }

  function attrOrMatch(node, attr, text, regex) {
    var value = node.getAttribute(attr); if (value) return value;
    var match = text.match(regex); return match ? match[1] : '';
  }

  function firstLine(text) { return clean(String(text).split(/\n/)[0]); }
  function clean(value) { return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
  function cleanNullable(value) { var result = clean(value); return result || null; }
  function normalize(value) { return clean(value).replace(/[，、]/g, ',').replace(/[—–－~～至]/g, '-').replace(/[（]/g, '(').replace(/[）]/g, ')'); }
  function positive(value) { var number = parseInt(value, 10); return number > 0 ? number : 0; }
  function uniqueNumbers(values) { var seen = {}; return values.map(Number).filter(function (x) { if (!Number.isFinite(x) || x <= 0 || seen[x]) return false; seen[x] = true; return true; }).sort(function (a, b) { return a - b; }); }
  function range(start, end) { var values = []; for (var i = start; i <= end; i += 1) values.push(i); return values; }
  function contiguous(values) { return values.length > 0 && values.every(function (x, i) { return i === 0 || x === values[i - 1] + 1; }); }
  function same(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  function maximum(items, getter) { return items.reduce(function (max, item) { return Math.max(max, getter(item) || 0); }, 0); }
  function value(id) { var node = document.getElementById(id); return node ? String(node.value || '') : ''; }
  function isIsoDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T00:00:00').getTime()); }
  function localDate(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
  function remove(id) { var node = document.getElementById(id); if (node) node.remove(); }
  function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function escapeAttr(value) { return escapeHtml(value); }
  function setStatus(message, error) { var node = document.querySelector('#' + toolbarId + ' p'); if (node) { node.textContent = message; node.style.color = error ? '#b42318' : '#52606d'; } }

  function installNavigationCompatibility() {
    document.addEventListener('click', function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[target="_blank"]') : null;
      if (!anchor || !anchor.href) return; event.preventDefault(); window.location.assign(anchor.href);
    }, true);
  }

  function toolbarCss() {
    return '#' + toolbarId + ',#' + toolbarId + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}' +
      '#' + toolbarId + '{all:initial;position:fixed;right:12px;bottom:16px;z-index:2147483646;width:min(240px,calc(100vw - 24px))}' +
      '#' + toolbarId + ' .zf-card{padding:14px;border:1px solid rgba(15,23,42,.12);border-radius:18px;background:#fff;box-shadow:0 14px 44px rgba(15,23,42,.25);color:#17212b}' +
      '#' + toolbarId + ' b{font-size:14px}#' + toolbarId + ' p{margin:5px 0 10px;font-size:11px;line-height:1.5;color:#52606d}' +
      '#' + toolbarId + ' button{width:100%;height:40px;border:0;border-radius:11px;background:#3569d4;color:#fff;font-size:12px;font-weight:700}' +
      '#' + toolbarId + ' button.secondary{margin-top:7px;border:1px solid #d0d5dd;background:#fff;color:#475467}';
  }

  function dialogCss() {
    return '#' + dialogId + ',#' + dialogId + ' *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}' +
      '#' + dialogId + '{all:initial;position:fixed;inset:0;z-index:2147483647}' +
      '#' + dialogId + ' .zf-mask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(15,23,42,.58)}' +
      '#' + dialogId + ' .zf-dialog{width:min(480px,100%);max-height:calc(100vh - 28px);overflow:auto;padding:22px;border-radius:22px;background:#fff;color:#17212b;box-shadow:0 24px 80px rgba(15,23,42,.3)}' +
      '#' + dialogId + ' .eyebrow{font-size:11px;font-weight:750;color:#3569d4}#' + dialogId + ' h2{margin:5px 0 8px;font-size:24px}#' + dialogId + ' .summary{font-size:13px;color:#52606d}' +
      '#' + dialogId + ' label{display:block;margin-top:12px;font-size:12px;font-weight:650;color:#344054}#' + dialogId + ' input,#' + dialogId + ' select{display:block;width:100%;height:46px;margin-top:6px;padding:0 12px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;color:#17212b;font-size:14px}' +
      '#' + dialogId + ' small{display:block;margin-top:5px;font-size:10px;font-weight:400;color:#667085}#' + dialogId + ' .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '#' + dialogId + ' .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}#' + dialogId + ' button{height:46px;border:0;border-radius:12px;background:#3569d4;color:#fff;font-size:14px;font-weight:700}#' + dialogId + ' button.secondary{border:1px solid #d0d5dd;background:#fff;color:#475467}';
  }

  function exposeTestApi() {
    window.__ZF_XHP_INTERNALS__ = { parseRecords: parseRecords, parseWeeks: parseWeeks, parseSections: parseSections, weeksToRule: weeksToRule, extractRecordArray: extractRecordArray, detectSemester: detectSemester };
  }
})();
