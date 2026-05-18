const $ = (id) => document.getElementById(id);

let allUsers = [];
let currentFilter = 'all';
let searchTerm = '';

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

let loaded = false;

async function loadAll() {
  const isFirstLoad = !loaded;

  if (isFirstLoad) {
    $('loading').classList.remove('hidden');
    $('page').classList.add('hidden');
  }

  try {
    const [summaryRes, timelineRes, usersRes] = await Promise.all([
      fetch('/api/meli/summary'),
      fetch('/api/meli/timeline'),
      fetch('/api/meli/users'),
    ]);

    if (!summaryRes.ok || !timelineRes.ok || !usersRes.ok) throw new Error('API error');

    const summary = await summaryRes.json();
    const timeline = await timelineRes.json();
    allUsers = await usersRes.json();

    renderSummary(summary);
    renderPieChart(allUsers);
    renderTimeline(timeline);
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
  const totalAtivos = Number(s.totalAtivos) || 0;
  const totalAssinatura = Number(s.totalComAssinatura) || 0;

  $('totalCadastrados').textContent = totalCad.toLocaleString('pt-BR');
  $('titCad').textContent = (Number(s.titularesCadastrados) || 0).toLocaleString('pt-BR');
  $('depCad').textContent = (Number(s.dependentesCadastrados) || 0).toLocaleString('pt-BR');

  $('totalAtivos').textContent = totalAtivos.toLocaleString('pt-BR');
  $('titAtivos').textContent = (Number(s.titularesAtivos) || 0).toLocaleString('pt-BR');
  $('depAtivos').textContent = (Number(s.dependentesAtivos) || 0).toLocaleString('pt-BR');

  $('totalAssinatura').textContent = totalAssinatura.toLocaleString('pt-BR');
  $('titAssinatura').textContent = (Number(s.titularesAssinatura) || 0).toLocaleString('pt-BR');
  $('depAssinatura').textContent = (Number(s.dependentesAssinatura) || 0).toLocaleString('pt-BR');

  $('receitaTotal').textContent = formatCurrency(s.receitaTotal);
  $('ticketMedio').textContent = formatCurrency(s.ticketMedio);

  const taxa = totalCad > 0 ? ((totalAssinatura / totalCad) * 100).toFixed(1) : '0.0';
  $('taxaConversao').textContent = taxa + '%';

  $('totalChips').textContent = (Number(s.totalChips) || 0).toLocaleString('pt-BR');
}

const PIE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

const tooltip = $('tooltip');

function showTooltip(e, html) {
  tooltip.innerHTML = html;
  tooltip.classList.remove('hidden');
  tooltip.style.left = (e.clientX + 12) + 'px';
  tooltip.style.top = (e.clientY - 8) + 'px';
}

function hideTooltip() {
  tooltip.classList.add('hidden');
}

function moveTooltip(e) {
  tooltip.style.left = (e.clientX + 12) + 'px';
  tooltip.style.top = (e.clientY - 8) + 'px';
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
  chart.innerHTML = '';
  legend.innerHTML = '';

  if (data.length === 0) {
    chart.innerHTML = '<span style="color:var(--text-muted);font-size:14px">Sem dados</span>';
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
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
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
    barStack.style.height = Math.max((total / maxVal) * 140, 2) + 'px';

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

    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = formatDay(dia);

    wrap.appendChild(valLabel);
    wrap.appendChild(barStack);
    wrap.appendChild(label);
    chart.appendChild(wrap);
  });
}

function renderTable() {
  const tbody = $('tableBody');
  tbody.innerHTML = '';

  const filtered = allUsers.filter(u => {
    if (currentFilter !== 'all' && u.tipo !== currentFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const match = (u.name || '').toLowerCase().includes(term)
        || (u.cpf || '').includes(term)
        || String(u.idUser).includes(term);
      if (!match) return false;
    }
    return true;
  });

  $('resultCount').textContent = `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--text-muted)">Nenhum usuario encontrado</td></tr>';
    return;
  }

  filtered.forEach(u => {
    const tr = document.createElement('tr');
    const statusColor = u.status === 'enabled' ? 'var(--green)' : 'var(--text-muted)';
    const paymentLabel = u.paymentMethod === 'payroll' ? 'Folha' : (u.paymentMethod || '-');

    tr.innerHTML = `
      <td>${u.idUser}</td>
      <td>${u.name || '-'}</td>
      <td>${u.cpf || '-'}</td>
      <td>${u.idMotorista || '-'}</td>
      <td><span style="color:${u.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${u.tipo}</span></td>
      <td><span style="color:${statusColor}">${u.status || '-'}</span></td>
      <td>${formatDate(u.dataCadastro)}</td>
      <td>${u.productName || '-'}</td>
      <td>${u.amount ? formatCurrency(u.amount) : '-'}</td>
      <td>${paymentLabel}</td>
      <td>${u.companyName || '-'}</td>
      <td>${u.imsi || '-'}</td>
      <td>${u.iccid || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

$('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  renderTable();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

loadAll();
initRefreshBar('refreshContainer', loadAll);
