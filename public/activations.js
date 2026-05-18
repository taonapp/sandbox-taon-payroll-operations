const $ = (id) => document.getElementById(id);

let currentYear, currentMonth;

function init() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth(); // 0-indexed — mês atual

  $('prevMonth').addEventListener('click', () => changeMonth(-1));
  $('nextMonth').addEventListener('click', () => changeMonth(1));
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeModal();
  });

  // Set today's date label
  const todayDateEl = $('todayDate');
  if (todayDateEl) {
    todayDateEl.textContent = now.toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });
  }

  loadToday();
  loadMonth();
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  loadMonth();
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

function formatWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'short' });
}

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

let todayLoaded = false;

async function loadToday() {
  const today = todayKey();
  const section = $('todaySection');
  const tbody = $('todayBody');
  const countEl = $('todayCount');
  const titEl = $('todayTit');
  const depEl = $('todayDep');
  const loadingEl = $('todayLoading');
  const contentEl = $('todayContent');

  const isFirstLoad = !todayLoaded;
  if (isFirstLoad) {
    loadingEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
  }

  try {
    const res = await fetch(`/api/activations/details?date=${today}`);
    if (!res.ok) throw new Error('Erro');
    const rows = await res.json();

    const titulares = rows.filter(r => r.tipo === 'Titular').length;
    const dependentes = rows.filter(r => r.tipo === 'Dependente').length;

    countEl.textContent = rows.length.toLocaleString('pt-BR');
    titEl.textContent = titulares.toLocaleString('pt-BR');
    depEl.textContent = dependentes.toLocaleString('pt-BR');

    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nenhuma ativacao hoje</td></tr>';
    } else {
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.idUser}</td>
          <td>${r.name || '-'}</td>
          <td>${r.cpf || '-'}</td>
          <td>${r.codigo || '-'}</td>
          <td><span style="color:${r.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${r.tipo}</span></td>
          <td>${formatCurrency(r.amount)}</td>
          <td>${r.companyName || '-'}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    if (isFirstLoad) {
      loadingEl.classList.add('hidden');
      contentEl.classList.remove('hidden');
      section.classList.remove('hidden');
      todayLoaded = true;
    }
  } catch (err) {
    if (isFirstLoad) {
      loadingEl.textContent = 'Erro ao carregar dados de hoje.';
    }
    console.error(err);
  }
}

async function loadAll() {
  await Promise.all([loadToday(), loadMonth()]);
}

let monthLoaded = false;

async function loadMonth() {
  $('monthLabel').textContent = formatMonthLabel();
  const isFirstLoad = !monthLoaded;
  if (isFirstLoad) {
    $('loading').classList.remove('hidden');
    $('page').classList.add('hidden');
  }

  try {
    const res = await fetch(`/api/activations?month=${monthKey()}`);
    if (!res.ok) throw new Error('Erro na API');
    const data = await res.json();

    render(data);

    if (isFirstLoad) {
      $('loading').classList.add('hidden');
      $('page').classList.remove('hidden');
      monthLoaded = true;
    }
  } catch (err) {
    if (isFirstLoad) {
      $('loading').textContent = 'Erro ao carregar dados.';
    }
    console.error(err);
  }
}

function render(data) {
  // Summary
  const totalMes = data.reduce((s, d) => s + Number(d.total), 0);
  const titMes = data.reduce((s, d) => s + Number(d.titulares), 0);
  const depMes = data.reduce((s, d) => s + Number(d.dependentes), 0);
  const diasComDados = data.length || 1;

  $('totalMes').textContent = totalMes.toLocaleString('pt-BR');
  $('titMes').textContent = titMes.toLocaleString('pt-BR');
  $('depMes').textContent = depMes.toLocaleString('pt-BR');
  $('mediaDia').textContent = (totalMes / diasComDados).toFixed(1);

  if (data.length > 0) {
    const best = data.reduce((a, b) => b.total > a.total ? b : a);
    $('melhorDiaVal').textContent = best.total.toLocaleString('pt-BR');
    $('melhorDiaDate').textContent = formatDay(best.dia) + ' (' + formatWeekday(best.dia) + ')';
  } else {
    $('melhorDiaVal').textContent = '-';
    $('melhorDiaDate').textContent = 'Sem dados';
  }

  // Chart
  const maxVal = Math.max(...data.map(d => d.total), 1);
  const chart = $('chart');
  chart.innerHTML = '';

  data.forEach(d => {
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const valLabel = document.createElement('span');
    valLabel.className = 'chart-bar-value';
    valLabel.textContent = d.total;

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = Math.max((d.total / maxVal) * 140, 2) + 'px';
    bar.title = `${formatDay(d.dia)}: ${d.total} ativações`;
    bar.addEventListener('click', () => showDetails(d.dia));

    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = new Date(d.dia + 'T12:00:00').getDate();

    wrap.appendChild(valLabel);
    wrap.appendChild(bar);
    wrap.appendChild(label);
    chart.appendChild(wrap);
  });

  // Table
  const tbody = $('tableBody');
  tbody.innerHTML = '';

  data.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDay(d.dia)} <span style="color:var(--text-muted)">${formatWeekday(d.dia)}</span></td>
      <td><b>${d.total}</b></td>
      <td>${d.titulares}</td>
      <td>${d.dependentes}</td>
      <td><button class="btn-detail" data-date="${d.dia}">Ver detalhes</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-detail').forEach(btn => {
    btn.addEventListener('click', () => showDetails(btn.dataset.date));
  });
}

async function showDetails(date) {
  $('modalTitle').textContent = `Ativações em ${formatDay(date)}`;
  $('modalBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';
  $('modal').classList.remove('hidden');

  try {
    const res = await fetch(`/api/activations/details?date=${date}`);
    if (!res.ok) throw new Error('Erro');
    const rows = await res.json();

    const tbody = $('modalBody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nenhum registro</td></tr>';
      return;
    }

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.name || '-'}</td>
        <td>${r.cpf || '-'}</td>
        <td>${r.codigo || '-'}</td>
        <td><span style="color:${r.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${r.tipo}</span></td>
        <td>${formatCurrency(r.amount)}</td>
        <td>${r.companyName || '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    $('modalBody').innerHTML = '<tr><td colspan="7" style="color:#ef4444">Erro ao carregar detalhes</td></tr>';
  }
}

function closeModal() {
  $('modal').classList.add('hidden');
}

init();
initRefreshBar('refreshContainer', loadAll);
