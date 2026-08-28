'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const windowObject = {
  __XHP_HUASHANG_TEST_MODE__: true,
  location: { href: 'https://jwxt.gzhs.edu.cn/jsxsd/xskb/xskb_list.do' }
};
const context = {
  window: windowObject,
  document: {},
  console,
  URL,
  Date,
  Number,
  String,
  Math,
  JSON,
  RegExp,
  Array,
  Object,
  parseInt,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  XHP: {
    getApiVersion: () => 3,
    getRuntimeMode: () => 'web',
    getActivationContext: () => JSON.stringify({ mode: 'web', actionId: null }),
    log: () => {}
  }
};
windowObject.window = windowObject;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'main.js' });

const api = windowObject.__HUASHANG_XHP_INTERNALS__;
const plain = value => JSON.parse(JSON.stringify(value));
assert(api, 'test API was not exposed');

assert.strictEqual(api.LOGIN_ENTRY_URL, 'https://jwxt.gzhs.edu.cn/jsxsd/');
assert.strictEqual(api.TIMETABLE_URL, 'https://jwxt.gzhs.edu.cn/jsxsd/xskb/xskb_list.do');
assert.strictEqual(api.MAX_SECTION_COUNT, 13);

for (const campus of ['guangzhou', 'zhaoqing']) {
  assert.strictEqual(api.SECTION_TIMES[campus].length, 13);
  api.SECTION_TIMES[campus].forEach((item, index) => {
    assert.strictEqual(item.sectionIndex, index + 1);
    assert(/^\d{2}:\d{2}$/.test(item.startTime));
    assert(/^\d{2}:\d{2}$/.test(item.endTime));
    assert(item.startTime < item.endTime);
  });
}
assert.deepStrictEqual(plain(api.SECTION_TIMES.guangzhou[0]), { sectionIndex: 1, startTime: '08:30', endTime: '09:15' });
assert.deepStrictEqual(plain(api.SECTION_TIMES.guangzhou[10]), { sectionIndex: 11, startTime: '20:35', endTime: '21:20' });
assert.deepStrictEqual(plain(api.SECTION_TIMES.guangzhou[12]), { sectionIndex: 13, startTime: '22:25', endTime: '23:10' });
assert.deepStrictEqual(plain(api.SECTION_TIMES.zhaoqing[0]), { sectionIndex: 1, startTime: '08:40', endTime: '09:25' });
assert.deepStrictEqual(plain(api.SECTION_TIMES.zhaoqing[7]), { sectionIndex: 8, startTime: '16:35', endTime: '17:20' });

assert.strictEqual(api.classifyLocation('广州校区 励志楼 A301'), 'guangzhou');
assert.strictEqual(api.classifyLocation('厚德楼 C214'), 'guangzhou');
assert.strictEqual(api.classifyLocation('肇庆校区 16号楼 212'), 'zhaoqing');
assert.strictEqual(api.classifyLocation('四会校区 7号楼 209'), 'zhaoqing');
assert.strictEqual(api.classifyLocation('线上课堂'), 'unknown');

const unknownCampus = api.detectCampus([{ schedules: [{ location: '线上课堂', weeks: [1, 2] }] }]);
assert.strictEqual(unknownCampus.campus, 'unknown');
const tiedCampus = api.detectCampus([{
  schedules: [
    { location: '励志楼 A101', weeks: [1, 2] },
    { location: '肇庆校区 6号楼', weeks: [1, 2] }
  ]
}]);
assert.strictEqual(tiedCampus.tied, true);

assert.deepStrictEqual(plain(api.parseWeeks('1-18周')), Array.from({ length: 18 }, (_, index) => index + 1));
assert.deepStrictEqual(plain(api.parseWeeks('1-17周(单)')), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
assert.deepStrictEqual(plain(api.parseSections('[01-02]节')), [1, 2]);
assert.deepStrictEqual(plain(api.parseSections('[01-02-03-04节]')), [1, 2, 3, 4]);
assert.deepStrictEqual(plain(api.parseSections('第10-11节')), [10, 11]);
assert.deepStrictEqual(plain(api.parseSections('第12-13节')), [12, 13]);
assert.deepStrictEqual(plain(api.parseSections('第13-14节')), []);
assert.strictEqual(api.looksLikeExplicitSectionLine('[01-02-03-04节]'), true);
assert.strictEqual(api.looksLikeExplicitSectionLine('[05-06节]'), true);
assert.strictEqual(api.guessSemesterStartDate('2026-2027-1'), '2026-08-31');

const grouped = api.groupCourses([
  { name: '大学英语', teacher: '陈老师', location: '励志楼 A201', dayOfWeek: 1, startSection: 1, endSection: 2, weeks: [1] },
  { name: '大学英语', teacher: '陈老师', location: '励志楼 A201', dayOfWeek: 1, startSection: 1, endSection: 2, weeks: [2] },
  { name: '大学英语', teacher: '陈老师', location: '厚德楼 B301', dayOfWeek: 3, startSection: 3, endSection: 4, weeks: [1, 2] }
]);
assert.strictEqual(grouped.length, 1);
assert.strictEqual(grouped[0].schedules.length, 2);
assert.deepStrictEqual(plain(grouped[0].schedules[0].weeks), [1, 2]);

function fakeCell(tagName, rowSpan = 1, colSpan = 1) {
  return {
    tagName,
    rowSpan,
    colSpan,
    getAttribute: name => name === 'rowspan' ? String(rowSpan) : (name === 'colspan' ? String(colSpan) : null)
  };
}
const spanning = fakeCell('TD', 2, 1);
const tableGrid = api.buildTableGrid({
  rows: [
    { children: [fakeCell('TH'), fakeCell('TH')] },
    { children: [fakeCell('TH'), spanning] },
    { children: [fakeCell('TH')] }
  ]
});
assert.strictEqual(tableGrid[1][1].origin, true);
assert.strictEqual(tableGrid[2][1].origin, false, 'rowspan continuation must not be parsed twice');

const parsed = {
  maxWeek: 18,
  maxSection: 13,
  courses: grouped
};
assert.strictEqual(api.shouldCreateSemester(
  { startDate: '2026-08-31', totalWeeks: 18, sectionCount: 12, currentWeek: 1 },
  { name: '2026-2027-1', startDate: '2026-08-31', totalWeeks: 18 },
  parsed
), true, 'a previous 12-section semester must be replaced with the Huashang 13-section model');
const payload = api.buildImportPayload(
  parsed,
  { startDate: null, totalWeeks: 0, sectionCount: 0, currentWeek: 0 },
  { name: '2026-2027-1', startDate: '2026-08-31', totalWeeks: 18 },
  { campus: 'zhaoqing' }
);
assert.strictEqual(payload.semester.sectionCount, 13);
assert.strictEqual(payload.sectionTimes.length, 13);

console.log('All Huashang plugin unit tests passed.');
