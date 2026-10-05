/* Catálogos cortos del SAT — solo las opciones que de verdad se usan en un
   restaurante. La lista completa tiene decenas de códigos; no tiene caso
   mostrárselos todos a quien está capturando una venta. */

const REGIMENES_FISCALES = [
  { value: '616', label: '616 · Sin obligaciones fiscales' },
  { value: '605', label: '605 · Sueldos y salarios' },
  { value: '626', label: '626 · Régimen Simplificado de Confianza (RESICO)' },
  { value: '612', label: '612 · Actividades empresariales y profesionales' },
  { value: '621', label: '621 · Incorporación Fiscal' },
  { value: '601', label: '601 · General de Ley Personas Morales' },
  { value: '603', label: '603 · Personas Morales sin fines de lucro' },
];

const USOS_CFDI = [
  { value: 'G03', label: 'G03 · Gastos en general' },
  { value: 'G01', label: 'G01 · Adquisición de mercancías' },
  { value: 'P01', label: 'P01 · Por definir' },
];

const FORMAS_PAGO = [
  { value: '01', label: 'Efectivo' },
  { value: '04', label: 'Tarjeta de crédito' },
  { value: '28', label: 'Tarjeta de débito' },
  { value: '03', label: 'Transferencia' },
  { value: '99', label: 'Por definir' },
];
