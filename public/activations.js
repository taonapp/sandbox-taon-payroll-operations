const $ = (id) => document.getElementById(id);

let selectedDate = '';
let selectedOp = 'meli';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function formatTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Navigation
$('prevDay').addEventListener('click', () => {
  selectedDate = shiftDate(selectedDate, -1);
  loadDay();
});

$('nextDay').addEventListener('click', () => {
  selectedDate = shiftDate(selectedDate, 1);
  loadDay();
});

$('btnToday').addEventListener('click', () => {
  selectedDate = todayKey();
  loadDay();
});

// Tabs
document.querySelectorAll('[data-op]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-op]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedOp = btn.dataset.op;
    loadDay();
  });
});

async function loadDay() {
  $('dayLabel').textContent = formatDayLabel(selectedDate);
  $('btnToday').classList.toggle('hidden', selectedDate === todayKey());

  $('dayLoading').classList.remove('hidden');
  $('dayContent').classList.add('hidden');

  try {
    const res = await fetch(`/payroll-ops/api/operations/day?date=${selectedDate}&op=${selectedOp}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    renderDay(data);

    $('dayLoading').classList.add('hidden');
    $('dayContent').classList.remove('hidden');
  } catch (err) {
    $('dayLoading').textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

function renderDay(data) {
  const s = data.summary;

  $('dayCadastros').textContent = s.cadastros.toLocaleString('pt-BR');
  $('dayTit').textContent = s.titulares.toLocaleString('pt-BR');
  $('dayDep').textContent = s.dependentes.toLocaleString('pt-BR');

  $('dayChips').textContent = s.chips.toLocaleString('pt-BR');
  $('dayChipsFis').textContent = s.chipsFisicos.toLocaleString('pt-BR');
  $('dayChipsEsim').textContent = s.chipsEsim.toLocaleString('pt-BR');

  // Cadastros table
  const cadBody = $('dayCadBody');
  cadBody.innerHTML = '';
  if (data.cadastros.length === 0) {
    cadBody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted)">Nenhum cadastro neste dia</td></tr>';
  } else {
    data.cadastros.forEach(r => {
      const tr = document.createElement('tr');
      const escolhaLabel = r.escolhaChip === 'physical' ? '<span style="color:var(--orange)">Físico</span>'
        : r.escolhaChip === 'esim' ? '<span style="color:var(--purple)">eSIM</span>' : '-';
      const chipLabel = r.temChip
        ? `<span style="color:var(--green)">${r.chipTipo === 'fisico' ? 'Físico' : 'eSIM'}</span> <small style="color:var(--text-muted)">${r.chipImsi || ''}</small>`
        : '<span style="color:var(--text-muted)">Sem chip</span>';
      const apnLabel = r.temChip
        ? (r.bateuApn ? '<span style="color:var(--green)">Sim</span>' : '<span style="color:#ef4444">Não</span>')
        : '-';
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.name || '-'}</td>
        <td>${r.cpf || '-'}</td>
        <td>${r.codigo || '-'}</td>
        <td><span style="color:${r.tipo === 'Titular' ? 'var(--blue)' : 'var(--purple)'}">${r.tipo}</span></td>
        <td>${r.plano || '-'}</td>
        <td>${r.valor ? formatCurrency(r.valor) : '-'}</td>
        <td>${r.empresa || '-'}</td>
        <td>${escolhaLabel}</td>
        <td>${chipLabel}</td>
        <td>${apnLabel}</td>
        <td>${formatTime(r.dataCadastro)}</td>
      `;
      cadBody.appendChild(tr);
    });
  }

  // Chips table
  const chipBody = $('dayChipBody');
  chipBody.innerHTML = '';
  if (data.chips.length === 0) {
    chipBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">Nenhum chip associado neste dia</td></tr>';
  } else {
    data.chips.forEach(r => {
      const tr = document.createElement('tr');
      const tipoLabel = r.tipoChip === 'fisico' ? '<span style="color:var(--blue)">Físico</span>'
        : r.tipoChip === 'e-sim' ? '<span style="color:var(--purple)">eSIM</span>' : '-';
      tr.innerHTML = `
        <td>${r.idUser}</td>
        <td>${r.userName || '-'}</td>
        <td>${r.imsi || '-'}</td>
        <td style="font-size:11px">${r.iccid || '-'}</td>
        <td>${tipoLabel}</td>
        <td>${r.companyName || '-'}</td>
        <td>${r.spotName || '-'}</td>
        <td>${r.dataCadastro ? new Date(r.dataCadastro).toLocaleDateString('pt-BR') + ' ' + formatTime(r.dataCadastro) : '-'}</td>
        <td>${formatTime(r.dataAssociacao)}</td>
      `;
      chipBody.appendChild(tr);
    });
  }
}

async function loadAll() {
  await loadDay();
}

// Init
selectedDate = todayKey();
loadDay();
initRefreshBar('refreshContainer', loadAll);
