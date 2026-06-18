const $ = (id) => document.getElementById(id);

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

function hBar(label, count, pct, colorClass) {
  return `
    <div class="nps-h-bar-row">
      <span class="nps-h-bar-label" title="${label}">${label}</span>
      <div class="nps-h-bar-track">
        <div class="nps-h-bar-fill ${colorClass || ''}" style="width:${pct}%"></div>
      </div>
      <span class="nps-h-bar-pct">${pct}%</span>
      <span class="nps-h-bar-count">${count}</span>
    </div>`;
}

function conectividadeColor(value) {
  if (value === 'op1') return 'green';
  if (value === 'op2') return 'green';
  if (value === 'op3') return 'orange';
  if (value === 'op4') return '';
  if (value === 'op5') return 'red';
  return '';
}

function motivacaoColor(value) {
  const n = Number(value);
  if (n >= 4) return 'green';
  if (n === 3) return 'orange';
  return 'red';
}

async function load() {
  try {
    const res = await fetch('/api/nps-meli');
    const d = await res.json();

    // KPIs
    const score = d.nps.score;
    $('npsScore').textContent = (score > 0 ? '+' : '') + score;
    $('npsTotal').textContent = d.nps.total + ' respostas NPS';
    $('npsPromo').textContent = d.nps.promotores;
    $('npsPromoPct').textContent = d.nps.pctPromo + '%';
    $('npsNeutro').textContent = d.nps.neutros;
    $('npsNeutroPct').textContent = d.nps.pctNeutro + '%';
    $('npsDetrator').textContent = d.nps.detratores;
    $('npsDetratPct').textContent = d.nps.pctDetrator + '%';
    $('ativaram').textContent = d.ativacao.ativaram;
    $('ativaramPct').textContent = d.ativacao.pctAtivaram + '% do total';
    $('totalRespostas').textContent = d.totalRespostas;
    $('ultimaAtualizacao').textContent = 'Ultima: ' + formatDate(d.ultimaAtualizacao);

    const card = $('npsScoreCard');
    if (score > 0) card.classList.add('score-positive');
    else if (score < 0) card.classList.add('score-negative');
    else card.classList.add('score-neutral');

    // Barra NPS
    $('npsBarDetrator').style.width = d.nps.pctDetrator + '%';
    $('npsBarNeutro').style.width   = d.nps.pctNeutro + '%';
    $('npsBarPromo').style.width    = d.nps.pctPromo + '%';
    $('npsLegDetrator').textContent = d.nps.pctDetrator + '% (' + d.nps.detratores + ')';
    $('npsLegNeutro').textContent   = d.nps.pctNeutro + '% (' + d.nps.neutros + ')';
    $('npsLegPromo').textContent    = d.nps.pctPromo + '% (' + d.nps.promotores + ')';

    // Q1 - ativacao
    const totalQ1 = d.ativacao.total;
    const pctNaoAtiv = totalQ1 ? Math.round((d.ativacao.naoAtivaram / totalQ1) * 100) : 0;
    $('ativacaoBars').innerHTML =
      hBar('Sim, tá funcionando', d.ativacao.ativaram, d.ativacao.pctAtivaram, 'green') +
      hBar('Não consegui ativar', d.ativacao.naoAtivaram, pctNaoAtiv, 'red');

    // Q1b - motivos
    if (d.motivosNaoAtivacao.length > 0) {
      $('motivosBars').innerHTML = d.motivosNaoAtivacao
        .map(r => hBar(r.label, r.count, r.pct, 'orange'))
        .join('');
    } else {
      $('motivosSection').style.display = 'none';
    }

    // Q3 - conectividade
    $('conectividadeBars').innerHTML = d.conectividade
      .map(r => hBar(r.label, r.count, r.pct, conectividadeColor(r.value)))
      .join('');

    // Q4 - motivacao nivel
    const nivelLabels = { '1': '1 — Nada motivado(a)', '2': '2', '3': '3 — Neutro(a)', '4': '4', '5': '5 — Muito motivado(a)' };
    $('motivacaoBars').innerHTML = d.motivacaoNivel
      .map(r => hBar(nivelLabels[r.value] || r.value, r.count, r.pct, motivacaoColor(r.value)))
      .join('');

    $('loading').classList.add('hidden');
    $('page').classList.remove('hidden');
  } catch (err) {
    $('loading').textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

load();
