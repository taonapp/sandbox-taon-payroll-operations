const $ = (id) => document.getElementById(id);

let allUsers = [];
let currentView = 'total';
let currentPartner = 'hagana';
let sortCol = 'dataCadastro';
let sortDir = 'desc';

const PARTNER_LABELS = { hagana: 'Haganá', aster: 'Aster' };
const PARTNER_CUTOFF = { hagana: 20, aster: 25 };

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
  const parceiro = PARTNER_LABELS[currentPartner] || currentPartner;
  if (currentView === 'cobranca') return `Cobranca por Pagador - ${parceiro} (corte dia ${PARTNER_CUTOFF[currentPartner]})`;
  if (currentView === 'total') return `Cobranca por Pagador - ${parceiro} (base total)`;
  return `Cobranca por Pagador - ${parceiro} (todos)`;
}

async function loadPayers() {
  const tbody = $('payersTableBody');
  const totals = $('payersTotals');
  $('payersLabel').textContent = getPayersLabel();

  try {
    const res = await fetch(`/payroll-ops/api/users/payers?view=${currentView}&op=${currentPartner}`);
    if (!res.ok) throw new Error('Erro na API');
    const payers = await res.json();

    tbody.innerHTML = '';
    let sumValor = 0;
    let sumLinhas = 0;
    let sumCobraveis = 0;

    payers.forEach(p => {
      sumValor += Number(p.valorTotalFolha) || 0;
      sumLinhas += Number(p.totalLinhas) || 0;
      sumCobraveis += Number(p.totalLinhasCobraveis) || 0;
      const tr = document.createElement('tr');
      const linhas = Number(p.totalLinhas);
      const cobraveis = Number(p.totalLinhasCobraveis);
      const diff = cobraveis > linhas;
      tr.innerHTML = `
        <td>${p.idUser || '-'}</td>
        <td>${p.name || '-'}</td>
        <td>${p.cpf || '-'}</td>
        <td>${formatCurrency(p.valorTotalFolha)}</td>
        <td>${linhas.toLocaleString('pt-BR')}</td>
        <td${diff ? ' style="color:var(--orange);font-weight:600"' : ''}>${cobraveis.toLocaleString('pt-BR')}</td>
      `;
      tbody.appendChild(tr);
    });

    totals.innerHTML = `
      <span><b>Total:</b> ${formatCurrency(sumValor)}</span>
      <span><b>Linhas cobradas:</b> ${sumLinhas.toLocaleString('pt-BR')}</span>
      <span><b>Total cobraveis:</b> ${sumCobraveis.toLocaleString('pt-BR')}</span>
      <span><b>Pagadores:</b> ${payers.length}</span>
    `;

    payersLoaded = true;
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Erro ao carregar dados</td></tr>';
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
    } else if (sortCol === 'dataCadastro' || sortCol === 'maxDateEnd') {
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
      <td>${formatDate(u.maxDateEnd)}</td>
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

function updateExportHref() {
  $('exportXlsx').href = `/payroll-ops/api/users/payers/export?op=${currentPartner}`;
}

// --- Modal "Ver SQL" ---
function showSqlModal(title, sql) {
  $('sqlModalTitle').textContent = title;
  $('sqlModalBody').textContent = sql;
  $('sqlModal').classList.remove('hidden');
}

function closeSqlModal() {
  $('sqlModal').classList.add('hidden');
}

async function openSqlFor(url, title) {
  showSqlModal(title, '-- carregando...');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Erro na API');
    const { sql } = await res.json();
    showSqlModal(title, sql || '-- (vazio)');
  } catch (err) {
    showSqlModal(title, '-- erro ao carregar a query');
    console.error(err);
  }
}

$('payersSqlBtn').addEventListener('click', (e) => {
  e.stopPropagation(); // não colapsar a seção
  openSqlFor(
    `/payroll-ops/api/users/payers?view=${currentView}&op=${currentPartner}&sql=1`,
    `Cobranca por Pagador - ${PARTNER_LABELS[currentPartner] || currentPartner} / ${currentView}`
  );
});

$('usersSqlBtn').addEventListener('click', () => {
  openSqlFor(
    `/payroll-ops/api/users?view=${currentView}&sql=1`,
    `Base de Usuarios - ${currentView} (nao filtra por parceiro)`
  );
});

$('sqlModalClose').addEventListener('click', closeSqlModal);
$('sqlModal').addEventListener('click', (e) => {
  if (e.target === $('sqlModal')) closeSqlModal(); // clique no overlay
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSqlModal();
});

$('sqlCopyBtn').addEventListener('click', async () => {
  const btn = $('sqlCopyBtn');
  try {
    await navigator.clipboard.writeText($('sqlModalBody').textContent);
    const prev = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  } catch (err) {
    console.error(err);
  }
});

// Event listeners
$('search').addEventListener('input', renderTable);
$('filterTipo').addEventListener('change', renderTable);
$('filterChip').addEventListener('change', renderTable);

// Partner switching (drives both the payers table and the export)
$('partnerSelect').addEventListener('change', (e) => {
  currentPartner = e.target.value;
  updateExportHref();
  if (currentView === 'sanity') {
    loadSanity();
    return;
  }
  payersLoaded = false;
  loadPayers();
});

// --- Sanity Check ---
function escapeHtml(v) {
  return String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function loadSanity() {
  renderSankey();
  const container = $('sanityCards');
  container.innerHTML = '<div class="sanity-empty">Carregando verificacoes...</div>';
  try {
    const res = await fetch(`/payroll-ops/api/sanity/summary?op=${currentPartner}`);
    if (!res.ok) throw new Error('Erro na API');
    const checks = await res.json();
    container.innerHTML = '';
    checks.forEach(c => container.appendChild(buildSanityCard(c)));
  } catch (err) {
    container.innerHTML = '<div class="sanity-empty">Erro ao carregar verificacoes.</div>';
    console.error(err);
  }
}

function buildSanityCard(check) {
  const card = document.createElement('div');
  card.className = 'sanity-card';
  card.innerHTML = `
    <div class="sanity-card-header">
      <span class="sanity-sev ${check.severity}"></span>
      <span class="sanity-title">${escapeHtml(check.label)}</span>
      <span class="sanity-count">${check.count}</span>
      <span class="sanity-spacer"></span>
      <button class="sql-btn" type="button" data-act="sql">Ver SQL</button>
      <span class="sanity-toggle-icon">&#9654;</span>
    </div>
    <div class="sanity-card-body hidden">
      <p class="sanity-explain">${escapeHtml(check.explain)}</p>
      <div class="sanity-list"><div class="sanity-empty">Expanda para carregar a listagem.</div></div>
    </div>`;

  const header = card.querySelector('.sanity-card-header');
  const body = card.querySelector('.sanity-card-body');
  const icon = card.querySelector('.sanity-toggle-icon');
  let loaded = false;

  header.addEventListener('click', () => {
    const hidden = body.classList.toggle('hidden');
    icon.innerHTML = hidden ? '&#9654;' : '&#9660;';
    if (!hidden && !loaded) {
      loaded = true;
      loadSanityList(check, body.querySelector('.sanity-list'));
    }
  });

  card.querySelector('[data-act="sql"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openSqlFor(
      `/payroll-ops/api/sanity/check?op=${currentPartner}&key=${check.key}&sql=1`,
      `SQL - ${check.label} (${PARTNER_LABELS[currentPartner] || currentPartner})`
    );
  });

  return card;
}

async function loadSanityList(check, el) {
  if (check.count === 0) {
    el.innerHTML = '<div class="sanity-empty">Nenhum usuario neste caso.</div>';
    return;
  }
  el.innerHTML = '<div class="sanity-empty">Carregando listagem...</div>';
  try {
    const res = await fetch(`/payroll-ops/api/sanity/check?op=${currentPartner}&key=${check.key}`);
    if (!res.ok) throw new Error('Erro na API');
    const rows = await res.json();
    el.innerHTML = '';
    el.appendChild(buildGenericTable(rows));
  } catch (err) {
    el.innerHTML = '<div class="sanity-empty">Erro ao carregar listagem.</div>';
    console.error(err);
  }
}

function buildGenericTable(rows) {
  if (!rows.length) {
    const d = document.createElement('div');
    d.className = 'sanity-empty';
    d.textContent = 'Sem registros.';
    return d;
  }
  const cols = Object.keys(rows[0]);
  const wrap = document.createElement('div');
  wrap.className = 'sanity-table-scroll';
  const thead = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r =>
    `<tr>${cols.map(c => `<td>${r[c] == null ? '-' : escapeHtml(r[c])}</td>`).join('')}</tr>`
  ).join('')}</tbody>`;
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = thead + tbody;
  wrap.appendChild(table);
  return wrap;
}

// --- Sankey do funil ---
const SVG_NS = 'http://www.w3.org/2000/svg';

async function renderSankey() {
  const el = $('sanitySankey');
  el.innerHTML = '<div class="sanity-empty">Carregando funil...</div>';
  try {
    const res = await fetch(`/payroll-ops/api/sanity/funnel?op=${currentPartner}`);
    if (!res.ok) throw new Error('Erro na API');
    const f = await res.json();
    el.innerHTML = '';
    el.appendChild(buildSankeySvg(f));
  } catch (err) {
    el.innerHTML = '<div class="sanity-empty">Erro ao carregar o funil.</div>';
    console.error(err);
  }
}

function buildSankeySvg(f) {
  const nodes = [
    { id: 'all',    col: 0, label: 'Cadastros ativos',   count: f.total,       kind: 'all' },
    { id: 'chip',   col: 1, label: 'Com chip cobrável',  count: f.comChip,     kind: 'all' },
    { id: 'nochip', col: 1, label: 'Sem chip cobrável',  count: f.semChip,     kind: 'warn' },
    { id: 'folha',  col: 2, label: 'Folha (payroll)',    count: f.folha,       kind: 'ok' },
    { id: 'outro',  col: 2, label: 'Outro método',       count: f.outroMetodo, kind: 'ok' },
    { id: 'semrpc', col: 2, label: 'Sem RPC ativa',      count: f.semRpc,      kind: 'bad' },
  ];
  const links = [
    { s: 'all',  t: 'chip',   v: f.comChip },
    { s: 'all',  t: 'nochip', v: f.semChip },
    { s: 'chip', t: 'folha',  v: f.folha },
    { s: 'chip', t: 'outro',  v: f.outroMetodo },
    { s: 'chip', t: 'semrpc', v: f.semRpc },
  ];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));

  const W = Math.max(700, $('sanitySankey').clientWidth || 820);
  const H = 360, nw = 14, padTop = 30, padBot = 22, padL = 10, padR = 170, gap = 22;
  const total = f.total || 1;

  const cols = {};
  nodes.forEach(n => (cols[n.col] = cols[n.col] || []).push(n));
  const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const maxNodes = Math.max(...colKeys.map(k => cols[k].length));
  const usableH = H - padTop - padBot - gap * (maxNodes - 1);
  const scale = usableH / total;
  const innerW = W - padL - padR - nw;

  colKeys.forEach(k => {
    const arr = cols[k];
    const sum = arr.reduce((s, n) => s + n.count, 0);
    const usedH = sum * scale + gap * (arr.length - 1);
    let y = padTop + (H - padTop - padBot - usedH) / 2;
    const x = padL + (colKeys.length > 1 ? (k / (colKeys.length - 1)) * innerW : 0);
    arr.forEach(n => { n.x = x; n.y = y; n.h = Math.max(2, n.count * scale); n._so = 0; n._to = 0; y += n.h + gap; });
  });

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(H));
  svg.classList.add('sankey-svg');

  // links (ordenar saídas pela posição vertical do destino)
  const lastCol = colKeys[colKeys.length - 1];
  links.slice()
    .sort((a, b) => (byId[a.s].col - byId[b.s].col) || (byId[a.t].y - byId[b.t].y))
    .forEach(l => {
      const s = byId[l.s], t = byId[l.t];
      if (!l.v) return;
      const w = Math.max(1, l.v * scale);
      const y0 = s.y + s._so + w / 2; s._so += w;
      const y1 = t.y + t._to + w / 2; t._to += w;
      const x0 = s.x + nw, x1 = t.x, mx = (x0 + x1) / 2;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`);
      path.setAttribute('stroke-width', String(w));
      path.setAttribute('class', `sankey-link ${t.kind}`);
      const tt = document.createElementNS(SVG_NS, 'title');
      tt.textContent = `${s.label} → ${t.label}: ${l.v}`;
      path.appendChild(tt);
      svg.appendChild(path);
    });

  // nós + rótulos
  nodes.forEach(n => {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(n.x));
    rect.setAttribute('y', String(n.y));
    rect.setAttribute('width', String(nw));
    rect.setAttribute('height', String(n.h));
    rect.setAttribute('rx', '2');
    rect.setAttribute('class', `sankey-node ${n.kind}`);
    const tt = document.createElementNS(SVG_NS, 'title');
    tt.textContent = `${n.label}: ${n.count}`;
    rect.appendChild(tt);
    svg.appendChild(rect);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'sankey-label');
    if (n.col === lastCol) {
      label.setAttribute('x', String(n.x + nw + 8));
      label.setAttribute('y', String(n.y + n.h / 2));
      label.setAttribute('dominant-baseline', 'middle');
    } else {
      label.setAttribute('x', String(n.x));
      label.setAttribute('y', String(n.y - 8));
    }
    label.textContent = `${n.label} · ${n.count}`;
    svg.appendChild(label);
  });

  const wrap = document.createElement('div');
  wrap.className = 'sankey-wrap';
  const head = document.createElement('div');
  head.className = 'sankey-head';
  head.textContent = `Funil da base — ${PARTNER_LABELS[currentPartner] || currentPartner}`;
  wrap.appendChild(head);
  wrap.appendChild(svg);
  return wrap;
}

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
    const exportBtn = $('exportXlsx');

    if (currentView === 'sanity') {
      chipFilter.classList.add('hidden');
      chipFilter.value = '';
      exportBtn.classList.add('hidden');
      $('loading').classList.add('hidden');
      $('page').classList.add('hidden');
      $('sanityPanel').classList.remove('hidden');
      loadSanity();
      return;
    }

    $('sanityPanel').classList.add('hidden');
    $('page').classList.remove('hidden');
    if (currentView === 'todos') {
      chipFilter.classList.remove('hidden');
    } else {
      chipFilter.classList.add('hidden');
      chipFilter.value = '';
    }
    if (currentView === 'cobranca') {
      exportBtn.classList.remove('hidden');
    } else {
      exportBtn.classList.add('hidden');
    }
    loadUsers();
  });
});

updateExportHref();
loadUsers();
initRefreshBar('refreshContainer', () => {
  if (currentView === 'sanity') {
    loadSanity();
    return;
  }
  payersLoaded = false;
  loadUsers();
});
