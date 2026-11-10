/* =========================================================
   Controle de Ordens de Serviço e Lucratividade
   JavaScript puro (sem frameworks).

   Regra de ouro dos cálculos: TODOS os valores monetários
   são guardados e calculados em CENTAVOS (números inteiros).
   Isso evita erros de arredondamento como 0,1 + 0,2 = 0,30000000004.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   1. CONSTANTES
   --------------------------------------------------------- */
const STORAGE_KEY = 'controleOS_v1';
const TAXA_POR_PARCELA = 3;      // % cobrado por parcela no crédito
const MAX_PARCELAS = 12;

const FORMAS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  transferencia: 'Transferência bancária'
};

/* ---------------------------------------------------------
   2. UTILITÁRIOS
   --------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compactFormatter = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Formata centavos como moeda: 123456 -> "R$ 1.234,56" */
function formatBRL(cents) {
  return brlFormatter.format((cents || 0) / 100);
}

/** Formato curto para eixos de gráfico: 123456 -> "R$ 1,2 mil" */
function formatBRLCompact(cents) {
  return 'R$ ' + compactFormatter.format((cents || 0) / 100);
}

/** Formata número com vírgula decimal: (10.5, 2) -> "10,5" */
function formatNumberBR(n, maxDecimals = 2) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: maxDecimals });
}

/** Formata percentual: 12.3456 -> "12,35%" */
function formatPct(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
}

/** Valor em centavos para preencher um campo de texto: 123456 -> "1.234,56" */
function centsToInput(cents) {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Converte o texto digitado em número decimal exato, aceitando
 * "1.234,56", "1234,56" e "1234.56".
 * Retorna { ok, empty, int, frac, value, error } — int/frac são strings
 * para permitir conversão sem erro de ponto flutuante.
 */
function parseDecimal(raw, maxDecimals = 2, dotIsThousands = true) {
  let s = String(raw == null ? '' : raw).replace(/R\$|\s/g, '');
  if (s === '') return { ok: true, empty: true, int: '0', frac: '', value: 0 };
  if (s.includes('-')) return { ok: false, error: 'Valores negativos não são permitidos.' };

  if (s.includes(',')) {
    // Formato brasileiro: ponto = milhar, vírgula = decimal
    if ((s.match(/,/g) || []).length > 1) return { ok: false, error: 'Valor inválido.' };
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) s = s.replace(/\./g, '');                      // 1.234.567
    else if (dots === 1 && dotIsThousands && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', ''); // 1.500 = mil e quinhentos
  }

  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return { ok: false, error: 'Valor inválido.' };
  const [intPart, fracPart = ''] = s.split('.');
  if (fracPart.length > maxDecimals) {
    return { ok: false, error: `Use no máximo ${maxDecimals} casas decimais.` };
  }
  return { ok: true, empty: false, int: intPart || '0', frac: fracPart, value: Number(s) };
}

/** Texto -> centavos (inteiro). Retorna { ok, empty, cents, error } */
function parseMoney(raw) {
  const p = parseDecimal(raw, 2, true);
  if (!p.ok) return p;
  const cents = Number(p.int) * 100 + Number((p.frac + '00').slice(0, 2));
  return { ok: true, empty: p.empty, cents };
}

/** Texto de percentual -> centésimos de % (10,5% -> 1050). */
function parsePercent(raw) {
  const p = parseDecimal(raw, 2, false);
  if (!p.ok) return p;
  const bp = Number(p.int) * 100 + Number((p.frac + '00').slice(0, 2));
  return { ok: true, empty: p.empty, bp };
}

/** Texto de quantidade -> milésimos (1,5 -> 1500). Aceita até 3 casas. */
function parseQuantity(raw) {
  const p = parseDecimal(raw, 3, false);
  if (!p.ok) return p;
  const milli = Number(p.int) * 1000 + Number((p.frac + '000').slice(0, 3));
  return { ok: true, empty: p.empty, milli };
}

/** Multiplica centavos por uma quantidade em milésimos, arredondando ao centavo. */
function multiplyCents(cents, milli) {
  return Math.round((cents * milli) / 1000);
}

/** Aplica um percentual (em centésimos de %) sobre centavos. */
function percentOfCents(cents, bp) {
  return Math.round((cents * bp) / 10000);
}

const sumBy = (list, fn) => list.reduce((acc, item) => acc + fn(item), 0);

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-10" -> "10/11/2026" */
function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------------------------------------------------------
   3. ARMAZENAMENTO (LocalStorage)
   --------------------------------------------------------- */
function loadOrders() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Erro ao ler dados salvos:', e);
    return [];
  }
}

function saveOrders(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error('Erro ao salvar:', e);
    toast('Não foi possível salvar os dados neste navegador.', true);
    return false;
  }
}

let orders = [];

/* ---------------------------------------------------------
   4. MOTOR DE CÁLCULO FINANCEIRO
   Fonte única de verdade: o formulário, o histórico, o dashboard,
   o CSV e a impressão usam todos esta mesma função.
   --------------------------------------------------------- */
/**
 * Estrutura da OS (valores em centavos):
 * { pecas:[{nome, qtd, custoUnit, vendaUnit}], frete, outrosCustos:[{desc, valor}],
 *   servico, descontoTipo:'valor'|'percent', descontoValor (centavos ou centésimos de %),
 *   pagamento, parcelas, taxaRetida }
 */
function calcOS(os) {
  // --- Peças: custo (compra) e receita (venda) ---
  const pecas = (os.pecas || []).map(p => {
    const milli = Math.round(Number(p.qtd) * 1000);
    return {
      ...p,
      custoTotal: multiplyCents(p.custoUnit, milli),
      vendaTotal: multiplyCents(p.vendaUnit, milli)
    };
  });
  const custoPecas = sumBy(pecas, p => p.custoTotal);
  const receitaPecas = sumBy(pecas, p => p.vendaTotal);

  // --- Outros custos e frete ---
  const outrosCustos = os.outrosCustos || [];
  const totalOutros = sumBy(outrosCustos, c => c.valor);
  const frete = os.frete || 0;

  // --- Serviço e desconto (desconto SOMENTE sobre a mão de obra) ---
  const servicoOriginal = os.servico || 0;
  let desconto = 0;
  let descontoPct;
  if (os.descontoTipo === 'percent') {
    const bp = Math.min(os.descontoValor || 0, 10000);
    desconto = percentOfCents(servicoOriginal, bp);
    descontoPct = bp / 100;
  } else {
    desconto = Math.min(os.descontoValor || 0, servicoOriginal);
    descontoPct = servicoOriginal > 0 ? (desconto / servicoOriginal) * 100 : 0;
  }
  const servicoFinal = servicoOriginal - desconto;

  // --- Venda após desconto (base para a taxa do cartão) ---
  const vendaAposDesconto = receitaPecas + servicoFinal;

  // --- Taxa do cartão de crédito: 3% por parcela, cobrada do cliente ---
  const isCredito = os.pagamento === 'credito';
  const parcelas = isCredito ? Math.min(Math.max(parseInt(os.parcelas, 10) || 1, 1), MAX_PARCELAS) : 1;
  const taxaPct = isCredito ? parcelas * TAXA_POR_PARCELA : 0;
  const taxaCartao = Math.round((vendaAposDesconto * taxaPct) / 100);
  const totalCliente = vendaAposDesconto + taxaCartao;

  // Parcelas em centavos exatos: a diferença do arredondamento vai na 1ª parcela
  const valorParcela = Math.floor(totalCliente / parcelas);
  const primeiraParcela = totalCliente - valorParcela * (parcelas - 1);

  // Se a operadora retém a taxa, ela vira despesa (repasse) — opcional
  const repasseTaxa = isCredito && os.taxaRetida ? taxaCartao : 0;

  // --- Receitas ---
  const receitaTotal = receitaPecas + servicoFinal + taxaCartao; // = totalCliente

  // --- Despesas (cada custo contado uma única vez) ---
  const totalDespesas = custoPecas + frete + totalOutros + repasseTaxa;

  // --- Indicadores ---
  const lucroBruto = receitaPecas + servicoFinal - custoPecas;
  const lucroLiquido = receitaTotal - totalDespesas;
  const margem = receitaTotal > 0 ? (lucroLiquido / receitaTotal) * 100 : 0;

  return {
    pecas, custoPecas, receitaPecas, margemPecas: receitaPecas - custoPecas,
    outrosCustos, totalOutros, frete,
    servicoOriginal, desconto, descontoPct, servicoFinal,
    vendaAposDesconto, isCredito, parcelas, taxaPct, taxaCartao, totalCliente,
    valorParcela, primeiraParcela, repasseTaxa,
    receitaTotal, totalDespesas, lucroBruto, lucroLiquido, margem
  };
}

/** Soma os resultados de várias OS (dashboard e rodapé do histórico). */
function aggregate(list) {
  const t = {
    qtd: list.length, receitaTotal: 0, receitaPecas: 0, servicoFinal: 0, custoPecas: 0, frete: 0,
    totalOutros: 0, repasseTaxa: 0, totalDespesas: 0, lucroBruto: 0, lucroLiquido: 0,
    desconto: 0, taxaCartao: 0
  };
  list.forEach(os => {
    const c = calcOS(os);
    Object.keys(t).forEach(k => { if (k !== 'qtd') t[k] += c[k]; });
  });
  t.ticketMedio = t.qtd ? Math.round(t.receitaTotal / t.qtd) : 0;
  t.margem = t.receitaTotal > 0 ? (t.lucroLiquido / t.receitaTotal) * 100 : 0;
  return t;
}

/* ---------------------------------------------------------
   5. DETALHAMENTO DOS CÁLCULOS (HTML reutilizável)
   Usado no painel do formulário, nos detalhes e no PDF completo.
   --------------------------------------------------------- */
function line(label, value, cls = '') {
  return `<div class="fin-line ${cls}"><span>${label}</span><span>${value}</span></div>`;
}

function renderFinancialDetail(c) {
  const lucroCls = c.lucroLiquido < 0 ? 'prejuizo' : 'lucro';
  const outrosLines = c.outrosCustos.map(o => line('• ' + escapeHtml(o.desc), formatBRL(o.valor), 'sub')).join('');

  const taxaLabel = c.isCredito
    ? `Taxa do cartão (${c.parcelas}x × ${TAXA_POR_PARCELA}% = ${c.taxaPct}%)`
    : 'Taxa do cartão (não se aplica)';

  const creditoBlock = c.isCredito ? `
    <div class="fin-block neutro">
      <h4>Cartão de crédito</h4>
      ${line('Valor original da venda (após desconto)', formatBRL(c.vendaAposDesconto))}
      ${line('Quantidade de parcelas', c.parcelas + 'x')}
      ${line('Percentual da taxa', `${c.parcelas} × ${TAXA_POR_PARCELA}% = ${c.taxaPct}%`)}
      ${line('Valor da taxa', formatBRL(c.taxaCartao))}
      ${line('Valor total com a taxa', formatBRL(c.totalCliente), 'total')}
      ${line('Valor de cada parcela', parcelasTexto(c))}
    </div>` : '';

  return `
    <div class="fin-block neutro">
      <div class="fin-highlight"><span>Total a cobrar do cliente</span><span class="fin-big">${formatBRL(c.totalCliente)}</span></div>
      ${c.isCredito ? `<div class="fin-line sub" style="padding-left:0"><span>${parcelasTexto(c)}</span><span></span></div>` : ''}
    </div>

    <div class="fin-block receita">
      <h4>Receitas</h4>
      ${line('Peças vendidas', formatBRL(c.receitaPecas))}
      ${line('Serviço (mão de obra) original', formatBRL(c.servicoOriginal), 'sub')}
      ${line(`(−) Desconto${c.desconto ? ' (' + formatPct(c.descontoPct) + ')' : ''}`, '− ' + formatBRL(c.desconto), 'sub')}
      ${line('Serviço após desconto', formatBRL(c.servicoFinal))}
      ${line(taxaLabel, formatBRL(c.taxaCartao))}
      ${line('Receita total', formatBRL(c.receitaTotal), 'total')}
      <div class="fin-formula">
        ${formatBRL(c.receitaPecas)} (peças) + ${formatBRL(c.servicoFinal)} (serviço) + ${formatBRL(c.taxaCartao)} (taxa) = <strong>${formatBRL(c.receitaTotal)}</strong>
      </div>
    </div>

    <div class="fin-block despesa">
      <h4>Despesas</h4>
      ${line('Custo de aquisição das peças', formatBRL(c.custoPecas))}
      ${line('Transporte / frete', formatBRL(c.frete))}
      ${line('Outros custos', formatBRL(c.totalOutros))}
      ${outrosLines}
      ${c.repasseTaxa ? line('Repasse da taxa à operadora', formatBRL(c.repasseTaxa)) : ''}
      ${line('Total de despesas', formatBRL(c.totalDespesas), 'total')}
      <div class="fin-formula">
        ${formatBRL(c.custoPecas)} (peças) + ${formatBRL(c.frete)} (frete) + ${formatBRL(c.totalOutros)} (outros)${c.repasseTaxa ? ' + ' + formatBRL(c.repasseTaxa) + ' (repasse taxa)' : ''} = <strong>${formatBRL(c.totalDespesas)}</strong>
      </div>
    </div>

    <div class="fin-block ${lucroCls}">
      <h4>Indicadores financeiros</h4>
      ${line('Lucro bruto', `<span class="${c.lucroBruto < 0 ? 'neg' : ''}">${formatBRL(c.lucroBruto)}</span>`)}
      <div class="fin-formula">
        ${formatBRL(c.receitaPecas)} (venda peças) + ${formatBRL(c.servicoFinal)} (serviço) − ${formatBRL(c.custoPecas)} (custo peças) = <strong>${formatBRL(c.lucroBruto)}</strong>
      </div>
      ${line('Lucro líquido', `<span class="${c.lucroLiquido < 0 ? 'neg' : ''}">${formatBRL(c.lucroLiquido)}</span>`, 'total')}
      <div class="fin-formula">
        ${formatBRL(c.receitaTotal)} (receita total) − ${formatBRL(c.totalDespesas)} (despesas) = <strong>${formatBRL(c.lucroLiquido)}</strong>
      </div>
      ${line('Margem de lucro', formatPct(c.margem))}
      <div class="fin-formula">
        ${formatBRL(c.lucroLiquido)} ÷ ${formatBRL(c.receitaTotal)} × 100 = <strong>${formatPct(c.margem)}</strong>
      </div>
      ${line('Total de descontos concedidos', formatBRL(c.desconto))}
      ${line('Total de taxas de cartão', formatBRL(c.taxaCartao))}
      ${line('Margem sobre as peças (venda − compra)', formatBRL(c.margemPecas), 'sub')}
    </div>

    ${creditoBlock}
  `;
}

/** Texto das parcelas, mostrando a 1ª diferente quando há sobra de centavos. */
function parcelasTexto(c) {
  if (c.parcelas === 1) return `1x de ${formatBRL(c.totalCliente)}`;
  if (c.primeiraParcela === c.valorParcela) return `${c.parcelas}x de ${formatBRL(c.valorParcela)}`;
  return `1x de ${formatBRL(c.primeiraParcela)} + ${c.parcelas - 1}x de ${formatBRL(c.valorParcela)}`;
}

/* ---------------------------------------------------------
   6. NAVEGAÇÃO
   --------------------------------------------------------- */
const VIEW_TITLES = { dashboard: 'Dashboard', form: 'Nova ordem de serviço', historico: 'Histórico de ordens de serviço' };
let currentView = 'dashboard';

function showView(view) {
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#pageTitle').textContent = view === 'form' && formState.editingId
    ? 'Editar OS nº ' + ($('#fNumero').value || '')
    : VIEW_TITLES[view];
  closeSidebar();
  if (view === 'dashboard') renderDashboard();
  if (view === 'historico') renderHistory();
  window.scrollTo({ top: 0 });
}

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebarBackdrop').classList.add('show');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('show');
}

/* ---------------------------------------------------------
   7. TOAST E MODAIS
   --------------------------------------------------------- */
function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function openModal(id) {
  const m = document.getElementById(id);
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
}
function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}

/** Caixa de confirmação. Retorna uma Promise<boolean>. */
function confirmDialog(message, { title = 'Confirmar', okText = 'Confirmar', danger = true } = {}) {
  return new Promise(resolve => {
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    const yes = $('#confirmYes');
    yes.textContent = okText;
    yes.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    openModal('confirmModal');
    const done = result => {
      closeModal('confirmModal');
      yes.onclick = null;
      $('#confirmNo').onclick = null;
      resolve(result);
    };
    yes.onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    yes.focus();
  });
}

/* ---------------------------------------------------------
   8. FORMULÁRIO DA ORDEM DE SERVIÇO
   --------------------------------------------------------- */
const formState = {
  editingId: null,     // id da OS em edição (null = nova)
  pecas: [],           // peças da OS em preenchimento
  outrosCustos: [],    // outros custos da OS em preenchimento
  editingPecaId: null, // peça carregada no editor
  dirty: false         // houve alteração não salva?
};

function setFieldError(id, msg) {
  const input = document.getElementById(id);
  const small = $(`.error[data-for="${id}"]`);
  if (input) input.classList.toggle('invalid', !!msg);
  if (small) small.textContent = msg || '';
}

function clearFormErrors() {
  $$('#osForm .error').forEach(e => { e.textContent = ''; });
  $$('#osForm .invalid').forEach(e => e.classList.remove('invalid'));
}

/** Sugere o próximo número de OS (maior número existente + 1). */
function suggestNextNumber() {
  const nums = orders.map(o => parseInt(String(o.numero).replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

/** Limpa o formulário para uma nova OS. */
function resetForm() {
  $('#osForm').reset();
  clearFormErrors();
  formState.editingId = null;
  formState.pecas = [];
  formState.outrosCustos = [];
  formState.dirty = false;
  cancelPecaEdit();
  $('#cDesc').value = '';
  $('#cValor').value = '';
  $('#custoErro').textContent = '';
  $('#fNumero').value = suggestNextNumber();
  $('#fData').value = todayISO();
  $('#fParcelas').value = '1';
  $('#btnSalvarOS').textContent = 'Salvar ordem de serviço';
  updateDiscountLabel();
  updatePaymentFields();
  renderPecas();
  renderCustos();
  updateLive();
}

/** Carrega uma OS salva no formulário para edição. */
function loadIntoForm(os) {
  resetForm();
  formState.editingId = os.id;
  formState.pecas = os.pecas.map(p => ({ ...p }));
  formState.outrosCustos = os.outrosCustos.map(c => ({ ...c }));
  $('#fNumero').value = os.numero;
  $('#fData').value = os.data;
  $('#fCliente').value = os.cliente;
  $('#fContato').value = os.contato;
  $('#fEquipamento').value = os.equipamento;
  $('#fDescricao').value = os.descricao;
  $('#fFornecedor').value = os.fornecedor || '';
  $('#fFrete').value = os.frete ? centsToInput(os.frete) : '';
  $('#fServico').value = os.servico ? centsToInput(os.servico) : '';
  $('#fDescontoTipo').value = os.descontoTipo;
  $('#fDescontoValor').value = !os.descontoValor ? ''
    : os.descontoTipo === 'percent' ? formatNumberBR(os.descontoValor / 100) : centsToInput(os.descontoValor);
  $('#fPagamento').value = os.pagamento;
  $('#fParcelas').value = String(os.parcelas || 1);
  $('#fTaxaRetida').checked = !!os.taxaRetida;
  $('#btnSalvarOS').textContent = 'Salvar alterações';
  updateDiscountLabel();
  updatePaymentFields();
  renderPecas();
  renderCustos();
  updateLive();
  formState.dirty = false;
}

/** Lê os campos numéricos do formulário, marcando erros em tempo real. */
function readNumbers(showErrors = true) {
  const errors = {};
  const frete = parseMoney($('#fFrete').value);
  const servico = parseMoney($('#fServico').value);
  const tipo = $('#fDescontoTipo').value;
  const desc = tipo === 'percent' ? parsePercent($('#fDescontoValor').value) : parseMoney($('#fDescontoValor').value);

  if (!frete.ok) errors.fFrete = frete.error;
  if (!servico.ok) errors.fServico = servico.error;
  if (!desc.ok) errors.fDescontoValor = desc.error;

  const servicoCents = servico.ok ? servico.cents : 0;
  let descontoValor = 0;
  if (desc.ok) {
    descontoValor = tipo === 'percent' ? desc.bp : desc.cents;
    if (tipo === 'percent' && descontoValor > 10000) errors.fDescontoValor = 'O desconto não pode passar de 100%.';
    if (tipo === 'valor' && descontoValor > servicoCents) errors.fDescontoValor = 'O desconto não pode ser maior que o valor do serviço.';
  }

  if (showErrors) {
    ['fFrete', 'fServico', 'fDescontoValor'].forEach(id => setFieldError(id, errors[id]));
  }

  return {
    errors,
    frete: frete.ok ? frete.cents : 0,
    servico: servicoCents,
    descontoTipo: tipo,
    descontoValor
  };
}

/** Monta o objeto da OS a partir do formulário. */
function buildOSFromForm() {
  const n = readNumbers(true);
  const pagamento = $('#fPagamento').value;
  return {
    os: {
      numero: $('#fNumero').value.trim(),
      data: $('#fData').value,
      cliente: $('#fCliente').value.trim(),
      contato: $('#fContato').value.trim(),
      equipamento: $('#fEquipamento').value.trim(),
      descricao: $('#fDescricao').value.trim(),
      fornecedor: $('#fFornecedor').value.trim(),
      pecas: formState.pecas.map(p => ({ ...p })),
      frete: n.frete,
      outrosCustos: formState.outrosCustos.map(c => ({ ...c })),
      servico: n.servico,
      descontoTipo: n.descontoTipo,
      descontoValor: n.descontoValor,
      pagamento,
      parcelas: pagamento === 'credito' ? parseInt($('#fParcelas').value, 10) || 1 : 1,
      taxaRetida: pagamento === 'credito' && $('#fTaxaRetida').checked
    },
    numErrors: n.errors
  };
}

/** Valida todos os campos obrigatórios. Retorna true se tudo estiver OK. */
function validateOS(os, numErrors) {
  const errors = { ...numErrors };
  const required = {
    fNumero: [os.numero, 'Informe o número da OS.'],
    fData: [os.data, 'Informe a data de abertura.'],
    fCliente: [os.cliente, 'Informe o nome do cliente.'],
    fContato: [os.contato, 'Informe o contato do cliente.'],
    fEquipamento: [os.equipamento, 'Informe o equipamento.'],
    fDescricao: [os.descricao, 'Descreva o problema ou serviço.'],
    fPagamento: [os.pagamento, 'Selecione a forma de pagamento.']
  };
  Object.entries(required).forEach(([id, [val, msg]]) => { if (!val) errors[id] = msg; });

  if (os.numero) {
    const dup = orders.find(o => o.id !== formState.editingId &&
      String(o.numero).trim().toLowerCase() === os.numero.toLowerCase());
    if (dup) errors.fNumero = 'Já existe uma OS com este número.';
  }
  if (os.pecas.length && !os.fornecedor) errors.fFornecedor = 'Informe o fornecedor das peças.';
  if (!os.pecas.length && os.servico === 0) errors.fServico = 'Informe o valor do serviço ou adicione ao menos uma peça.';

  ['fNumero', 'fData', 'fCliente', 'fContato', 'fEquipamento', 'fDescricao', 'fFornecedor', 'fPagamento', 'fFrete', 'fServico', 'fDescontoValor']
    .forEach(id => setFieldError(id, errors[id]));

  const ids = Object.keys(errors);
  if (ids.length) {
    const first = document.getElementById(ids.find(id => document.getElementById(id)));
    if (first) { first.focus(); first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return false;
  }
  return true;
}

/** Salva (cria ou atualiza) a OS. */
function saveOS(e) {
  e.preventDefault();
  if (formState.editingPecaId) {
    toast('Termine ou cancele a edição da peça antes de salvar.', true);
    return;
  }
  const { os, numErrors } = buildOSFromForm();
  if (!validateOS(os, numErrors)) {
    toast('Verifique os campos destacados.', true);
    return;
  }
  const now = new Date().toISOString();
  if (formState.editingId) {
    const idx = orders.findIndex(o => o.id === formState.editingId);
    orders[idx] = { ...orders[idx], ...os, atualizadoEm: now };
  } else {
    orders.push({ id: uid(), ...os, criadoEm: now, atualizadoEm: now });
  }
  if (!saveOrders(orders)) return;
  toast(formState.editingId ? `OS nº ${os.numero} atualizada.` : `OS nº ${os.numero} cadastrada.`);
  resetForm();
  showView('historico');
}

/** Atualiza o painel financeiro e os resumos a cada alteração. */
function updateLive() {
  const { os } = buildOSFromForm();
  const c = calcOS(os);

  $('#finPanel').innerHTML = `
    <h2>Painel financeiro</h2>
    <p class="panel-sub">Atualizado automaticamente enquanto você preenche.</p>
    ${renderFinancialDetail(c)}`;

  // Resumo de custos separados (seção 3)
  $('#costSummary').innerHTML = `
    <div class="fin-block despesa">
      <h4>Custos desta OS (separados)</h4>
      ${line('Peças (custo de compra)', formatBRL(c.custoPecas))}
      ${line('Transporte / frete', formatBRL(c.frete))}
      ${line('Outros custos adicionais', formatBRL(c.totalOutros))}
      ${line('Total de custos', formatBRL(c.custoPecas + c.frete + c.totalOutros), 'total')}
    </div>
    <div class="fin-block receita">
      ${line('Valor do serviço (mão de obra) — receita', formatBRL(c.servicoOriginal))}
    </div>`;

  // Resumo do desconto (seção 4)
  $('#discountSummary').innerHTML = `
    ${line('Valor original do serviço', formatBRL(c.servicoOriginal))}
    ${line(`Desconto aplicado${c.desconto ? ' (' + formatPct(c.descontoPct) + ')' : ''}`, '− ' + formatBRL(c.desconto))}
    ${line('Valor final do serviço', formatBRL(c.servicoFinal), 'total')}
    <div class="fin-formula">As peças (${formatBRL(c.receitaPecas)}) não recebem desconto.</div>`;

  // Resumo do cartão (seção 5)
  const card = $('#cardSummary');
  if (c.isCredito) {
    card.classList.remove('hidden');
    card.innerHTML = `
      ${line('Valor original da venda', formatBRL(c.vendaAposDesconto))}
      ${line('Quantidade de parcelas', c.parcelas + 'x')}
      ${line('Percentual da taxa', `${c.parcelas} × ${TAXA_POR_PARCELA}% = ${c.taxaPct}%`)}
      ${line('Valor da taxa', formatBRL(c.taxaCartao))}
      ${line('Valor total com a taxa', formatBRL(c.totalCliente), 'total')}
      ${line('Valor de cada parcela', parcelasTexto(c))}`;
  } else {
    card.classList.add('hidden');
  }
}

function updateDiscountLabel() {
  const isPct = $('#fDescontoTipo').value === 'percent';
  $('#lblDesconto').textContent = isPct ? 'Desconto (%)' : 'Desconto (R$)';
  $('#fDescontoValor').placeholder = isPct ? '0' : '0,00';
}

function updatePaymentFields() {
  const isCredito = $('#fPagamento').value === 'credito';
  $('#parcelasField').classList.toggle('hidden', !isCredito);
  $('#taxaRetidaField').classList.toggle('hidden', !isCredito);
}

/** Formata o campo ao sair dele (ex.: "1234,5" -> "1.234,50"). */
function formatOnBlur(e) {
  const el = e.target;
  if (el.value.trim() === '') return;
  if (el.id === 'fDescontoValor' && $('#fDescontoTipo').value === 'percent') {
    const p = parsePercent(el.value);
    if (p.ok) el.value = formatNumberBR(p.bp / 100);
  } else if (el.id === 'pQtd') {
    const q = parseQuantity(el.value);
    if (q.ok) el.value = formatNumberBR(q.milli / 1000, 3);
  } else if (el.classList.contains('money') || el.id === 'fDescontoValor') {
    const m = parseMoney(el.value);
    if (m.ok) el.value = centsToInput(m.cents);
  }
}

/* ---------- 8.1 Peças ---------- */
function readPecaEditor() {
  const nome = $('#pNome').value.trim();
  const qtd = parseQuantity($('#pQtd').value);
  const custo = parseMoney($('#pCusto').value);
  const venda = parseMoney($('#pVenda').value);
  return { nome, qtd, custo, venda };
}

function updatePecaPreview() {
  const { qtd, custo, venda } = readPecaEditor();
  if (!qtd.ok || !custo.ok || !venda.ok) {
    $('#partPreview').textContent = 'Total da peça: —';
    return;
  }
  const milli = qtd.empty ? 1000 : qtd.milli;
  const vendaUnit = venda.empty ? custo.cents : venda.cents;
  const custoTotal = multiplyCents(custo.cents, milli);
  const vendaTotal = multiplyCents(vendaUnit, milli);
  $('#partPreview').innerHTML =
    `Custo: ${formatNumberBR(milli / 1000, 3)} × ${formatBRL(custo.cents)} = <strong>${formatBRL(custoTotal)}</strong><br>` +
    `Venda: ${formatNumberBR(milli / 1000, 3)} × ${formatBRL(vendaUnit)} = <strong>${formatBRL(vendaTotal)}</strong>`;
}

function addOrUpdatePeca() {
  const { nome, qtd, custo, venda } = readPecaEditor();
  const err = $('#pecaErro');
  let msg = '';
  if (!nome) msg = 'Informe o nome da peça.';
  else if (!qtd.ok) msg = 'Quantidade: ' + qtd.error;
  else if (qtd.empty || qtd.milli === 0) msg = 'A quantidade deve ser maior que zero.';
  else if (!custo.ok) msg = 'Valor de compra: ' + custo.error;
  else if (custo.empty) msg = 'Informe o valor unitário de compra.';
  else if (!venda.ok) msg = 'Valor de venda: ' + venda.error;
  err.textContent = msg;
  if (msg) return;

  const peca = {
    id: formState.editingPecaId || uid(),
    nome,
    qtd: qtd.milli / 1000,
    custoUnit: custo.cents,
    vendaUnit: venda.empty ? custo.cents : venda.cents
  };
  if (formState.editingPecaId) {
    const i = formState.pecas.findIndex(p => p.id === formState.editingPecaId);
    formState.pecas[i] = peca;
    toast('Peça atualizada.');
  } else {
    formState.pecas.push(peca);
  }
  formState.dirty = true;
  cancelPecaEdit();
  renderPecas();
  updateLive();
  $('#pNome').focus();
}

function editPeca(id) {
  const p = formState.pecas.find(x => x.id === id);
  if (!p) return;
  formState.editingPecaId = id;
  $('#pNome').value = p.nome;
  $('#pQtd').value = formatNumberBR(p.qtd, 3);
  $('#pCusto').value = centsToInput(p.custoUnit);
  $('#pVenda').value = centsToInput(p.vendaUnit);
  $('#btnAddPeca').textContent = 'Salvar peça';
  $('#btnCancelPeca').classList.remove('hidden');
  $('#partEditor').classList.add('editing');
  updatePecaPreview();
  renderPecas();
  $('#partEditor').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#pNome').focus();
}

function cancelPecaEdit() {
  formState.editingPecaId = null;
  ['#pNome', '#pQtd', '#pCusto', '#pVenda'].forEach(s => { $(s).value = ''; });
  $('#pecaErro').textContent = '';
  $('#btnAddPeca').textContent = '+ Adicionar peça';
  $('#btnCancelPeca').classList.add('hidden');
  $('#partEditor').classList.remove('editing');
  updatePecaPreview();
}

function deletePeca(id) {
  if (formState.editingPecaId === id) cancelPecaEdit();
  formState.pecas = formState.pecas.filter(p => p.id !== id);
  formState.dirty = true;
  renderPecas();
  updateLive();
  toast('Peça removida.');
}

function renderPecas() {
  const c = calcOS({ pecas: formState.pecas });
  const body = $('#pecasBody');
  if (!c.pecas.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Nenhuma peça adicionada.</td></tr>';
    $('#pecasFoot').innerHTML = '';
    return;
  }
  body.innerHTML = c.pecas.map(p => `
    <tr class="${p.id === formState.editingPecaId ? 'row-editing' : ''}">
      <td>${escapeHtml(p.nome)}</td>
      <td class="num">${formatNumberBR(p.qtd, 3)}</td>
      <td class="num">${formatBRL(p.custoUnit)}</td>
      <td class="num">${formatBRL(p.custoTotal)}</td>
      <td class="num">${formatBRL(p.vendaUnit)}</td>
      <td class="num">${formatBRL(p.vendaTotal)}</td>
      <td class="actions-col"><div class="row-actions">
        <button type="button" class="icon-btn" data-edit-peca="${p.id}">Editar</button>
        <button type="button" class="icon-btn danger" data-del-peca="${p.id}">Excluir</button>
      </div></td>
    </tr>`).join('');
  $('#pecasFoot').innerHTML = `
    <tr>
      <td colspan="3">Total das peças (${c.pecas.length})</td>
      <td class="num">${formatBRL(c.custoPecas)}</td>
      <td></td>
      <td class="num">${formatBRL(c.receitaPecas)}</td>
      <td></td>
    </tr>`;
}

/* ---------- 8.2 Outros custos ---------- */
function addCusto() {
  const desc = $('#cDesc').value.trim();
  const valor = parseMoney($('#cValor').value);
  let msg = '';
  if (!desc) msg = 'Informe a descrição do custo.';
  else if (!valor.ok) msg = valor.error;
  else if (valor.empty || valor.cents === 0) msg = 'Informe um valor maior que zero.';
  $('#custoErro').textContent = msg;
  if (msg) return;
  formState.outrosCustos.push({ id: uid(), desc, valor: valor.cents });
  formState.dirty = true;
  $('#cDesc').value = '';
  $('#cValor').value = '';
  renderCustos();
  updateLive();
  $('#cDesc').focus();
}

function deleteCusto(id) {
  formState.outrosCustos = formState.outrosCustos.filter(c => c.id !== id);
  formState.dirty = true;
  renderCustos();
  updateLive();
  toast('Custo removido.');
}

function renderCustos() {
  const body = $('#custosBody');
  if (!formState.outrosCustos.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">Nenhum custo adicional.</td></tr>';
    return;
  }
  body.innerHTML = formState.outrosCustos.map(c => `
    <tr>
      <td>${escapeHtml(c.desc)}</td>
      <td class="num">${formatBRL(c.valor)}</td>
      <td class="actions-col"><button type="button" class="icon-btn danger" data-del-custo="${c.id}">Excluir</button></td>
    </tr>`).join('');
}

/** Abre o formulário para uma nova OS, confirmando se houver dados não salvos. */
async function startNewOS() {
  if (formState.dirty) {
    const ok = await confirmDialog('Existe uma OS em preenchimento com alterações não salvas. Deseja descartá-las e começar uma nova?',
      { title: 'Descartar alterações?', okText: 'Descartar' });
    if (!ok) { showView('form'); return; }
  }
  resetForm();
  showView('form');
}

async function cancelForm() {
  if (formState.dirty) {
    const ok = await confirmDialog('As alterações não salvas serão perdidas.', { title: 'Cancelar preenchimento?', okText: 'Descartar' });
    if (!ok) return;
  }
  const wasEditing = !!formState.editingId;
  resetForm();
  showView(wasEditing ? 'historico' : 'dashboard');
}

/* ---------------------------------------------------------
   9. HISTÓRICO
   --------------------------------------------------------- */
function getHistoryFilters() {
  return {
    cliente: $('#hCliente').value.trim().toLowerCase(),
    numero: $('#hNumero').value.trim().toLowerCase(),
    de: $('#hDe').value,
    ate: $('#hAte').value
  };
}

function filterOrders(list, { cliente = '', numero = '', de = '', ate = '' }) {
  return list.filter(o =>
    (!cliente || o.cliente.toLowerCase().includes(cliente)) &&
    (!numero || String(o.numero).toLowerCase().includes(numero)) &&
    (!de || o.data >= de) &&
    (!ate || o.data <= ate));
}

/** Ordena por data (mais recente primeiro) e depois pelo número. */
function sortOrders(list) {
  return [...list].sort((a, b) =>
    b.data.localeCompare(a.data) ||
    String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
}

function renderHistory() {
  const list = sortOrders(filterOrders(orders, getHistoryFilters()));
  const body = $('#histBody');
  const foot = $('#histFoot');

  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">Nenhuma ordem de serviço cadastrada ainda. Use “Nova ordem de serviço” no menu.</td></tr>';
    foot.innerHTML = '';
    return;
  }
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">Nenhuma OS encontrada para os filtros informados.</td></tr>';
    foot.innerHTML = '';
    return;
  }

  body.innerHTML = list.map(o => {
    const c = calcOS(o);
    const pag = FORMAS_PAGAMENTO[o.pagamento] + (c.isCredito ? ` ${c.parcelas}x` : '');
    return `
      <tr>
        <td><strong>${escapeHtml(o.numero)}</strong></td>
        <td>${formatDateBR(o.data)}</td>
        <td>${escapeHtml(o.cliente)}</td>
        <td>${escapeHtml(o.equipamento)}</td>
        <td><span class="badge">${escapeHtml(pag)}</span></td>
        <td class="num">${formatBRL(c.receitaTotal)}</td>
        <td class="num">${formatBRL(c.totalDespesas)}</td>
        <td class="num ${c.lucroLiquido < 0 ? 'neg' : 'pos'}"><strong>${formatBRL(c.lucroLiquido)}</strong></td>
        <td class="actions-col"><div class="row-actions">
          <button type="button" class="icon-btn" data-view-os="${o.id}">Ver</button>
          <button type="button" class="icon-btn" data-edit-os="${o.id}">Editar</button>
          <button type="button" class="icon-btn danger" data-del-os="${o.id}">Excluir</button>
        </div></td>
      </tr>`;
  }).join('');

  const t = aggregate(list);
  foot.innerHTML = `
    <tr>
      <td colspan="5">${list.length} OS listada(s)</td>
      <td class="num">${formatBRL(t.receitaTotal)}</td>
      <td class="num">${formatBRL(t.totalDespesas)}</td>
      <td class="num ${t.lucroLiquido < 0 ? 'neg' : 'pos'}">${formatBRL(t.lucroLiquido)}</td>
      <td></td>
    </tr>`;
}

let detailId = null;

/** Mostra todos os dados e cálculos de uma OS. */
function showDetail(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  detailId = id;
  const c = calcOS(o);
  $('#detailTitle').textContent = `OS nº ${o.numero}`;
  $('#detailBody').innerHTML = `
    <div class="detail-grid">
      <div><small>Cliente</small><strong>${escapeHtml(o.cliente)}</strong></div>
      <div><small>Contato</small><strong>${escapeHtml(o.contato)}</strong></div>
      <div><small>Data de abertura</small><strong>${formatDateBR(o.data)}</strong></div>
      <div><small>Equipamento</small><strong>${escapeHtml(o.equipamento)}</strong></div>
      <div><small>Fornecedor das peças</small><strong>${escapeHtml(o.fornecedor || '—')}</strong></div>
      <div><small>Pagamento</small><strong>${FORMAS_PAGAMENTO[o.pagamento]}${c.isCredito ? ' — ' + c.parcelas + 'x' : ''}</strong></div>
      <div class="wide"><small>Descrição do problema / serviço</small><strong>${escapeHtml(o.descricao)}</strong></div>
    </div>
    ${pecasTableHTML(c, true)}
    ${o.outrosCustos.length ? `
      <h4 class="sub-title">Outros custos</h4>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody>${o.outrosCustos.map(x => `<tr><td>${escapeHtml(x.desc)}</td><td class="num">${formatBRL(x.valor)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    <div class="detail-cols">${renderFinancialDetail(c)}</div>
    <p class="chart-sub">Criada em ${new Date(o.criadoEm).toLocaleString('pt-BR')} · Última alteração em ${new Date(o.atualizadoEm).toLocaleString('pt-BR')}</p>`;
  openModal('detailModal');
}

/** Tabela de peças (detalhes e impressão). */
function pecasTableHTML(c, showCost, cls = 'table') {
  if (!c.pecas.length) return '<p class="chart-sub">Nenhuma peça utilizada.</p>';
  return `
    <div class="table-wrap"><table class="${cls}">
      <thead><tr>
        <th>Peça</th><th class="num">Qtd</th>
        ${showCost ? '<th class="num">Compra unit.</th><th class="num">Custo total</th>' : ''}
        <th class="num">${showCost ? 'Venda unit.' : 'Valor unit.'}</th><th class="num">${showCost ? 'Venda total' : 'Total'}</th>
      </tr></thead>
      <tbody>${c.pecas.map(p => `
        <tr><td>${escapeHtml(p.nome)}</td><td class="num">${formatNumberBR(p.qtd, 3)}</td>
        ${showCost ? `<td class="num">${formatBRL(p.custoUnit)}</td><td class="num">${formatBRL(p.custoTotal)}</td>` : ''}
        <td class="num">${formatBRL(p.vendaUnit)}</td><td class="num">${formatBRL(p.vendaTotal)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr class="total">
        <td colspan="2">Total das peças</td>
        ${showCost ? `<td></td><td class="num">${formatBRL(c.custoPecas)}</td>` : ''}
        <td></td><td class="num">${formatBRL(c.receitaPecas)}</td>
      </tr></tfoot>
    </table></div>`;
}

function editOS(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  closeModal('detailModal');
  loadIntoForm(o);
  showView('form');
}

async function deleteOS(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const ok = await confirmDialog(
    `Excluir a OS nº ${o.numero} de ${o.cliente}? Esta ação não pode ser desfeita.`,
    { title: 'Excluir ordem de serviço', okText: 'Excluir' });
  if (!ok) return;
  orders = orders.filter(x => x.id !== id);
  saveOrders(orders);
  if (formState.editingId === id) resetForm();
  renderHistory();
  toast(`OS nº ${o.numero} excluída.`);
}

/* ---------------------------------------------------------
   10. EXPORTAÇÃO CSV
   --------------------------------------------------------- */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Centavos -> "1234,56" (sem separador de milhar, bom para planilhas). */
const csvMoney = cents => (cents / 100).toFixed(2).replace('.', ',');

function exportCSV(list) {
  if (!list.length) {
    toast('Não há ordens de serviço para exportar.', true);
    return;
  }
  const header = ['Nº OS', 'Data', 'Cliente', 'Contato', 'Equipamento', 'Descrição', 'Fornecedor', 'Peças',
    'Custo das peças', 'Venda das peças', 'Frete', 'Outros custos', 'Serviço original', 'Desconto',
    'Serviço final', 'Forma de pagamento', 'Parcelas', 'Taxa cartão (%)', 'Taxa cartão (R$)',
    'Repasse taxa (despesa)', 'Receita total', 'Total de despesas', 'Lucro bruto', 'Lucro líquido', 'Margem (%)'];
  const rows = sortOrders(list).map(o => {
    const c = calcOS(o);
    const pecas = c.pecas.map(p => `${p.nome} (${formatNumberBR(p.qtd, 3)} x ${csvMoney(p.custoUnit)} compra / ${csvMoney(p.vendaUnit)} venda)`).join(' | ');
    return [o.numero, formatDateBR(o.data), o.cliente, o.contato, o.equipamento, o.descricao, o.fornecedor, pecas,
      csvMoney(c.custoPecas), csvMoney(c.receitaPecas), csvMoney(c.frete), csvMoney(c.totalOutros),
      csvMoney(c.servicoOriginal), csvMoney(c.desconto), csvMoney(c.servicoFinal), FORMAS_PAGAMENTO[o.pagamento],
      c.parcelas, String(c.taxaPct).replace('.', ','), csvMoney(c.taxaCartao), csvMoney(c.repasseTaxa),
      csvMoney(c.receitaTotal), csvMoney(c.totalDespesas), csvMoney(c.lucroBruto), csvMoney(c.lucroLiquido),
      c.margem.toFixed(2).replace('.', ',')];
  });
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ordens-de-servico-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${list.length} OS exportada(s) em CSV.`);
}

/* ---------------------------------------------------------
   11. IMPRESSÃO / PDF
   mode = 'cliente'  -> sem custos internos nem lucro
   mode = 'completo' -> com todos os cálculos financeiros
   --------------------------------------------------------- */
function printOS(id, mode) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const c = calcOS(o);
  const valores = `
    <table class="pr-table">
      <tbody>
        <tr><td>Peças</td><td class="num">${formatBRL(c.receitaPecas)}</td></tr>
        <tr><td>Serviço (mão de obra)</td><td class="num">${formatBRL(c.servicoOriginal)}</td></tr>
        <tr><td>Desconto no serviço${c.desconto ? ' (' + formatPct(c.descontoPct) + ')' : ''}</td><td class="num">− ${formatBRL(c.desconto)}</td></tr>
        <tr><td>Serviço após desconto</td><td class="num">${formatBRL(c.servicoFinal)}</td></tr>
        ${c.isCredito ? `<tr><td>Taxa do cartão de crédito (${c.parcelas}x × ${TAXA_POR_PARCELA}% = ${c.taxaPct}%)</td><td class="num">${formatBRL(c.taxaCartao)}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td class="num">${formatBRL(c.totalCliente)}</td></tr>
      </tbody>
    </table>
    <p><strong>Forma de pagamento:</strong> ${FORMAS_PAGAMENTO[o.pagamento]}${c.isCredito ? ' — ' + parcelasTexto(c) : ''}</p>`;

  $('#printArea').innerHTML = `
    <div class="pr-head">
      <div><h1>Ordem de Serviço nº ${escapeHtml(o.numero)}</h1>
        <div>${mode === 'completo' ? 'Relatório completo (uso interno)' : 'Via do cliente'}</div></div>
      <div style="text-align:right">Data de abertura<br><strong>${formatDateBR(o.data)}</strong></div>
    </div>
    <div class="pr-grid">
      <div><small>Cliente</small>${escapeHtml(o.cliente)}</div>
      <div><small>Contato</small>${escapeHtml(o.contato)}</div>
      <div><small>Equipamento</small>${escapeHtml(o.equipamento)}</div>
      ${mode === 'completo' ? `<div><small>Fornecedor das peças</small>${escapeHtml(o.fornecedor || '—')}</div>` : '<div></div>'}
      <div class="wide"><small>Descrição do problema / serviço</small>${escapeHtml(o.descricao)}</div>
    </div>
    <h3 class="pr-sec">Peças</h3>
    ${pecasTableHTML(c, mode === 'completo', 'pr-table')}
    <h3 class="pr-sec">Valores</h3>
    ${valores}
    ${mode === 'completo' ? `<h3 class="pr-sec">Análise financeira</h3>${renderFinancialDetail(c)}` : `
      <div class="pr-sign"><div>Assinatura do cliente</div><div>Assinatura do técnico</div></div>`}
    <div class="pr-foot">Emitido em ${new Date().toLocaleString('pt-BR')}</div>`;

  document.body.classList.add('printing');
  window.print();
}

/* ---------------------------------------------------------
   12. DASHBOARD E GRÁFICOS (SVG desenhado em JS puro)
   --------------------------------------------------------- */
function getDashboardList() {
  return filterOrders(orders, { de: $('#dashDe').value, ate: $('#dashAte').value });
}

function renderDashboard() {
  const list = getDashboardList();
  const t = aggregate(list);
  const kpis = [
    ['Ordens de serviço', String(t.qtd), 'no período', 'k-neutro'],
    ['Faturamento total', formatBRL(t.receitaTotal), 'receita recebida dos clientes', 'k-receita'],
    ['Total gasto com peças', formatBRL(t.custoPecas), 'custo de aquisição', 'k-despesa'],
    ['Total de despesas', formatBRL(t.totalDespesas), 'peças + frete + outros' + (t.repasseTaxa ? ' + repasse' : ''), 'k-despesa'],
    ['Lucro bruto acumulado', formatBRL(t.lucroBruto), 'peças + serviço − custo peças', 'k-lucro'],
    ['Lucro líquido acumulado', formatBRL(t.lucroLiquido), 'margem de ' + formatPct(t.margem), 'k-lucro'],
    ['Ticket médio por OS', formatBRL(t.ticketMedio), 'faturamento ÷ nº de OS', 'k-receita'],
    ['Descontos concedidos', formatBRL(t.desconto), 'somente na mão de obra', 'k-neutro'],
    ['Taxas de cartão', formatBRL(t.taxaCartao), 'cobradas dos clientes', 'k-neutro']
  ];
  $('#kpiGrid').innerHTML = kpis.map(([label, value, note, cls]) => `
    <div class="card kpi ${cls}">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${value.includes('-') ? 'neg' : ''}">${value}</div>
      <div class="kpi-note">${note}</div>
    </div>`).join('');

  // Séries por período
  const series = groupByPeriod(list, $('#dashAgrupar').value);
  renderBarChart($('#chartFaturamento'), series.map(s => ({
    label: s.label, value: s.receita,
    tip: `<b>${s.label}</b>Faturamento: ${formatBRL(s.receita)}<br>${s.qtd} OS`
  })));
  renderBarChart($('#chartLucro'), series.map(s => ({
    label: s.label, value: s.lucro,
    tip: `<b>${s.label}</b>Lucro líquido: ${formatBRL(s.lucro)}<br>Receita: ${formatBRL(s.receita)}<br>Despesas: ${formatBRL(s.despesas)}`
  })), { signed: true });

  // Despesas por categoria
  const despesas = [
    { label: 'Peças', value: t.custoPecas },
    { label: 'Transporte / frete', value: t.frete },
    { label: 'Outros custos', value: t.totalOutros }
  ];
  if (t.repasseTaxa) despesas.push({ label: 'Repasse taxa cartão', value: t.repasseTaxa });
  renderHBars($('#chartDespesas'), despesas.map(d => ({
    ...d, text: `${formatBRL(d.value)} · ${t.totalDespesas ? formatPct((d.value / t.totalDespesas) * 100) : '0%'}`
  })), t.totalDespesas === 0 ? 'Nenhuma despesa registrada no período.' : '');

  // Formas de pagamento
  const pag = Object.keys(FORMAS_PAGAMENTO).map(k => {
    const os = list.filter(o => o.pagamento === k);
    return { label: FORMAS_PAGAMENTO[k], qtd: os.length, valor: aggregate(os).receitaTotal };
  });
  renderHBars($('#chartPagamentos'), pag.map(p => ({
    label: p.label, value: p.qtd,
    text: `${p.qtd} OS · ${t.qtd ? formatPct((p.qtd / t.qtd) * 100) : '0%'} · ${formatBRL(p.valor)}`
  })), t.qtd === 0 ? 'Nenhuma OS no período.' : '');
}

/** Agrupa OS por mês ("2026-11") ou dia ("2026-11-10"), preenchendo lacunas. */
function groupByPeriod(list, mode) {
  if (!list.length) return [];
  const keyOf = d => (mode === 'dia' ? d : d.slice(0, 7));
  const map = new Map();
  list.forEach(o => {
    const k = keyOf(o.data);
    const c = calcOS(o);
    const cur = map.get(k) || { receita: 0, despesas: 0, lucro: 0, qtd: 0 };
    cur.receita += c.receitaTotal;
    cur.despesas += c.totalDespesas;
    cur.lucro += c.lucroLiquido;
    cur.qtd += 1;
    map.set(k, cur);
  });

  // Gera todas as chaves entre a menor e a maior data (até 90 períodos)
  const keys = [...map.keys()].sort();
  const all = [];
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  while (cursor <= last && all.length < 90) {
    all.push(cursor);
    cursor = nextPeriod(cursor, mode);
  }
  const finalKeys = all.length < 90 ? all : keys;

  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return finalKeys.map(k => {
    const v = map.get(k) || { receita: 0, despesas: 0, lucro: 0, qtd: 0 };
    const [y, m, d] = k.split('-');
    const label = mode === 'dia' ? `${d}/${m}` : `${meses[Number(m) - 1]}/${y.slice(2)}`;
    return { key: k, label, ...v };
  });
}

function nextPeriod(key, mode) {
  const pad = n => String(n).padStart(2, '0');
  if (mode === 'dia') {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  let [y, m] = key.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${pad(m)}`;
}

/** Calcula um passo "redondo" para o eixo (1, 2, 2.5, 5, 10 × 10^n). */
function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Caminho SVG de uma barra com a ponta (lado oposto à base) arredondada. */
function barPath(x, yBase, yEnd, w) {
  const h = Math.abs(yEnd - yBase);
  const r = Math.min(4, w / 2, h);
  if (yEnd <= yBase) { // barra para cima
    return `M${x},${yBase} V${yEnd + r} Q${x},${yEnd} ${x + r},${yEnd} H${x + w - r} Q${x + w},${yEnd} ${x + w},${yEnd + r} V${yBase} Z`;
  }
  return `M${x},${yBase} V${yEnd - r} Q${x},${yEnd} ${x + r},${yEnd} H${x + w - r} Q${x + w},${yEnd} ${x + w},${yEnd - r} V${yBase} Z`;
}

/**
 * Gráfico de colunas em SVG.
 * items: [{ label, value (centavos), tip (HTML) }]
 * signed: true colore valores negativos de vermelho (prejuízo).
 */
function renderBarChart(el, items, { signed = false } = {}) {
  if (!items.length) {
    el.innerHTML = '<div class="chart-empty">Nenhuma OS no período.<br>Os gráficos aparecem quando houver ordens cadastradas.</div>';
    return;
  }
  const W = Math.max(el.clientWidth || 0, 280);
  const H = 250;
  const m = { t: 22, r: 8, b: 28, l: 74 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const values = items.map(i => i.value);
  let max = Math.max(0, ...values);
  let min = Math.min(0, ...values);
  if (max === min) max = 10000; // tudo zero: eixo até R$ 100
  const step = niceStep(max - min, 4);
  const top = Math.ceil(max / step) * step;
  const bottom = Math.floor(min / step) * step;
  const y = v => m.t + ((top - v) / (top - bottom)) * ih;

  // Linhas de grade e rótulos do eixo Y
  let grid = '';
  for (let v = bottom; v <= top + step / 2; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>`;
    grid += `<text class="axis-label" x="${m.l - 8}" y="${yy}" dy="4" text-anchor="end">${formatBRLCompact(v)}</text>`;
  }

  const band = iw / items.length;
  const bw = Math.max(Math.min(42, band * 0.62), 3);
  const labelEvery = Math.max(1, Math.ceil(items.length / Math.max(1, Math.floor(iw / 56))));
  const maxIdx = values.indexOf(Math.max(...values));

  let bars = '';
  items.forEach((it, i) => {
    const x = m.l + band * i + (band - bw) / 2;
    const color = signed && it.value < 0 ? '#e34948' : '#2a78d6';
    if (it.value !== 0) bars += `<path class="bar" d="${barPath(x, y(0), y(it.value), bw)}" fill="${color}"/>`;
    // Área de toque maior que a barra
    bars += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>`;
    if (i % labelEvery === 0) {
      bars += `<text class="axis-label" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(it.label)}</text>`;
    }
  });

  // Rótulo direto somente no maior valor (evita poluição visual)
  let valueLabel = '';
  if (values[maxIdx] > 0) {
    const x = m.l + band * maxIdx + band / 2;
    valueLabel = `<text class="value-label" x="${x}" y="${y(values[maxIdx]) - 6}" text-anchor="middle">${formatBRLCompact(values[maxIdx])}</text>`;
  }

  const baseline = `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)" stroke-width="1"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${grid}${baseline}${bars}${valueLabel}</svg>`;

  // Tooltip ao passar o mouse / tocar
  const tip = $('#chartTooltip');
  $$('.hit', el).forEach(r => {
    const show = ev => {
      tip.innerHTML = items[Number(r.dataset.i)].tip;
      tip.classList.add('show');
      const px = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const py = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(px + 14, window.innerWidth - tw - 8) + 'px';
      tip.style.top = (py + 14) + 'px';
    };
    r.addEventListener('mousemove', show);
    r.addEventListener('touchstart', show, { passive: true });
    r.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

/** Barras horizontais (categorias) com rótulo direto de valor. */
function renderHBars(el, items, emptyMsg) {
  if (emptyMsg) {
    el.innerHTML = `<div class="chart-empty">${emptyMsg}</div>`;
    return;
  }
  const max = Math.max(...items.map(i => i.value), 1);
  el.innerHTML = `<div class="hbars">${items.map(i => `
    <div class="hbar-row">
      <div class="hbar-name">${escapeHtml(i.label)}</div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${i.value ? Math.max((i.value / max) * 62, 1) : 0}%"></div>
        <span class="hbar-val">${i.text}</span>
      </div>
    </div>`).join('')}</div>`;
}

/* ---------------------------------------------------------
   13. EVENTOS E INICIALIZAÇÃO
   --------------------------------------------------------- */
function bindEvents() {
  // Navegação
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.view === 'form') startNewOS();
    else showView(btn.dataset.view);
  }));
  $('#menuToggle').addEventListener('click', openSidebar);
  $('#sidebarBackdrop').addEventListener('click', closeSidebar);

  // Formulário
  const form = $('#osForm');
  form.addEventListener('submit', saveOS);
  form.addEventListener('input', e => {
    if (!e.target.closest('#partEditor') && !e.target.closest('.cost-editor')) formState.dirty = true;
    if (e.target.closest('#partEditor')) updatePecaPreview();
    // Ao corrigir um campo obrigatório, remove o aviso
    if (e.target.classList.contains('invalid') && e.target.value.trim()) setFieldError(e.target.id, '');
    updateLive();
  });
  form.addEventListener('change', updateLive);
  $$('input[inputmode="decimal"]', form).forEach(i => i.addEventListener('blur', formatOnBlur));
  // Enter nos editores de peça/custo adiciona o item em vez de enviar a OS
  $('#partEditor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOrUpdatePeca(); } });
  $('.cost-editor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCusto(); } });

  $('#fDescontoTipo').addEventListener('change', () => {
    $('#fDescontoValor').value = '';
    updateDiscountLabel();
    updateLive();
  });
  $('#fPagamento').addEventListener('change', updatePaymentFields);
  $('#btnAddPeca').addEventListener('click', addOrUpdatePeca);
  $('#btnCancelPeca').addEventListener('click', () => { cancelPecaEdit(); renderPecas(); });
  $('#btnAddCusto').addEventListener('click', addCusto);
  $('#btnCancelarOS').addEventListener('click', cancelForm);

  $('#pecasBody').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit-peca]');
    const del = e.target.closest('[data-del-peca]');
    if (ed) editPeca(ed.dataset.editPeca);
    if (del) deletePeca(del.dataset.delPeca);
  });
  $('#custosBody').addEventListener('click', e => {
    const del = e.target.closest('[data-del-custo]');
    if (del) deleteCusto(del.dataset.delCusto);
  });

  // Histórico
  ['#hCliente', '#hNumero', '#hDe', '#hAte'].forEach(s => $(s).addEventListener('input', renderHistory));
  $('#hLimpar').addEventListener('click', () => {
    ['#hCliente', '#hNumero', '#hDe', '#hAte'].forEach(s => { $(s).value = ''; });
    renderHistory();
  });
  $('#histBody').addEventListener('click', e => {
    const v = e.target.closest('[data-view-os]');
    const ed = e.target.closest('[data-edit-os]');
    const del = e.target.closest('[data-del-os]');
    if (v) showDetail(v.dataset.viewOs);
    if (ed) editOS(ed.dataset.editOs);
    if (del) deleteOS(del.dataset.delOs);
  });
  $('#btnExportCsv').addEventListener('click', () => exportCSV(filterOrders(orders, getHistoryFilters())));
  $('#btnExportCsvSide').addEventListener('click', () => exportCSV(orders));

  // Modais
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal').id)));
  $('#detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeModal('detailModal'); });
  $('#detailEdit').addEventListener('click', () => editOS(detailId));
  $('#detailPrintCliente').addEventListener('click', () => printOS(detailId, 'cliente'));
  $('#detailPrintCompleto').addEventListener('click', () => printOS(detailId, 'completo'));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#confirmModal').classList.contains('open')) $('#confirmNo').click();
    else closeModal('detailModal');
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'));

  // Dashboard
  ['#dashDe', '#dashAte', '#dashAgrupar'].forEach(s => $(s).addEventListener('change', renderDashboard));
  $('#dashLimpar').addEventListener('click', () => {
    $('#dashDe').value = '';
    $('#dashAte').value = '';
    renderDashboard();
  });
  window.addEventListener('resize', debounce(() => { if (currentView === 'dashboard') renderDashboard(); }, 150));
  document.addEventListener('scroll', () => $('#chartTooltip').classList.remove('show'), { passive: true });

  // Mantém os dados sincronizados se outra aba alterar o LocalStorage
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return;
    orders = loadOrders();
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'historico') renderHistory();
  });
}

function init() {
  orders = loadOrders();
  // Opções de parcelas (1x a 12x) com o percentual da taxa
  $('#fParcelas').innerHTML = Array.from({ length: MAX_PARCELAS }, (_, i) =>
    `<option value="${i + 1}">${i + 1}x — taxa de ${(i + 1) * TAXA_POR_PARCELA}%</option>`).join('');
  bindEvents();
  resetForm();
  showView('dashboard');
}

// Só inicializa a interface quando a página do sistema estiver carregada
// (permite reutilizar as funções de cálculo em testes).
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('osForm')) init();
  });
}
