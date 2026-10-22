'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectWorkflow } = require('../main.js');
const ID = '12345678-1234-4123-8123-123456789012';
const payload = { format: 'classschedule-semester', formatVersion: 1, semester: {
  name: 'fixture', key: 'semester', sectionTimes: [{sectionIndex: 1, startTime: '08:00', endTime: '08:45'}],
  courses: [{name: 'fixture', schedules: ['EVERY', 'ODD', 'EVEN', 'SPECIFIED', 'CONTINUOUS'].map(rule => ({
    dayOfWeek: 1, startSection: 1, endSection: 1, weekRuleType: rule, weekNumbers: rule === 'SPECIFIED' ? '1,3,5' : rule === 'CONTINUOUS' ? '2,4' : ''
  }))}]
}};
function fixture() {
  let now = 0, responseStatus = 200, networkFailure = false;
  const requests = [], writes = new Set();
  const host = async (op, args) => {
    if (op === 'lan.pair') return { connected: true, saved: false, address: 'http://192.168.1.2:19082' };
    if (op === 'schedule.export') return { payload };
    if (op === 'lan.disconnect' || op === 'lan.forget') return { connected: false, saved: false };
    assert.equal(op, 'lan.request'); requests.push(structuredClone(args));
    if (args.path.endsWith('/preview')) return { status: 200, body: {
      previewId: 'a'.repeat(32), expiresInSeconds: 300, semesters: [{key: 'semester', name: 'fixture', courseCount: 1, occurrenceCount: 10}]
    }};
    if (responseStatus !== 200) return { status: responseStatus, body: {} };
    if (args.path.endsWith('/commit')) {
      writes.add(args.body.commitId);
      if (networkFailure) { networkFailure = false; throw new Error('fixture lost response'); }
      return { status: 200, body: {committed: true, commitId: args.body.commitId, semesterCount: 1, occurrenceCount: 10} };
    }
    return { status: 200, body: {date: '2026-10-22', tasks: []} };
  };
  return { workflow: new ConnectWorkflow(host, () => ID, () => now), requests, writes,
    failNetwork() { networkFailure = true; }, status(value) { responseStatus = value; }, clock(value) { now = value; } };
}
test('native v1 payload and every week/section field are sent unchanged; preview never commits', async () => {
  const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview();
  assert.deepEqual(f.requests[0].body.payload, payload);
  assert.equal(f.requests.length, 1); assert.equal(f.writes.size, 0);
  assert.deepEqual(Object.keys(f.requests[0]).sort(), ['body', 'method', 'path']);
});
test('ambiguous network response retries the identical commitId/body even after expiry', async () => {
  const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview(); f.failNetwork();
  await assert.rejects(f.workflow.commit(['semester']), /lost response/);
  f.clock(900000); await f.workflow.pair(); await f.workflow.commit(['different-key-ignored-on-retry']);
  const commits = f.requests.filter(r => r.path.endsWith('/commit'));
  assert.deepEqual(commits[0].body, commits[1].body); assert.equal(f.writes.size, 1);
  assert.equal(f.workflow.preview, null);
});
test('expired new commits are blocked before HTTP', async () => {
  const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview(); f.clock(300000);
  await assert.rejects(f.workflow.commit(['semester']), {code: 'preview_expired'});
  assert.equal(f.writes.size, 0);
});
for (const status of [400, 404, 409, 413]) test('HTTP ' + status + ' requires a fresh preview without a write', async () => {
  const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview(); f.status(status);
  await assert.rejects(f.workflow.commit(['semester']), {code: 'http_' + status});
  assert.equal(f.workflow.preview, null); assert.equal(f.writes.size, 0);
});
test('HTTP 401 discards active connection and forces explicit pairing', async () => {
  const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview(); f.status(401);
  await assert.rejects(f.workflow.commit(['semester']), {code: 'http_401'});
  assert.equal(f.workflow.connection, null); assert.equal(f.workflow.preview, null);
});
test('today is read-only and denied access has no writes', async () => {
  const f = fixture(); await f.workflow.pair(); f.status(403);
  await assert.rejects(f.workflow.today(), {code: 'http_403'});
  assert.equal(f.writes.size, 0); assert.equal(f.requests[0].method, 'GET'); assert.equal(f.requests[0].body, undefined);
});
test('disconnect and forget clear exported payload and pending selection', async () => {
  for (const forget of [false, true]) {
    const f = fixture(); await f.workflow.pair(); await f.workflow.makePreview(); await f.workflow.disconnect(forget);
    assert.equal(f.workflow.payload, null); assert.equal(f.workflow.preview, null); assert.equal(f.workflow.commitRequest, null);
    assert.equal(f.workflow.connection.connected, false);
  }
});
