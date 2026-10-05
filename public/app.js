/* Panel de facturación — sin build step, sin framework. Todo vive aquí. */

let selectedCustomer = null; // { id, legal_name, tax_id }

function fillSelect(select, options) {
  select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
}

fillSelect(document.getElementById('paymentForm'), FORMAS_PAGO);
fillSelect(document.getElementById('use'), USOS_CFDI);
fillSelect(document.getElementById('nc-regimen'), REGIMENES_FISCALES);

const mxn = (n) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Espeja el cálculo que hace server.js (buildInvoiceItem) para que lo que se
// ve aquí sea exactamente lo que se va a facturar — nunca una sorpresa.
function computeBreakdown(amount, taxMode) {
  const total = Number(amount) || 0;
  if (taxMode === 'exento') return { subtotal: total, iva: 0, total, exento: true };
  const RATE = 0.16;
  let subtotal = taxMode === 'incluido' ? total / (1 + RATE) : total;
  subtotal = Math.round(subtotal * 100) / 100;
  const iva = Math.round(subtotal * RATE * 100) / 100;
  const grand = Math.round((subtotal + iva) * 100) / 100;
  return { subtotal, iva, total: grand, exento: false };
}

// --- Resumen en vivo ----------------------------------------------
const amountInput = document.getElementById('amount');
const summaryBox = document.getElementById('summary');
const summaryCustomer = document.getElementById('summary-customer');

function updateSummary() {
  const amount = Number(amountInput.value);
  if (!amount || amount <= 0) {
    summaryBox.hidden = true;
    return;
  }
  const taxMode = document.querySelector('input[name="taxMode"]:checked').value;
  const { subtotal, iva, total } = computeBreakdown(amount, taxMode);

  document.getElementById('sum-subtotal').textContent = mxn(subtotal);
  document.getElementById('sum-iva').textContent = mxn(iva);
  document.getElementById('sum-total').textContent = mxn(total);
  document.getElementById('sum-iva-row').hidden = taxMode === 'exento';

  if (selectedCustomer) {
    summaryCustomer.hidden = false;
    summaryCustomer.innerHTML = `A nombre de <strong>${selectedCustomer.legal_name}</strong> · ${selectedCustomer.tax_id}`;
  } else {
    summaryCustomer.hidden = true;
  }

  summaryBox.hidden = false;
}

amountInput.addEventListener('input', updateSummary);
document.querySelectorAll('input[name="taxMode"]').forEach((r) => r.addEventListener('change', updateSummary));

// --- Búsqueda de cliente ----------------------------------------------
const searchInput = document.getElementById('customer-search');
const resultsList = document.getElementById('customer-results');
const selectedBox = document.getElementById('customer-selected');
const searchStatus = document.getElementById('search-status');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    resultsList.hidden = true;
    resultsList.innerHTML = '';
    searchStatus.hidden = true;
    return;
  }
  searchStatus.hidden = false;
  resultsList.hidden = true;
  searchTimer = setTimeout(async () => {
    const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    const items = body.data || [];
    resultsList.innerHTML = items
      .map(
        (c, i) =>
          `<li data-i="${i}"><strong>${c.legal_name}</strong><span>${c.tax_id}</span></li>`,
      )
      .join('') || '<li class="empty">Sin resultados — puedes agregarlo como nuevo.</li>';
    searchStatus.hidden = true;
    resultsList.hidden = false;
    resultsList._items = items;
  }, 300);
});

resultsList.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const customer = resultsList._items[Number(li.dataset.i)];
  selectCustomer(customer);
  resultsList.hidden = true;
  searchInput.value = '';
});

function selectCustomer(customer) {
  selectedCustomer = customer;
  selectedBox.hidden = false;
  selectedBox.innerHTML = `Facturando a <strong>${customer.legal_name}</strong> (${customer.tax_id}) <button type="button" class="link-btn" id="clear-customer">cambiar</button>`;
  document.getElementById('clear-customer').addEventListener('click', () => {
    selectedCustomer = null;
    selectedBox.hidden = true;
    updateSummary();
  });
  updateSummary();
}

// --- Alta de cliente nuevo ----------------------------------------------
const newCustomerBox = document.getElementById('new-customer');
document.getElementById('toggle-new-customer').addEventListener('click', () => {
  newCustomerBox.hidden = !newCustomerBox.hidden;
  if (!newCustomerBox.hidden) document.getElementById('nc-name').focus();
});

// El RFC del SAT siempre va en mayúsculas — se corrige mientras se escribe,
// en vez de dejar que alguien lo capture mal y truene hasta el timbrado.
const rfcInput = document.getElementById('nc-rfc');
rfcInput.addEventListener('input', () => {
  const pos = rfcInput.selectionStart;
  rfcInput.value = rfcInput.value.toUpperCase();
  rfcInput.selectionStart = rfcInput.selectionEnd = pos;
  rfcInput.classList.remove('field-invalid');
});
rfcInput.addEventListener('blur', () => {
  const len = rfcInput.value.trim().length;
  rfcInput.classList.toggle('field-invalid', len > 0 && len !== 12 && len !== 13);
});

document.getElementById('save-new-customer').addEventListener('click', async () => {
  const legalName = document.getElementById('nc-name').value.trim();
  const taxId = document.getElementById('nc-rfc').value.trim().toUpperCase();
  const taxSystem = document.getElementById('nc-regimen').value;
  const zip = document.getElementById('nc-zip').value.trim();
  const email = document.getElementById('nc-email').value.trim();

  if (!legalName || !taxId || !zip) {
    alert('Falta nombre, RFC o código postal del cliente.');
    return;
  }

  const btn = document.getElementById('save-new-customer');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legalName, taxId, taxSystem, zip, email }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'No se pudo guardar el cliente.');
    selectCustomer(body);
    newCustomerBox.hidden = true;
    rfcInput.classList.remove('field-invalid');
    ['nc-name', 'nc-rfc', 'nc-zip', 'nc-email'].forEach((id) => (document.getElementById(id).value = ''));
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cliente';
  }
});

// --- Generar factura ----------------------------------------------
const form = document.getElementById('invoice-form');
const resultBox = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedCustomer) {
    alert('Selecciona o agrega un cliente primero.');
    return;
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Generando…';
  resultBox.hidden = true;

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: document.getElementById('amount').value,
        taxMode: form.taxMode.value,
        customerId: selectedCustomer.id,
        paymentForm: document.getElementById('paymentForm').value,
        use: document.getElementById('use').value,
        sendEmail: document.getElementById('sendEmail').checked,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'No se pudo generar la factura.');

    resultBox.hidden = false;
    resultBox.className = 'result ok';
    resultBox.innerHTML = `
      <div class="result__body">
        <p class="result__line">
          ${body.simulated ? '<strong>Simulación</strong> generada' : 'Factura generada'} — folio <strong>${body.folio_number ?? body.id}</strong>.
          ${body.pdf_url ? `<a href="${body.pdf_url}" target="_blank" rel="noopener">Ver / descargar PDF</a>` : ''}
          ${body.verification_url ? ` · <a href="${body.verification_url}" target="_blank" rel="noopener">Ver verificación en el SAT</a>` : ''}
        </p>
        ${body.simulated ? '<p class="result__note">No se timbró ante el SAT — es solo para probar el flujo.</p>' : ''}
        <button type="button" class="btn result__new" id="new-invoice-btn">+ Generar nueva factura</button>
      </div>
    `;
    document.getElementById('new-invoice-btn').addEventListener('click', () => {
      resultBox.hidden = true;
      amountInput.focus();
      amountInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Solo se limpia lo propio de ESTA venta (monto, trato de IVA, forma de
    // pago/uso de CFDI, si se manda por correo) — el cliente se queda
    // seleccionado, porque lo más común es facturar varias ventas seguidas
    // a la misma persona sin tener que volver a buscarla.
    form.reset();
    updateSummary();
  } catch (err) {
    resultBox.hidden = false;
    resultBox.className = 'result error';
    resultBox.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generar factura';
  }
});
