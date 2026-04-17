'use strict';

/** ============================================================================
 * CONFIGURAÇÃO DO SUPABASE (NUVEM)
 * ============================================================================ */
const SUPABASE_URL = 'https://stjrjonlarwhepclrmus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0anJqb25sYXJ3aGVwY2xybXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTMwOTIsImV4cCI6MjA5MTkyOTA5Mn0.qvswg3lvbqNda-53oBXf-UcUAEZZUjVCVPC3AfmpTAA';

// Inicializa o Supabase (cliente principal)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Domínio técnico para permitir login por "Usuário" sem e-mail visível
const AUTH_DOMAIN = '@mymetal.internal';
const PROFILE_CACHE_KEY = 'sb-profile-cache';

/**
 * Função Global para controlar o Menu Lateral (Desktop e Mobile)
 */
window.toggleSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    sidebar.classList.toggle('mobile-open');
    overlay.style.display = sidebar.classList.contains('mobile-open') ? 'block' : 'none';
  } else {
    sidebar.classList.toggle('collapsed');
  }
};

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
 * Limpa todo o estado visual do app para evitar vazamento de dados entre sessões de usuários diferentes.
 */
function resetAppState() {
  // Reseta views internas do suporte
  document.querySelectorAll('.sup-internal-view').forEach(v => v.classList.remove('active'));
  const supList = document.getElementById('sup-view-list');
  if (supList) supList.classList.add('active');

  // Limpa formulários
  const formTicket = document.getElementById('form-ticket');
  if (formTicket) formTicket.reset();
  const formReply = document.getElementById('form-reply');
  if (formReply) formReply.reset();

  // Limpa estados de upload pendentes
  pendingTicketFile = null;
  pendingReplyFile = null;

  // Restaura labels de upload
  const tkLbl = document.getElementById('tk-anexo-lbl');
  if (tkLbl) { tkLbl.textContent = 'Escolher um arquivo...'; tkLbl.style.color = 'inherit'; }
  const rpLbl = document.getElementById('reply-anexo-lbl');
  if (rpLbl) { rpLbl.textContent = 'Anexar Arquivo'; rpLbl.style.color = 'inherit'; }

  // Restaura cabeçalho e botões do suporte
  const mainHeader = document.getElementById('support-main-header');
  if (mainHeader) mainHeader.style.display = 'flex';
  const btnNewTicket = document.getElementById('btn-new-ticket');
  if (btnNewTicket) btnNewTicket.style.display = 'inline-flex';

  // Limpa lista de tickets renderizados
  const ticketList = document.getElementById('ticket-list');
  if (ticketList) ticketList.innerHTML = '';

  // Reseta filtros
  ticketFilters.text = '';
  ticketFilters.client = 'all';
  const searchInput = document.getElementById('ticket-search');
  if (searchInput) searchInput.value = '';

  // Reseta Admin
  if (typeof switchAdminTab === 'function') switchAdminTab('tab-licencas');
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
  
  // Limpa o nome do arquivo de caracteres especiais, espaços e acentos
  const cleanName = file.name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\d.-]/g, '_');   // troca tudo que não é letra/número por _

  const fileName = `${Date.now()}_${cleanName}`;
  const filePath = `${folderPath}/${fileName}`;
  
  const { data, error } = await sb.storage.from('Armazenamento de arquivos enviados no Suporte').upload(filePath, file);
  if (error) throw error;
  
  const { data: urlData } = sb.storage.from('Armazenamento de arquivos enviados no Suporte').getPublicUrl(filePath);
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
    // Busca os tickets junto com os dados ATUAIS do perfil e da empresa via Join
    const { data, error } = await sb.from('tickets').select('*, profiles(name, companies(name))');
    if (error) throw error;
    return data || [];
  } catch (e) { 
    console.error('Erro ao ler Supabase (Join)', e); 
    // Fallback simples caso o relacionamento ainda não esteja configurado
    const { data: fallbackData } = await sb.from('tickets').select('*');
    return fallbackData || []; 
  }
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

    // Define o nome do solicitante em tempo real (Prioridade: Perfil Atual > Texto salvo no Ticket)
    const requesterName = (t.profiles && t.profiles.name) ? t.profiles.name : (t.requester || '-');

    row.innerHTML = `
      <span class="t-code">${t.code}</span>
      <span class="t-title" title="${t.title}">${t.title}</span>
      <span class="t-user" title="${requesterName}">${requesterName}</span>
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

  // Dados dinâmicos do autor e sua empresa atualizada
  const requesterName = (t.profiles && t.profiles.name) ? t.profiles.name : (t.requester || '-');
  const companyName = (t.profiles && t.profiles.companies && t.profiles.companies.name) ? t.profiles.companies.name : (t.company || '-');

  // Preenche dados
  document.getElementById('det-code').textContent = t.code;
  document.getElementById('det-title').textContent = t.title;
  document.getElementById('det-date').textContent = new Date(t.created_at).toLocaleString('pt-BR');
  document.getElementById('det-top-requester').textContent = requesterName;
  document.getElementById('det-sub-company').textContent = companyName;

  document.getElementById('det-desc-author').textContent = requesterName;
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

// Funções Globais de Suporte para o Admin (Chamadas pelo HTML)
window.switchAdminTab = (tabId) => {
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
  
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
  
  const btn = document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
};

let currentModalCallback = null;
window.closeEditModal = () => {
  document.getElementById('admin-edit-modal').style.display = 'none';
  currentModalCallback = null;
};

window.openEditModal = (title, bodyHtml, callback) => {
  document.getElementById('edit-modal-title').textContent = title;
  document.getElementById('edit-form-body').innerHTML = bodyHtml;
  document.getElementById('admin-edit-modal').style.display = 'flex';
  currentModalCallback = callback;
  if (window.lucide) lucide.createIcons();
};

function initAdminPanel() {
  const userForm = document.getElementById('admin-create-user-form');
  const companyForm = document.getElementById('admin-create-company-form');
  const editForm = document.getElementById('admin-edit-form');
  
  const errorBox = document.getElementById('admin-error');
  const successBox = document.getElementById('admin-success');

  // Variável para guardar empresas em cache para renderização rápida de nomes
  let cachedCompanies = [];

  // --- GESTÃO DE EMPRESAS ---

  async function loadCompanies() {
    try {
      const { data, error } = await sb.from('companies').select('*').order('name');
      if (error) throw error;
      cachedCompanies = data || [];

      // 1. Renderiza lista na aba de empresas
      const list = document.getElementById('admin-companies-list');
      if (list) {
        list.innerHTML = '';
        cachedCompanies.forEach(c => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--border-light)';
          tr.innerHTML = `
            <td style="padding: 12px;">${c.name}</td>
            <td style="padding: 12px; color: var(--text-secondary);">${c.cnpj || '-'}</td>
            <td style="padding: 12px; font-size: 12px; color: var(--text-hint);">${c.address || '-'}</td>
            <td style="padding: 12px; display: flex; gap: 8px;">
               <button class="btn-edit" data-id="${c.id}" style="background: var(--surface-2); border: 1px solid var(--border); padding: 4px; border-radius: 4px; cursor: pointer; color: var(--accent);"><i data-lucide="edit-3" style="width:14px; height:14px;"></i></button>
               <button class="btn-del" data-id="${c.id}" style="background: var(--surface-2); border: 1px solid var(--border); padding: 4px; border-radius: 4px; cursor: pointer; color: var(--danger-text);"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
            </td>
          `;
          
          tr.querySelector('.btn-edit').onclick = () => editCompany(c);
          tr.querySelector('.btn-del').onclick = () => deleteCompany(c.id);
          list.appendChild(tr);
        });
      }

      // 2. Popula o Select no formulário de usuários e Filtro
      const select = document.getElementById('admin-u-company-id');
      const filterSelect = document.getElementById('admin-filter-company');

      const companyOptions = cachedCompanies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      if (select) {
        select.innerHTML = '<option value="">Selecione uma empresa...</option>' + companyOptions;
      }
      if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">Todas as Empresas</option>' + companyOptions;
      }

      if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Erro empresas', e); }
  }

  async function saveCompany(e) {
    e.preventDefault();
    const name = document.getElementById('comp-nome').value;
    const cnpj = document.getElementById('comp-cnpj').value;
    const address = document.getElementById('comp-address').value;

    try {
      const { error } = await sb.from('companies').insert({ name, cnpj, address });
      if (error) throw error;
      companyForm.reset();
      loadCompanies();
    } catch (err) { alert('Erro ao salvar empresa: ' + err.message); }
  }

  async function editCompany(company) {
    const html = `
      <div class="field">
        <label>Nome da Empresa</label>
        <div class="input-wrap"><input type="text" id="edit-comp-name" value="${company.name}" required /></div>
      </div>
      <div class="field">
        <label>CNPJ</label>
        <div class="input-wrap"><input type="text" id="edit-comp-cnpj" value="${company.cnpj || ''}" /></div>
      </div>
      <div class="field" style="margin-top: 10px;">
        <label>Endereço</label>
        <div class="input-wrap"><input type="text" id="edit-comp-address" value="${company.address || ''}" /></div>
      </div>
    `;
    
    openEditModal('Editar Empresa', html, async () => {
      const name = document.getElementById('edit-comp-name').value;
      const cnpj = document.getElementById('edit-comp-cnpj').value;
      const address = document.getElementById('edit-comp-address').value;
      
      const { error } = await sb.from('companies').update({ name, cnpj, address }).eq('id', company.id);
      if (error) throw error;
      loadCompanies();
      loadUsersGrid(); // Recarrega lista de usuários caso o nome da empresa tenha mudado
      closeEditModal();
    });
  }

  async function deleteCompany(id) {
    if (!confirm('Tem certeza que deseja excluir esta empresa? Usuários vinculados ficarão sem empresa.')) return;
    try {
      const { error } = await sb.from('companies').delete().eq('id', id);
      if (error) throw error;
      loadCompanies();
      loadUsersGrid();
    } catch (err) { alert('Erro ao deletar: ' + err.message); }
  }

  // --- GESTÃO DE USUÁRIOS (LICENÇAS) ---

  async function loadUsersGrid() {
    try {
      const filterCompanyId = document.getElementById('admin-filter-company')?.value || 'all';
      
      let query = sb.from('profiles').select('*').order('created_at', { ascending: false });
      if (filterCompanyId !== 'all') {
        query = query.eq('company_id', filterCompanyId);
      }

      const { data: users, error } = await query;
      if (error) throw error;
      const tbody = document.getElementById('admin-users-list');
      if (!tbody) return;
      tbody.innerHTML = '';

      (users || []).forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';

        // Remove o domínio interno para exibir apenas o login
        const displayLogin = u.email.replace(AUTH_DOMAIN, '');

        // Busca nome da empresa no cache
        const companyObj = cachedCompanies.find(c => c.id === u.company_id);
        const companyName = companyObj ? companyObj.name : (u.company || '-');

        let pms = [];
        if (u.permissions?.calc) pms.push('Calc');
        if (u.permissions?.trainings) pms.push('Vídeos');
        if (u.permissions?.support) pms.push('Suporte');
        if (u.permissions?.admin) pms.push('Admin');

        tr.innerHTML = `
          <td style="padding: 12px;">${u.name || '(Sem Nome)'}</td>
          <td style="padding: 12px; font-weight: 500; color: var(--accent);">${displayLogin}</td>
          <td style="padding: 12px; font-family: monospace; font-size: 13px;">${u.access_key || '••••••'}</td>
          <td style="padding: 12px;">${companyName}</td>
          <td style="padding: 12px;">
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${pms.map(p => `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--sidebar-bg); color: var(--text-secondary);">${p}</span>`).join('')}
            </div>
          </td>
          <td style="padding: 12px; display: flex; gap: 8px;">
             <button class="btn-edit-u" title="Editar Usuário" style="background: var(--surface-2); border: 1px solid var(--border); padding: 4px; border-radius: 4px; cursor: pointer; color: var(--accent);"><i data-lucide="edit-3" style="width:14px; height:14px;"></i></button>
             <button class="btn-pwd-u" title="Trocar Senha" style="background: var(--surface-2); border: 1px solid var(--border); padding: 4px; border-radius: 4px; cursor: pointer; color: #10b981;"><i data-lucide="key" style="width:14px; height:14px;"></i></button>
             <button class="btn-del-u" title="Excluir" style="background: var(--surface-2); border: 1px solid var(--border); padding: 4px; border-radius: 4px; cursor: pointer; color: var(--danger-text);"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
          </td>
        `;

        tr.querySelector('.btn-edit-u').onclick = () => editUser(u);
        tr.querySelector('.btn-pwd-u').onclick = () => adminChangePassword(u);
        tr.querySelector('.btn-del-u').onclick = () => deleteUser(u.id);

        tbody.appendChild(tr);
      });
      if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Erro na listagem', e); }
  }

  async function deleteUser(id) {
    if (!confirm('Excluir este perfil de usuário? O acesso ao sistema será revogado imediatamente.')) return;
    try {
      const { error } = await sb.from('profiles').delete().eq('id', id);
      if (error) throw error;
      loadUsersGrid();
    } catch (err) { alert('Erro ao excluir usuário: ' + err.message); }
  }

  async function editUser(user) {
    const html = `
      <div class="field">
        <label>Nome Completo</label>
        <div class="input-wrap"><input type="text" id="edit-u-nome" value="${user.name}" required /></div>
      </div>
      <div class="field" style="margin-top: 10px;">
        <label>Alterar Empresa</label>
        <div class="input-wrap">
          <select id="edit-u-company-id" style="width: 100%; height: 40px; border-radius: 8px; padding: 0 12px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-primary);">
            <option value="">Sem empresa vinculada</option>
            ${cachedCompanies.map(c => `<option value="${c.id}" ${c.id === user.company_id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top: 15px;">
        <label>Permissões de Acesso</label>
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding: 12px; background: var(--surface-2); border-radius: 8px; border: 1px solid var(--border);">
           <label style="display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--text-primary); font-size: 14px;">
              <input type="checkbox" id="edit-perm-calc" ${user.permissions?.calc ? 'checked' : ''} /> 
              <span>Calculadora de H. Máxima</span>
           </label>
           <label style="display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--text-primary); font-size: 14px;">
              <input type="checkbox" id="edit-perm-trainings" ${user.permissions?.trainings ? 'checked' : ''} /> 
              <span>Treinamentos MyMetal</span>
           </label>
           <label style="display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--text-primary); font-size: 14px;">
              <input type="checkbox" id="edit-perm-support" ${user.permissions?.support ? 'checked' : ''} /> 
              <span>Central de Atendimento</span>
           </label>
           <label style="display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--text-primary); font-size: 14px;">
              <input type="checkbox" id="edit-perm-admin" ${user.permissions?.admin ? 'checked' : ''} /> 
              <span style="font-weight: 500; color: var(--accent);">Acesso Administrador</span>
           </label>
        </div>
      </div>
    `;

    openEditModal('Editar Usuário', html, async () => {
      const name = document.getElementById('edit-u-nome').value;
      const company_id = document.getElementById('edit-u-company-id').value;
      const perms = {
        calc: document.getElementById('edit-perm-calc').checked,
        trainings: document.getElementById('edit-perm-trainings').checked,
        support: document.getElementById('edit-perm-support').checked,
        admin: document.getElementById('edit-perm-admin').checked
      };

      const { error } = await sb.from('profiles').update({
        name,
        company_id,
        role: perms.admin ? 'admin' : 'client',
        permissions: perms,
        // (Opcional) Senha não pode ser editada via profiles no Supabase, mas guardamos a chave inicial aqui se necessário
      }).eq('id', user.id);

      if (error) throw error;
      loadUsersGrid();
      closeEditModal();
    });
  }

  async function adminChangePassword(user) {
    const html = `
      <div class="field">
        <label>Nova Senha para <strong>${user.name}</strong></label>
        <div class="input-wrap">
          <input type="text" id="new-u-password" placeholder="Mínimo 6 caracteres" required />
        </div>
        <p style="font-size: 11px; color: var(--text-hint); margin-top: 8px;">A nova senha será aplicada imediatamente e o usuário precisará usá-la no próximo acesso.</p>
      </div>
    `;

    openEditModal('Trocar Senha Manual', html, async () => {
      const newPwd = document.getElementById('new-u-password').value;
      if (!newPwd || newPwd.length < 6) {
        alert('A senha deve ter pelo menos 6 caracteres.');
        return;
      }

      try {
        // 1. Chama a função SQL RPC para trocar no Auth do Supabase
        const { error: rpcError } = await sb.rpc('admin_change_password', { 
          target_user_id: user.id, 
          new_password: newPwd 
        });
        if (rpcError) throw rpcError;

        // 2. Sincroniza o perfil (access_key) para que o admin possa ver a nova senha
        const { error: profError } = await sb.from('profiles').update({ access_key: newPwd }).eq('id', user.id);
        if (profError) throw profError;

        alert('Senha de ' + user.name + ' alterada com sucesso!');
        loadUsersGrid();
        closeEditModal();
      } catch (err) {
        console.error(err);
        alert('Erro ao trocar senha: ' + err.message);
      }
    });
  }

  // --- HANDLERS EVENTOS ---

  if (userForm) {
    userForm.onsubmit = async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none'; successBox.style.display = 'none';

      const uNome = document.getElementById('admin-u-nome').value;
      const uCompanyId = document.getElementById('admin-u-company-id').value;
      const uEmail = document.getElementById('admin-u-email').value;
      const uSenha = document.getElementById('admin-u-senha').value;

      const permissions = {
        calc: document.getElementById('perm-calc').checked,
        trainings: document.getElementById('perm-trainings').checked,
        support: document.getElementById('perm-support').checked,
        admin: document.getElementById('perm-admin').checked
      };

      const btnO = userForm.querySelector('button[type="submit"]');
      const btnTxt = document.getElementById('btn-create-u-txt');
      btnTxt.textContent = 'Gerando...';
      btnO.disabled = true;

      try {
        const finalEmail = uEmail.includes('@') ? uEmail : uEmail.toLowerCase().trim() + AUTH_DOMAIN;
        
        const { data: authData, error: authError } = await secSb.auth.signUp({ email: finalEmail, password: uSenha });
        if (authError) throw authError;

        const { error: profError } = await sb.from('profiles').insert({
          id: authData.user.id,
          name: uNome,
          company_id: uCompanyId,
          email: finalEmail,
          access_key: uSenha, // Salva para visualização do Admin
          role: permissions.admin ? 'admin' : 'client',
          permissions: permissions,
          created_at: new Date().toISOString()
        });
        if (profError) throw profError;

        await secSb.auth.signOut();
        successBox.style.display = 'block';
        userForm.reset();
        loadUsersGrid();
      } catch (err) {
        errorBox.textContent = 'Erro: ' + err.message;
        errorBox.style.display = 'block';
      } finally {
        btnTxt.textContent = 'Gerar Licença e Salvar';
        btnO.disabled = false;
      }
    };
  }

  if (companyForm) {
    companyForm.onsubmit = saveCompany;
  }

  if (document.getElementById('btn-gen-pwd')) {
    document.getElementById('btn-gen-pwd').onclick = (e) => {
      e.preventDefault();
      const randomPwd = Math.random().toString(36).slice(-6).toUpperCase();
      document.getElementById('admin-u-senha').value = randomPwd;
    };
  }

  // Handler Universal para os Modais de Edição (Usa a callback definida no openEditModal)
  const editFormModal = document.getElementById('admin-edit-form');
  if (editFormModal) {
    editFormModal.onsubmit = async (e) => {
      e.preventDefault();
      if (currentModalCallback) {
        try {
          await currentModalCallback();
        } catch (err) {
          console.error(err);
          alert('Erro ao salvar alterações: ' + err.message);
        }
      }
    };
  }

  const companyFilter = document.getElementById('admin-filter-company');
  if (companyFilter) {
    companyFilter.onchange = () => loadUsersGrid();
  }

  // Carga inicial do painel
  loadCompanies().then(() => loadUsersGrid());
}

let isSupportControlsInitialized = false;
function initSupportControls() {
  if (isSupportControlsInitialized) {
    // Já inicializado, mas precisa recarregar tickets para o novo usuário
    renderTickets();
    return;
  }
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
        lbl.textContent = 'Enviando ao servidor...';
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
/**
 * ROTEADOR SPA (Global)
 */
function renderView() {
  const views = ['view-home', 'view-calc', 'view-trainings', 'view-support', 'view-admin'];
  const navItems = document.querySelectorAll('.nav-item');
  const topTitle = document.getElementById('top-title');
  let hash = window.location.hash.replace('#', '') || 'view-home';

  // Se não estiver logado, não navega
  if (!currentUser && hash !== 'login-overlay') return;

  // PROTEÇÃO DE ROTA
  const p = currentUser?.permissions || {};
  const isAdm = currentUser?.role === 'admin';
  const guards = {
    'view-calc': p.calc || isAdm,
    'view-trainings': p.trainings || isAdm,
    'view-support': p.support || isAdm,
    'view-admin': p.admin || isAdm
  };

  if (guards[hash] === false) {
    window.location.hash = 'view-forbidden';
    return;
  }

  // Esconde todas as views e mostra a atual
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === hash) ? 'block' : 'none';
  });

  // Atualiza menu lateral
  navItems.forEach(item => {
    item.classList.toggle('active', item.getAttribute('href') === '#' + hash);
  });

  // Atualiza breadcrumb
  if (topTitle) {
    const titles = {
      'view-home': 'Dashboard / Visão Geral',
      'view-calc': 'Ferramentas / Calculadora H. Máxima',
      'view-trainings': 'MyMetal / Treinamentos',
      'view-support': 'Atendimento / Suporte',
      'view-admin': 'Gestão / Licenças'
    };
    topTitle.textContent = titles[hash] || 'Dashboard';
  }

  // Carrega tickets quando entra no suporte e RESETA para a lista (evita travar em um chamado antigo)
  if (hash === 'view-support') {
    if (typeof switchSupportView === 'function') switchSupportView('sup-view-list');
    if (typeof renderTickets === 'function') renderTickets();
  }

  const mainContent = document.querySelector('.main-content');
  if (mainContent) mainContent.scrollTop = 0;
  if (window.lucide) lucide.createIcons();
}

// Inicializa o roteador global uma única vez
window.addEventListener('hashchange', renderView);

function initSupabaseAuthUI() {
  const overlay = document.getElementById('login-overlay');
  const mainApp = document.getElementById('app-wrapper');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  const PROFILE_CACHE_KEY = 'cached_user_profile';

  function showLoginForm(errorMsg = null) {
    loginForm.style.display = 'flex';
    if (errorMsg) {
      loginError.textContent = errorMsg;
      loginError.style.color = 'var(--danger-text)';
      loginError.style.display = 'block';
    } else {
      loginError.style.display = 'none';
    }
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar na Plataforma'; }
  }

  // Monta a interface com os dados do perfil
  function setupApp(profile) {
    currentUser = profile;
    const p = currentUser.permissions || {};
    const isAdm = currentUser.role === 'admin';

    const toggles = {
      'nav-item-calc': p.calc || isAdm,
      'nav-item-trainings': p.trainings || isAdm,
      'nav-item-support': p.support || isAdm,
      'nav-item-admin': p.admin || isAdm
    };
    Object.entries(toggles).forEach(([id, show]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? 'flex' : 'none';
    });

    const grpToggles = {
      'grp-ferramentas': p.calc || isAdm,
      'grp-mymetal': p.trainings || isAdm,
      'grp-suporte': p.support || isAdm
    };
    Object.entries(grpToggles).forEach(([id, show]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? 'block' : 'none';
    });

    if (isAdm) initAdminPanel();

    // Personalização do Dashboard
    const welcomeName = document.getElementById('user-welcome-name');
    if (welcomeName) welcomeName.textContent = profile.name || 'Usuário';

    overlay.style.display = 'none';
    mainApp.style.display = 'flex';

    const validHashes = ['view-home', 'view-calc', 'view-trainings', 'view-support', 'view-admin'];
    const currentHash = window.location.hash.replace('#', '');
    if (!validHashes.includes(currentHash)) {
      window.location.hash = 'view-home';
    }
    renderView();
    renderPerfis();
    initSupportControls();

    // --- LOGICA DO MENU SANDUICHE (Toggle) ---
    const btnToggle = document.getElementById('toggle-sidebar');
    if (btnToggle) {
      // Define ícone inicial baseado no estado atual
      const isCollapsed = document.querySelector('.sidebar').classList.contains('collapsed');
      btnToggle.innerHTML = `<i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-left'}"></i>`;
      if (window.lucide) lucide.createIcons();

      btnToggle.onclick = (e) => {
        e.preventDefault();
        if (window.toggleSidebar) {
           window.toggleSidebar();
           // Altera o ícone de acordo com o estado após o clique
           const isCollapsed = document.querySelector('.sidebar').classList.contains('collapsed');
           btnToggle.innerHTML = `<i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-left'}"></i>`;
           if (window.lucide) lucide.createIcons();
        }
      };
    }

    // Auto-fechar menu no mobile ao clicar em um link
    document.querySelectorAll('.menu-item').forEach(item => {
      item.onclick = () => {
        const sidebar = document.querySelector('.sidebar');
        if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-open')) {
          if (window.toggleSidebar) window.toggleSidebar();
        }
      };
    });
  }

  // ── Monitor de Autenticação ──────────────────────────────────────
  sb.auth.onAuthStateChange((event, session) => {
    console.log('Evento Auth:', event);

    if (event === 'INITIAL_SESSION') {
      if (session?.user) {
        console.log('🔄 Restaurando sessão com validação no banco...');
        // Em vez de usar o cache, buscamos sempre o perfil fresquinho do banco
        sb.from('profiles').select('*').eq('id', session.user.id).limit(1)
          .then(({ data, error }) => {
            if (error || !data || data.length === 0) {
              console.error('Erro ao validar perfil:', error);
              showLoginForm('Acesso negado: Perfil não encontrado.');
              return;
            }
            const profile = data[0];
            const fullProfile = { id: session.user.id, email: session.user.email, ...profile };
            localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(fullProfile));
            setupApp(fullProfile);
          });
      } else {
        showLoginForm();
      }
      return;
    }

    if (event === 'SIGNED_OUT') {
      currentUser = null;
      resetAppState();
      localStorage.removeItem(PROFILE_CACHE_KEY);
      window.location.hash = '';
      mainApp.style.display = 'none';
      overlay.style.display = 'flex';
      showLoginForm();
    }
  });

  // ── Formulário de Login (ÚNICO momento que fala com o banco) ─────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    loginError.style.display = 'none';
    btnSubmit.textContent = 'Autenticando...';
    btnSubmit.disabled = true;

    try {
      // 1. Autentica (Adiciona máscara se for apenas usuário)
      const finalEmail = email.includes('@') ? email : email.toLowerCase().trim() + AUTH_DOMAIN;

      const { data: authData, error: authError } = await sb.auth.signInWithPassword({ email: finalEmail, password: senha });
      if (authError) {
        let msg = 'Login ou senha inválidos.';
        if (authError.message.includes('Email not confirmed')) msg = '⚠️ E-mail não confirmado. Desative "Confirm email" no Dashboard.';
        showLoginForm(msg);
        return;
      }

      const user = authData.user;
      btnSubmit.textContent = 'Carregando perfil...';

      // 2. Busca perfil no banco
      let profile = null;
      try {
        const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).limit(1);
        if (error) throw error;
        if (data?.length > 0) profile = data[0];
      } catch (dbErr) {
        console.error('Erro DB:', dbErr.message);
        const isMaster = email.includes('admin') || email.includes('ericnash2011') || email.includes('rodrigo@idealle.com');
        if (isMaster) {
          profile = { name: 'Administrador', role: 'admin', permissions: { calc: true, trainings: true, support: true, admin: true } };
        }
      }

      if (!profile) {
        await sb.auth.signOut();
        showLoginForm('Acesso negado: licença não encontrada.');
        return;
      }

      // 3. Salva no cache e abre o app
      const fullProfile = { id: user.id, email: user.email, ...profile };
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(fullProfile));
      window.location.hash = 'view-home';
      setupApp(fullProfile);

    } catch (err) {
      showLoginForm('Erro de rede. Verifique sua conexão.');
    }
  });

  // ── Logout ────────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    overlay.style.display = 'flex';
    mainApp.style.display = 'none';
    try {
      await sb.auth.signOut();
    } catch (err) {
      currentUser = null;
      resetAppState();
      localStorage.removeItem(PROFILE_CACHE_KEY);
      window.location.hash = '';
      showLoginForm();
    }
  });

  // ── Toggle Visualização de Senha ────────────────────────────────────
  const toggleBtn = document.getElementById('toggle-password');
  const pwdInput = document.getElementById('login-senha');
  if (toggleBtn && pwdInput) {
    toggleBtn.onclick = () => {
      const isPwd = pwdInput.type === 'password';
      pwdInput.type = isPwd ? 'text' : 'password';
      toggleBtn.innerHTML = `<i data-lucide="${isPwd ? 'eye-off' : 'eye'}"></i>`;
      if (window.lucide) lucide.createIcons();
    };
  }
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
