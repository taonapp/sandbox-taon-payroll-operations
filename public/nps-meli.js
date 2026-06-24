function fmt(n) {
  return Number(n).toLocaleString('pt-BR');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function hBar(label, count, pct, colorClass) {
  const fill = Math.max(pct, 0);
  return `
    <div class="nps-h-bar-row">
      <span class="nps-h-label">${label}</span>
      <div class="nps-h-track">
        <div class="nps-h-fill ${colorClass}" style="width:${fill}%"></div>
      </div>
      <span class="nps-h-pct">${pct}%</span>
      <span class="nps-h-count">${fmt(count)}</span>
    </div>`;
}

function ativacaoColor(value) {
  if (value === 'op1') return 'fill-green';
  return 'fill-red';
}

function conectividadeColor(value) {
  if (value === 'op1') return 'fill-green';
  if (value === 'op2') return 'fill-teal';
  if (value === 'op3') return 'fill-orange';
  if (value === 'op4') return 'fill-gray';
  return 'fill-red';
}

function motivacaoColor(value) {
  const v = parseInt(value, 10);
  if (v === 5) return 'fill-green';
  if (v === 4) return 'fill-teal';
  if (v === 3) return 'fill-gray';
  if (v === 2) return 'fill-orange';
  return 'fill-red';
}

async function load() {
  try {
    const res = await fetch('/payroll-ops/api/nps-meli');
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();

    // 1. KPIs
    document.getElementById('totalRespostas').textContent = fmt(d.totalRespostas);
    if (d.totalRespostas < 100) {
      document.getElementById('nWarning').classList.remove('hidden');
    }
    document.getElementById('ultimaAtualizacao').textContent = 'Atualizado ' + fmtDate(d.ultimaAtualizacao);

    document.getElementById('pctAtivaram').textContent = d.ativacao.pctAtivaram + '%';
    document.getElementById('ativaramSub').textContent = fmt(d.ativacao.ativaram) + ' de ' + fmt(d.ativacao.total) + ' ativaram';

    const scoreEl = document.getElementById('npsScore');
    scoreEl.textContent = (d.nps.score > 0 ? '+' : '') + d.nps.score;
    const scoreCard = document.getElementById('npsScoreCard');
    scoreCard.classList.remove('score-positive', 'score-neutral', 'score-negative');
    if (d.nps.score >= 50) scoreCard.classList.add('score-positive');
    else if (d.nps.score >= 0) scoreCard.classList.add('score-neutral');
    else scoreCard.classList.add('score-negative');
    document.getElementById('npsScoreSub').textContent = fmt(d.nps.total) + ' avaliaram';

    // 2. Ativacao
    document.getElementById('ativacaoBars').innerHTML =
      d.ativacao.opcoes.map(r => hBar(r.label, r.count, r.pct, ativacaoColor(r.value))).join('');

    if (d.ativacao.naoAtivaram > 0 && d.motivosNaoAtivacao.length > 0) {
      document.getElementById('ativacaoSection').classList.add('nps-two-col-section');
      document.getElementById('motivosWrapper').classList.remove('hidden');
      document.getElementById('motivosBase').textContent = fmt(d.ativacao.naoAtivaram);
      document.getElementById('motivosBars').innerHTML =
        d.motivosNaoAtivacao.map(r => hBar(r.label, r.count, r.pct, 'fill-orange')).join('');
    }

    // 3. NPS
    document.getElementById('npsScope').textContent =
      fmt(d.nps.total) + ' respostas — entre os que ativaram o chip';

    document.getElementById('npsPromo').textContent = fmt(d.nps.promotores);
    document.getElementById('npsPromoPct').textContent = d.nps.pctPromo + '%';
    document.getElementById('npsNeutro').textContent = fmt(d.nps.neutros);
    document.getElementById('npsNeutroPct').textContent = d.nps.pctNeutro + '%';
    document.getElementById('npsDetrator').textContent = fmt(d.nps.detratores);
    document.getElementById('npsDetratPct').textContent = d.nps.pctDetrator + '%';

    const tot = d.nps.total;
    document.getElementById('npsBarDetrator').style.width = (tot ? (d.nps.detratores / tot) * 100 : 0) + '%';
    document.getElementById('npsBarNeutro').style.width   = (tot ? (d.nps.neutros    / tot) * 100 : 0) + '%';
    document.getElementById('npsBarPromo').style.width    = (tot ? (d.nps.promotores / tot) * 100 : 0) + '%';
    document.getElementById('npsLegDetrator').textContent = fmt(d.nps.detratores) + ' (' + d.nps.pctDetrator + '%)';
    document.getElementById('npsLegNeutro').textContent   = fmt(d.nps.neutros)    + ' (' + d.nps.pctNeutro   + '%)';
    document.getElementById('npsLegPromo').textContent    = fmt(d.nps.promotores) + ' (' + d.nps.pctPromo    + '%)';

    // 4. Conectividade
    const conectividadeOrder = ['op1', 'op2', 'op3', 'op4', 'op5'];
    document.getElementById('conectividadeScope').textContent =
      fmt(d.ativacao.ativaram) + ' respostas — entre os que ativaram o chip';
    document.getElementById('conectividadeBars').innerHTML =
      [...d.conectividade]
        .sort((a, b) => conectividadeOrder.indexOf(a.value) - conectividadeOrder.indexOf(b.value))
        .map(r => hBar(r.label, r.count, r.pct, conectividadeColor(r.value))).join('');

    // 6. Comentarios livres
    if (d.comentarios && d.comentarios.length > 0) {
      document.getElementById('comentariosTotal').textContent = fmt(d.comentarios.length);
      document.getElementById('comentariosGrid').innerHTML = d.comentarios.map(c => {
        let lineClass = 'nps-comment-line';
        let tag = '';
        if (c.npsScore != null) {
          if (c.npsScore <= 6)      { lineClass += ' line-detrator'; tag = '<span class="nps-comment-tag tag-detrator">Detrator</span>'; }
          else if (c.npsScore <= 8) { lineClass += ' line-neutro';   tag = '<span class="nps-comment-tag tag-neutro">Neutro</span>'; }
        }
        return `<div class="${lineClass}">${tag}<span class="nps-comment-text">"${c.texto}"</span></div>`;
      }).join('');
    } else {
      document.getElementById('comentariosSection').classList.add('hidden');
    }

    // 5. Motivacao para manter nivel
    const motivacaoOrder = ['5', '4', '3', '2', '1'];
    document.getElementById('motivacaoScope').textContent =
      fmt(d.ativacao.ativaram) + ' respostas — entre os que ativaram o chip';
    document.getElementById('motivacaoBars').innerHTML =
      [...d.motivacaoNivel]
        .sort((a, b) => motivacaoOrder.indexOf(a.value) - motivacaoOrder.indexOf(b.value))
        .map(r => hBar(r.label, r.count, r.pct, motivacaoColor(r.value))).join('');

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('page').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading').textContent = 'Erro ao carregar dados: ' + err.message;
  }
}

load();
