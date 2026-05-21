const $ = (id) => document.getElementById(id);

let dashData = null;
let currentView = 'total';

function formatNumber(n) {
  return Number(n || 0).toLocaleString('pt-BR');
}

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(part, total) {
  if (!total) return 0;
  return ((part / total) * 100).toFixed(1);
}

function setPeriod() {
  const now = new Date();
  const day = now.getDate();
  let start, end;

  if (day > 7) {
    start = new Date(now.getFullYear(), now.getMonth(), 7);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 7);
    end = new Date(now.getFullYear(), now.getMonth(), 7);
  }

  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  $('period').textContent = `Ciclo: ${fmt(start)} - ${fmt(end)}`;
}

function renderView(d) {
  // Big numbers
  $('totalLinhas').textContent = formatNumber(d.totalLinhas);
  $('receitaPotencial').textContent = formatCurrency(d.receitaPotencial);
  $('ticketMedio').textContent = formatCurrency(d.ticketMedio);

  // Breakdowns
  $('titulares').textContent = formatNumber(d.titulares);
  $('dependentes').textContent = formatNumber(d.dependentes);
  $('receitaTitulares').textContent = formatCurrency(d.receitaTitulares);
  $('receitaDependentes').textContent = formatCurrency(d.receitaDependentes);
  $('ticketMedioTitulares').textContent = formatCurrency(d.ticketMedioTitulares);
  $('ticketMedioDependentes').textContent = formatCurrency(d.ticketMedioDependentes);

  // Bar - Linhas
  const pctTit = pct(Number(d.titulares), Number(d.totalLinhas));
  const pctDep = pct(Number(d.dependentes), Number(d.totalLinhas));
  $('barLinhasTit').style.width = pctTit + '%';
  $('barLinhasTit').textContent = pctTit > 10 ? pctTit + '%' : '';
  $('barLinhasDep').style.width = pctDep + '%';
  $('barLinhasDep').textContent = pctDep > 10 ? pctDep + '%' : '';
  $('pctLinhasTit').textContent = pctTit + '%';
  $('pctLinhasDep').textContent = pctDep + '%';

  // Bar - Receita
  const pctRecTit = pct(Number(d.receitaTitulares), Number(d.receitaPotencial));
  const pctRecDep = pct(Number(d.receitaDependentes), Number(d.receitaPotencial));
  $('barReceitaTit').style.width = pctRecTit + '%';
  $('barReceitaTit').textContent = pctRecTit > 10 ? pctRecTit + '%' : '';
  $('barReceitaDep').style.width = pctRecDep + '%';
  $('barReceitaDep').textContent = pctRecDep > 10 ? pctRecDep + '%' : '';
  $('pctReceitaTit').textContent = pctRecTit + '%';
  $('pctReceitaDep').textContent = pctRecDep + '%';
}

async function loadDashboard() {
  const isFirstLoad = !dashData;
  try {
    const res = await fetch('/payroll-ops/api/dashboard');
    if (!res.ok) throw new Error('Erro na API');
    dashData = await res.json();

    renderView(dashData[currentView]);

    if (isFirstLoad) {
      $('loading').classList.add('hidden');
      $('dashboard').classList.remove('hidden');
    }
  } catch (err) {
    if (isFirstLoad) {
      $('loading').textContent = 'Erro ao carregar dados. Verifique a conexao com o banco.';
    }
    console.error(err);
  }
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    if (dashData) renderView(dashData[currentView]);
  });
});

setPeriod();
loadDashboard();
initRefreshBar('refreshContainer', loadDashboard);
