const monthPicker = document.getElementById('monthPicker');
const btnLoad = document.getElementById('btnLoad');
const btnDownload = document.getElementById('btnDownload');
const btnPdf = document.getElementById('btnPdf');
const btnEmail = document.getElementById('btnEmail');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const results = document.getElementById('results');

// Default to previous month
const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
monthPicker.value = prev.toISOString().slice(0, 7);

let currentData = null;

const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleString('pt-BR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

function renderTable(rows, tbodyId, tfootId, totalRepasse) {
  const tbody = document.getElementById(tbodyId);
  const tfoot = document.getElementById(tfootId);

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.nickname || '-'}</td>
      <td>${r.last_product || '-'}</td>
      <td>${fmtDate(r.last_date)}</td>
      <td>${fmt(Number(r.last_amount))}</td>
      <td><span class="badge ${r.tipo === 'Ativação' ? 'badge-ativacao' : 'badge-recorrencia'}">${r.tipo}</span></td>
      <td>${fmt(r.repasse)}</td>
    </tr>
  `).join('');

  tfoot.innerHTML = `
    <tr>
      <td colspan="5" style="text-align:right">Valor total</td>
      <td>${fmt(totalRepasse)}</td>
    </tr>
  `;
}

async function loadData() {
  const month = monthPicker.value;
  if (!month) return;

  empty.classList.add('hidden');
  results.classList.add('hidden');
  loading.classList.remove('hidden');
  btnDownload.disabled = true;
  btnPdf.disabled = true;
  btnEmail.disabled = true;

  try {
    const res = await fetch(`/api/partnerships?month=${month}`);
    if (!res.ok) throw new Error('Erro na consulta');
    const data = await res.json();
    currentData = data;

    document.getElementById('giguTotal').textContent = fmt(data.giguTotal);
    document.getElementById('stopclubTotal').textContent = fmt(data.stopclubTotal);
    document.getElementById('grandTotal').textContent = fmt(data.total);
    document.getElementById('giguCount').textContent = `${data.gigu.length} registros`;
    document.getElementById('stopclubCount').textContent = `${data.stopclub.length} registros`;
    document.getElementById('totalCount').textContent = `${data.gigu.length + data.stopclub.length} registros`;
    document.getElementById('giguCountLabel').textContent = `${data.gigu.length} registros`;
    document.getElementById('stopclubCountLabel').textContent = `${data.stopclub.length} registros`;

    renderTable(data.gigu, 'giguBody', 'giguFoot', data.giguTotal);
    renderTable(data.stopclub, 'stopclubBody', 'stopclubFoot', data.stopclubTotal);

    loading.classList.add('hidden');
    results.classList.remove('hidden');
    btnDownload.disabled = false;
    btnPdf.disabled = false;
    btnEmail.disabled = false;
  } catch (err) {
    loading.textContent = 'Erro ao carregar dados.';
    console.error(err);
  }
}

function downloadCSV() {
  if (!currentData) return;
  const month = monthPicker.value;
  const lines = [];
  const sep = ';';

  // GIGU section
  lines.push('GIGU');
  lines.push(['Nome do cliente', 'Produto adquirido', 'Data da compra', 'Valor da compra', 'Caso', 'Repasse'].join(sep));
  for (const r of currentData.gigu) {
    lines.push([
      r.nickname || '',
      r.last_product || '',
      fmtDate(r.last_date),
      Number(r.last_amount).toFixed(2).replace('.', ','),
      r.tipo,
      `R$ ${r.repasse.toFixed(2).replace('.', ',')}`,
    ].join(sep));
  }
  lines.push(['Valor total', '', '', '', 'Valor total', `R$ ${currentData.giguTotal.toFixed(2).replace('.', ',')}`].join(sep));
  lines.push('');

  // STOPCLUB section
  lines.push('STOPCLUB');
  lines.push(['Nome do cliente', 'Produto adquirido', 'Data da compra', 'Valor da compra', 'Caso', 'Repasse'].join(sep));
  for (const r of currentData.stopclub) {
    lines.push([
      r.nickname || '',
      r.last_product || '',
      fmtDate(r.last_date),
      Number(r.last_amount).toFixed(2).replace('.', ','),
      r.tipo,
      `R$ ${r.repasse.toFixed(2).replace('.', ',')}`,
    ].join(sep));
  }
  lines.push(['Valor total', '', '', '', 'Valor total', `R$ ${currentData.stopclubTotal.toFixed(2).replace('.', ',')}`].join(sep));
  lines.push('');
  lines.push(['Total', `R$ ${currentData.total.toFixed(2).replace('.', ',')}`].join(sep));

  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GIGU+STOPCLUB ${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getMonthLabel(month) {
  const [y, m] = month.split('-');
  const names = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

function fmtBRL(v) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function fmtValor(v) {
  return Number(v).toFixed(2).replace('.', ',');
}

function fmtDatePdf(d) {
  if (!d) return '-';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}.000`;
}

function downloadPDF() {
  if (!currentData) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const month = monthPicker.value;
  const monthLabel = getMonthLabel(month);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const primary = [23, 37, 84];
  const accent = [37, 99, 235];
  const headerBg = [23, 37, 84];
  const headerText = [255, 255, 255];
  const altRow = [241, 245, 249];
  const white = [255, 255, 255];
  const totalBg = [219, 234, 254];
  const grandTotalBg = [23, 37, 84];

  const cols = ['Nome do cliente', 'Produto adquirido', 'Data da compra', 'Valor da compra', 'Caso', 'Repasse'];

  function buildRows(data) {
    return data.map(r => [
      r.nickname || '-',
      r.last_product || '-',
      fmtDatePdf(r.last_date),
      fmtValor(r.last_amount),
      r.tipo,
      fmtBRL(r.repasse),
    ]);
  }

  function addFooter(doc) {
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`GIGU+STOPCLUB ${monthLabel}`, 14, pageH - 8);
      doc.text(`Pagina ${i} de ${pages}`, pageW - 14, pageH - 8, { align: 'right' });
    }
  }

  // --- Title page header ---
  doc.setFillColor(...primary);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...headerText);
  doc.text(`Relatorio de Parcerias — ${monthLabel}`, 14, 17);

  // Summary boxes
  let sy = 38;
  const boxW = (pageW - 42) / 3;
  const boxes = [
    { label: 'GIGU', value: fmtBRL(currentData.giguTotal), count: `${currentData.gigu.length} registros`, color: accent },
    { label: 'STOPCLUB', value: fmtBRL(currentData.stopclubTotal), count: `${currentData.stopclub.length} registros`, color: [245, 158, 11] },
    { label: 'TOTAL GERAL', value: fmtBRL(currentData.total), count: `${currentData.gigu.length + currentData.stopclub.length} registros`, color: [22, 163, 74] },
  ];
  boxes.forEach((b, i) => {
    const bx = 14 + i * (boxW + 7);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(bx, sy, boxW, 26, 3, 3, 'F');
    doc.setDrawColor(...b.color);
    doc.setLineWidth(0.8);
    doc.line(bx, sy, bx, sy + 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(b.label, bx + 6, sy + 9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...b.color);
    doc.text(b.value, bx + 6, sy + 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(b.count, bx + boxW - 4, sy + 9, { align: 'right' });
  });

  let startY = sy + 36;

  // --- GIGU Table ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...primary);
  doc.text('GIGU', 14, startY);
  startY += 4;

  const giguRows = buildRows(currentData.gigu);
  giguRows.push(['', '', '', '', 'Valor total', fmtBRL(currentData.giguTotal)]);

  doc.autoTable({
    startY,
    head: [cols],
    body: giguRows,
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [220, 220, 220], lineWidth: 0.1 },
    headStyles: { fillColor: headerBg, textColor: headerText, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: altRow },
    columnStyles: {
      0: { cellWidth: 52 },
      3: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === giguRows.length - 1) {
        data.cell.styles.fillColor = totalBg;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = primary;
      }
      if (data.section === 'body' && data.column.index === 4 && data.row.index < giguRows.length - 1) {
        const val = data.cell.raw;
        if (val === 'Ativação') {
          data.cell.styles.textColor = [22, 163, 74];
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'Recorrência') {
          data.cell.styles.textColor = accent;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // --- STOPCLUB Table ---
  startY = doc.lastAutoTable.finalY + 12;

  // Check if we need a new page
  if (startY > pageH - 30) {
    doc.addPage();
    startY = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...primary);
  doc.text('STOPCLUB', 14, startY);
  startY += 4;

  const scRows = buildRows(currentData.stopclub);
  scRows.push(['', '', '', '', 'Valor total', fmtBRL(currentData.stopclubTotal)]);

  doc.autoTable({
    startY,
    head: [cols],
    body: scRows,
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [220, 220, 220], lineWidth: 0.1 },
    headStyles: { fillColor: headerBg, textColor: headerText, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: altRow },
    columnStyles: {
      0: { cellWidth: 52 },
      3: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === scRows.length - 1) {
        data.cell.styles.fillColor = totalBg;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = primary;
      }
      if (data.section === 'body' && data.column.index === 4 && data.row.index < scRows.length - 1) {
        const val = data.cell.raw;
        if (val === 'Ativação') {
          data.cell.styles.textColor = [22, 163, 74];
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'Recorrência') {
          data.cell.styles.textColor = accent;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // --- Grand total ---
  startY = doc.lastAutoTable.finalY + 10;
  if (startY > pageH - 20) {
    doc.addPage();
    startY = 20;
  }

  doc.setFillColor(...grandTotalBg);
  doc.roundedRect(pageW - 14 - 80, startY, 80, 14, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...headerText);
  doc.text('Total', pageW - 14 - 74, startY + 9.5);
  doc.text(fmtBRL(currentData.total), pageW - 14 - 4, startY + 9.5, { align: 'right' });

  addFooter(doc);
  doc.save(`GIGU+STOPCLUB ${monthLabel}.pdf`);
}

function openEmailDraft() {
  if (!currentData) return;
  const month = monthPicker.value;
  const monthLabel = getMonthLabel(month);

  // First download the PDF so user has it ready
  downloadPDF();

  // Then open Gmail compose
  const to = 'jani@gigu.app,raul@gigu.app,ighor.rodrigues@stopclub.com.br';
  const cc = 'daniel.oelsner@fishervb.com';
  const subject = `Parceria GigU/StopClub e TaOn - Indicações Mês ${monthLabel}`;
  const body = `Bom dia,\n\nSegue relatório de indicações de ${monthLabel} para conferência e emissão da NF.\n\nObrigado!`;

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1`
    + `&to=${encodeURIComponent(to)}`
    + `&cc=${encodeURIComponent(cc)}`
    + `&su=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`;

  setTimeout(() => window.open(gmailUrl, '_blank'), 500);
}

btnLoad.addEventListener('click', loadData);
btnDownload.addEventListener('click', downloadCSV);
btnPdf.addEventListener('click', downloadPDF);
btnEmail.addEventListener('click', openEmailDraft);
monthPicker.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadData();
});
