const $ = (id) => document.getElementById(id);

let allUsers = [];
let currentFilter = 'all';
let evoFilter = 'all';
let searchTerm = '';
let selectedRefDate = '';

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

function formatDateTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTimeBR(d) {
  if (!d) return '-';
  const dt = new Date(d);
  dt.setHours(dt.getHours() - 3);
  return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

let loaded = false;
let selectedMonth = '';

function getCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const names = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return names[Number(m) - 1] + ' ' + y;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function updateMonthNav() {
  $('monthLabel').textContent = formatMonthLabel(selectedMonth);
}

let selectedChipMonth = '';

async function loadTimeline() {
  const res = await fetch(`/payroll-ops/api/meli/timeline?month=${selectedMonth}`);
  if (!res.ok) throw new Error('API error');
  const timeline = await res.json();
  renderTimeline(timeline);
}

async function loadChipTimeline() {
  const res = await fetch(`/payroll-ops/api/meli/chips-timeline?month=${selectedChipMonth}`);
  if (!res.ok) throw new Error('API error');
  const data = await res.json();
  renderChipTimeline(data);
}

function getCurrentRefDate() {
  const now = new Date();
  return now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
}

async function loadRefDates() {
  const res = await fetch('/payroll-ops/api/meli/ref-dates');
  if (!res.ok) return [];
  return res.json();
}

async function loadUsers() {
  const [usersRes, evoRes] = await Promise.all([
    fetch(`/payroll-ops/api/meli/users?refDate=${selectedRefDate}`),
    fetch(`/payroll-ops/api/meli/evolution?refDate=${selectedRefDate}`),
  ]);
  if (!usersRes.ok) throw new Error('API error');
  allUsers = await usersRes.json();
  const evolution = evoRes.ok ? await evoRes.json() : null;
  renderEvolution(evolution);
  renderTable();
}

async function loadPendingChips() {
  const [physRes, esimRes] = await Promise.all([
    fetch('/payroll-ops/api/meli/pending-chips?type=physical'),
    fetch('/payroll-ops/api/meli/pending-chips?type=esim'),
  ]);

  if (physRes.ok) renderPendingSection(await physRes.json(), 'pendingChipsSection', 'pendingTableBody', 'pendingCount');
  if (esimRes.ok) renderPendingSection(await esimRes.json(), 'pendingEsimSection', 'pendingEsimTableBody', 'pendingEsimCount');
}

function renderPendingSection(rows, sectionId, tbodyId, countId) {
  const section = $(sectionId);
  const tbody = $(tbodyId);

  if (rows.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  $(countId).textContent = rows.length + ' pendente' + (rows.length !== 1 ? 's' : '');

  tbody.innerHTML = '';
  const now = new Date();
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const cadastro = new Date(r.dataCadastro);
    const diffMs = now.getTime() - cadastro.getTime();
    const dias = Math.max(0, Math.floor(diffMs / 86400000));
    const diasClass = dias >= 7 ? 'danger' : dias >= 3 ? 'warn' : '';
    tr.innerHTML = `
      <td>${r.idUser}</td>
      <td>${r.name || '-'}</td>
      <td>${r.idMotorista || '-'}</td>
      <td><span style="color:${r.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${r.tipo}</span></td>
      <td><span style="color:${r.status === 'enabled' ? 'var(--green)' : 'var(--text-muted)'}">${r.status || '-'}</span></td>
      <td>${formatDateTimeBR(r.dataCadastro)}</td>
      <td>${r.productName || '-'}</td>
      <td>${r.amount ? formatCurrency(r.amount) : '-'}</td>
      <td>${r.companyName || '-'}</td>
      <td><span class="days-pending ${diasClass}">${dias}d</span></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadAll() {
  const isFirstLoad = !loaded;

  if (isFirstLoad) {
    $('loading').classList.remove('hidden');
    $('page').classList.add('hidden');
    selectedMonth = getCurrentMonth();
    selectedChipMonth = getCurrentMonth();
    updateMonthNav();
    $('chipMonthLabel').textContent = formatMonthLabel(selectedChipMonth);
  }

  try {
    const [summaryRes, refDates] = await Promise.all([
      fetch('/payroll-ops/api/meli/summary'),
      loadRefDates(),
    ]);

    if (!summaryRes.ok) throw new Error('API error');
    const summary = await summaryRes.json();

    // Populate refDate select
    if (isFirstLoad && refDates.length > 0) {
      const select = $('refDateSelect');
      select.innerHTML = '';
      const currentRef = getCurrentRefDate();
      refDates.forEach(rd => {
        const opt = document.createElement('option');
        opt.value = rd;
        const y = rd.substring(0, 4);
        const m = rd.substring(4, 6);
        const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        opt.textContent = names[Number(m) - 1] + '/' + y;
        select.appendChild(opt);
      });
      selectedRefDate = refDates.includes(currentRef) ? currentRef : refDates[0];
      select.value = selectedRefDate;
    }

    const [usersRes, evolutionRes] = await Promise.all([
      fetch(`/payroll-ops/api/meli/users?refDate=${selectedRefDate}`),
      fetch(`/payroll-ops/api/meli/evolution?refDate=${selectedRefDate}`),
    ]);
    if (!usersRes.ok) throw new Error('API error');
    allUsers = await usersRes.json();
    const evolution = evolutionRes.ok ? await evolutionRes.json() : null;

    renderSummary(summary);
    renderEvolution(evolution);
    renderPieChart(allUsers);
    await Promise.all([loadTimeline(), loadChipTimeline(), loadPendingChips()]);
    renderTable();

    if (isFirstLoad) {
      $('loading').classList.add('hidden');
      $('page').classList.remove('hidden');
      loaded = true;
    }
  } catch (err) {
    if (isFirstLoad) {
      $('loading').textContent = 'Erro ao carregar dados.';
    }
    console.error(err);
  }
}

function renderSummary(s) {
  const totalCad = Number(s.totalCadastrados) || 0;
  const ativos = Number(s.ativosAtualmente) || 0;
  const comChip = Number(s.ativosComChip) || 0;
  const apn = Number(s.ativosApn) || 0;

  const pct = (v, base) => base > 0 ? ((v / base) * 100).toFixed(1) : '0.0';

  const titCad = Number(s.titularesCadastrados) || 0;
  const depCad = Number(s.dependentesCadastrados) || 0;
  const naoEleg = totalCad - ativos;
  const chipFisico = Number(s.ativosChipFisico) || 0;
  const chipEsim = Number(s.ativosChipEsim) || 0;
  const pendFisico = Number(s.pendenteFisico) || 0;
  const pendEsim = Number(s.pendenteEsim) || 0;
  const naoElegApn = Number(s.naoElegiveisApn) || 0;

  // Stage 1: Cadastrados
  $('fCadastrados').textContent = totalCad.toLocaleString('pt-BR');
  $('fTitCad').textContent = titCad.toLocaleString('pt-BR');
  $('fTitCadPct').textContent = '(' + pct(titCad, totalCad) + '%)';
  $('fDepCad').textContent = depCad.toLocaleString('pt-BR');
  $('fDepCadPct').textContent = '(' + pct(depCad, totalCad) + '%)';
  $('fBar1').style.width = '100%';

  // Stage 2: Elegíveis
  $('fAtivos').textContent = ativos.toLocaleString('pt-BR');
  $('fNaoElegiveis').textContent = naoEleg.toLocaleString('pt-BR');
  $('fNaoElegPct').textContent = '(' + pct(naoEleg, totalCad) + '%)';
  $('fBar2').style.width = pct(ativos, totalCad) + '%';
  $('fConv1').textContent = pct(ativos, totalCad) + '% conversão';

  // Stage 3: Com Chip
  $('fComChip').textContent = comChip.toLocaleString('pt-BR');
  $('fChipFisico').textContent = chipFisico.toLocaleString('pt-BR');
  $('fChipFisicoPct').textContent = '(' + pct(chipFisico, comChip) + '%)';
  $('fChipEsim').textContent = chipEsim.toLocaleString('pt-BR');
  $('fChipEsimPct').textContent = '(' + pct(chipEsim, comChip) + '%)';
  $('fPendFisico').textContent = pendFisico.toLocaleString('pt-BR');
  $('fPendFisicoPct').textContent = '(' + pct(pendFisico, totalCad) + '%)';
  $('fPendEsim').textContent = pendEsim.toLocaleString('pt-BR');
  $('fPendEsimPct').textContent = '(' + pct(pendEsim, totalCad) + '%)';
  $('fBar3').style.width = pct(comChip, totalCad) + '%';
  $('fConv2').textContent = pct(comChip, ativos) + '% dos elegíveis';

  // Stage 4: APN
  $('fApn').textContent = apn.toLocaleString('pt-BR');
  $('fApnNaoEleg').textContent = naoElegApn.toLocaleString('pt-BR');
  $('fApnNaoElegPct').textContent = '(' + pct(naoElegApn, totalCad) + '%)';
  $('fBar4').style.width = pct(apn, totalCad) + '%';
  $('fConv3').textContent = pct(apn, comChip) + '% dos com chip';

  // Receita
  $('receitaTotal').textContent = formatCurrency(s.receitaTotal);
  $('ticketMedio').textContent = formatCurrency(s.ticketMedio);
}

function formatRefDateLabel(rd) {
  if (!rd) return '-';
  const y = rd.substring(0, 4);
  const m = rd.substring(4, 6);
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return names[Number(m) - 1] + '/' + y;
}

function renderEvolution(ev) {
  if (!ev || !ev.refDate) return;

  const prevLabel = formatRefDateLabel(ev.prevRefDate);
  const currLabel = formatRefDateLabel(ev.refDate);
  const totalCad = Number(ev.totalUsuarios) || 0;
  const entraram = Number(ev.entraramNaBase) || 0;
  const sairam = Number(ev.sairamDaBase) || 0;

  $('fEntraram').textContent = entraram.toLocaleString('pt-BR');
  $('fEntraramPct').textContent = totalCad > 0 ? '(' + ((entraram / totalCad) * 100).toFixed(1) + '%)' : '';
  $('fEntraramSub').textContent = `no ciclo ${currLabel}`;

  $('fSairam').textContent = sairam.toLocaleString('pt-BR');
  $('fSairamPct').textContent = totalCad > 0 ? '(' + ((sairam / totalCad) * 100).toFixed(1) + '%)' : '';
  $('fSairamSub').textContent = `${prevLabel} → ${currLabel}`;
}

const PIE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

const tooltip = $('tooltip');

function positionTooltip(e) {
  const rect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = e.clientX + 12;
  let top = e.clientY - 8;

  if (left + rect.width > vw) left = e.clientX - rect.width - 12;
  if (top + rect.height > vh) top = e.clientY - rect.height - 8;
  if (left < 0) left = 4;
  if (top < 0) top = 4;

  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function showTooltip(e, html) {
  tooltip.innerHTML = html;
  tooltip.classList.remove('hidden');
  positionTooltip(e);
}

function hideTooltip() {
  tooltip.classList.add('hidden');
}

function moveTooltip(e) {
  positionTooltip(e);
}

function renderPieChart(users) {
  const counts = {};
  users.forEach(u => {
    const label = u.productName || 'Sem plano';
    counts[label] = (counts[label] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = users.length || 1;

  const size = 180;
  const cx = size / 2, cy = size / 2, r = size / 2;
  let startAngle = -Math.PI / 2;

  const pieEl = $('pieChart');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  entries.forEach(([label, count], i) => {
    const pct = count / total;
    const angle = pct * Math.PI * 2;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const color = PIE_COLORS[i % PIE_COLORS.length];

    let d;
    if (entries.length === 1) {
      d = `M ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx - 0.01},${cy - r} Z`;
    } else {
      d = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color);
    path.style.transition = 'opacity 0.15s';
    path.style.cursor = 'default';

    const ttHtml = `<span class="tt-color" style="background:${color}"></span>${label}: <span class="tt-value">${count}</span> (${(pct * 100).toFixed(1)}%)`;
    path.addEventListener('mouseenter', (e) => {
      showTooltip(e, ttHtml);
      path.style.opacity = '0.8';
    });
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', () => {
      hideTooltip();
      path.style.opacity = '1';
    });

    svg.appendChild(path);
    startAngle = endAngle;
  });

  pieEl.innerHTML = '';
  pieEl.appendChild(svg);

  const legend = $('pieLegend');
  legend.innerHTML = '';
  entries.forEach(([label, count], i) => {
    const pct = ((count / total) * 100).toFixed(1);
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const item = document.createElement('div');
    item.className = 'pie-legend-item';
    item.innerHTML = `
      <span class="pie-legend-dot" style="background:${color}"></span>
      <span><b>${count}</b> ${label}</span>
      <span class="pie-legend-pct">${pct}%</span>
    `;
    legend.appendChild(item);
  });
}

function renderTimeline(data) {
  const chart = $('chart');
  const legend = $('chartLegend');
  const labels = $('chartLabels');
  chart.innerHTML = '';
  legend.innerHTML = '';
  labels.innerHTML = '';

  if (data.length === 0) {
    const [y, m] = selectedMonth.split('-');
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    chart.innerHTML = '<div style="color:var(--text-muted);font-size:18px;text-align:center;width:100%;padding:40px 0">Nenhuma ativação em ' + monthNames[Number(m) - 1] + ' de ' + y + '</div>';
    return;
  }

  const days = {};
  const planos = new Set();
  data.forEach(d => {
    if (!days[d.dia]) days[d.dia] = {};
    days[d.dia][d.plano] = Number(d.total);
    planos.add(d.plano);
  });

  const sortedDays = Object.keys(days).sort();
  const startDate = new Date(sortedDays[0] + 'T12:00:00');
  const isCurrentMonth = selectedMonth === getCurrentMonth();
  let endDate;
  if (isCurrentMonth) {
    endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
  } else {
    const [y, m] = selectedMonth.split('-').map(Number);
    endDate = new Date(y, m, 0, 12, 0, 0);
  }
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!days[key]) days[key] = {};
  }

  const planoList = [...planos];
  const dayEntries = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
  const maxVal = Math.max(...dayEntries.map(([, p]) => Object.values(p).reduce((s, v) => s + v, 0)), 1);

  planoList.forEach((plano, i) => {
    const item = document.createElement('span');
    item.className = 'chart-legend-item';
    item.innerHTML = `<span class="chart-legend-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>${plano}`;
    legend.appendChild(item);
  });

  dayEntries.forEach(([dia, planoCounts]) => {
    const total = Object.values(planoCounts).reduce((s, v) => s + v, 0);
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const valLabel = document.createElement('span');
    valLabel.className = 'chart-bar-value';
    valLabel.textContent = total || '';

    const barStack = document.createElement('div');
    barStack.className = 'chart-bar-stack';
    barStack.style.height = Math.max((total / maxVal) * 120, 2) + 'px';

    planoList.forEach((plano, i) => {
      const count = planoCounts[plano] || 0;
      if (count === 0) return;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      const seg = document.createElement('div');
      seg.className = 'chart-bar-seg';
      seg.style.flex = count;
      seg.style.background = color;

      const ttHtml = `<span class="tt-color" style="background:${color}"></span>${plano}: <span class="tt-value">${count}</span> (${formatDay(dia)})`;
      seg.addEventListener('mouseenter', (e) => showTooltip(e, ttHtml));
      seg.addEventListener('mousemove', moveTooltip);
      seg.addEventListener('mouseleave', hideTooltip);

      barStack.appendChild(seg);
    });

    wrap.appendChild(valLabel);
    wrap.appendChild(barStack);
    chart.appendChild(wrap);

    const slot = document.createElement('div');
    slot.className = 'chart-label-slot';
    slot.dataset.dia = dia;
    labels.appendChild(slot);
  });

  // Show labels at intervals to avoid overlap
  const totalDays = dayEntries.length;
  const step = totalDays <= 15 ? 1 : totalDays <= 30 ? 2 : 3;
  const slots = labels.querySelectorAll('.chart-label-slot');
  slots.forEach((slot, i) => {
    if (i % step === 0 || i === totalDays - 1) {
      const label = document.createElement('span');
      label.className = 'chart-bar-label';
      label.textContent = formatDay(slot.dataset.dia);
      slot.appendChild(label);
    }
  });

  // Sync horizontal scroll
  chart.addEventListener('scroll', () => { labels.scrollLeft = chart.scrollLeft; });
  labels.addEventListener('scroll', () => { chart.scrollLeft = labels.scrollLeft; });
}

const CHIP_COLORS = { 'fisico': '#3b82f6', 'e-sim': '#a855f7' };
const CHIP_LABELS = { 'fisico': 'Físico', 'e-sim': 'eSIM' };

function renderChipTimeline(data) {
  const chart = $('chipChart');
  const legend = $('chipChartLegend');
  const labels = $('chipChartLabels');
  chart.innerHTML = '';
  legend.innerHTML = '';
  labels.innerHTML = '';

  if (data.length === 0) {
    const [y, m] = selectedChipMonth.split('-');
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    chart.innerHTML = '<div style="color:var(--text-muted);font-size:18px;text-align:center;width:100%;padding:40px 0">Nenhum chip em ' + monthNames[Number(m) - 1] + ' de ' + y + '</div>';
    return;
  }

  const days = {};
  const tipos = new Set();
  data.forEach(d => {
    if (!days[d.dia]) days[d.dia] = {};
    days[d.dia][d.tipoChip] = Number(d.total);
    tipos.add(d.tipoChip);
  });

  const sortedDays = Object.keys(days).sort();
  const startDate = new Date(sortedDays[0] + 'T12:00:00');
  const isCurrentMonth = selectedChipMonth === getCurrentMonth();
  let endDate;
  if (isCurrentMonth) {
    endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
  } else {
    const [y, m] = selectedChipMonth.split('-').map(Number);
    endDate = new Date(y, m, 0, 12, 0, 0);
  }
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!days[key]) days[key] = {};
  }

  const tipoList = ['fisico', 'e-sim'].filter(t => tipos.has(t));
  const dayEntries = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
  const maxVal = Math.max(...dayEntries.map(([, t]) => Object.values(t).reduce((s, v) => s + v, 0)), 1);

  tipoList.forEach(tipo => {
    const item = document.createElement('span');
    item.className = 'chart-legend-item';
    item.innerHTML = `<span class="chart-legend-dot" style="background:${CHIP_COLORS[tipo]}"></span>${CHIP_LABELS[tipo]}`;
    legend.appendChild(item);
  });

  dayEntries.forEach(([dia, tipoCounts]) => {
    const total = Object.values(tipoCounts).reduce((s, v) => s + v, 0);
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const valLabel = document.createElement('span');
    valLabel.className = 'chart-bar-value';
    valLabel.textContent = total || '';

    const barStack = document.createElement('div');
    barStack.className = 'chart-bar-stack';
    barStack.style.height = Math.max((total / maxVal) * 120, 2) + 'px';

    tipoList.forEach(tipo => {
      const count = tipoCounts[tipo] || 0;
      if (count === 0) return;
      const color = CHIP_COLORS[tipo];
      const seg = document.createElement('div');
      seg.className = 'chart-bar-seg';
      seg.style.flex = count;
      seg.style.background = color;

      const ttHtml = `<span class="tt-color" style="background:${color}"></span>${CHIP_LABELS[tipo]}: <span class="tt-value">${count}</span> (${formatDay(dia)})`;
      seg.addEventListener('mouseenter', (e) => showTooltip(e, ttHtml));
      seg.addEventListener('mousemove', moveTooltip);
      seg.addEventListener('mouseleave', hideTooltip);

      barStack.appendChild(seg);
    });

    wrap.appendChild(valLabel);
    wrap.appendChild(barStack);
    chart.appendChild(wrap);

    const slot = document.createElement('div');
    slot.className = 'chart-label-slot';
    slot.dataset.dia = dia;
    labels.appendChild(slot);
  });

  const totalDays = dayEntries.length;
  const step = totalDays <= 15 ? 1 : totalDays <= 30 ? 2 : 3;
  const slots = labels.querySelectorAll('.chart-label-slot');
  slots.forEach((slot, i) => {
    if (i % step === 0 || i === totalDays - 1) {
      const label = document.createElement('span');
      label.className = 'chart-bar-label';
      label.textContent = formatDay(slot.dataset.dia);
      slot.appendChild(label);
    }
  });

  chart.addEventListener('scroll', () => { labels.scrollLeft = chart.scrollLeft; });
  labels.addEventListener('scroll', () => { chart.scrollLeft = labels.scrollLeft; });
}

function renderTable() {
  const tbody = $('tableBody');
  tbody.innerHTML = '';

  const filtered = allUsers.filter(u => {
    if (currentFilter !== 'all' && u.tipo !== currentFilter) return false;
    if (evoFilter === 'ativo') { if (u.evolucao !== 'permaneceu' && u.evolucao !== 'entrou') return false; }
    else if (evoFilter === 'fora') { if (u.naBase !== 'Nao') return false; }
    else if (evoFilter !== 'all' && u.evolucao !== evoFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const match = String(u.idUser).includes(term)
        || String(u.idMotorista || '').toLowerCase().includes(term);
      if (!match) return false;
    }
    return true;
  });

  $('resultCount').textContent = `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="19" style="text-align:center;color:var(--text-muted)">Nenhum usuario encontrado</td></tr>';
    return;
  }

  const nivelLabel = (levelName) => {
    if (!levelName) return '-';
    const map = { Silver: 'Prata', Gold: 'Ouro', Platinum: 'Platina' };
    return map[levelName] || levelName;
  };

  const movLabel = (mov) => {
    if (!mov) return '-';
    const map = { Up: 'Subiu', Down: 'Desceu', Flat: 'Manteve' };
    return map[mov] || mov;
  };

  filtered.forEach(u => {
    const tr = document.createElement('tr');
    const statusColor = u.status === 'enabled' ? 'var(--green)' : 'var(--text-muted)';
    const paymentLabel = u.paymentMethod === 'payroll' ? 'Folha' : (u.paymentMethod || '-');
    const naBaseColor = u.naBase === 'Sim' ? 'var(--green)' : 'var(--orange)';
    const nivel = nivelLabel(u.nivelMeli);
    let movText, movColor;
    if (u.naBase === 'Nao' && u.naBaseAnterior === 'Sim') {
      movText = 'Nao elegivel';
      movColor = '#ef4444';
    } else if (u.naBase === 'Nao' && u.naBaseAnterior === 'Nao') {
      movText = '-';
      movColor = 'var(--text-muted)';
    } else {
      movText = movLabel(u.movimento);
      movColor = u.movimento === 'Up' ? 'var(--green)' : u.movimento === 'Down' ? '#ef4444' : u.movimento === 'Flat' ? 'var(--blue)' : 'var(--text-muted)';
    }
    const isDup = u.dupCount > 1;
    const dupBadge = isDup ? ` <span title="${u.dupCount} registros para este identifier neste refDate" style="background:#ef4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:8px;cursor:help">DUP ${u.dupCount}</span>` : '';

    const naBaseAntColor = u.naBaseAnterior === 'Sim' ? 'var(--green)' : 'var(--orange)';
    const prevNivel = nivelLabel(u.prevLevelName);

    const evoMap = {
      'permaneceu': { label: 'Ativo', color: 'var(--green)' },
      'entrou': { label: 'Entrou', color: 'var(--blue)' },
      'saiu': { label: 'Saiu', color: '#ef4444' },
      'nunca': { label: 'Sem eleg.', color: 'var(--text-muted)' },
      'sem-id': { label: 'Sem ID', color: 'var(--text-muted)' },
    };
    const evo = evoMap[u.evolucao] || { label: '-', color: 'var(--text-muted)' };

    tr.innerHTML = `
      <td>${u.idUser}</td>
      <td>${u.idMotorista || '-'}${dupBadge}</td>
      <td><span style="color:${u.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${u.tipo}</span></td>
      <td><span style="color:${statusColor}">${u.status || '-'}</span></td>
      <td>${formatDateTimeBR(u.dataCadastro)}</td>
      <td>${u.productName || '-'}</td>
      <td>${u.amount ? formatCurrency(u.amount) : '-'}</td>
      <td>${paymentLabel}</td>
      <td>${u.companyName || '-'}</td>
      <td><span style="color:${naBaseColor};font-weight:600">${u.naBase}</span></td>
      <td>${nivel}</td>
      <td><span style="color:${movColor}">${movText}</span></td>
      <td><span style="color:${naBaseAntColor};font-weight:600">${u.naBaseAnterior}</span></td>
      <td>${prevNivel}</td>
      <td><span style="font-weight:600;color:${evo.color}">${evo.label}</span></td>
      <td>${u.getTypeChip === 'physical' ? '<span style="color:var(--orange)">Físico</span>' : u.getTypeChip === 'esim' ? '<span style="color:var(--purple)">eSIM</span>' : '-'}</td>
      <td>${u.tipoChip ? u.tipoChip.replace(/fisico/g, 'Físico').replace(/e-sim/g, 'eSIM') : '-'}</td>
      <td>${u.imsi || '-'}</td>
      <td>${u.iccid || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

$('monthPrev').addEventListener('click', () => {
  selectedMonth = shiftMonth(selectedMonth, -1);
  updateMonthNav();
  loadTimeline();
});

$('monthNext').addEventListener('click', () => {
  selectedMonth = shiftMonth(selectedMonth, 1);
  updateMonthNav();
  loadTimeline();
});

$('chipMonthPrev').addEventListener('click', () => {
  selectedChipMonth = shiftMonth(selectedChipMonth, -1);
  $('chipMonthLabel').textContent = formatMonthLabel(selectedChipMonth);
  loadChipTimeline();
});

$('chipMonthNext').addEventListener('click', () => {
  selectedChipMonth = shiftMonth(selectedChipMonth, 1);
  $('chipMonthLabel').textContent = formatMonthLabel(selectedChipMonth);
  loadChipTimeline();
});

$('refDateSelect').addEventListener('change', (e) => {
  selectedRefDate = e.target.value;
  loadUsers();
});

$('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  renderTable();
});

document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

document.querySelectorAll('[data-evo]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-evo]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    evoFilter = btn.dataset.evo;
    renderTable();
  });
});

$('exportIds').addEventListener('click', () => {
  const filtered = allUsers.filter(u => {
    if (currentFilter !== 'all' && u.tipo !== currentFilter) return false;
    if (evoFilter === 'ativo') { if (u.evolucao !== 'permaneceu' && u.evolucao !== 'entrou') return false; }
    else if (evoFilter === 'fora') { if (u.naBase !== 'Nao') return false; }
    else if (evoFilter !== 'all' && u.evolucao !== evoFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return String(u.idUser).includes(term) || String(u.idMotorista || '').toLowerCase().includes(term);
    }
    return true;
  });
  const ids = filtered.map(u => u.idMotorista).filter(Boolean);
  if (ids.length === 0) return;
  const csv = 'DRIVER_ID\n' + ids.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meli26_driver_ids.csv';
  a.click();
  URL.revokeObjectURL(url);
});

$('exportElegiveisChip').addEventListener('click', async () => {
  try {
    const res = await fetch('/payroll-ops/api/meli/elegiveis-com-chip');
    if (!res.ok) throw new Error('API error');
    const ids = await res.json();
    if (ids.length === 0) return;
    const csv = 'DRIVER_ID\n' + ids.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meli26_elegiveis_com_chip.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export error:', err);
  }
});

// Modal Chips
if ($('cardChips')) $('cardChips').addEventListener('click', async () => {
  const modal = $('chipsModal');
  const tbody = $('chipsTableBody');
  tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/payroll-ops/api/meli/chips');
    if (!res.ok) throw new Error('API error');
    const rows = await res.json();

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;color:var(--text-muted)">Nenhum chip encontrado</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const apnStyle = r.primeiraApn ? 'color:var(--green)' : 'color:var(--text-muted)';
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.imsi || '-'}</td>
        <td>${r.iccid || '-'}</td>
        <td>${r.tipoChip || '-'}</td>
        <td>${r.statusChip || '-'}</td>
        <td>${formatDateTime(r.dataAssociacao)}</td>
        <td style="${apnStyle}">${formatDateTime(r.primeiraApn)}</td>
        <td style="${apnStyle}">${formatDateTime(r.ultimaApn)}</td>
        <td>${r.totalSessoes || 0}</td>
        <td>${r.ipUser || '-'}</td>
        <td>${formatDateTime(r.ipUserDate)}</td>
        <td>${r.ipTemp || '-'}</td>
        <td>${r.ipTempStatus || '-'}</td>
        <td>${formatDateTime(r.ipTempDate)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;color:var(--text-muted)">Erro ao carregar dados</td></tr>';
    console.error(err);
  }
});

$('chipsModalClose').addEventListener('click', () => {
  $('chipsModal').classList.add('hidden');
});

$('chipsModal').addEventListener('click', (e) => {
  if (e.target === $('chipsModal')) $('chipsModal').classList.add('hidden');
});

// Modal APN
let naoApnData = [];

if ($('cardApn')) $('cardApn').addEventListener('click', async () => {
  const modal = $('apnModal');
  const tbody = $('apnTableBody');
  const tbodyNao = $('naoApnTableBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';
  tbodyNao.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';
  modal.classList.remove('hidden');

  try {
    const [apnRes, naoRes] = await Promise.all([
      fetch('/payroll-ops/api/meli/apn'),
      fetch('/payroll-ops/api/meli/nao-apn'),
    ]);
    if (!apnRes.ok || !naoRes.ok) throw new Error('API error');

    const rows = await apnRes.json();
    naoApnData = await naoRes.json();

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nenhum chip bateu na APN</td></tr>';
    } else {
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.idUser}</td>
          <td>${r.imsi || '-'}</td>
          <td>${r.ipUser || '-'}</td>
          <td>${formatDateTime(r.ipUserDate)}</td>
          <td>${r.ipTemp || '-'}</td>
          <td>${r.ipTempStatus || '-'}</td>
          <td>${formatDateTime(r.ipTempDate)}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    if (naoApnData.length === 0) {
      tbodyNao.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Todos os chips bateram na APN</td></tr>';
    } else {
      tbodyNao.innerHTML = '';
      naoApnData.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.idUser}</td>
          <td>${r.imsi || '-'}</td>
          <td>${r.iccid || '-'}</td>
          <td>${r.tipoChip || '-'}</td>
          <td>${r.statusChip || '-'}</td>
        `;
        tbodyNao.appendChild(tr);
      });
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Erro ao carregar dados</td></tr>';
    tbodyNao.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Erro ao carregar dados</td></tr>';
    console.error(err);
  }
});

$('exportNaoApnCsv').addEventListener('click', () => {
  if (naoApnData.length === 0) return;
  const header = 'ID,IMSI,ICCID,Tipo,Status';
  const lines = naoApnData.map(r =>
    [r.idUser, r.imsi || '', r.iccid || '', r.tipoChip || '', r.statusChip || ''].join(',')
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chips_nao_bateram_apn.csv';
  a.click();
  URL.revokeObjectURL(url);
});

$('apnModalClose').addEventListener('click', () => {
  $('apnModal').classList.add('hidden');
});

$('apnModal').addEventListener('click', (e) => {
  if (e.target === $('apnModal')) $('apnModal').classList.add('hidden');
});

// === TABS ===
let activeTab = 'ativacao';
let stockLoaded = false;

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;

    $('tabAtivacao').classList.toggle('hidden', activeTab !== 'ativacao');
    $('tabMovimentos').classList.toggle('hidden', activeTab !== 'movimentos');
    $('tabEstoque').classList.toggle('hidden', activeTab !== 'estoque');

    if (activeTab === 'estoque' && !stockLoaded) {
      loadStock();
    }
    if (activeTab === 'movimentos' && !movementsLoaded) {
      loadMovementsTab();
    }
  });
});

// === MOVIMENTOS ===
let movementsLoaded = false;

async function loadMovementsTab() {
  try {
    const res = await fetch('/payroll-ops/api/meli/ref-dates');
    if (!res.ok) return;
    const refDates = await res.json();

    const select = $('mvRefDateSelect');
    select.innerHTML = '';
    refDates.forEach(rd => {
      const opt = document.createElement('option');
      opt.value = rd;
      const y = rd.substring(0, 4);
      const m = rd.substring(4, 6);
      const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      opt.textContent = names[Number(m) - 1] + '/' + y;
      select.appendChild(opt);
    });

    movementsLoaded = true;
    if (refDates.length > 0) {
      select.value = refDates[0];
      loadMovements(refDates[0]);
    }
  } catch (err) {
    console.error('Movements tab error:', err);
  }
}

$('mvRefDateSelect').addEventListener('change', (e) => {
  loadMovements(e.target.value);
});

async function loadMovements(refDate) {
  $('mvLoading').textContent = 'Carregando...';
  $('mvLoading').classList.remove('hidden');
  $('mvDash').classList.add('hidden');

  try {
    const res = await fetch(`/payroll-ops/api/meli/movements?refDate=${refDate}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    $('mvLoading').classList.add('hidden');
    $('mvDash').classList.remove('hidden');
    renderMovements(data);
  } catch (err) {
    $('mvLoading').textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

function levelTag(name) {
  if (!name) return '-';
  const cls = name.toLowerCase();
  const label = { Silver: 'Prata', Gold: 'Ouro', Platinum: 'Platina' }[name] || name;
  return `<span class="level-tag ${cls}">${label}</span>`;
}

function movLabel(mov) {
  if (!mov) return '-';
  const map = { Up: 'Subiu', Down: 'Desceu', Flat: 'Manteve' };
  const color = mov === 'Up' ? 'var(--green)' : mov === 'Down' ? '#ef4444' : 'var(--blue)';
  return `<span style="color:${color}">${map[mov] || mov}</span>`;
}

function renderMovements(d) {
  // Overview
  const diff = d.naCurr - d.naPrev;
  $('mvPrevTotal').textContent = d.naPrev.toLocaleString('pt-BR');
  $('mvPrevLabel').textContent = formatRefDateLabel(d.prevRefDate);
  $('mvCurrTotal').textContent = d.naCurr.toLocaleString('pt-BR');
  $('mvCurrLabel').textContent = formatRefDateLabel(d.refDate);
  $('mvVariacao').textContent = (diff >= 0 ? '+' : '') + diff.toLocaleString('pt-BR');
  $('mvVariacao').style.color = diff >= 0 ? 'var(--green)' : '#ef4444';
  $('mvVariacaoPct').textContent = d.naPrev > 0 ? ((diff / d.naPrev) * 100).toFixed(1) + '%' : '';

  // Fluxo
  $('mvPermaneceram').textContent = d.permaneceram.toLocaleString('pt-BR');
  $('mvEntraram').textContent = d.entraram.toLocaleString('pt-BR');
  $('mvSairam').textContent = d.sairam.toLocaleString('pt-BR');
  $('mvNenhuma').textContent = d.nenhumaBase.toLocaleString('pt-BR');

  // Level distribution
  const lvlBody = $('mvLevelBody');
  lvlBody.innerHTML = '';
  ['Silver', 'Gold', 'Platinum'].forEach(n => {
    const p = d.prevLevels[n] || 0;
    const c = d.currLevels[n] || 0;
    const v = c - p;
    const color = v > 0 ? 'var(--green)' : v < 0 ? '#ef4444' : 'var(--text-muted)';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${levelTag(n)}</td><td>${p}</td><td>${c}</td><td style="color:${color};font-weight:600">${v >= 0 ? '+' : ''}${v}</td>`;
    lvlBody.appendChild(tr);
  });

  // Retention
  const retBody = $('mvRetencaoBody');
  retBody.innerHTML = '';
  d.retencao.forEach(r => {
    const tr = document.createElement('tr');
    const pctColor = r.pct >= 90 ? 'var(--green)' : r.pct >= 70 ? 'var(--orange)' : '#ef4444';
    tr.innerHTML = `
      <td>${levelTag(r.nivel)}</td>
      <td>${r.total}</td>
      <td>${r.ficaram}</td>
      <td style="color:#ef4444;font-weight:600">${r.perdidos}</td>
      <td style="color:${pctColor};font-weight:600">${r.pct}%</td>
    `;
    retBody.appendChild(tr);
  });

  // Movimentos
  $('mvSubiram').textContent = d.movimentos.subiram.toLocaleString('pt-BR');
  $('mvDesceram').textContent = d.movimentos.desceram.toLocaleString('pt-BR');
  $('mvMantiveram').textContent = d.movimentos.mantiveram.toLocaleString('pt-BR');

  // Transitions - grouped by category
  const transBody = $('mvTransBody');
  transBody.innerHTML = '';

  const upKeys = ['Silver -> Gold', 'Silver -> Platinum', 'Gold -> Platinum'];
  const downKeys = ['Gold -> Silver', 'Platinum -> Silver', 'Platinum -> Gold'];
  const flatKeys = ['Silver -> Silver', 'Gold -> Gold', 'Platinum -> Platinum'];

  const ups = d.transitions.filter(t => upKeys.includes(t.key));
  const downs = d.transitions.filter(t => downKeys.includes(t.key));
  const flats = d.transitions.filter(t => flatKeys.includes(t.key));

  // Perderam benefício agrupado por nível
  const saiLevels = {};
  d.sairamDetail.forEach(r => {
    const l = r.prevLevel || 'Sem nível';
    saiLevels[l] = (saiLevels[l] || 0) + 1;
  });
  const saiEntries = Object.entries(saiLevels).sort((a, b) => b[1] - a[1]);

  function addSectionHeader(label, color) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="font-weight:700;color:${color};padding-top:16px;border-bottom:none">${label}</td>`;
    transBody.appendChild(tr);
  }

  function addTransRow(from, arrow, to, count, arrowColor) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${levelTag(from)}</td>
      <td><span class="transition-arrow" style="color:${arrowColor}">${arrow}</span></td>
      <td>${to ? levelTag(to) : ''}</td>
      <td><b>${count}</b></td>
    `;
    transBody.appendChild(tr);
  }

  function addTotalRow(total, color) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="3" style="text-align:right;color:${color};font-size:12px;font-weight:600;padding-right:8px">Total</td>
      <td style="color:${color};font-weight:700;border-top:1px solid ${color}30">${total}</td>
    `;
    transBody.appendChild(tr);
  }

  if (ups.length > 0) {
    addSectionHeader('Subiram de Nivel', 'var(--green)');
    let sum = 0;
    ups.forEach(t => {
      const [from, to] = t.key.split(' -> ');
      addTransRow(from, '&uarr;', to, t.count, 'var(--green)');
      sum += t.count;
    });
    addTotalRow(sum, 'var(--green)');
  }

  if (flats.length > 0) {
    addSectionHeader('Mantiveram Nivel', 'var(--blue)');
    let sum = 0;
    flats.forEach(t => {
      const [from, to] = t.key.split(' -> ');
      addTransRow(from, '&rarr;', to, t.count, 'var(--blue)');
      sum += t.count;
    });
    addTotalRow(sum, 'var(--blue)');
  }

  if (downs.length > 0) {
    addSectionHeader('Desceram de Nivel', '#ef4444');
    let sum = 0;
    downs.forEach(t => {
      const [from, to] = t.key.split(' -> ');
      addTransRow(from, '&darr;', to, t.count, '#ef4444');
      sum += t.count;
    });
    addTotalRow(sum, '#ef4444');
  }

  if (saiEntries.length > 0) {
    addSectionHeader('Perderam Beneficio', 'var(--text-muted)');
    let sum = 0;
    saiEntries.forEach(([level, count]) => {
      addTransRow(level, '&times;', null, count, 'var(--text-muted)');
      sum += count;
    });
    addTotalRow(sum, 'var(--text-muted)');
  }

  // Saíram detail
  $('mvSairamCount').textContent = d.sairamDetail.length;
  const saiBody = $('mvSairamBody');
  saiBody.innerHTML = '';
  if (d.sairamDetail.length === 0) {
    saiBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhum</td></tr>';
  } else {
    d.sairamDetail.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.name || '-'}</td>
        <td>${r.identifier || '-'}</td>
        <td>${levelTag(r.prevLevel)}</td>
        <td>${movLabel(r.prevMovement)}</td>
      `;
      saiBody.appendChild(tr);
    });
  }

  // Entraram detail
  $('mvEntraramCount').textContent = d.entraramDetail.length;
  const entBody = $('mvEntraramBody');
  entBody.innerHTML = '';
  if (d.entraramDetail.length === 0) {
    entBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhum</td></tr>';
  } else {
    d.entraramDetail.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.name || '-'}</td>
        <td>${r.identifier || '-'}</td>
        <td>${levelTag(r.currLevel)}</td>
        <td>${movLabel(r.currMovement)}</td>
      `;
      entBody.appendChild(tr);
    });
  }

  // Cobertura
  $('mvTotalCad').textContent = d.totalCadastrados.toLocaleString('pt-BR');
  $('mvCobertura').textContent = d.naCurr.toLocaleString('pt-BR');
  const cobPct = d.totalCadastrados > 0 ? (d.naCurr / d.totalCadastrados * 100).toFixed(1) : '0';
  $('mvCoberturaPct').textContent = cobPct + '% dos cadastrados';
  const fora = d.totalCadastrados - d.naCurr;
  $('mvForaBase').textContent = fora.toLocaleString('pt-BR');
  $('mvForaBasePct').textContent = d.totalCadastrados > 0 ? ((fora / d.totalCadastrados) * 100).toFixed(1) + '% dos cadastrados' : '';
}

// === ESTOQUE ===
let stTimeline = [];
let stSelectedMonth = '';
let selectedCompanyId = '';

async function loadStock() {
  try {
    const res = await fetch('/payroll-ops/api/stock/companies');
    if (!res.ok) throw new Error('API error');
    const companies = await res.json();

    const select = $('stCompanySelect');
    select.innerHTML = '<option value="">Selecione uma empresa...</option>';
    companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.idCompany;
      opt.textContent = `${c.companyName} (${c.total})`;
      select.appendChild(opt);
    });
    stockLoaded = true;
  } catch (err) {
    console.error('Stock load error:', err);
  }
}

$('stCompanySelect').addEventListener('change', (e) => {
  selectedCompanyId = e.target.value;
  if (!selectedCompanyId) {
    $('stEmpty').classList.remove('hidden');
    $('stDash').classList.add('hidden');
    return;
  }
  loadCompanyDash(selectedCompanyId);
});

async function loadCompanyDash(idCompany) {
  $('stEmpty').classList.add('hidden');
  $('stDash').classList.remove('hidden');

  try {
    const res = await fetch(`/payroll-ops/api/stock/company/${idCompany}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    renderStockSummary(data.summary);
    renderStockSpots(data.spots);

    stTimeline = data.timeline;
    stSelectedMonth = getCurrentMonth();
    $('stMonthLabel').textContent = formatMonthLabel(stSelectedMonth);
    renderStockTimeline();
  } catch (err) {
    console.error('Company dash error:', err);
  }
}

function renderStockSummary(s) {
  const total = Number(s.total) || 0;
  const disponivel = Number(s.disponivel) || 0;
  const associado = Number(s.associado) || 0;

  $('stTotal').textContent = total.toLocaleString('pt-BR');
  $('stFisico').textContent = (Number(s.fisico) || 0).toLocaleString('pt-BR');
  $('stEsim').textContent = (Number(s.esim) || 0).toLocaleString('pt-BR');

  $('stDisponivel').textContent = disponivel.toLocaleString('pt-BR');
  $('stFisicoDisp').textContent = (Number(s.fisicoDisp) || 0).toLocaleString('pt-BR');
  $('stEsimDisp').textContent = (Number(s.esimDisp) || 0).toLocaleString('pt-BR');

  $('stAssociado').textContent = associado.toLocaleString('pt-BR');
  $('stFisicoAssoc').textContent = (Number(s.fisicoAssoc) || 0).toLocaleString('pt-BR');
  $('stEsimAssoc').textContent = (Number(s.esimAssoc) || 0).toLocaleString('pt-BR');

  const taxa = total > 0 ? ((associado / total) * 100).toFixed(1) : '0.0';
  $('stTaxaUso').textContent = taxa + '%';
  $('stTaxaSub').textContent = `${associado.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} chips`;
}

function pctBar(disponivel, total) {
  const pct = total > 0 ? (disponivel / total * 100).toFixed(1) : 0;
  const color = pct >= 50 ? 'var(--green)' : pct >= 20 ? 'var(--orange)' : '#ef4444';
  return `<div style="display:flex;align-items:center;gap:8px">
    <div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <span style="font-size:12px;color:${color};font-weight:600">${pct}%</span>
  </div>`;
}

function renderStockTimeline() {
  const chart = $('stChart');
  const legend = $('stChartLegend');
  const labels = $('stChartLabels');
  chart.innerHTML = '';
  legend.innerHTML = '';
  labels.innerHTML = '';

  // Filter timeline for selected month
  const monthData = stTimeline.filter(d => d.dia && d.dia.startsWith(stSelectedMonth));

  if (monthData.length === 0) {
    const [y, m] = stSelectedMonth.split('-');
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    chart.innerHTML = '<div style="color:var(--text-muted);font-size:18px;text-align:center;width:100%;padding:40px 0">Nenhuma associacao em ' + monthNames[Number(m) - 1] + ' de ' + y + '</div>';
    return;
  }

  const days = {};
  const tipos = new Set();
  monthData.forEach(d => {
    if (!days[d.dia]) days[d.dia] = {};
    days[d.dia][d.tipoChip] = Number(d.total);
    tipos.add(d.tipoChip);
  });

  // Fill missing days
  const sortedDays = Object.keys(days).sort();
  const startDate = new Date(sortedDays[0] + 'T12:00:00');
  const isCurrentMonth = stSelectedMonth === getCurrentMonth();
  let endDate;
  if (isCurrentMonth) {
    endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
  } else {
    const [y, m] = stSelectedMonth.split('-').map(Number);
    endDate = new Date(y, m, 0, 12, 0, 0);
  }
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!days[key]) days[key] = {};
  }

  const tipoList = ['fisico', 'e-sim'].filter(t => tipos.has(t));
  const dayEntries = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
  const maxVal = Math.max(...dayEntries.map(([, t]) => Object.values(t).reduce((s, v) => s + v, 0)), 1);

  tipoList.forEach(tipo => {
    const item = document.createElement('span');
    item.className = 'chart-legend-item';
    item.innerHTML = `<span class="chart-legend-dot" style="background:${CHIP_COLORS[tipo]}"></span>${CHIP_LABELS[tipo]}`;
    legend.appendChild(item);
  });

  dayEntries.forEach(([dia, tipoCounts]) => {
    const total = Object.values(tipoCounts).reduce((s, v) => s + v, 0);
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const valLabel = document.createElement('span');
    valLabel.className = 'chart-bar-value';
    valLabel.textContent = total || '';

    const barStack = document.createElement('div');
    barStack.className = 'chart-bar-stack';
    barStack.style.height = Math.max((total / maxVal) * 120, 2) + 'px';

    tipoList.forEach(tipo => {
      const count = tipoCounts[tipo] || 0;
      if (count === 0) return;
      const color = CHIP_COLORS[tipo];
      const seg = document.createElement('div');
      seg.className = 'chart-bar-seg';
      seg.style.flex = count;
      seg.style.background = color;

      const ttHtml = `<span class="tt-color" style="background:${color}"></span>${CHIP_LABELS[tipo]}: <span class="tt-value">${count}</span> (${formatDay(dia)})`;
      seg.addEventListener('mouseenter', (e) => showTooltip(e, ttHtml));
      seg.addEventListener('mousemove', moveTooltip);
      seg.addEventListener('mouseleave', hideTooltip);

      barStack.appendChild(seg);
    });

    wrap.appendChild(valLabel);
    wrap.appendChild(barStack);
    chart.appendChild(wrap);

    const slot = document.createElement('div');
    slot.className = 'chart-label-slot';
    slot.dataset.dia = dia;
    labels.appendChild(slot);
  });

  const totalDays = dayEntries.length;
  const step = totalDays <= 15 ? 1 : totalDays <= 30 ? 2 : 3;
  const slots = labels.querySelectorAll('.chart-label-slot');
  slots.forEach((slot, i) => {
    if (i % step === 0 || i === totalDays - 1) {
      const label = document.createElement('span');
      label.className = 'chart-bar-label';
      label.textContent = formatDay(slot.dataset.dia);
      slot.appendChild(label);
    }
  });

  chart.addEventListener('scroll', () => { labels.scrollLeft = chart.scrollLeft; });
  labels.addEventListener('scroll', () => { chart.scrollLeft = labels.scrollLeft; });
}

// === MODAL SPOT CHIPS ===
let spotChipsData = [];
let spotStatusFilter = 'all';
let spotTypeFilter = 'all';

function renderStockSpots(rows) {
  const tbody = $('stSpotBody');
  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nenhum spot</td></tr>';
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    const total = Number(r.total);
    const disponivel = Number(r.disponivel);
    const label = r.parentSpotName
      ? `<span style="color:var(--text-muted)">${r.parentSpotName} &rsaquo;</span> ${r.spotName}`
      : r.spotName;
    tr.innerHTML = `
      <td><b>${label}</b></td>
      <td>${total.toLocaleString('pt-BR')}</td>
      <td style="color:var(--green);font-weight:600">${disponivel.toLocaleString('pt-BR')}</td>
      <td>${Number(r.associado).toLocaleString('pt-BR')}</td>
      <td>${Number(r.fisicoDisp).toLocaleString('pt-BR')}</td>
      <td>${Number(r.esimDisp).toLocaleString('pt-BR')}</td>
      <td>${pctBar(disponivel, total)}</td>
    `;
    tr.addEventListener('click', () => openSpotChipsModal(r.idSpot, r.spotName));
    tbody.appendChild(tr);
  });
}

async function openSpotChipsModal(idSpot, spotName) {
  const modal = $('spotChipsModal');
  const tbody = $('spotChipsTableBody');
  $('spotChipsTitle').textContent = `Chips — ${spotName}`;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';
  modal.classList.remove('hidden');

  // Reset filters
  spotStatusFilter = 'all';
  spotTypeFilter = 'all';
  document.querySelectorAll('[data-spot-status]').forEach(b => b.classList.toggle('active', b.dataset.spotStatus === 'all'));
  document.querySelectorAll('[data-spot-type]').forEach(b => b.classList.toggle('active', b.dataset.spotType === 'all'));

  try {
    const res = await fetch(`/payroll-ops/api/stock/spot-chips?idCompany=${selectedCompanyId}&idSpot=${idSpot}`);
    if (!res.ok) throw new Error('API error');
    spotChipsData = await res.json();
    renderSpotChipsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Erro ao carregar</td></tr>';
    console.error(err);
  }
}

const STATUS_MAP = { 1: 'Ativo', 2: 'Inativo', 3: 'Disponível', 4: 'Reservado' };

function renderSpotChipsTable() {
  const tbody = $('spotChipsTableBody');
  tbody.innerHTML = '';

  const filtered = spotChipsData.filter(r => {
    if (spotStatusFilter === 'disponivel' && r.idUser !== null) return false;
    if (spotStatusFilter === 'associado' && r.idUser === null) return false;
    if (spotTypeFilter !== 'all' && r.tipoChip !== spotTypeFilter) return false;
    return true;
  });

  $('spotChipsCount').textContent = `${filtered.length} chip${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nenhum chip encontrado</td></tr>';
    return;
  }

  const showQr = spotTypeFilter === 'e-sim';
  const headerRow = document.querySelector('#spotChipsModal thead tr');
  headerRow.innerHTML = `
    <th>IMSI</th>
    <th>ICCID</th>
    <th>Tipo</th>
    <th>Status</th>
    <th>Usuario</th>
    <th>Data Associacao</th>
    ${showQr ? '<th>QR Code eSIM</th>' : ''}
  `;

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    const tipoLabel = r.tipoChip === 'fisico' ? 'Físico' : r.tipoChip === 'e-sim' ? 'eSIM' : r.tipoChip || '-';
    const statusLabel = STATUS_MAP[r.idStatus] || ('Status ' + r.idStatus);
    const statusColor = r.idStatus === 1 ? 'var(--green)' : r.idStatus === 3 ? 'var(--blue)' : 'var(--text-muted)';
    const userCell = r.idUser ? `<a style="color:var(--blue)">${r.idUser}</a> ${r.userName || ''}` : '<span style="color:var(--text-muted)">-</span>';
    const vdateCell = r.idUser ? formatDateTime(r.vdate) : '-';
    tr.innerHTML = `
      <td>${r.imsi || '-'}</td>
      <td style="font-size:11px">${r.iccid || '-'}</td>
      <td><span style="color:${r.tipoChip === 'fisico' ? 'var(--blue)' : 'var(--purple)'}">${tipoLabel}</span></td>
      <td><span style="color:${statusColor}">${statusLabel}</span></td>
      <td>${userCell}</td>
      <td>${vdateCell}</td>
      ${showQr ? `<td class="qr-cell" style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;cursor:${r.qrcodeEsim ? 'pointer' : 'default'}" ${r.qrcodeEsim ? `title="Clique para copiar" data-qr="${r.qrcodeEsim}"` : ''}>${r.qrcodeEsim || '<span style="color:var(--text-muted)">-</span>'}</td>` : ''}
    `;
    tbody.appendChild(tr);
  });
}

document.querySelectorAll('[data-spot-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-spot-status]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    spotStatusFilter = btn.dataset.spotStatus;
    renderSpotChipsTable();
  });
});

document.querySelectorAll('[data-spot-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-spot-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    spotTypeFilter = btn.dataset.spotType;
    renderSpotChipsTable();
  });
});

$('spotChipsTableBody').addEventListener('click', (e) => {
  const cell = e.target.closest('.qr-cell[data-qr]');
  if (!cell) return;
  navigator.clipboard.writeText(cell.dataset.qr).then(() => {
    const orig = cell.textContent;
    cell.textContent = 'Copiado!';
    cell.style.color = 'var(--green)';
    setTimeout(() => { cell.textContent = orig; cell.style.color = ''; }, 1200);
  });
});

$('spotChipsModalClose').addEventListener('click', () => {
  $('spotChipsModal').classList.add('hidden');
});

$('spotChipsModal').addEventListener('click', (e) => {
  if (e.target === $('spotChipsModal')) $('spotChipsModal').classList.add('hidden');
});

$('stMonthPrev').addEventListener('click', () => {
  stSelectedMonth = shiftMonth(stSelectedMonth, -1);
  $('stMonthLabel').textContent = formatMonthLabel(stSelectedMonth);
  renderStockTimeline();
});

$('stMonthNext').addEventListener('click', () => {
  stSelectedMonth = shiftMonth(stSelectedMonth, 1);
  $('stMonthLabel').textContent = formatMonthLabel(stSelectedMonth);
  renderStockTimeline();
});

loadAll();
initRefreshBar('refreshContainer', loadAll);
