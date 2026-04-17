'use strict';

/** ============================================================================
 * CONFIGURAÇÃO DO SUPABASE (NUVEM)
 * ============================================================================ */
const SUPABASE_URL = 'https://stjrjonlarwhepclrmus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0anJqb25sYXJ3aGVwY2xybXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTMwOTIsImV4cCI6MjA5MTkyOTA5Mn0.qvswg3lvbqNda-53oBXf-UcUAEZZUjVCVPC3AfmpTAA';

// Inicializa o Supabase (cliente principal)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Instância secundária EXCLUSIVA para criação de contas sem deslogar o admin no front
const secSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storageKey: 'sb-secondary-auth',
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Tabela de pressões de ensaio baseada na norma ABNT NBR 10821-2017.
 * Mapeia a "Altura Máxima do Edifício" e a "Região (I a V)" para a Pressão de Vento (em Pa).
 * Estrutura: { AlturaEdificioEmMetros: { Regiao: PressaoEmPa } }
 */
const PRESSOES = {
  6: { 1: 350, 2: 470, 3: 610, 4: 770, 5: 950 },
  15: { 1: 420, 2: 580, 3: 750, 4: 950, 5: 1180 },
  30: { 1: 500, 2: 680, 3: 890, 4: 1130, 5: 1400 },
  60: { 1: 600, 2: 815, 3: 1060, 4: 1350, 5: 1660 },
  90: { 1: 660, 2: 890, 3: 1170, 4: 1480, 5: 1820 }
};

/**
 * Retém a lista dinâmica de perfis de alumínio presentes no projeto da esquadria.
 * Inicialmente preenchido com 2 perfis de exemplo.
 */
let perfis = [
  { nome: 'LG248', area: 272, jx: 49594, wx: 2119, ix: 0 },
  { nome: 'LG249', area: 250, jx: 52794, wx: 2321, ix: 0 }
];

/**
 * Calcula a altura máxima da esquadria usando a física dos materiais.
 * Utiliza o Módulo de Elasticidade (E) do Alumínio (70.000 MPa) e o critério de flecha L/175.
 *
 * @param {number} larguraFolha - A largura de uma folha da janela.
 * @param {number} pressao - A pressão calculada do vento para a região/altura.
 * @param {number} jxTotal - Momento de inércia acumulado de todos os perfis.
 * @returns {number} Altura máxima aprovada em milímetros.
 */
function calcularHmax(larguraFolha, pressao, jxTotal) {
  if (!larguraFolha || !pressao || !jxTotal) return 0;

  const constanteAluminio = 30720000000;
  const hCubo = (constanteAluminio * jxTotal) / (pressao * larguraFolha);

  return Math.round(Math.pow(hCubo, 1 / 3));
}

/**
 * Função de roteamento visual para comportamento de Single Page App (SPA).
 * Alterna entre Dashboard, Ferramentas e Treinamentos mapeando classes CSS.
 */
let isNavigationInitialized = false;
function initNavigation() {
  if (isNavigationInitialized) return;
  isNavigationInitialized = true;

  const menuItems = document.querySelectorAll('.menu-item');
  const views = document.querySelectorAll('.view');
  const topTitle = document.getElementById('top-title');

  // Adiciona navegação aos botões de atalho internos na Home
  const homeCards = document.querySelectorAll('[data-action]');
  homeCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = card.getAttribute('data-action');
      navigateTo(targetId);
    });
  });

  // Adiciona navegação a cada item lateral
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');
      if (targetId) window.location.hash = targetId;
    });
  });

  // O Motor de Roteamento! Escuta a URL e controla o DOM.
  function applyRoute() {
    let targetId = window.location.hash.substring(1);
    if (!targetId || !document.getElementById(targetId)) return; // Ignora hashes/links mortos

    // SEGURANÇA DE ROTEADOR: Se o cara tentar digitar na URL, eu barro aqui
    if (currentUser && currentUser.permissions) {
      const p = currentUser.permissions;
      let allowed = true;
      if (targetId === 'view-calc' && !p.calc) allowed = false;
      if (targetId === 'view-trainings' && !p.trainings) allowed = false;
      if (targetId === 'view-support' && !p.support) allowed = false;
      if (targetId === 'view-admin' && !p.admin) allowed = false;

      if (!allowed) {
        targetId = 'view-forbidden';
      }
    }

    views.forEach(v => v.classList.remove('active'));
    menuItems.forEach(m => m.classList.remove('active'));

    const activeMenu = document.querySelector(`.menu-item[data-target="${targetId}"]`);
    if (activeMenu) activeMenu.classList.add('active');

    const targetView = document.getElementById(targetId);
    if (targetView) targetView.classList.add('active');

    // Modifica o título principal da janela à qual o usuário navegou
    if (targetId === 'view-home') topTitle.textContent = 'Dashboard / Visão Geral';
    if (targetId === 'view-calc') topTitle.textContent = 'Ferramentas / Calculadora H. Máxima';
    if (targetId === 'view-trainings') topTitle.textContent = 'MyMetal / Treinamentos';
    if (targetId === 'view-admin') topTitle.textContent = 'Gestão / Licenças';
    if (targetId === 'view-support') {
      topTitle.textContent = 'Atendimento / Suporte';
      if (typeof renderTickets === 'function') renderTickets();
    }
  }

  // Liga a escuta da API de Histórico do navegador (Faz as Setas de Voltar e Avançar funcionarem!)
  window.addEventListener('hashchange', applyRoute);

  // Mantém a antiga função navigateTo apontando para URL para nao quebrar cliques isolados
  function navigateTo(targetId) {
    window.location.hash = targetId;
  }
}

/**
 * Soma o Inércia Jx (mm⁴) de todos os perfis adicionados.
 */
function somarJx() {
  return perfis.reduce((s, p) => s + (parseFloat(p.jx) || 0), 0);
}

/**
 * Renderiza (cria no HTML) os modais dinâmicos com inputs interativos para cada perfil presente na array "perfis".
 */
function renderPerfis() {
  const list = document.getElementById('perfis-list');
  list.innerHTML = '';

  perfis.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'perfil-row';

    // Injeta os dados da array visualmente
    row.innerHTML = `
      <div><input type="text"   value="${p.nome}" placeholder="Nome"   data-i="${i}" data-k="nome" /></div>
      <div><input type="number" value="${p.area}" placeholder="mm²"    data-i="${i}" data-k="area" min="0" step="1" /></div>
      <div><input type="number" value="${p.jx}"   placeholder="mm⁴"    data-i="${i}" data-k="jx"   min="0" step="1" /></div>
      <div><input type="number" value="${p.wx}"   placeholder="mm³"    data-i="${i}" data-k="wx"   min="0" step="1" /></div>
      <div><input type="number" value="${p.ix || 0}" placeholder="mm⁴"   data-i="${i}" data-k="ix"   min="0" step="1" /></div>
      <button class="btn-rm" data-i="${i}" title="Remover perfil">×</button>
    `;
    list.appendChild(row);
  });

  // Atualiza propriedades do perfil à medida que o usuário digita
  list.querySelectorAll('input').forEach(el => {
    el.addEventListener('input', onPerfilChange);
  });

  // Escuta os botões de excluir (limite mínimo de 1 perfil é exigido)
  list.querySelectorAll('.btn-rm').forEach(btn => {
    btn.addEventListener('click', onRemovePerfil);
  });

  atualizarJxTotal();
}

/**
 * Processo acionável ao digitar sobre algum campo de perfil da interface.
 * Caso seja texto (nome) mantém como string, propriedades numéricas são formatadas para float.
 */
function onPerfilChange(e) {
  const i = parseInt(e.target.dataset.i);
  const k = e.target.dataset.k;
  perfis[i][k] = k === 'nome' ? e.target.value : parseFloat(e.target.value) || 0;
  atualizarJxTotal();
}

/**
 * Remove dinamicamente uma fileira da lista visual baseada no Index, desde que haja mais de 1 listada.
 */
function onRemovePerfil(e) {
  const i = parseInt(e.target.dataset.i);
  if (perfis.length <= 1) return;
  perfis.splice(i, 1);
  renderPerfis();
}

/**
 * Atualiza o texto na interface exibindo a somatória do Momento de Inércia de Perfis.
 */
function atualizarJxTotal() {
  const jx = somarJx();
  const el = document.getElementById('jx-total');
  el.textContent = jx ? jx.toLocaleString('pt-BR') + ' mm⁴' : '—';
}

/**
 * A principal Função Executable da plataforma: Coleta os dados do site, roda as premissas matemáticas normativas e reescreve os elementos e alertas visuais mediante sucesso/falha da verificação física de Esquadrias.
 */
function calcular() {
  // Extrai as premissas imputadas no documento HTML
  const largura = parseFloat(document.getElementById('largura').value) || 0;
  const folhas = parseInt(document.getElementById('folhas').value) || 2;
  const altJan = parseFloat(document.getElementById('alt_jan').value) || 0;
  const altEd = parseFloat(document.getElementById('alt_ed').value);
  const regiao = parseInt(document.getElementById('regiao').value);

  // Deriva cálculos secundários (Pressão cruzada NBR e Largura da Folha base)
  const pressao = (PRESSOES[altEd] || {})[regiao] || 0;
  const folhaL = largura > 0 ? Math.round(largura / folhas) : 0;
  const jx = somarJx();

  // Recebe o núcleo de execução
  const hmax = calcularHmax(folhaL, pressao, jx);
  const flecha = hmax > 0 ? Math.min(30, Math.round(hmax / 175)) : 0;

  // Substitui os valores de UI do Resumo de Resultados 
  document.getElementById('m-press').textContent = pressao ? pressao + ' Pa' : '—';
  document.getElementById('m-folha').textContent = folhaL ? folhaL.toLocaleString('pt-BR') + ' mm' : '—';
  document.getElementById('m-flecha').textContent = flecha ? flecha + ' mm' : '—';
  document.getElementById('m-jx').textContent = jx ? jx.toLocaleString('pt-BR') + ' mm⁴' : '—';
  document.getElementById('m-hinser').textContent = altJan ? altJan.toLocaleString('pt-BR') + ' mm' : '—';
  document.getElementById('m-regiao').textContent = 'Região ' + ['I', 'II', 'III', 'IV', 'V'][regiao - 1];

  // Mostra o Destacado Maior e Constrói a Barra percentual
  document.getElementById('res-hmax').textContent = hmax > 0 ? hmax.toLocaleString('pt-BR') : '—';
  const pct = (hmax > 0 && altJan > 0) ? Math.min(100, Math.round((altJan / hmax) * 100)) : 0;
  const fill = document.getElementById('bar-fill');
  const badge = document.getElementById('res-badge');

  document.getElementById('bar-pct').textContent = pct > 0 ? pct + '%' : '—';
  fill.style.width = pct + '%';

  // Lógica dos Badges Coloridos de Avaliação e Barra de uso de Material (Aprovado Folga / Marginal / Reprovado)
  if (!hmax || !altJan) {
    badge.textContent = 'Insira todos os dados';
    badge.className = 'badge neutral';
    fill.style.background = 'var(--border-strong)';
  } else if (altJan <= hmax * 0.9) {
    badge.textContent = 'Aprovado (Folga estrutural)';
    badge.className = 'badge ok';
    fill.style.background = 'var(--success-text)';
  } else if (altJan <= hmax) {
    badge.textContent = 'Aprovado (Margem baixa)';
    badge.className = 'badge warn';
    fill.style.background = 'var(--warn-text)';
  } else {
    badge.textContent = 'Reprovado — excede o limite';
    badge.className = 'badge err';
    fill.style.background = 'var(--danger-text)';
  }

  // Revela e desliza de maneira suave até a Sessão de Resultado 
  const section = document.getElementById('result-section');
  section.classList.add('visible');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** ============================================================================
 * SISTEMA DE SUPORTE / HELPDESK (MOCK COM LOCALSTORAGE E USUÁRIOS FAKES)
 * ============================================================================ */

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return 'agora mesmo';

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `há ${diffInMinutes} minuto${diffInMinutes > 1 ? 's' : ''}`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `há ${diffInHours} hora${diffInHours > 1 ? 's' : ''}`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `há ${diffInDays} dia${diffInDays > 1 ? 's' : ''}`;

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `há ${diffInMonths} mês(es)`;

  const diffInYears = Math.floor(diffInMonths / 12);
  return `há ${diffInYears} ano${diffInYears > 1 ? 's' : ''}`;
}

/**
 * Helper para subir arquivos ao Supabase Storage
 * Retorna a URL de download pública definitiva
 */
async function uploadToStorage(file, folderPath) {
  if (!file) return null;
  const fileName = `${Date.now()}_${file.name}`;
  const filePath = `${folderPath}/${fileName}`;
  const { data, error } = await sb.storage.from('attachments').upload(filePath, file);
  if (error) throw error;
  const { data: urlData } = sb.storage.from('attachments').getPublicUrl(filePath);
  return urlData.publicUrl;
}

let currentUser = null;

// Estados Globais de Upload em segundo plano
let pendingTicketFile = null;
let pendingReplyFile = null;

let ticketFilters = {
  text: '',
  sortCol: 'created_at',
  sortDir: 'desc',
  client: 'all',
  statuses: ['Em espera', 'Em desenvolvimento', 'Aguardando resposta', 'Respondido']
};

async function getTickets() {
  try {
    const { data, error } = await sb.from('tickets').select('*');
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('Erro ao ler Supabase', e); return []; }
}

async function saveTicket(ticket, isUpdate = false) {
  try {
    if (isUpdate) {
      const { id, ...rest } = ticket;
      await sb.from('tickets').update(rest).eq('id', id);
    } else {
      delete ticket.id;
      await sb.from('tickets').insert(ticket);
    }
  } catch (e) { console.error('Erro salvar', e); }
}

async function renderTickets() {
  const list = document.getElementById('ticket-list');
  if (!list) return;

  if (!currentUser) return; // Só carrega se autenticado

  let tickets = await getTickets();

  // Update Section Title e Visibilidade de Filtro Cliente
  const secSubtitle = document.querySelector('#view-support .page-sub');
  const filterClientWrap = document.getElementById('filter-client-wrap');

  if (currentUser.role === 'admin') {
    if (secSubtitle) secSubtitle.textContent = 'Central de Chamados (Acesso Administrador: Vendo Todos)';
    if (filterClientWrap) filterClientWrap.style.display = 'block';
  } else {
    if (secSubtitle) secSubtitle.textContent = `Meus Chamados (Logado como ${currentUser.name})`;
    if (filterClientWrap) filterClientWrap.style.display = 'none';
  }

  // 1. Role-based filtering
  if (currentUser.role === 'client') {
    tickets = tickets.filter(t => t.author_id === currentUser.id);
  }

  // 2. Text Search Filtering
  if (ticketFilters.text) {
    tickets = tickets.filter(t => {
      const term = ticketFilters.text.toLowerCase();
      return t.code.toLowerCase().includes(term) || t.title.toLowerCase().includes(term);
    });
  }

  // 3. Client Filter (if Admin)
  if (currentUser.role === 'admin' && ticketFilters.client !== 'all') {
    tickets = tickets.filter(t => t.author_id === ticketFilters.client);
  }

  // 4. Status Filtering
  tickets = tickets.filter(t => ticketFilters.statuses.includes(t.status));

  // 5. Sorting
  tickets.sort((a, b) => {
    let valA = a[ticketFilters.sortCol] || '';
    let valB = b[ticketFilters.sortCol] || '';

    // Tratamento especial para Datas e Status
    if (ticketFilters.sortCol === 'created_at') {
      valA = new Date(valA).getTime();
      valB = new Date(valB).getTime();
    } else {
      valA = valA.toString().toLowerCase();
      valB = valB.toString().toLowerCase();
    }

    if (valA < valB) return ticketFilters.sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return ticketFilters.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  list.innerHTML = '';

  if (tickets.length === 0) {
    list.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-hint); font-size: 13px;">Nenhum chamado atende aos filtros atuais.</div>`;
    return;
  }

  tickets.forEach(t => {
    const row = document.createElement('div');
    row.className = 'ticket-row';

    // Status visual
    let statusClass = 'status-open';
    if (t.status === 'Em desenvolvimento') statusClass = 'status-dev';
    if (t.status === 'Aguardando resposta') statusClass = 'status-wait';
    if (t.status === 'Respondido') statusClass = 'status-answered';
    if (t.status === 'Encerrado') statusClass = 'status-closed';

    row.innerHTML = `
      <span class="t-code">${t.code}</span>
      <span class="t-title" title="${t.title}">${t.title}</span>
      <span class="t-user" title="${t.requester}">${t.requester}</span>
      <span class="t-date">${new Date(t.created_at).toLocaleDateString('pt-BR')}</span>
      <span><div class="badge ${statusClass}">${t.status}</div></span>
    `;

    row.addEventListener('click', () => openTicketDetail(t.id));
    list.appendChild(row);
  });

  // Re-injeta icones se houver recarga
  if (window.lucide) lucide.createIcons();
}

function switchSupportView(viewId) {
  document.querySelectorAll('.sup-internal-view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  // Controla o botão + Novo Chamado e o Cabeçalho Global
  const btnNewTicket = document.getElementById('btn-new-ticket');
  const mainHeader = document.getElementById('support-main-header');

  if (viewId === 'sup-view-detail') {
    if (btnNewTicket) btnNewTicket.style.display = 'none';
    if (mainHeader) mainHeader.style.display = 'none';
  } else {
    if (mainHeader) mainHeader.style.display = 'flex';
    if (btnNewTicket) {
      if (viewId === 'sup-view-list') btnNewTicket.style.display = 'inline-flex';
      else btnNewTicket.style.display = 'none';
    }
  }
}

function renderTimeline(ticket) {
  const container = document.getElementById('tk-timeline');
  container.innerHTML = '';

  const replies = ticket.replies || [];
  if (replies.length === 0) {
    container.innerHTML = '<p style="font-size: 13px; color: var(--text-hint); text-align: center; padding: 20px;">Nenhuma resposta neste chamado ainda.</p>';
    return;
  }

  replies.forEach(r => {
    const isOwner = r.role === 'admin';
    const row = document.createElement('div');
    row.className = 't-reply ' + (isOwner ? 'admin-reply' : '');

    let attHtml = '';
    if (r.attachmentName && r.attachmentUrl) {
      attHtml = `
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border);">
         <a href="${r.attachmentUrl}" target="_blank" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='var(--surface-2)'" style="display: inline-flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border-strong); padding: 6px 12px; border-radius: var(--radius-md); cursor: pointer; transition: background 0.2s; text-decoration: none;">
            <i data-lucide="paperclip" style="width: 14px; height: 14px; color: var(--text-secondary);"></i>
            <span style="font-size: 12px; font-weight: 500; color: var(--text-primary);">${r.attachmentName}</span>
            <i data-lucide="download" style="width: 14px; height: 14px; color: var(--accent); margin-left: 8px;"></i>
         </a>
      </div>`;
    }

    row.innerHTML = `
      <div class="t-reply-header" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <span class="t-reply-author" style="font-weight: 500">${r.author} ${isOwner ? '<span style="font-size: 11px; font-weight: normal; color: var(--accent); background: var(--accent-bg); padding: 2px 6px; border-radius: 2px; margin-left: 6px;">Staff</span>' : ''}</span>
        <span class="t-reply-date" style="font-size: 11px; color: var(--text-hint);" title="${new Date(r.date).toLocaleString('pt-BR')}">${timeAgo(r.date)}</span>
      </div>
      <div class="t-reply-body" style="font-size: 14px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;">${r.content}</div>
      ${attHtml}
    `;
    container.appendChild(row);
  });

  // Refresca os icones do lucide inseridos dinamicamente
  if (typeof window.lucide !== 'undefined') {
    window.lucide.createIcons();
  }
}

async function openTicketDetail(id) {
  const tickets = await getTickets();
  const t = tickets.find(x => x.id === id);
  if (!t) return;

  // Preenche dados
  document.getElementById('det-code').textContent = t.code;
  document.getElementById('det-title').textContent = t.title;
  document.getElementById('det-date').textContent = new Date(t.created_at).toLocaleString('pt-BR');
  document.getElementById('det-top-requester').textContent = t.requester;
  document.getElementById('det-sub-company').textContent = t.company;

  document.getElementById('det-desc-author').textContent = t.requester;
  document.getElementById('det-desc-date').textContent = new Date(t.created_at).toLocaleString('pt-BR');
  document.getElementById('det-desc').textContent = t.description;

  // Set urgencia badge
  const urgBadge = document.getElementById('det-urgency');
  urgBadge.textContent = t.urgency.toUpperCase();
  urgBadge.className = 'badge';
  if (t.urgency.toLowerCase() === 'crítica') urgBadge.classList.add('critic');
  else if (t.urgency.toLowerCase() === 'alta') urgBadge.classList.add('high');
  else if (t.urgency.toLowerCase() === 'média') urgBadge.classList.add('medium');
  else urgBadge.classList.add('low');

  // Set anexos
  const attWrap = document.getElementById('det-attachment-wrap');
  const btnDownloadReal = document.getElementById('btn-download-anexo');

  if (t.attachment_name && t.attachment_url) {
    attWrap.style.display = 'block';
    document.getElementById('det-anexo-nome').textContent = t.attachment_name;

    // Configura o link real de download
    if (btnDownloadReal) {
      btnDownloadReal.onclick = function (e) {
        e.preventDefault();
        window.open(t.attachment_url, '_blank');
      };
    }
  } else {
    attWrap.style.display = 'none';
  }

  // Bind Formulario de Resposta
  const replyForm = document.getElementById('form-reply');
  replyForm.onsubmit = async function (e) {
    e.preventDefault();
    const txtArea = document.getElementById('reply-text');
    const msg = txtArea.value.trim();
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!msg && !pendingReplyFile) return;

    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = 'Enviando...';
    submitBtn.disabled = true;

    try {
      if (!t.replies) t.replies = [];
      t.replies.push({
        author: currentUser.name,
        role: currentUser.role,
        date: new Date().toISOString(),
        content: msg,
        attachmentName: pendingReplyFile ? pendingReplyFile.name : null,
        attachmentUrl: pendingReplyFile ? pendingReplyFile.url : null
      });

      await saveTicket(t, true);

      txtArea.value = '';
      pendingReplyFile = null; // Limpa estado
      document.getElementById('reply-anexo-lbl').textContent = 'Anexar Arquivo';
      document.getElementById('reply-anexo-lbl').style.color = 'inherit';
      renderTimeline(t);
    } catch (err) {
      console.error(err);
      alert('Erro ao enviar resposta.');
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
      if (window.lucide) lucide.createIcons();
    }
  };

  renderTimeline(t);

  // Set controle de status e evento isolado (remoção de evento anterior)
  const selStatus = document.getElementById('det-status-select');
  selStatus.value = t.status;

  // Desativa select caso não seja Admin
  if (currentUser.role !== 'admin') {
    selStatus.disabled = true;
    selStatus.style.background = 'transparent';
    selStatus.style.border = 'none';
    selStatus.style.appearance = 'none';
  } else {
    selStatus.disabled = false;
    selStatus.style.background = 'var(--surface)';
    selStatus.style.border = '1px solid var(--border-strong)';
    selStatus.style.appearance = 'auto';
  }

  selStatus.onchange = function (e) {
    updateTicketStatus(t.id, e.target.value);
  };

  switchSupportView('sup-view-detail');
}

async function updateTicketStatus(id, newStatus) {
  const tickets = await getTickets();
  const t = tickets.find(x => x.id === id);
  if (t) {
    t.status = newStatus;
    await saveTicket(t, true);
    renderTickets(); // atualiza a lista em background
  }
}

function initAdminPanel() {
  const form = document.getElementById('admin-create-user-form');
  const errorBox = document.getElementById('admin-error');
  const successBox = document.getElementById('admin-success');
  const btnTxt = document.getElementById('btn-create-u-txt');

  // Listador Assíncrono da Tabela
  async function loadUsersGrid() {
    try {
      const { data: users, error } = await sb.from('profiles').select('*');
      if (error) throw error;
      const tbody = document.getElementById('admin-users-list');
      if (!tbody) return;
      tbody.innerHTML = '';

      (users || []).forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';

        // Formata as permissões legíveis para a tabela
        let pms = [];
        if (u.permissions?.calc) pms.push('Calc');
        if (u.permissions?.trainings) pms.push('Vídeos');
        if (u.permissions?.support) pms.push('Suporte');
        if (u.permissions?.admin) pms.push('Admin');

        tr.innerHTML = `
          <td style="padding: 12px;">${u.name || '(Sem Nome)'}</td>
          <td style="padding: 12px; font-weight: 500;">${u.email}</td>
          <td style="padding: 12px; color: var(--accent);">${u.company || '-'}</td>
          <td style="padding: 12px;">
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${pms.map(p => `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--sidebar-bg); color: var(--text-secondary);">${p}</span>`).join('')}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) { console.error('Erro na listagem', e); }
  }

  // Motor Criação de Licenças via Secondary Supabase Client
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none'; successBox.style.display = 'none';

      const uNome = document.getElementById('admin-u-nome').value;
      const uEmpresa = document.getElementById('admin-u-empresa').value;
      const uEmail = document.getElementById('admin-u-email').value;
      const uSenha = document.getElementById('admin-u-senha').value;

      const permissions = {
        calc: document.getElementById('perm-calc').checked,
        trainings: document.getElementById('perm-trainings').checked,
        support: document.getElementById('perm-support').checked,
        admin: document.getElementById('perm-admin').checked
      };

      btnTxt.textContent = 'Gerando Chave...';
      const btnO = form.querySelector('button[type="submit"]');
      btnO.disabled = true;

      try {
        // Cria usuário invisivelmente no Supabase Auth sem te deslogar
        const { data: signUpData, error: signUpError } = await secSb.auth.signUp({
          email: uEmail,
          password: uSenha
        });
        if (signUpError) throw signUpError;

        // Cadastra o Perfil na tabela corporativa do Supabase
        const { error: profileError } = await sb.from('profiles').insert({
          id: signUpData.user.id,
          name: uNome,
          company: uEmpresa,
          email: uEmail,
          role: permissions.admin ? 'admin' : 'client',
          permissions: permissions,
          created_at: new Date().toISOString()
        });
        if (profileError) throw profileError;

        // Apaga o rastro da sessão da memória pra evitar conflitos
        await secSb.auth.signOut();

        successBox.style.display = 'block';
        form.reset();
        btnTxt.textContent = 'Gerar Licença e Salvar';
        btnO.disabled = false;

        // Autorecarrega a tabela
        loadUsersGrid();

      } catch (error) {
        errorBox.textContent = 'Erro Supabase: ' + (error.code || '') + ' - ' + (error.message || error);
        errorBox.style.display = 'block';
        btnTxt.textContent = 'Gerar Licença e Salvar';
        btnO.disabled = false;
      }
    };
  }

  // Dá o tiro inicial de relógio da tabela
  loadUsersGrid();
}

let isSupportControlsInitialized = false;
function initSupportControls() {
  if (isSupportControlsInitialized) return;
  isSupportControlsInitialized = true;

  const selFilterClient = document.getElementById('filter-client');
  if (selFilterClient) {
    // Esconde ou desativa o filtro de cliente na visualização já que conectamos na Nuvem real
    selFilterClient.style.display = 'none';
  }

  // Filtros de Ordenacao (Table Headers)
  const sortHeaders = document.querySelectorAll('.th-sort');
  sortHeaders.forEach(th => {
    th.addEventListener('click', () => {
      const prop = th.dataset.sort;
      if (ticketFilters.sortCol === prop) {
        ticketFilters.sortDir = ticketFilters.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        ticketFilters.sortCol = prop;
        ticketFilters.sortDir = 'desc'; // default for new col
      }

      // UI update dos icones das setas
      sortHeaders.forEach(x => {
        x.style.color = 'inherit';
        const icon = x.querySelector('.sort-icon');
        icon.setAttribute('data-lucide', 'arrow-down-up');
        icon.style.opacity = '0.3';
      });

      th.style.color = 'var(--text-primary)';
      const activeIcon = th.querySelector('.sort-icon');
      activeIcon.setAttribute('data-lucide', ticketFilters.sortDir === 'desc' ? 'arrow-down' : 'arrow-up');
      activeIcon.style.opacity = '1';

      if (window.lucide) lucide.createIcons();

      renderTickets();
    });
  });

  // Filtros de Status (Checkboxes)
  const statusGroup = document.getElementById('filter-status-group');
  if (statusGroup) {
    const checks = statusGroup.querySelectorAll('input[type="checkbox"]');
    checks.forEach(chk => {
      chk.addEventListener('change', () => {
        ticketFilters.statuses = Array.from(checks).filter(c => c.checked).map(c => c.value);
        renderTickets();
      });
    });
  }

  // Removido listener do MockSwitcher pois não há mais usuários ficticios! 

  // Navigation internal
  document.getElementById('btn-new-ticket').addEventListener('click', () => {
    // Auto fill readonly fields
    document.getElementById('tk-nome').value = currentUser.name;
    document.getElementById('tk-empresa').value = currentUser.company;

    switchSupportView('sup-view-form');
  });

  document.getElementById('btn-cancel-ticket').addEventListener('click', () => {
    document.getElementById('form-ticket').reset();
    document.getElementById('tk-anexo-lbl').textContent = 'Escolher um arquivo...';
    switchSupportView('sup-view-list');
  });

  document.getElementById('btn-back-tickets').addEventListener('click', () => {
    switchSupportView('sup-view-list');
  });

  // Search filter
  document.getElementById('ticket-search').addEventListener('input', (e) => {
    ticketFilters.text = e.target.value;
    renderTickets();
  });

  // Botao copiar código
  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const copyCode = document.getElementById('det-code').textContent;
      navigator.clipboard.writeText(copyCode).then(() => {
        alert('Código ' + copyCode + ' copiado com sucesso!');
      });
    });
  }

  // Botão fake de download
  const btnDownload = document.getElementById('btn-download-anexo');
  if (btnDownload) {
    btnDownload.addEventListener('click', (e) => {
      e.preventDefault();
      alert('Iniciando o download seguro do arquivo: ' + document.getElementById('det-anexo-nome').textContent);
    });
  }

  // Upload visual hint & Limit logic (Agora com Upload Real em Background)
  const tkAnexo = document.getElementById('tk-anexo');
  if (tkAnexo) {
    tkAnexo.addEventListener('change', async (e) => {
      const lbl = document.getElementById('tk-anexo-lbl');
      const submitBtn = document.querySelector('#form-ticket button[type="submit"]');

      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        if (file.size > 5 * 1024 * 1024) {
          alert('Arquivo excedeu o limite de 5MB.');
          e.target.value = '';
          lbl.textContent = 'Escolher um arquivo...';
          return;
        }

        // Inicia Upload Imediato
        const originalLabel = lbl.textContent;
        lbl.textContent = 'Enviando ao Google...';
        lbl.style.color = 'var(--accent)';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Aguardando Upload...';
        }

        try {
          // Usamos um ID de pasta temporário
          const tempId = Date.now().toString();
          const url = await uploadToStorage(file, `tickets/temp_${tempId}`);
          pendingTicketFile = { name: file.name, url: url };

          lbl.textContent = '✓ ' + file.name;
          lbl.style.color = 'var(--success-text)';
        } catch (err) {
          console.error(err);
          lbl.textContent = 'Erro no upload. Tente novamente.';
          lbl.style.color = 'var(--danger-text)';
          pendingTicketFile = null;
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Abrir Chamado';
          }
        }
      } else {
        lbl.textContent = 'Escolher um arquivo...';
        lbl.style.color = 'inherit';
        pendingTicketFile = null;
      }
    });
  }

  // Reply Attachment listener (Background Upload)
  const replyAnexo = document.getElementById('reply-anexo');
  if (replyAnexo) {
    replyAnexo.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const lbl = document.getElementById('reply-anexo-lbl');
      const submitBtn = e.target.closest('form')?.querySelector('button[type="submit"]');

      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert('Arquivo excedeu 5MB.');
          e.target.value = '';
          return;
        }

        lbl.textContent = 'Subindo...';
        lbl.style.color = 'var(--accent)';
        if (submitBtn) submitBtn.disabled = true;

        try {
          const url = await uploadToStorage(file, `replies/temp_${Date.now()}`);
          pendingReplyFile = { name: file.name, url: url };
          lbl.textContent = '✓ ' + file.name;
          lbl.style.color = 'var(--success-text)';
        } catch (err) {
          lbl.textContent = 'Erro!';
          lbl.style.color = 'var(--danger-text)';
          pendingReplyFile = null;
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      }
    });
  }

  // Form submit
  document.getElementById('form-ticket').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;

    const code = 'SUP-' + Math.floor(1000 + Math.random() * 9000);

    submitBtn.innerHTML = 'Gravando chamado...';
    submitBtn.disabled = true;

    try {
      const newTicket = {
        code: code,
        author_id: currentUser.id,
        requester: document.getElementById('tk-nome').value,
        company: document.getElementById('tk-empresa').value,
        title: document.getElementById('tk-titulo').value,
        description: document.getElementById('tk-desc').value,
        urgency: document.getElementById('tk-urgencia').value,
        status: 'Em espera',
        created_at: new Date().toISOString(),
        attachment_name: pendingTicketFile ? pendingTicketFile.name : null,
        attachment_url: pendingTicketFile ? pendingTicketFile.url : null,
        replies: []
      };

      await saveTicket(newTicket, false);

      e.target.reset();
      pendingTicketFile = null; // Limpa para o próximo
      document.getElementById('tk-anexo-lbl').textContent = 'Escolher um arquivo...';
      document.getElementById('tk-anexo-lbl').style.color = 'inherit';

      renderTickets();
      switchSupportView('sup-view-list');

      alert('Chamado ' + code + ' aberto com sucesso!');
    } catch (err) {
      console.error(err);
      alert('Erro ao abrir chamado.');
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  });
}

function initSupabaseAuthUI() {
  const overlay = document.getElementById('login-overlay');
  const mainApp = document.getElementById('app-wrapper');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  // Helper para resetar botões de login
  function resetLoginButton() {
    const btnLog = loginForm?.querySelector('button[type="submit"]');
    if (btnLog) {
      btnLog.disabled = false;
      btnLog.textContent = 'Entrar na Plataforma';
    }
  }

  let isProcessingAuth = false;

  // Função centralizada que processa o usuário autenticado
  async function handleAuthUser(user) {
    if (isProcessingAuth) return;
    isProcessingAuth = true;

    if (user) {
      console.log('--- Processando Usuário:', user.email, '---');
      try {
        // TIMEOUT DE SEGURANÇA: Se o banco não responder em 4s, aborta
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        console.log('Buscando perfil na tabela "profiles"...');
        const { data: profiles, error } = await sb.from('profiles')
          .select('*')
          .eq('id', user.id)
          .limit(1)
          .abortSignal(controller.signal);
        
        clearTimeout(timeoutId);
        const profile = profiles && profiles.length > 0 ? profiles[0] : null;

        if (error) {
          console.warn('Nota sobre perfil:', error.message);
          if (error.message.includes('relation "profiles" does not exist')) {
            alert('⚠️ TABELA FALTANDO: Rode o SQL no Dashboard do Supabase.');
            await sb.auth.signOut();
            return;
          }
        }

        if (profile) {
          console.log('✅ Perfil carregado:', profile.name);
          currentUser = { id: user.id, email: user.email, ...profile };
        } else {
          console.log('⚠️ Perfil não encontrado, tentando auto-promoção admin...');
          if (user.email.includes('admin') || user.email.includes('ericnash2011')) {
            currentUser = {
              id: user.id, email: user.email,
              name: user.user_metadata?.full_name || 'Admin Oficial',
              role: 'admin', company: 'Idealle',
              permissions: { calc: true, trainings: true, support: true, admin: true }
            };
            await sb.from('profiles').upsert({
              id: currentUser.id, name: currentUser.name, email: currentUser.email,
              role: currentUser.role, company: currentUser.company, permissions: currentUser.permissions,
              created_at: new Date().toISOString()
            });
          } else {
            await sb.auth.signOut();
            alert('ACESSO NEGADO: Sua licença não foi encontrada.');
            return;
          }
        }

        // Toggles da interface
        const p = currentUser.permissions;
        if (document.getElementById('nav-item-calc')) document.getElementById('nav-item-calc').style.display = p.calc ? 'flex' : 'none';
        if (document.getElementById('nav-item-trainings')) document.getElementById('nav-item-trainings').style.display = p.trainings ? 'flex' : 'none';
        if (document.getElementById('nav-item-support')) document.getElementById('nav-item-support').style.display = p.support ? 'flex' : 'none';
        const navItemAdmin = document.getElementById('nav-item-admin');
        if (navItemAdmin) navItemAdmin.style.display = p.admin ? 'flex' : 'none';

        if (p.admin) initAdminPanel();

        overlay.style.display = 'none';
        mainApp.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
        if (!window.location.hash || window.location.hash === '#login-overlay') window.location.hash = 'view-home';
        window.dispatchEvent(new Event('hashchange'));

        initNavigation();
        renderPerfis();
        initSupportControls();
      } catch (e) {
        console.error('Erro no processamento de Auth:', e);
        if (e.name === 'AbortError') {
          alert('⏳ O banco de dados demorou demais para responder. Tente novamente ou verifique sua conexão.');
        }
        resetLoginButton();
      } finally {
        isProcessingAuth = false;
      }
    } else {
      currentUser = null;
      overlay.style.display = 'flex';
      mainApp.style.display = 'none';
      resetLoginButton();
      isProcessingAuth = false;
    }
  }

  // Monitor de Autenticação Unificado (Supabase v2)
  sb.auth.onAuthStateChange(async (event, session) => {
    console.log('Evento Auth:', event);
    
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      if (session?.user) await handleAuthUser(session.user);
    } 
    
    if (event === 'SIGNED_OUT') {
      await handleAuthUser(null);
    }
  });

  // Listener Formulário Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    console.log('--- Iniciando Login Supabase ---');
    loginError.style.display = 'none';
    const btnOriginalText = btnSubmit.textContent;
    btnSubmit.textContent = 'Autenticando na Nuvem...';
    btnSubmit.disabled = true;

    try {
      console.log('Tentando signInWithPassword para:', email);
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });

      if (error) {
        console.error('Erro retornado pelo Supabase Auth:', error);
        let msg = 'Erro ao entrar. Verifique suas credenciais.';
        
        if (error.message.includes('Email not confirmed')) {
          msg = '⚠️ CONFIRMAÇÃO PENDENTE: Você precisa clicar no link enviado por e-mail ou desativar "Confirm email" no Dashboard do Supabase (Authentication -> Providers).';
        } else if (error.status === 400) {
          msg = 'E-mail ou senha inválidos no Supabase. Verifique se criou o usuário na aba AUTH.';
        } else {
          msg = 'Erro: ' + error.message;
        }

        loginError.textContent = msg;
        loginError.style.display = 'block';
      } else {
        console.log('Login Auth bem-sucedido, processando usuário:', data.user.id);
      }
    } catch (err) {
      console.error('Falha CATASTRÓFICA no login:', err);
      alert('Erro inesperado de rede ou script. Verifique o console (F12).');
    } finally {
      // GARANTIA: Se não logou (o onAuthStateChange não escondeu o overlay), destrava o botão
      setTimeout(() => {
        if (overlay.style.display !== 'none') {
          console.log('Resetando botão de login por segurança.');
          btnSubmit.textContent = btnOriginalText;
          btnSubmit.disabled = false;
        }
      }, 1000);
    }
  });

  // Listener Logout
  document.getElementById('btn-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      overlay.style.display = 'flex';
      mainApp.style.display = 'none';
      await sb.auth.signOut();
    } catch (err) {
      console.error('Erro ao sair:', err);
      // Fallback em caso de erro no Supabase: forçar recarga
      window.location.reload();
    }
  });
}

/**
 * Função global de arranque
 */
document.addEventListener('DOMContentLoaded', () => {
  // Inicialização Bloqueada por Autenticação. Só destrava no onAuthStateChange.
  initSupabaseAuthUI();

  // Escuta os botões de execução independentes da calculadora
  document.getElementById('btn-add-perfil').addEventListener('click', () => {
    perfis.push({ nome: 'Perfil', area: 0, jx: 0, wx: 0, ix: 0 });
    renderPerfis();
  });

  document.getElementById('btn-calc').addEventListener('click', calcular);
});
