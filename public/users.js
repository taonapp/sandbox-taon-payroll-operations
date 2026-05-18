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

let usersLoaded = false;

async function loadUsers() {
  const isFirstLoad = !usersLoaded;
  if (isFirstLoad) {
    $('loading').classList.remove('hidden');
    $('page').classList.add('hidden');
  }

  try {
    const res = await fetch(`/api/users?view=${currentView}`);
    if (!res.ok) throw new Error('Erro na API');
    allUsers = await res.json();
    renderTable();

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
      <td>${u.idSimCard || '-'}</td>
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
    loadUsers();
  });
});

loadUsers();
initRefreshBar('refreshContainer', loadUsers);
