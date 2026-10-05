const SANDBOX_URL = 'https://apisandbox.facturama.mx';
const PRODUCTION_URL = 'https://api.facturama.mx';

/** Thin wrapper around the Facturama REST API (auth: HTTP Basic con
 * usuario/contraseña de API, no un token). Throws con el mensaje que
 * Facturama regresa, para que el panel muestre algo útil. */
function client(user, password, { live = false } = {}) {
  const baseUrl = live ? PRODUCTION_URL : SANDBOX_URL;
  const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = body?.Message || (body ? JSON.stringify(body) : `Facturama respondió ${res.status}`);
      throw new Error(message);
    }
    return body;
  }

  return {
    // Facturama pide mínimo 4 caracteres para buscar.
    searchCustomers: (keyword) => request(`/Client?keyword=${encodeURIComponent(keyword)}`),

    getCustomer: (id) => request(`/Client/${encodeURIComponent(id)}`),

    createCustomer: (customer) => request('/Client', { method: 'POST', body: JSON.stringify(customer) }),

    createInvoice: (invoice) => request('/3/cfdis', { method: 'POST', body: JSON.stringify(invoice) }),

    // Best-effort: no hemos podido probar esto contra una cuenta real todavía
    // (ver README) — por eso el server siempre lo envuelve en un catch.
    emailInvoice: (cfdiId, email) => {
      const subject = encodeURIComponent('Tu factura de SABORES');
      const comments = encodeURIComponent('Gracias por tu visita.');
      const to = encodeURIComponent(email);
      return request(`/cfdi/issued/${cfdiId}/email/${subject}/${comments}/${to}/false`, { method: 'POST' });
    },

    // Best-effort también: el nombre exacto del campo con el base64 no está
    // confirmado contra una cuenta real (ver README) — revísalo en cuanto
    // tengas credenciales antes de confiar en esto.
    getInvoicePdf: async (cfdiId) => {
      const body = await request(`/api/Cfdi/pdf/issued/${cfdiId}`);
      const base64 = body?.Content ?? body?.content;
      if (!base64) throw new Error('Facturama no regresó el PDF en el campo esperado — revisa facturama.js.');
      return Buffer.from(base64, 'base64');
    },
  };
}

module.exports = { client };
