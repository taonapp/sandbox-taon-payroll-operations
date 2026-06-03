const $ = (id) => document.getElementById(id);

// === TABS ===
let activeMainTab = 'geral';
let folhaLoaded = false;
let opsLoaded = false;

document.querySelectorAll('[data-main-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-main-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeMainTab = btn.dataset.mainTab;
    $('tabGeral').classList.toggle('hidden', activeMainTab !== 'geral');
    $('tabFolha').classList.toggle('hidden', activeMainTab !== 'folha');

    if (activeMainTab === 'folha' && !folhaLoaded) loadDashboard();
    if (activeMainTab === 'geral' && !opsLoaded) loadOps();
  });
});

// === GERAL (OPERAÇÕES) ===
let currentYear, currentMonth;

function initMonth() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  loadOps();
}

function monthKey() {
  return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
}

function formatMonthLabel() {
  const d = new Date(currentYear, currentMonth, 1);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatDateTimeBR(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

const OP_COLORS = {
  meli: { accent: 'accent-yellow', badge: '#ffe600', badgeText: '#1a1a2e' },
  hagana: { accent: 'accent-blue', badge: '#3b82f6', badgeText: '#fff' },
  aster: { accent: 'accent-green', badge: '#22c55e', badgeText: '#fff' },
};

const CHIP_COLORS = { 'fisico': '#3b82f6', 'e-sim': '#a855f7' };
const CHIP_LABELS = { 'fisico': 'Físico', 'e-sim': 'eSIM' };

$('prevMonth').addEventListener('click', () => changeMonth(-1));
$('nextMonth').addEventListener('click', () => changeMonth(1));

async function loadOps() {
  $('monthLabel').textContent = formatMonthLabel();
  const isFirst = !opsLoaded;

  try {
    const res = await fetch(`/payroll-ops/api/operations/summary?month=${monthKey()}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    renderOperations(data);

    $('opsLoading').classList.add('hidden');
    $('operationSections').classList.remove('hidden');
    opsLoaded = true;
  } catch (err) {
    if (isFirst) $('opsLoading').textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

function renderOperations(data) {
  const container = $('operationSections');
  container.innerHTML = '';

  for (const [key, op] of Object.entries(data)) {
    const section = document.createElement('section');
    section.className = 'op-section';

    const colors = OP_COLORS[key] || OP_COLORS.hagana;
    const t = op.totals;
    const m = op.month;
    const diasComDados = op.timeline.length || 1;
    const media = (m.total / diasComDados).toFixed(1);

    let todayHtml = '';
    if (monthKey() === getCurrentMonth()) {
      const todayCount = op.today.length;
      todayHtml = `
        <div class="op-today">
          <span class="op-today-label">Hoje: <b>${todayCount}</b> cadastro${todayCount !== 1 ? 's' : ''}</span>
          ${todayCount > 0 ? `<button class="btn-detail op-today-btn" data-op="${key}" data-action="today">Ver</button>` : ''}
        </div>
      `;
    }

    section.innerHTML = `
      <div class="op-header">
        <h2 class="op-title">${op.label}</h2>
        <div class="op-codes">${op.codes.map(c => `<span class="op-code-badge" style="background:${colors.badge};color:${colors.badgeText}">${c}</span>`).join(' ')}</div>
        ${todayHtml}
      </div>
      <div class="cards-row">
        <div class="card ${colors.accent}">
          <span class="card-label">Total Historico</span>
          <span class="card-value">${Number(t.totalCadastrados).toLocaleString('pt-BR')}</span>
          <div class="card-breakdown">
            <span><span class="dot dot-blue"></span> Titulares: <b>${Number(t.titulares).toLocaleString('pt-BR')}</b></span>
            <span><span class="dot dot-purple"></span> Dependentes: <b>${Number(t.dependentes).toLocaleString('pt-BR')}</b></span>
          </div>
        </div>
        <div class="card accent-blue">
          <span class="card-label">Cadastros no Mes</span>
          <span class="card-value">${m.total.toLocaleString('pt-BR')}</span>
          <div class="card-breakdown">
            <span><span class="dot dot-blue"></span> Tit: <b>${m.titulares}</b></span>
            <span><span class="dot dot-purple"></span> Dep: <b>${m.dependentes}</b></span>
            <span style="color:var(--text-muted)">Media: <b>${media}</b>/dia</span>
          </div>
        </div>
        <div class="card accent-green">
          <span class="card-label">Chips Associados</span>
          <span class="card-value">${Number(t.totalChips).toLocaleString('pt-BR')}</span>
          <div class="card-breakdown">
            <span><span class="dot dot-blue"></span> Fisicos: <b>${Number(t.chipsFisicos).toLocaleString('pt-BR')}</b></span>
            <span><span class="dot dot-purple"></span> eSIM: <b>${Number(t.chipsEsim).toLocaleString('pt-BR')}</b></span>
          </div>
        </div>
        <div class="card accent-orange">
          <span class="card-label">Sem Chip</span>
          <span class="card-value">${Number(t.semChip).toLocaleString('pt-BR')}</span>
          <span class="card-sub">${t.totalCadastrados > 0 ? ((t.semChip / t.totalCadastrados) * 100).toFixed(1) + '% dos cadastrados' : ''}</span>
        </div>
      </div>
      <div class="cards-row">
        <div class="card">
          <span class="card-label">Cadastros por Dia</span>
          <div class="chart-container" id="chart-${key}"></div>
          <div class="chart-labels" id="chartLabels-${key}"></div>
        </div>
        <div class="card">
          <span class="card-label">Chips Associados por Dia</span>
          <div class="chart-legend" id="chipLegend-${key}"></div>
          <div class="chart-container" id="chipChart-${key}"></div>
          <div class="chart-labels" id="chipLabels-${key}"></div>
        </div>
      </div>
    `;
    container.appendChild(section);
    renderActivationChart(key, op.timeline);
    renderChipChart(key, op.chipTimeline);

    const todayBtn = section.querySelector('[data-action="today"]');
    if (todayBtn) todayBtn.addEventListener('click', () => showTodayModal(op));
  }
}

function renderActivationChart(key, data) {
  const chart = document.getElementById(`chart-${key}`);
  const labels = document.getElementById(`chartLabels-${key}`);
  chart.innerHTML = ''; labels.innerHTML = '';
  if (data.length === 0) { chart.innerHTML = '<div style="color:var(--text-muted);font-size:14px;text-align:center;width:100%;padding:30px 0">Nenhum cadastro no mes</div>'; return; }
  const maxVal = Math.max(...data.map(d => Number(d.total)), 1);
  data.forEach(d => {
    const wrap = document.createElement('div'); wrap.className = 'chart-bar-wrap';
    const val = document.createElement('span'); val.className = 'chart-bar-value'; val.textContent = d.total;
    const bar = document.createElement('div'); bar.className = 'chart-bar'; bar.style.height = Math.max((d.total / maxVal) * 100, 2) + 'px';
    wrap.appendChild(val); wrap.appendChild(bar); chart.appendChild(wrap);
    const slot = document.createElement('div'); slot.className = 'chart-label-slot'; slot.dataset.dia = d.dia; labels.appendChild(slot);
  });
  const step = data.length <= 15 ? 1 : data.length <= 30 ? 2 : 3;
  labels.querySelectorAll('.chart-label-slot').forEach((s, i) => {
    if (i % step === 0 || i === data.length - 1) { const l = document.createElement('span'); l.className = 'chart-bar-label'; l.textContent = formatDay(s.dataset.dia); s.appendChild(l); }
  });
  chart.addEventListener('scroll', () => { labels.scrollLeft = chart.scrollLeft; });
  labels.addEventListener('scroll', () => { chart.scrollLeft = labels.scrollLeft; });
}

function renderChipChart(key, data) {
  const chart = document.getElementById(`chipChart-${key}`);
  const legend = document.getElementById(`chipLegend-${key}`);
  const labels = document.getElementById(`chipLabels-${key}`);
  chart.innerHTML = ''; legend.innerHTML = ''; labels.innerHTML = '';
  if (data.length === 0) { chart.innerHTML = '<div style="color:var(--text-muted);font-size:14px;text-align:center;width:100%;padding:30px 0">Nenhum chip no mes</div>'; return; }
  const days = {}; const tipos = new Set();
  data.forEach(d => { if (!days[d.dia]) days[d.dia] = {}; days[d.dia][d.tipoChip] = Number(d.total); tipos.add(d.tipoChip); });
  const tipoList = ['fisico', 'e-sim'].filter(t => tipos.has(t));
  const dayEntries = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
  const maxVal = Math.max(...dayEntries.map(([, t]) => Object.values(t).reduce((s, v) => s + v, 0)), 1);
  tipoList.forEach(tipo => {
    const item = document.createElement('span'); item.className = 'chart-legend-item';
    item.innerHTML = `<span class="chart-legend-dot" style="background:${CHIP_COLORS[tipo]}"></span>${CHIP_LABELS[tipo]}`;
    legend.appendChild(item);
  });
  dayEntries.forEach(([dia, tipoCounts]) => {
    const total = Object.values(tipoCounts).reduce((s, v) => s + v, 0);
    const wrap = document.createElement('div'); wrap.className = 'chart-bar-wrap';
    const val = document.createElement('span'); val.className = 'chart-bar-value'; val.textContent = total || '';
    const stack = document.createElement('div'); stack.className = 'chart-bar-stack'; stack.style.height = Math.max((total / maxVal) * 100, 2) + 'px';
    tipoList.forEach(tipo => {
      const count = tipoCounts[tipo] || 0; if (!count) return;
      const seg = document.createElement('div'); seg.className = 'chart-bar-seg'; seg.style.flex = count; seg.style.background = CHIP_COLORS[tipo];
      stack.appendChild(seg);
    });
    wrap.appendChild(val); wrap.appendChild(stack); chart.appendChild(wrap);
    const slot = document.createElement('div'); slot.className = 'chart-label-slot'; slot.dataset.dia = dia; labels.appendChild(slot);
  });
  const step = dayEntries.length <= 15 ? 1 : dayEntries.length <= 30 ? 2 : 3;
  labels.querySelectorAll('.chart-label-slot').forEach((s, i) => {
    if (i % step === 0 || i === dayEntries.length - 1) { const l = document.createElement('span'); l.className = 'chart-bar-label'; l.textContent = formatDay(s.dataset.dia); s.appendChild(l); }
  });
  chart.addEventListener('scroll', () => { labels.scrollLeft = chart.scrollLeft; });
  labels.addEventListener('scroll', () => { chart.scrollLeft = labels.scrollLeft; });
}

function showTodayModal(op) {
  let modal = document.getElementById('todayModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'todayModal'; modal.className = 'modal-overlay hidden';
    modal.innerHTML = `<div class="modal"><div class="modal-header"><h2 id="todayModalTitle">Cadastros Hoje</h2><button class="btn-close" id="todayModalClose">&times;</button></div><div class="modal-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>ID</th><th>Nome</th><th>Tipo</th><th>Codigo</th><th>Chip</th><th>Cadastro</th></tr></thead><tbody id="todayModalBody"></tbody></table></div></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('todayModalClose').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  }
  document.getElementById('todayModalTitle').textContent = `Cadastros Hoje — ${op.label}`;
  const tbody = document.getElementById('todayModalBody'); tbody.innerHTML = '';
  if (op.today.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nenhum</td></tr>'; }
  else {
    op.today.forEach(r => {
      const tr = document.createElement('tr');
      const chip = r.tipoChip === 'fisico' ? '<span style="color:var(--blue)">Físico</span>' : r.tipoChip === 'e-sim' ? '<span style="color:var(--purple)">eSIM</span>' : '<span style="color:var(--text-muted)">Sem chip</span>';
      tr.innerHTML = `<td>${r.idUser}</td><td>${r.name||'-'}</td><td><span style="color:${r.tipo==='Titular'?'var(--blue)':'var(--purple)'}">${r.tipo}</span></td><td>${r.codigo||'-'}</td><td>${chip}</td><td>${formatDateTimeBR(r.dataCadastro)}</td>`;
      tbody.appendChild(tr);
    });
  }
  modal.classList.remove('hidden');
}

// === DESCONTO EM FOLHA ===
let dashData = null;
let currentView = 'total';

function formatNumber(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function formatCurrency(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function pct(part, total) { if (!total) return 0; return ((part / total) * 100).toFixed(1); }

function setPeriod() {
  const now = new Date();
  const day = now.getDate();
  let start, end;
  if (day > 7) { start = new Date(now.getFullYear(), now.getMonth(), 7); end = new Date(now.getFullYear(), now.getMonth() + 1, 7); }
  else { start = new Date(now.getFullYear(), now.getMonth() - 1, 7); end = new Date(now.getFullYear(), now.getMonth(), 7); }
  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  $('period').textContent = `Ciclo: ${fmt(start)} - ${fmt(end)}`;
}

function renderView(d) {
  $('totalLinhas').textContent = formatNumber(d.totalLinhas);
  $('receitaPotencial').textContent = formatCurrency(d.receitaPotencial);
  $('ticketMedio').textContent = formatCurrency(d.ticketMedio);
  $('titulares').textContent = formatNumber(d.titulares);
  $('dependentes').textContent = formatNumber(d.dependentes);
  $('receitaTitulares').textContent = formatCurrency(d.receitaTitulares);
  $('receitaDependentes').textContent = formatCurrency(d.receitaDependentes);
  $('ticketMedioTitulares').textContent = formatCurrency(d.ticketMedioTitulares);
  $('ticketMedioDependentes').textContent = formatCurrency(d.ticketMedioDependentes);
  const pctTit = pct(Number(d.titulares), Number(d.totalLinhas));
  const pctDep = pct(Number(d.dependentes), Number(d.totalLinhas));
  $('barLinhasTit').style.width = pctTit + '%'; $('barLinhasTit').textContent = pctTit > 10 ? pctTit + '%' : '';
  $('barLinhasDep').style.width = pctDep + '%'; $('barLinhasDep').textContent = pctDep > 10 ? pctDep + '%' : '';
  $('pctLinhasTit').textContent = pctTit + '%'; $('pctLinhasDep').textContent = pctDep + '%';
  const pctRecTit = pct(Number(d.receitaTitulares), Number(d.receitaPotencial));
  const pctRecDep = pct(Number(d.receitaDependentes), Number(d.receitaPotencial));
  $('barReceitaTit').style.width = pctRecTit + '%'; $('barReceitaTit').textContent = pctRecTit > 10 ? pctRecTit + '%' : '';
  $('barReceitaDep').style.width = pctRecDep + '%'; $('barReceitaDep').textContent = pctRecDep > 10 ? pctRecDep + '%' : '';
  $('pctReceitaTit').textContent = pctRecTit + '%'; $('pctReceitaDep').textContent = pctRecDep + '%';
}

async function loadDashboard() {
  const isFirst = !dashData;
  try {
    const res = await fetch('/payroll-ops/api/dashboard');
    if (!res.ok) throw new Error('Erro na API');
    dashData = await res.json();
    renderView(dashData[currentView]);
    $('folhaLoading').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    folhaLoaded = true;
  } catch (err) {
    if (isFirst) $('folhaLoading').textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

document.querySelectorAll('.tab[data-view]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-view]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    if (dashData) renderView(dashData[currentView]);
  });
});

// === REFRESH ===
async function loadAllDash() {
  if (activeMainTab === 'geral') await loadOps();
  else await loadDashboard();
}

// === INIT ===
initMonth();
setPeriod();
loadOps();
initRefreshBar('refreshContainer', loadAllDash);
