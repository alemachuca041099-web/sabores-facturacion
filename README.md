# Facturación · SABORES

Panel privado (una sola contraseña) para que alguien en el restaurante capture
una venta — monto, si lleva IVA, y a quién se le factura — y se genere la
factura (CFDI) automáticamente vía [Facturama](https://facturama.mx/), su API
de facturación electrónica.

Se eligió Facturama sobre otras opciones (Facturapi, etc.) porque para el
volumen bajo de un restaurante chico sale más barato: el módulo de API cuesta
$1,650 MXN **al año** (no al mes) más $0.50 MXN por factura timbrada — contra
$299 MXN/mes de otras opciones. Ver la cotización para la comparación completa.

No hay base de datos propia: Facturama guarda la lista de clientes/receptores
por nosotros. Este proyecto solo es un formulario + un servidor chiquito que
llama a su API (las credenciales nunca pueden vivir en el navegador, por eso
hace falta el servidor).

## Modo simulación (activado por default)

Mientras no exista la cuenta de Facturama, el panel corre en **modo
simulación**: el flujo completo funciona igual (buscar/agregar cliente,
capturar monto, generar) pero nada se conecta a Facturama.

- Los clientes y las facturas se guardan en `data/simulation.json` (se crea
  solo, no se sube a git).
- Sí se genera un PDF real y descargable — pero con una marca de agua roja
  bien visible de **"SIMULACIÓN — NO VÁLIDO FISCALMENTE"** y una nota al pie
  explicándolo, para que nadie lo confunda con una factura de verdad.
- No se manda ningún correo, aunque el cliente tenga uno capturado.
- El folio sale como `SIM-0001`, `SIM-0002`, etc., para que sea obvio que no
  es un folio real del SAT.

Para apagarlo el día que ya tengas cuenta de Facturama: pon
`SIMULATION_MODE=false` en `.env` y completa las variables de Facturama de
abajo.

## Lo que falta hacer ANTES de usarlo de verdad (fuera de código)

1. Crear una cuenta en [facturama.mx](https://facturama.mx/) y contratar el
   módulo de API ($1,650 MXN/año).
2. Dar de alta el RFC de SABORES y subir su CSD (Certificado de Sello
   Digital) — esto se hace en el dashboard de Facturama, con el `.cer` y
   `.key` del negocio y su contraseña. **No es el mismo certificado que un
   FIEL de persona física** — si SABORES no tiene CSD propio, se tramita en
   el portal del SAT (Trámites > Certificado de sello digital).
3. Sacar las credenciales de API (usuario y contraseña, no es una sola
   llave) desde Configuración > Credenciales de API.
4. Confirmar el código postal del domicilio fiscal de SABORES (está en su
   Constancia de Situación Fiscal) — el SAT lo pide como "lugar de
   expedición" en cada factura.
5. Decidir quién en el restaurante va a capturar las ventas y con qué
   frecuencia (¿cada venta al momento, o al final del día con la suma de
   tickets?) — el panel no sabe nada de las ventas si no se le captura.

## Instalación local

```bash
npm install
cp .env.example .env
# Edita al menos PANEL_PASSWORD y SESSION_SECRET — con SIMULATION_MODE=true
# (el default) no hace falta nada de Facturama todavía.
npm start
```

Abre `http://localhost:3000`. Arranca en modo simulación por default (ver
arriba); cuando ya tengas cuenta de Facturama, pon `SIMULATION_MODE=false` y
completa sus credenciales — por default corre contra su ambiente de pruebas
(`apisandbox.facturama.mx`, no timbra ante el SAT de verdad) hasta que
cambies `FACTURAMA_LIVE=true`.

## Cómo se usa

1. Entra con la contraseña del panel.
2. Captura el monto de la venta.
3. Indica si el IVA va incluido en ese monto, se suma aparte, o está exento.
4. Busca al cliente por nombre o RFC (mínimo 4 letras). Si no existe, dale a
   **"+ Agregar cliente nuevo"** y captura sus datos fiscales una sola vez —
   la próxima vez ya aparece en la búsqueda.
5. Genera la factura. Si el cliente tiene correo, se le puede enviar el PDF
   automáticamente.

## Cosas para revisar antes de usarlo en producción

- **Esto no se ha podido probar contra una cuenta real de Facturama** (no
  existía una al armar el código) — se construyó siguiendo su documentación
  pública (`apisandbox.facturama.mx/Docs`), pero en cuanto tengas
  credenciales, genera una factura de prueba en modo sandbox y revisa:
  - Que el endpoint de envío por correo (`emailInvoice` en `facturama.js`)
    funcione — sus parámetros no quedaron 100% claros en la documentación
    pública; si falla, el panel lo ignora silenciosamente y la factura se
    genera igual, solo no se manda el correo.
  - Que la respuesta de "generar factura" traiga el folio y el link de
    verificación en los campos que se están leyendo (`invoice.Folio`,
    `invoice.VerificationUrl` en `server.js`) — si Facturama los nombra
    distinto, ajusta esas dos líneas.
- El código de producto usado por default es `90101501` (Restaurantes) del
  catálogo del SAT — ajústalo en `server.js` (`buildInvoiceItem`) si tu
  giro específico necesita otro.
- Las sesiones viven en memoria del servidor (`express-session` sin store
  externo) — perfecto para un solo servidor siempre encendido; si algún día
  se reinicia el proceso, todos tienen que volver a iniciar sesión. Para
  este uso (una contraseña compartida, bajo volumen) es más que suficiente.
- Este proyecto no debe desplegarse en el mismo hosting que el sitio
  público de Sabores ni compartir dominio sin pensarlo — es una
  herramienta de dinero/fiscal, mantenla en su propia URL privada.

## Acceso solo desde computadora

El panel está destinado a PC/laptop con una ventana de al menos 768 px.
Express revisa el User-Agent antes del login, el HTML y la API: teléfonos y
tabletas reciben una pantalla propia de SABORES (HTTP 403), sin contraseña
ni formulario de factura. La API responde 403 con un mensaje JSON. Las hojas
de estilo y el detector siguen disponibles para mostrar el bloqueo.
Las vistas de login y facturación también revisan el User-Agent y el ancho,
actualizan el bloqueo al redimensionar y detienen envíos de formularios.
CSS conserva el bloqueo por ancho aunque JavaScript esté desactivado.

La detección es una restricción de uso, no una prueba de identidad del dispositivo:
un User-Agent puede falsificarse y el servidor no conoce el viewport. Un teléfono
que anuncie un agente de escritorio puede eludir la parte del servidor; la
comprobación del navegador cubre el ancho y algunos iPad con agente de escritorio.
El bloqueo por ancho también aplica a una ventana pequeña en una computadora.

### Verificación reproducible

Sin copiar ni leer `.env`, arrancar con valores temporales de ejemplo:

```bash
SIMULATION_MODE=true PANEL_PASSWORD=cambia-esta-contrasena SESSION_SECRET=cambia-este-secreto-de-sesion PORT=3000 npm start
```

En otra terminal:

```bash
curl -i -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' http://localhost:3000/login.html
curl -i -A 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' http://localhost:3000/index.html
```

Ambas respuestas deben ser 403 y contener «Solo disponible en computadora»,
sin `invoice-form` ni `name="password"`. La petición de escritorio a
`/login.html` debe devolver 200 con el formulario de contraseña.

`npm test` ejecuta los manejadores reales de Express sin sockets: bloqueo con
agentes iPhone/Android/iPad, acceso de escritorio, contraseña correcta e incorrecta,
logout, creación/búsqueda de cliente, factura simulada y descarga de un PDF.
El almacenamiento de simulación se sustituye por memoria; no toca
`data/simulation.json`. También ejecuta el detector en un contexto JavaScript
con viewport simulado de 767/768 px y cambio de tamaño. No renderiza CSS ni
sustituye una prueba visual en un navegador real.

Verificado con curl real contra el servidor levantado en local: agente iPhone
a `/login.html` devuelve 403 con la pantalla «Solo disponible en computadora»
(no el formulario de contraseña), y la petición de escritorio al mismo path
devuelve 200 normal. Pendiente solo la prueba visual en un teléfono físico.
