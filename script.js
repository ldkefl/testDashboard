// ===== 샘플 데이터 생성 =====
const ENDPOINTS = [
  { path: '/v1/users', method: 'GET', weight: 0.30 },
  { path: '/v1/orders', method: 'GET', weight: 0.22 },
  { path: '/v1/orders', method: 'POST', weight: 0.12 },
  { path: '/v1/products', method: 'GET', weight: 0.18 },
  { path: '/v1/auth/token', method: 'POST', weight: 0.10 },
  { path: '/v1/reports', method: 'GET', weight: 0.08 },
];

const RANGES = {
  '24h': { points: 24, stepMs: 3600e3, base: 4200, label: d => `${d.getHours()}시` },
  '7d':  { points: 7,  stepMs: 86400e3, base: 98000, label: d => `${d.getMonth() + 1}/${d.getDate()}` },
  '30d': { points: 30, stepMs: 86400e3, base: 95000, label: d => `${d.getMonth() + 1}/${d.getDate()}` },
};

const QUOTA_LIMIT = 5_000_000;
const AVG_BYTES_PER_REQ = 2.4 * 1024; // 약 2.4KB

const rand = (min, max) => Math.random() * (max - min) + min;
const pick = items => {
  let r = Math.random();
  for (const it of items) { if ((r -= it.weight) <= 0) return it; }
  return items[items.length - 1];
};

function generateSeries(rangeKey) {
  const cfg = RANGES[rangeKey];
  const now = Date.now();
  return Array.from({ length: cfg.points }, (_, i) => {
    const t = new Date(now - (cfg.points - 1 - i) * cfg.stepMs);
    // 24시간 범위는 낮 시간대에 트래픽이 많도록 곡선 적용
    const daily = rangeKey === '24h' ? 0.6 + 0.6 * Math.sin(((t.getHours() - 6) / 24) * Math.PI * 2) ** 2 : 1;
    const total = Math.round(cfg.base * daily * rand(0.85, 1.15));
    const errors = Math.round(total * rand(0.005, 0.035));
    return { t, label: cfg.label(t), success: total - errors, errors, latency: rand(80, 220) };
  });
}

// ===== 상태 =====
const state = {
  range: '24h',
  series: {},
  logs: [],
  quotaUsed: Math.round(QUOTA_LIMIT * rand(0.55, 0.75)),
  timer: null,
};
Object.keys(RANGES).forEach(k => (state.series[k] = generateSeries(k)));

// ===== 포맷 유틸 =====
const fmtNum = n => n.toLocaleString('ko-KR');
const fmtCompact = n => new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const fmtBytes = b => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 ? 2 : 1)} ${units[i]}`;
};
const $ = id => document.getElementById(id);

// ===== KPI =====
function setDelta(el, pct, goodWhenUp = true) {
  const up = pct >= 0;
  el.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% 이전 기간 대비`;
  el.className = 'kpi-delta ' + (up === goodWhenUp ? 'up' : 'down');
}

function renderKpis() {
  const s = state.series[state.range];
  const total = s.reduce((a, p) => a + p.success + p.errors, 0);
  const errors = s.reduce((a, p) => a + p.errors, 0);
  const latency = s.reduce((a, p) => a + p.latency, 0) / s.length;

  $('kpiRequests').textContent = fmtCompact(total);
  $('kpiData').textContent = fmtBytes(total * AVG_BYTES_PER_REQ);
  $('kpiError').textContent = `${((errors / total) * 100).toFixed(2)}%`;
  $('kpiLatency').textContent = `${Math.round(latency)} ms`;

  // 데모용 증감률 (범위별로 고정)
  const seed = { '24h': [8.4, 6.1, -0.3, -4.2], '7d': [12.7, 10.9, 0.4, 2.1], '30d': [21.3, 18.5, -0.8, -6.5] }[state.range];
  setDelta($('kpiRequestsDelta'), seed[0]);
  setDelta($('kpiDataDelta'), seed[1]);
  setDelta($('kpiErrorDelta'), seed[2], false);
  setDelta($('kpiLatencyDelta'), seed[3], false);
}

// ===== 라인 차트 (SVG) =====
function renderLineChart() {
  const box = $('lineChart');
  const s = state.series[state.range];
  const W = box.clientWidth, H = box.clientHeight;
  const pad = { t: 10, r: 10, b: 24, l: 44 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const maxY = Math.max(...s.map(p => p.success)) * 1.1;
  const x = i => pad.l + (s.length === 1 ? iw / 2 : (i / (s.length - 1)) * iw);
  const y = v => pad.t + ih - (v / maxY) * ih;

  const path = key => s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const area = `${path('success')}L${x(s.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (maxY / 4) * i;
    grid += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtCompact(Math.round(v))}</text>`;
  }
  const every = Math.ceil(s.length / Math.max(2, Math.floor(iw / 60)));
  const xLabels = s.map((p, i) => (i % every === 0 || i === s.length - 1)
    ? `<text class="axis-label" x="${x(i)}" y="${H - 6}" text-anchor="middle">${p.label}</text>` : '').join('');

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      ${grid}${xLabels}
      <path class="area-success" d="${area}"/>
      <path class="line-success" d="${path('success')}"/>
      <path class="line-error" d="${path('errors')}"/>
      <line class="hover-line" id="hoverLine" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>
      <rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent" id="hitArea"/>
    </svg>`;

  const tip = $('tooltip');
  const hover = $('hoverLine');
  const hit = $('hitArea');
  hit.addEventListener('mousemove', e => {
    const rect = box.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.max(0, Math.min(s.length - 1, Math.round(((mx - pad.l) / iw) * (s.length - 1))));
    const p = s[i];
    hover.setAttribute('x1', x(i));
    hover.setAttribute('x2', x(i));
    hover.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${p.label}</b><br>성공 ${fmtNum(p.success)} · 오류 ${fmtNum(p.errors)}`;
    tip.style.left = `${box.offsetLeft + x(i)}px`;
    tip.style.top = `${box.offsetTop + y(p.success)}px`;
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    hover.setAttribute('visibility', 'hidden');
  });
}

// ===== 할당량 게이지 =====
function renderQuota() {
  const pct = state.quotaUsed / QUOTA_LIMIT;
  const circ = 2 * Math.PI * 50;
  const fill = $('gaugeFill');
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = circ * (1 - Math.min(pct, 1));
  fill.style.stroke = pct > 0.9 ? 'var(--error)' : pct > 0.75 ? 'var(--warning)' : 'var(--accent)';

  $('quotaPct').textContent = `${(pct * 100).toFixed(1)}%`;
  $('quotaUsed').textContent = fmtNum(state.quotaUsed);
  $('quotaLimit').textContent = fmtNum(QUOTA_LIMIT);

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const days = Math.ceil((nextMonth - now) / 86400e3);
  $('quotaReset').textContent = `${days}일`;
}

// ===== 엔드포인트 막대 =====
function renderBars() {
  const s = state.series[state.range];
  const total = s.reduce((a, p) => a + p.success + p.errors, 0);
  const rows = ENDPOINTS.map(ep => ({ name: `${ep.method} ${ep.path}`, count: Math.round(total * ep.weight) }))
    .sort((a, b) => b.count - a.count);
  const max = rows[0].count;

  $('barChart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <span class="bar-name" title="${r.name}">${r.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.count / max) * 100}%"></div></div>
      <span class="bar-val">${fmtCompact(r.count)}</span>
    </div>`).join('');
}

// ===== 상태 코드 분포 =====
function renderStatus() {
  const s = state.series[state.range];
  const ok = s.reduce((a, p) => a + p.success, 0);
  const err = s.reduce((a, p) => a + p.errors, 0);
  const items = [
    { label: '2xx 성공', value: ok, color: 'var(--success)' },
    { label: '4xx 클라이언트 오류', value: Math.round(err * 0.72), color: 'var(--warning)' },
    { label: '5xx 서버 오류', value: Math.round(err * 0.28), color: 'var(--error)' },
  ];
  const total = items.reduce((a, it) => a + it.value, 0);

  $('statusList').innerHTML = `
    <div class="status-stack">
      ${items.map(it => `<div style="width:${(it.value / total) * 100}%;background:${it.color}"></div>`).join('')}
    </div>
    ${items.map(it => `
      <div class="status-item">
        <span><i style="background:${it.color}"></i>${it.label}</span>
        <span class="val">${fmtNum(it.value)} (${((it.value / total) * 100).toFixed(1)}%)</span>
      </div>`).join('')}`;
}

// ===== 요청 로그 =====
function makeLog(time = new Date()) {
  const ep = pick(ENDPOINTS);
  const r = Math.random();
  const status = r < 0.94 ? (ep.method === 'POST' ? 201 : 200) : r < 0.98 ? [400, 401, 404, 429][Math.floor(rand(0, 4))] : [500, 502, 503][Math.floor(rand(0, 3))];
  return {
    time,
    method: ep.method,
    path: ep.path,
    status,
    latency: Math.round(status >= 500 ? rand(800, 3000) : rand(30, 400)),
    size: Math.round(rand(200, 12000)),
    isNew: false,
  };
}

function renderLogs() {
  const q = $('logFilter').value.trim().toLowerCase();
  const rows = state.logs.filter(l => !q || `${l.method} ${l.path}`.toLowerCase().includes(q)).slice(0, 15);
  const tbody = $('logBody');
  tbody.innerHTML = '';
  for (const l of rows) {
    const tr = document.createElement('tr');
    if (l.isNew) tr.className = 'new';
    tr.innerHTML = `
      <td>${l.time.toLocaleTimeString('ko-KR')}</td>
      <td><span class="method">${l.method}</span></td>
      <td class="ep">${l.path}</td>
      <td><span class="badge s${String(l.status)[0]}">${l.status}</span></td>
      <td class="num">${fmtNum(l.latency)} ms</td>
      <td class="num">${fmtBytes(l.size)}</td>`;
    tbody.appendChild(tr);
    l.isNew = false;
  }
  if (!rows.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">일치하는 요청이 없습니다</td></tr>';
}

// ===== 실시간 시뮬레이션 =====
function tick() {
  const n = Math.floor(rand(1, 4));
  for (let i = 0; i < n; i++) {
    const log = makeLog();
    log.isNew = true;
    state.logs.unshift(log);

    // 모든 범위의 마지막 구간에 반영
    for (const k of Object.keys(state.series)) {
      const last = state.series[k].at(-1);
      log.status >= 400 ? last.errors++ : last.success++;
    }
  }
  state.logs.length = Math.min(state.logs.length, 100);
  state.quotaUsed += n * Math.floor(rand(20, 80)); // 데모용 가속
  renderAll();
}

function setLive(on) {
  clearInterval(state.timer);
  state.timer = on ? setInterval(tick, 2500) : null;
}

// ===== 전체 렌더 & 이벤트 =====
function renderAll() {
  renderKpis();
  renderLineChart();
  renderQuota();
  renderBars();
  renderStatus();
  renderLogs();
}

$('rangeSelect').addEventListener('click', e => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  document.querySelectorAll('#rangeSelect button').forEach(b => b.classList.toggle('active', b === btn));
  state.range = btn.dataset.range;
  renderAll();
});
$('liveToggle').addEventListener('change', e => setLive(e.target.checked));
$('logFilter').addEventListener('input', renderLogs);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderLineChart, 150);
});

// 초기 로그 채우기
for (let i = 0; i < 20; i++) state.logs.push(makeLog(new Date(Date.now() - i * rand(3000, 15000))));
state.logs.sort((a, b) => b.time - a.time);

renderAll();
setLive(true);
