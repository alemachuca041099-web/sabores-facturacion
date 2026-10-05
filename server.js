require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const facturama = require('./facturama');
const simulation = require('./simulation');
const { isMobile } = require('./public/device-policy');

// Modo simulación por default — así el panel funciona de punta a punta
// (cliente, monto, PDF) sin necesitar todavía la cuenta real de Facturama.
// Pon SIMULATION_MODE=false en .env el día que ya tengas credenciales.
const SIMULATION_MODE = process.env.SIMULATION_MODE !== 'false';

const REQUIRED_ENV = SIMULATION_MODE
  ? ['PANEL_PASSWORD', 'SESSION_SECRET']
  : ['FACTURAMA_USER', 'FACTURAMA_PASSWORD', 'FACTURAMA_EXPEDITION_ZIP', 'PANEL_PASSWORD', 'SESSION_SECRET'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Falta la variable de entorno ${key}. Copia .env.example a .env y complétalo.`);
    process.exit(1);
  }
}

const live = process.env.FACTURAMA_LIVE === 'true';
const pac = SIMULATION_MODE
  ? simulation.client()
  : facturama.client(process.env.FACTURAMA_USER, process.env.FACTURAMA_PASSWORD, { live });

const app = express();

// Antes del login, la sesión, el HTML real y cualquier operación fiscal.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.vary('User-Agent');
  if (!isMobile(req.get('User-Agent'))) return next();
  if (['/styles.css', '/device-policy.js'].includes(req.path) && ['GET', 'HEAD'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'El panel solo está disponible en computadora.' });
  }
  return res.status(403).sendFile(path.join(__dirname, 'public', 'desktop-only.html'));
});

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
  }),
);

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  res.status(401).json({ error: 'No has iniciado sesión.' });
}

// --- Auth -----------------------------------------------------------------
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password === process.env.PANEL_PASSWORD) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.redirect('/login.html?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Gate the app shell and the API behind the session; login page + its own
// assets stay public so there's somewhere to log in from.
app.use((req, res, next) => {
  const publicPaths = ['/login.html', '/login', '/catalogos.js', '/styles.css', '/device-policy.js', '/desktop-only.html'];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.startsWith('/api/')) return next(); // handled per-route below
  if (req.session.authed) return next();
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Normalización -------------------------------------------------------
// El frontend (app.js) espera esta forma (legal_name/tax_id/id) sin importar
// si el backend activo es Facturama o la simulación local.
function toFrontendCustomer(c) {
  return { id: c.Id, legal_name: c.Name, tax_id: c.Rfc, email: c.Email, cfdi_use: c.CfdiUse };
}

// --- API --------------------------------------------------------------
app.get('/api/customers', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 4) return res.json({ data: [] }); // Facturama pide mínimo 4 caracteres
    const result = await pac.searchCustomers(q);
    res.json({ data: (result || []).map(toFrontendCustomer) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/customers', requireAuth, async (req, res) => {
  try {
    const { legalName, taxId, taxSystem, email, zip } = req.body;
    if (!legalName || !taxId || !taxSystem || !zip) {
      return res.status(400).json({ error: 'Faltan datos del cliente (nombre, RFC, régimen o código postal).' });
    }
    const customer = await pac.createCustomer({
      Name: legalName,
      Rfc: taxId,
      FiscalRegime: taxSystem,
      TaxZipCode: zip,
      CfdiUse: 'G03',
      Email: email || undefined,
      Address: { ZipCode: zip },
    });
    res.json(toFrontendCustomer(customer));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Turns "monto + trato de IVA" en el/los renglón(es) que pide Facturama.
// A diferencia de Facturapi, aquí el precio SIEMPRE va sin IVA (Subtotal) y
// el impuesto se suma aparte en "Taxes" — por eso "incluido" hay que
// des-calcularlo primero.
function buildInvoiceItem(amount, taxMode) {
  const total = Number(amount);
  const base = { Quantity: '1', ProductCode: '90101501', UnitCode: 'E48', Unit: 'Servicio', Description: 'Consumo en restaurante' };

  if (taxMode === 'exento') {
    const value = total.toFixed(2);
    return { ...base, UnitPrice: value, Subtotal: value, TaxObject: '01', Total: value };
  }

  const RATE = 0.16;
  let subtotal = taxMode === 'incluido' ? total / (1 + RATE) : total;
  subtotal = Math.round(subtotal * 100) / 100;
  const tax = Math.round(subtotal * RATE * 100) / 100;
  const grandTotal = Math.round((subtotal + tax) * 100) / 100;

  return {
    ...base,
    UnitPrice: subtotal.toFixed(2),
    Subtotal: subtotal.toFixed(2),
    TaxObject: '02',
    Taxes: [{ Name: 'IVA', Rate: '0.16', Total: tax.toFixed(2), Base: subtotal.toFixed(2), IsRetention: 'false', IsFederalTax: 'true' }],
    Total: grandTotal.toFixed(2),
  };
}

app.post('/api/invoices', requireAuth, async (req, res) => {
  try {
    const { amount, taxMode, customerId, paymentForm, use, sendEmail } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    if (!customerId) return res.status(400).json({ error: 'Selecciona o agrega un cliente.' });

    // Necesitamos el régimen fiscal y CP del receptor, que la búsqueda por
    // palabra clave no siempre trae completos — se piden aparte.
    const customer = await pac.getCustomer(customerId);

    const invoice = await pac.createInvoice({
      NameId: '1',
      CfdiType: 'I',
      ExpeditionPlace: process.env.FACTURAMA_EXPEDITION_ZIP || '00000',
      PaymentForm: paymentForm || '01',
      PaymentMethod: 'PUE',
      Currency: 'MXN',
      Exportation: '01',
      Receiver: {
        Rfc: customer.Rfc,
        Name: customer.Name,
        CfdiUse: use || customer.CfdiUse || 'G03',
        FiscalRegime: customer.FiscalRegime,
        TaxZipCode: customer.Address?.ZipCode || customer.TaxZipCode,
      },
      Items: [buildInvoiceItem(amount, taxMode)],
    });

    if (sendEmail && customer.Email) {
      await pac.emailInvoice(invoice.Id, customer.Email).catch(() => null); // no truena la respuesta si el correo falla
    }

    res.json({
      folio_number: invoice.Folio ?? invoice.Id,
      id: invoice.Id,
      verification_url: invoice.VerificationUrl,
      pdf_url: `/api/invoices/${encodeURIComponent(invoice.Id)}/pdf`,
      simulated: SIMULATION_MODE,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/pdf', requireAuth, async (req, res) => {
  try {
    const pdf = await pac.getInvoicePdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// En Vercel la app se exporta y corre como función serverless — no hay que
// escuchar un puerto propio ahí, Vercel ya le da el request/response.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const mode = SIMULATION_MODE ? 'SIMULACIÓN (sin cuenta real)' : `Facturama ${live ? 'PRODUCCIÓN' : 'sandbox'}`;
    console.log(`Panel de facturación en http://localhost:${port} — modo: ${mode}`);
  });
}

module.exports = app;
