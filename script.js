'use strict';

// ─── Tabela de pressões de ensaio (Pa) — NBR 10821-2017
// Chave: altura máx. do edifício (m) → região (I a V)
const PRESSOES = {
  6:  { 1: 350,  2: 470,  3: 610,  4: 770,  5: 950  },
  15: { 1: 420,  2: 580,  3: 750,  4: 950,  5: 1180 },
  30: { 1: 500,  2: 680,  3: 890,  4: 1130, 5: 1400 },
  60: { 1: 600,  2: 815,  3: 1060, 4: 1350, 5: 1660 },
  90: { 1: 660,  2: 890,  3: 1170, 4: 1480, 5: 1820 }
};

// ─── Tabela de referência interpolada do gráfico Gold Slim
// Formato: [largura_folha_mm, pressao_ensaio_Pa, altura_max_mm]
// Base: perfis LG248+LG249, Jx total = 102.388 mm⁴
const TABELA_REF = [
  [600,610,1950],[600,750,1780],[600,890,1650],[600,1060,1500],[600,1170,1400],
  [700,610,1870],[700,750,1700],[700,890,1570],[700,1060,1420],[700,1170,1330],
  [800,610,1790],[800,750,1620],[800,890,1480],[800,1060,1340],[800,1170,1260],
  [900,610,1720],[900,750,1545],[900,890,1400],[900,1060,1260],[900,1170,1180],
  [1000,610,1650],[1000,750,1470],[1000,890,1330],[1000,1060,1190],[1000,1170,1110],
  [1100,610,1580],[1100,750,1400],[1100,890,1240],[1100,1060,1080],[1100,1170,945],
  [1200,610,1510],[1200,750,1330],[1200,890,1175],[1200,1060,1010],[1200,1170,875],
  [1300,610,1445],[1300,750,1265],[1300,890,1110],[1300,1060,945],[1300,1170,810],
  [1400,610,1380],[1400,750,1200],[1400,890,1040],[1400,1060,875],[1400,1170,745],
  [1500,610,1310],[1500,750,1130],[1500,890,975],[1500,1060,810],[1500,1170,685],
];

const JX_REF = 102388; // mm⁴ — referência LG248+LG249

// ─── Estado dos perfis
let perfis = [
  { nome: 'LG248', area: 272,  jx: 49594, wx: 2119, ix: 0 },
  { nome: 'LG249', area: 250,  jx: 52794, wx: 2321, ix: 0 }
];

// ─── Interpolação bilinear na tabela de referência
function interpolaHmax(larguraFolha, pressao) {
  const Ls = [600,700,800,900,1000,1100,1200,1300,1400,1500];
  const Ps = [610,750,890,1060,1170];

  const Lc = Math.max(600, Math.min(1500, larguraFolha));
  const Pc = Math.max(610, Math.min(1170, pressao));

  const l1 = Ls.filter(l => l <= Lc).pop() || 600;
  const l2 = Ls.filter(l => l >  Lc)[0]  || 1500;
  const p1 = Ps.filter(p => p <= Pc).pop() || 610;
  const p2 = Ps.filter(p => p >  Pc)[0]  || 1170;

  const get = (l, p) => {
    const row = TABELA_REF.find(r => r[0] === l && r[1] === p);
    return row ? row[2] : 1000;
  };

  const tl = l1 === l2 ? 0 : (Lc - l1) / (l2 - l1);
  const tp = p1 === p2 ? 0 : (Pc - p1) / (p2 - p1);

  const hP1 = get(l1, p1) + tl * (get(l2, p1) - get(l1, p1));
  const hP2 = get(l1, p2) + tl * (get(l2, p2) - get(l1, p2));

  return hP1 + tp * (hP2 - hP1);
}

// ─── Cálculo da altura máxima escalada pelo Jx dos perfis inseridos
function calcularHmax(larguraFolha, pressao, jxTotal) {
  if (!larguraFolha || !pressao || !jxTotal) return 0;
  const hRef = interpolaHmax(larguraFolha, pressao);
  const ratio = Math.pow(jxTotal / JX_REF, 1 / 3);
  return Math.round(hRef * ratio);
}

// ─── Soma do Jx de todos os perfis
function somarJx() {
  return perfis.reduce((s, p) => s + (parseFloat(p.jx) || 0), 0);
}

// ─── Renderiza a lista de perfis
function renderPerfis() {
  const list = document.getElementById('perfis-list');
  list.innerHTML = '';

  perfis.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'perfil-row';
    row.innerHTML = `
      <div><input type="text"   value="${p.nome}" placeholder="Nome"   data-i="${i}" data-k="nome" /></div>
      <div><input type="number" value="${p.area}" placeholder="mm²"    data-i="${i}" data-k="area" min="0" step="1" /></div>
      <div><input type="number" value="${p.jx}"   placeholder="mm⁴"    data-i="${i}" data-k="jx"   min="0" step="1" /></div>
      <div><input type="number" value="${p.wx}"   placeholder="mm³"    data-i="${i}" data-k="wx"   min="0" step="1" /></div>
      <div><input type="number" value="${p.ix||0}" placeholder="mm⁴"   data-i="${i}" data-k="ix"   min="0" step="1" /></div>
      <button class="btn-rm" data-i="${i}" title="Remover perfil">×</button>
    `;
    list.appendChild(row);
  });

  // eventos dos inputs
  list.querySelectorAll('input').forEach(el => {
    el.addEventListener('input', onPerfilChange);
  });

  // eventos dos botões de remover
  list.querySelectorAll('.btn-rm').forEach(btn => {
    btn.addEventListener('click', onRemovePerfil);
  });

  atualizarJxTotal();
}

function onPerfilChange(e) {
  const i = parseInt(e.target.dataset.i);
  const k = e.target.dataset.k;
  perfis[i][k] = k === 'nome' ? e.target.value : parseFloat(e.target.value) || 0;
  atualizarJxTotal();
}

function onRemovePerfil(e) {
  const i = parseInt(e.target.dataset.i);
  if (perfis.length <= 1) return;
  perfis.splice(i, 1);
  renderPerfis();
}

function atualizarJxTotal() {
  const jx = somarJx();
  const el = document.getElementById('jx-total');
  el.textContent = jx ? jx.toLocaleString('pt-BR') + ' mm⁴' : '—';
}

// ─── Calcular e exibir resultado
function calcular() {
  const largura  = parseFloat(document.getElementById('largura').value)  || 0;
  const folhas   = parseInt(document.getElementById('folhas').value)      || 2;
  const altJan   = parseFloat(document.getElementById('alt_jan').value)   || 0;
  const altEd    = parseFloat(document.getElementById('alt_ed').value);
  const regiao   = parseInt(document.getElementById('regiao').value);

  const pressao  = (PRESSOES[altEd] || {})[regiao] || 0;
  const folhaL   = largura > 0 ? Math.round(largura / folhas) : 0;
  const jx       = somarJx();

  const hmax     = calcularHmax(folhaL, pressao, jx);
  const flecha   = hmax > 0 ? Math.min(30, Math.round(hmax / 175)) : 0;

  // métricas
  document.getElementById('m-press').textContent   = pressao  ? pressao + ' Pa'                      : '—';
  document.getElementById('m-folha').textContent   = folhaL   ? folhaL.toLocaleString('pt-BR') + ' mm' : '—';
  document.getElementById('m-flecha').textContent  = flecha   ? flecha + ' mm'                       : '—';
  document.getElementById('m-jx').textContent      = jx       ? jx.toLocaleString('pt-BR') + ' mm⁴'  : '—';
  document.getElementById('m-hinser').textContent  = altJan   ? altJan.toLocaleString('pt-BR') + ' mm': '—';
  document.getElementById('m-regiao').textContent  = 'Região ' + ['I','II','III','IV','V'][regiao - 1];

  // resultado principal
  document.getElementById('res-hmax').textContent  = hmax > 0 ? hmax.toLocaleString('pt-BR') : '—';

  // barra e badge
  const pct    = (hmax > 0 && altJan > 0) ? Math.min(100, Math.round((altJan / hmax) * 100)) : 0;
  const fill   = document.getElementById('bar-fill');
  const badge  = document.getElementById('res-badge');

  document.getElementById('bar-pct').textContent = pct > 0 ? pct + '%' : '—';
  fill.style.width = pct + '%';

  if (!hmax || !altJan) {
    badge.textContent  = 'Insira todos os dados';
    badge.className    = 'badge neutral';
    fill.style.background = '#ccc';
  } else if (altJan <= hmax * 0.9) {
    badge.textContent  = 'Aprovado';
    badge.className    = 'badge ok';
    fill.style.background = '#3b6d11';
  } else if (altJan <= hmax) {
    badge.textContent  = 'Aprovado — margem baixa';
    badge.className    = 'badge warn';
    fill.style.background = '#854f0b';
  } else {
    badge.textContent  = 'Reprovado — excede o limite';
    badge.className    = 'badge err';
    fill.style.background = '#a32d2d';
  }

  // exibe a seção de resultado
  const section = document.getElementById('result-section');
  section.classList.add('visible');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Init
document.addEventListener('DOMContentLoaded', () => {
  renderPerfis();

  document.getElementById('btn-add-perfil').addEventListener('click', () => {
    perfis.push({ nome: 'Perfil', area: 0, jx: 0, wx: 0, ix: 0 });
    renderPerfis();
  });

  document.getElementById('btn-calc').addEventListener('click', calcular);
});
