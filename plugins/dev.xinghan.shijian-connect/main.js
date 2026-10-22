(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.__shijianConnectMounted) { root.__shijianConnectMounted = true; api.mount(root); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function fail(code, message) { var error = new Error(message); error.code = code; return error; }
  var messages = {
    400: '课表格式或学期选择不受支持，请核对后重新预览。',
    401: '配对令牌已失效，请重新连接并填写时笺当前令牌。',
    403: '桌面尚未允许读取今日计划，请在时笺勾选摘要授权。',
    404: '预览不存在或已过期，请重新预览。',
    409: '桌面课表在预览后发生变化，请重新预览并确认。',
    413: '课表过大，请减少学期或课程范围。',
    429: '时笺的待确认预览较多，请稍后重试。'
  };
  function ConnectWorkflow(host, uuid, now) {
    this.host = host; this.uuid = uuid; this.now = now || Date.now;
    this.connection = null; this.payload = null; this.preview = null;
    this.expiresAt = 0; this.commitRequest = null; this.lastSync = null;
  }
  ConnectWorkflow.prototype.clearPreview = function () {
    this.preview = null; this.expiresAt = 0; this.commitRequest = null;
  };
  ConnectWorkflow.prototype.pair = async function () {
    this.connection = null;
    this.connection = await this.host('lan.pair', {});
    return this.connection;
  };
  ConnectWorkflow.prototype.disconnect = async function (forget) {
    this.connection = await this.host(forget ? 'lan.forget' : 'lan.disconnect', {});
    this.payload = null; this.clearPreview();
  };
  ConnectWorkflow.prototype.request = async function (path, body) {
    if (!this.connection || !this.connection.connected) throw fail('not_paired', '请先连接时笺。');
    var args = { path: path, method: body ? 'POST' : 'GET' };
    if (body) args.body = body;
    var result;
    try { result = await this.host('lan.request', args); }
    catch (error) {
      if (['preview_expired', 'preview_required', 'invalid_commit', 'invalid_selection'].indexOf(error.code) >= 0) this.clearPreview();
      throw error;
    }
    if (result.status < 200 || result.status >= 300) {
      if (result.status === 401) { this.connection = null; this.clearPreview(); }
      if ([400, 404, 409, 413].indexOf(result.status) >= 0) this.clearPreview();
      throw fail('http_' + result.status, messages[result.status] || '时笺未完成操作，请重试；提交重试会沿用同一编号。');
    }
    return result.body;
  };
  ConnectWorkflow.prototype.makePreview = async function () {
    this.clearPreview(); this.payload = null;
    var exported = await this.host('schedule.export', {});
    this.payload = exported.payload; // Native exporter v1, unchanged. No mapper or alternate JSON format.
    var receipt = await this.request('/api/v1/course-sync/preview', { payload: this.payload });
    if (!receipt || !Array.isArray(receipt.semesters) || !receipt.semesters.length || !receipt.previewId) {
      throw fail('invalid_response', '预览响应不完整，请重新预览。');
    }
    this.preview = receipt;
    this.expiresAt = this.now() + Math.min(300, receipt.expiresInSeconds) * 1000;
    return receipt;
  };
  ConnectWorkflow.prototype.commit = async function (keys) {
    if (!this.preview) throw fail('preview_required', '请先预览课表。');
    if (!this.commitRequest) {
      if (this.now() >= this.expiresAt) { this.clearPreview(); throw fail('preview_expired', '预览已过期，请重新预览。'); }
      var selected = Array.from(new Set(keys));
      if (!selected.length || selected.some(function (key) {
        return !this.preview.semesters.some(function (semester) { return semester.key === key; });
      }, this)) throw fail('invalid_selection', '请选择预览中的学期。');
      this.commitRequest = { previewId: this.preview.previewId, commitId: this.uuid(), semesterKeys: selected };
    }
    var result;
    try { result = await this.request('/api/v1/course-sync/commit', this.commitRequest); }
    catch (error) { if (error.code === 'cancelled') this.commitRequest = null; throw error; }
    if (result.committed !== true || result.commitId !== this.commitRequest.commitId) {
      throw fail('invalid_response', '暂未获得明确提交结果，请重试查询同一次提交。');
    }
    this.clearPreview(); this.payload = null; this.lastSync = result;
    return result;
  };
  ConnectWorkflow.prototype.today = function () { return this.request('/api/v1/today'); };

  function mount(win) {
    var doc = win.document;
    var dark = win.matchMedia && win.matchMedia('(prefers-color-scheme:dark)').matches;
    try {
      if (win.XHP && typeof win.XHP.getHostAppearance === 'function') {
        var appearance = JSON.parse(win.XHP.getHostAppearance());
        if (typeof appearance.dark === 'boolean') dark = appearance.dark;
      }
    } catch (_) { /* Fall back to the platform media preference. */ }
    doc.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var style = doc.createElement('style');
    style.textContent = `
:root { color-scheme: light dark; --bg:#f3f6fb; --surface:rgba(255,255,255,.76); --text:#1c2e48; --muted:#63758c; --brand:#386bd8; --soft:rgba(226,236,255,.72); --line:rgba(107,135,174,.16); --error:#ac302e; --good:#247864; --shadow:0 8px 28px rgba(56,81,126,.045); }
* { box-sizing:border-box; }
body { margin:0; background:radial-gradient(ellipse at 0 0,rgba(204,224,255,.6),transparent 54%),radial-gradient(ellipse at 100% 35%,rgba(222,242,237,.38),transparent 45%),var(--bg); color:var(--text); font:15px/1.65 system-ui,sans-serif; min-height:100vh; }
main { max-width:940px; margin:auto; padding:20px 18px 36px; }
h1,h2,p { margin:0; } h1 { font-size:24px; line-height:1.35; letter-spacing:.015em; font-weight:700; } h2 { font-size:17px; line-height:1.4; font-weight:650; }
small,.muted { color:var(--muted); } small { font-size:12px; }
.hero { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:0 4px 16px; }
.hero p { color:var(--muted); font-size:13px; margin-top:6px; }
.hero-art { width:78px; height:66px; flex-shrink:0; color:var(--brand); }
.eyebrow { color:var(--brand); font-size:11px; font-weight:650; letter-spacing:.11em; margin-bottom:5px; }
.flow { display:grid; gap:14px; }
section { min-width:0; padding:18px; border:1px solid rgba(255,255,255,.85); border-radius:20px; background:var(--surface); box-shadow:var(--shadow); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
.section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:13px; }
.title-group { display:flex; gap:9px; align-items:center; }
.step { display:inline-flex; align-items:center; justify-content:center; width:25px; height:25px; border-radius:9px; background:var(--soft); color:var(--brand); font-size:12px; font-weight:700; flex-shrink:0; }
.badge { display:inline-flex; align-items:center; gap:6px; border-radius:20px; background:rgba(113,132,156,.08); color:var(--muted); padding:4px 9px; font-size:11px; white-space:nowrap; }
.badge:before { content:''; width:5px; height:5px; border-radius:50%; background:currentColor; }
.badge.connected { color:var(--good); background:rgba(74,165,136,.09); }
#connection { font-size:13px; overflow-wrap:anywhere; color:var(--muted); }
.connection-note { font-size:12px; color:var(--muted); margin-top:12px; line-height:1.7; }
.actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:14px; }
button { min-height:46px; border:1px solid var(--line); border-radius:13px; padding:10px 15px; background:rgba(255,255,255,.52); color:var(--text); font:inherit; font-size:13px; line-height:1.5; font-weight:600; cursor:pointer; transition:background .16s,transform .16s; }
button.primary { background:var(--brand); border-color:transparent; color:white; box-shadow:0 4px 10px rgba(54,105,211,.10); }
button.secondary { color:var(--brand); background:var(--soft); border-color:transparent; }
button.quiet { padding-inline:9px; border-color:transparent; background:transparent; color:var(--muted); font-weight:500; }
button:disabled { opacity:.44; cursor:default; box-shadow:none; } button:focus-visible,input:focus-visible { outline:3px solid var(--brand); outline-offset:3px; }
button:active:not(:disabled) { transform:scale(.985); } @media(hover:hover) { button:hover:not(:disabled) { filter:brightness(.96); } }
#pair { flex:1; min-width:116px; } #preview,#commit { width:100%; display:flex; align-items:center; justify-content:center; gap:9px; margin-top:14px; }
button svg { width:17px; height:17px; flex-shrink:0; }
.status { display:flex; align-items:flex-start; gap:8px; min-height:32px; margin:0 4px 13px; color:var(--muted); font-size:12px; line-height:1.6; }
.status:before { content:''; display:block; width:6px; height:6px; border-radius:50%; background:var(--brand); flex-shrink:0; margin-top:7px; opacity:.65; }
.status.error { color:var(--error); } .status.error:before { background:var(--error); }
main[aria-busy=true] .status:before { width:10px; height:10px; margin-top:4px; border-radius:50%; border:2px solid var(--line); border-top-color:var(--brand); background:transparent; animation:loading .8s linear infinite; }
@keyframes loading { to { transform:rotate(360deg); } }
.description { font-size:13px; color:var(--muted); line-height:1.8; }
.empty { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--muted); margin-top:13px; } .empty svg { width:15px; height:15px; flex-shrink:0; }
.stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); background:var(--soft); border-radius:14px; margin:16px 0; padding:12px 6px; }
.stats span { display:flex; align-items:baseline; justify-content:center; gap:4px; color:var(--muted); font-size:11px; } .stats span+span { border-left:1px solid var(--line); } .stats strong { color:var(--brand); font-size:23px; line-height:1.3; font-weight:700; }
fieldset { border:0; padding:0; margin:0; } legend { font-size:12px; color:var(--muted); padding:0 0 5px; }
.row { display:flex; gap:11px; align-items:flex-start; padding:12px 0; cursor:pointer; border-bottom:1px solid var(--line); }
.row input { width:20px; height:20px; margin:3px 0 0; accent-color:var(--brand); flex-shrink:0; } .row span { min-width:0; overflow-wrap:anywhere; } .row strong { font-size:14px; font-weight:600; } .row small { display:block; margin-top:2px; font-size:11px; }
.note { border-left:2px solid rgba(56,107,216,.42); padding-left:10px; margin-top:14px; color:var(--muted); font-size:11px; line-height:1.85; } .note strong { color:var(--text); font-weight:550; }
#expiry { font-size:11px; color:var(--muted); margin-top:9px; }
.today .section-head { margin-bottom:8px; } .today h2 { font-size:16px; } .today .step { background:rgba(80,150,135,.09); color:var(--good); }
#today { min-height:40px; padding:8px 12px; white-space:nowrap; } #today-date { color:var(--muted); font-size:12px; margin-top:12px; }
#today-list { list-style:none; padding:0; margin:0; } #today-list li { padding:11px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; } #today-list li:last-child { border-bottom:0; padding-bottom:0; }
.task-title { font-size:14px; font-weight:550; } .task-meta { font-size:11px; color:var(--muted); display:block; margin-top:3px; }
[hidden] { display:none!important; }
@media(min-width:700px) { main { padding:28px 28px 42px; } .flow { grid-template-columns:minmax(250px,.9fr) minmax(0,1.35fr); gap:18px; align-items:start; } .sync { grid-column:2; grid-row:1 / span 2; } .today { grid-column:1; } section { padding:22px; } .hero { padding-bottom:20px; } }
@media(max-width:350px) { main { padding:16px 13px 28px; } section { padding:15px; } h1 { font-size:22px; } .hero-art { width:62px; } .actions { gap:3px; } button.quiet { padding-inline:7px; font-size:12px; } }
:root[data-theme=light] { color-scheme:light; }
:root[data-theme=dark] { color-scheme:dark; --bg:#111b2b; --surface:rgba(26,40,60,.83); --text:#e9f0fd; --muted:#a7b7cd; --brand:#709bfa; --soft:rgba(72,108,177,.17); --line:rgba(151,174,214,.16); --error:#ffb4ab; --good:#8bd0b8; --shadow:0 8px 24px rgba(0,0,0,.06); }
[data-theme=dark] body { background:radial-gradient(ellipse at 0 0,rgba(45,73,126,.34),transparent 60%),var(--bg); }
[data-theme=dark] section { border-color:rgba(159,186,224,.13); }
[data-theme=dark] button { background:rgba(52,73,105,.3); }
[data-theme=dark] button.primary { background:#416ed0; color:#fff; }
@media(prefers-reduced-motion:reduce) { button { transition:none; } button:active:not(:disabled) { transform:none; } main[aria-busy=true] .status:before { animation:none; } }
`;
    doc.head.appendChild(style);
    doc.body.innerHTML = `<main>
  <header class="hero">
    <div><p class="eyebrow">CLASS SCHEDULE × SHIJIAN</p><h1>课表同步到时笺</h1><p>从手机到电脑，每一节课都有安排</p></div>
    <svg class="hero-art" viewBox="0 0 86 72" fill="none" aria-hidden="true"><rect x="21" y="9" width="59" height="41" rx="9" fill="currentColor" opacity=".07"/><rect x="25" y="13" width="53" height="35" rx="6" stroke="currentColor" stroke-width="1.7"/><path d="M51 49v9m-11 1h24" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="4" y="27" width="26" height="40" rx="7" fill="var(--bg)" stroke="currentColor" stroke-width="1.7"/><path d="M14 32h6m-5 30h4M12 42h11m-11 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M37 31h23m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="73" cy="16" r="4" fill="#9acfc1"/></svg>
  </header>
  <p id="feedback" class="status" role="status" aria-live="polite">正在读取连接状态…</p>
  <div class="flow">
    <section class="connection-card">
      <div class="section-head"><div class="title-group"><span class="step" aria-hidden="true">01</span><h2>连接电脑</h2></div><span id="connection-status" class="badge">未连接</span></div>
      <p id="connection">先在电脑时笺开启“手机插件直连”</p>
      <div class="actions"><button id="pair" class="primary">连接电脑</button><button id="disconnect" class="quiet">断开</button><button id="forget" class="quiet">删除配对</button></div>
      <p class="connection-note">同一局域网 · 原生安全配对<br>地址与令牌默认仅本次使用，加密保存需主动勾选。</p>
    </section>
    <section class="sync">
      <div class="section-head"><div class="title-group"><span class="step" aria-hidden="true">02</span><h2>预览并同步课表</h2></div></div>
      <p class="description">选一个学期，或一次选择全部。<br>先核对课程与课次数，再确认同步。</p>
      <button id="preview" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v5m10-5v5M3 11h18m-14 5h4m3 0h3"/></svg>选择学期并预览</button>
      <div id="preview-content" hidden>
        <div id="stats" class="stats"></div>
        <fieldset><legend>选择本次同步的学期</legend><div id="semesters"></div></fieldset>
        <p class="note">将替换时笺中同名、同开始日学期的旧导入课次；个人任务、手工日程和其他课表保留。<br><strong>单次调课、停课不在当前JSON内，不会同步。</strong></p>
        <p id="expiry"></p><button id="commit" class="primary">确认并同步</button>
      </div>
      <p id="preview-empty" class="empty">选择学期后，预览会显示在这里</p>
    </section>
    <section class="today">
      <div class="section-head"><div class="title-group"><span class="step" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m5 12 4 4 10-11M5 21h14"/></svg></span><h2>时笺今日计划</h2></div><button id="today" class="secondary">读取摘要</button></div>
      <p class="description">桌面授权后只读展示，不修改任务。</p><p id="today-date"></p><ul id="today-list"></ul>
    </section>
  </div>
</main>`;
    var pending = new Map(), seq = 0, busy = false, selected = new Set(), feedback = doc.getElementById('feedback');
    function host(operation, args) {
      return new Promise(function (resolve, reject) {
        if (!win.XHP || typeof win.XHP.requestHost !== 'function' || win.XHP.getApiVersion() < 4) {
          reject(fail('host_too_old', '请先安装星瀚课程表1.5.0或更高版本。')); return;
        }
        var id = 'sj_' + (++seq), timer = win.setTimeout(function () {
          pending.delete(id); reject(fail('timeout', '操作超时。若正在提交，请连接后重试同一次提交。'));
        }, 120000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        if (!win.XHP.requestHost(id, operation, JSON.stringify(args))) {
          win.clearTimeout(timer); pending.delete(id); reject(fail('permission_denied', '宿主未授予此插件所需能力。'));
        }
      });
    }
    win.addEventListener('xhp:response', function (event) {
      var response = event.detail, callback = pending.get(response.id);
      if (!callback) return;
      pending.delete(response.id); win.clearTimeout(callback.timer);
      if (response.ok) callback.resolve(response.result);
      else callback.reject(fail(response.error.code, response.error.message));
    });
    function uuid() {
      if (win.crypto.randomUUID) return win.crypto.randomUUID();
      var bytes = new Uint8Array(16); win.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      var text = Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
      return text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20);
    }
    var workflow = new ConnectWorkflow(host, uuid);
    function say(message, error) { feedback.textContent = message; feedback.classList.toggle('error', !!error); }
    function render() {
      var connected = !!(workflow.connection && workflow.connection.connected);
      doc.getElementById('connection').textContent = connected ? workflow.connection.address + (workflow.connection.saved ? ' · 本机加密保存' : ' · 仅本次') : '先在电脑时笺开启“手机插件直连”';
      doc.getElementById('connection-status').textContent = connected ? '已连接' : '未连接';
      doc.getElementById('connection-status').classList.toggle('connected', connected);
      doc.getElementById('pair').textContent = connected ? '更换配对' : '连接电脑';
      ['pair', 'disconnect', 'forget', 'preview', 'commit', 'today'].forEach(function (id) {
        var disabled = busy;
        if (['preview', 'today', 'disconnect'].indexOf(id) >= 0) disabled = disabled || !connected;
        if (id === 'commit') disabled = disabled || !connected || !workflow.preview || !selected.size;
        doc.getElementById(id).disabled = disabled;
      });
      doc.getElementById('commit').textContent = workflow.commitRequest ? '重试同一次提交' : '确认并同步';
      doc.getElementById('preview-content').hidden = !workflow.preview;
      doc.getElementById('preview-empty').hidden = !!workflow.preview;
      doc.getElementById('preview-empty').textContent = workflow.lastSync ? '已同步 ' + workflow.lastSync.semesterCount + ' 个学期 · ' + workflow.lastSync.occurrenceCount + ' 个课次' : '选择学期后，预览会显示在这里';
      doc.querySelectorAll('#semesters input').forEach(function (input) { input.disabled = busy || !!workflow.commitRequest; });
      doc.querySelector('main').setAttribute('aria-busy', String(busy));
    }
    function previewRows() {
      var list = doc.getElementById('semesters'); list.textContent = ''; selected.clear();
      if (!workflow.preview) return;
      var courseCount = 0, occurrenceCount = 0;
      workflow.preview.semesters.forEach(function (semester) {
        selected.add(semester.key); courseCount += semester.courseCount; occurrenceCount += semester.occurrenceCount;
        var label = doc.createElement('label'); label.className = 'row';
        var input = doc.createElement('input'); input.type = 'checkbox'; input.checked = true;
        input.addEventListener('change', function () { if (input.checked) selected.add(semester.key); else selected.delete(semester.key); render(); });
        var text = doc.createElement('span'), title = doc.createElement('strong'), detail = doc.createElement('small');
        title.textContent = semester.name;
        detail.textContent = semester.startDate + ' 起 · ' + semester.weeks + '周 · ' + semester.courseCount + '门课程 · ' + semester.occurrenceCount + '课次';
        text.appendChild(title); text.appendChild(detail); label.appendChild(input); label.appendChild(text); list.appendChild(label);
      });
      var stats = doc.getElementById('stats'); stats.textContent = '';
      [[workflow.preview.semesters.length, '个学期'], [courseCount, '门课程'], [occurrenceCount, '个课次']].forEach(function (value) {
        var node = doc.createElement('span'), number = doc.createElement('strong'); number.textContent = value[0]; node.appendChild(number); node.appendChild(doc.createTextNode(' ' + value[1])); stats.appendChild(node);
      });
      doc.getElementById('expiry').textContent = '预览最多保留5分钟。过期或桌面课表变化时，需要重新预览。';
    }
    async function run(message, action) {
      if (busy) return;
      busy = true; say(message); render();
      try { var result = await action(); if (typeof result === 'string') say(result); }
      catch (error) { say(error.message || '操作未完成，请重试。', true); }
      finally { busy = false; render(); }
    }
    doc.getElementById('pair').onclick = function () { run('请在原生弹窗填写配对信息；随后检查连接…', async function () {
      await workflow.pair(); return '连接检查通过。请选择要同步的学期。';
    }); };
    doc.getElementById('disconnect').onclick = function () { run('正在断开…', async function () {
      await workflow.disconnect(false); return '已断开，本次临时连接已清除。';
    }); };
    doc.getElementById('forget').onclick = function () { run('正在删除本机保存…', async function () {
      await workflow.disconnect(true); return '已断开并删除保存的地址和令牌。';
    }); };
    doc.getElementById('preview').onclick = function () { run('请选择学期，随后向时笺请求只读预览…', async function () {
      await workflow.makePreview(); previewRows(); return '预览完成，请核对学期、课程数与课次数。';
    }); };
    doc.getElementById('commit').onclick = function () { run('正在确认并提交；请等待结果…', async function () {
      var result = await workflow.commit(Array.from(selected));
      return '同步完成：' + result.semesterCount + '个学期，' + result.occurrenceCount + '个课次。';
    }); };
    doc.getElementById('today').onclick = function () { run('正在读取时笺今日计划…', async function () {
      var list = doc.getElementById('today-list'); list.textContent = ''; doc.getElementById('today-date').textContent = '';
      doc.getElementById('today-date').textContent = '正在读取…';
      var result;
      try { result = await workflow.today(); }
      catch (error) { doc.getElementById('today-date').textContent = error.message; throw error; }
      doc.getElementById('today-date').textContent = result.date + (result.tasks && result.tasks.length ? ' · ' + result.tasks.length + ' 项计划' : ' · 今日暂无计划');
      var states = { Todo: '未开始', Doing: '进行中', Done: '已完成' };
      (result.tasks || []).slice(0, 100).forEach(function (task) {
        var item = doc.createElement('li');
        var title = doc.createElement('div'), meta = doc.createElement('span'); title.className = 'task-title'; meta.className = 'task-meta';
        title.textContent = task.title;
        meta.textContent = (states[task.state] || task.state) + ' · ' + Math.round(Math.max(0, Math.min(1, task.progress || 0)) * 100) + '%' + (task.estimateMinutes ? ' · 预计 ' + task.estimateMinutes + ' 分钟' : '');
        item.appendChild(title); item.appendChild(meta); list.appendChild(item);
      });
      return result.tasks && result.tasks.length ? '已读取只读摘要。' : '时笺今天暂无计划。';
    }); };
    function clearPending() {
      pending.forEach(function (callback) { win.clearTimeout(callback.timer); callback.reject(fail('connection_closed', '已因进入后台断开，请重新连接；未获结果的提交可继续重试。')); }); pending.clear();
      workflow.connection = null;
      doc.getElementById('today-list').textContent = ''; doc.getElementById('today-date').textContent = '';
      render();
    }
    win.addEventListener('xhp:resume', clearPending);
    win.addEventListener('pagehide', clearPending);
    run('正在读取连接状态…', async function () {
      workflow.connection = await host('lan.status', {});
      return workflow.connection.saved ? '检测到本机加密配对，请点“连接时笺”确认使用。' : '连接电脑后即可选择学期。默认仅本次使用凭据。';
    });
  }
  return { ConnectWorkflow: ConnectWorkflow, mount: mount };
});
