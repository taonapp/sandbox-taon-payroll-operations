const $ = (id) => document.getElementById(id);

let allUsers = [];
let currentView = 'total';
let sortCol = 'dataCadastro';
let sortDir = 'desc';

function formatCurrency(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

let payersLoaded = false;

function getPayersLabel() {
  if (currentView === 'cobranca') return 'Cobranca por Pagador (corte dia 20)';
  if (currentView === 'total') return 'Cobranca por Pagador (base total)';
  return 'Cobranca por Pagador (todos)';
}

async function loadPayers() {
  const tbody = $('payersTableBody');
  const totals = $('payersTotals');
  $('payersLabel').textContent = getPayersLabel();

  try {
    const res = await fetch(`/payroll-ops/api/users/payers?view=${currentView}`);
    if (!res.ok) throw new Error('Erro na API');
    const payers = await res.json();

    tbody.innerHTML = '';
    let sumValor = 0;
    let sumLinhas = 0;

    payers.forEach(p => {
      sumValor += Number(p.valorTotalFolha) || 0;
      sumLinhas += Number(p.totalLinhas) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.idUser || '-'}</td>
        <td>${p.name || '-'}</td>
        <td>${p.cpf || '-'}</td>
        <td>${formatCurrency(p.valorTotalFolha)}</td>
        <td>${Number(p.totalLinhas).toLocaleString('pt-BR')}</td>
      `;
      tbody.appendChild(tr);
    });

    totals.innerHTML = `
      <span><b>Total:</b> ${formatCurrency(sumValor)}</span>
      <span><b>Linhas:</b> ${sumLinhas.toLocaleString('pt-BR')}</span>
      <span><b>Pagadores:</b> ${payers.length}</span>
    `;

    payersLoaded = true;
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Erro ao carregar dados</td></tr>';
    console.error(err);
  }
}

// Toggle payers section
$('payersToggle').addEventListener('click', () => {
  const content = $('payersContent');
  const icon = $('payersIcon');
  const isHidden = content.classList.toggle('hidden');
  icon.textContent = isHidden ? '\u25B6' : '\u25BC';
});

let usersLoaded = false;

async function loadUsers() {
  const isFirstLoad = !usersLoaded;
  if (isFirstLoad) {
    $('loading').classList.remove('hidden');
    $('page').classList.add('hidden');
  }

  try {
    const res = await fetch(`/payroll-ops/api/users?view=${currentView}`);
    if (!res.ok) throw new Error('Erro na API');
    allUsers = await res.json();
    renderTable();

    loadPayers();

    if (isFirstLoad) {
      $('loading').classList.add('hidden');
      $('page').classList.remove('hidden');
      usersLoaded = true;
    }
  } catch (err) {
    if (isFirstLoad) {
      $('loading').textContent = 'Erro ao carregar dados.';
    }
    console.error(err);
  }
}

function getFiltered() {
  const search = $('search').value.toLowerCase().trim();
  const tipo = $('filterTipo').value;

  let filtered = allUsers;

  if (tipo) {
    filtered = filtered.filter(u => u.tipo === tipo);
  }

  const chip = $('filterChip').value;
  if (chip) {
    filtered = filtered.filter(u => u.statusSimCard === chip);
  }

  if (search) {
    filtered = filtered.filter(u =>
      String(u.idUser).includes(search) ||
      (u.name || '').toLowerCase().includes(search) ||
      (u.cpf || '').includes(search) ||
      (u.codigo || '').toLowerCase().includes(search)
    );
  }

  // Sort
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];

    if (sortCol === 'valorRecorrencia' || sortCol === 'valorProporcional' || sortCol === 'idUser') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else if (sortCol === 'dataCadastro') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
    } else {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
    }

    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return filtered;
}

function renderTable() {
  const filtered = getFiltered();
  $('resultCount').textContent = `${filtered.length} de ${allUsers.length} registros`;

  const tbody = $('tableBody');
  tbody.innerHTML = '';

  filtered.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.idUser}</td>
      <td>${u.name || '-'}</td>
      <td>${u.cpf || '-'}</td>
      <td><span class="${u.tipo === 'Titular' ? 'badge-titular' : 'badge-dependente'}">${u.tipo}</span></td>
      <td>${u.codigo || '-'}</td>
      <td>${formatDate(u.dataCadastro)}</td>
      <td>${u.assinaturaRecorrente || '-'}</td>
      <td>${formatCurrency(u.valorRecorrencia)}</td>
      <td>${u.diasDeUso || '-'}</td>
      <td>${formatCurrency(u.valorProporcional)}</td>
      <td>${u.companyName || '-'}</td>
      <td>${currentView === 'todos'
        ? `<span class="${u.statusSimCard === 'Sim' ? 'badge-sim' : u.statusSimCard === 'Inativo' ? 'badge-inativo' : 'badge-semchip'}">${u.statusSimCard || '-'}</span>`
        : (u.idSimCard || '-')}</td>
    `;
    tbody.appendChild(tr);
  });

  // Update sort indicators
  document.querySelectorAll('.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// Event listeners
$('search').addEventListener('input', renderTable);
$('filterTipo').addEventListener('change', renderTable);
$('filterChip').addEventListener('change', renderTable);

document.querySelectorAll('.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = 'asc';
    }
    renderTable();
  });
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    const chipFilter = $('filterChip');
    if (currentView === 'todos') {
      chipFilter.classList.remove('hidden');
    } else {
      chipFilter.classList.add('hidden');
      chipFilter.value = '';
    }
    loadUsers();
  });
});

loadUsers();
initRefreshBar('refreshContainer', () => {
  payersLoaded = false;
  loadUsers();
});
