import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ReceiptData } from "./data";

/**
 * El recibo, como documento.
 *
 * Se genera en el servidor con `@react-pdf/renderer` y no con un navegador sin
 * cabeza: Puppeteer en serverless es caro de arrancar y frágil de mantener, y
 * un recibo es una página de texto con una tabla — no necesita un motor de
 * render entero.
 *
 * **No dice «factura» en ninguna parte.** No es un documento fiscal: no lleva
 * NIT, ni resolución de la DIAN, ni numeración autorizada. Llamarlo factura
 * sería afirmar algo que no es, y quien lo lleve a su contabilidad creyendo que
 * lo es se encontraría el problema meses después. Es un comprobante de pago, y
 * eso es exactamente lo que dice.
 *
 * Los colores van escritos a mano y no como tokens porque el PDF no tiene CSS
 * ni tema: son los valores de DESIGN.md en su versión clara, que es la única
 * que existe sobre papel.
 */

const COLORS = {
  ink: "#141210",
  muted: "#6f655c",
  line: "#e2d9cc",
  brand: "#5c4a3a",
  surface: "#fffcf8",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 16,
  },
  brandName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: COLORS.brand },
  brandLine: { fontSize: 9, color: COLORS.muted, marginTop: 3 },
  docLabel: {
    fontSize: 8,
    letterSpacing: 1.4,
    color: COLORS.muted,
    textAlign: "right",
  },
  docNumber: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    marginTop: 4,
  },
  docDate: { fontSize: 9, color: COLORS.muted, textAlign: "right", marginTop: 3 },

  section: { marginTop: 26 },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: COLORS.muted,
    marginBottom: 7,
  },
  strong: { fontFamily: "Helvetica-Bold" },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  rowLabel: { color: COLORS.muted },
  rowValue: { textAlign: "right", maxWidth: "62%" },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: COLORS.brand,
  },
  totalLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  totalValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: COLORS.brand },

  note: {
    marginTop: 30,
    fontSize: 8,
    color: COLORS.muted,
    lineHeight: 1.5,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: COLORS.muted,
    textAlign: "center",
  },
});

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

export const ReceiptDocument = ({ data }: { data: ReceiptData }) => (
  <Document
    title={`Comprobante de pago ${data.receiptNumber}`}
    author={data.emitter.name}
    subject={data.concept}
  >
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brandName}>{data.emitter.name}</Text>
          <Text style={styles.brandLine}>{data.emitter.email}</Text>
          <Text style={styles.brandLine}>{data.emitter.site}</Text>
        </View>
        <View>
          <Text style={styles.docLabel}>COMPROBANTE DE PAGO</Text>
          <Text style={styles.docNumber}>{data.receiptNumber}</Text>
          <Text style={styles.docDate}>{data.paidAtLabel}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PAGADO POR</Text>
        <Text style={styles.strong}>{data.payer.name}</Text>
        {data.payer.email ? (
          <Text style={{ color: COLORS.muted, marginTop: 3 }}>
            {data.payer.email}
          </Text>
        ) : null}
        {data.payer.countryIso ? (
          <Text style={{ color: COLORS.muted, marginTop: 3 }}>
            País: {data.payer.countryIso}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DETALLE</Text>
        <Row label="Concepto" value={data.concept} />
        {data.sessions ? (
          <Row label="Sesiones incluidas" value={String(data.sessions)} />
        ) : null}
        <Row label="Medio de pago" value={data.method} />
        <Row label="Referencia del proveedor" value={data.providerReference} />
        <Row label="Moneda" value={data.currency} />
        {/* La comisión sólo aparece si el proveedor la reportó. Un «0» donde no
            hay dato diría que la pasarela no cobró nada, que casi nunca es
            cierto. */}
        {data.feeLabel ? (
          <Row
            label="Comisión de la pasarela"
            value={`${data.feeLabel} ${data.currency}`}
          />
        ) : null}
        {data.netLabel ? (
          <Row label="Neto recibido" value={`${data.netLabel} ${data.currency}`} />
        ) : null}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total pagado</Text>
          <Text style={styles.totalValue}>
            {data.totalLabel} {data.currency}
          </Text>
        </View>
      </View>

      <Text style={styles.note}>
        Este documento es un comprobante del pago recibido y no constituye una
        factura ni un documento tributario. Si necesitas facturación, escríbenos
        a {data.emitter.email} indicando el número de este comprobante.
      </Text>

      <Text style={styles.footer} fixed>
        {data.emitter.name} · {data.emitter.site} · Comprobante{" "}
        {data.receiptNumber}
      </Text>
    </Page>
  </Document>
);

/** El PDF ya renderizado, listo para servir o adjuntar. */
export const renderReceiptPdf = async (data: ReceiptData): Promise<Buffer> =>
  renderToBuffer(<ReceiptDocument data={data} />);

/** Nombre con el que se descarga o se adjunta. */
export const receiptFilename = (receiptNumber: string): string =>
  `${receiptNumber}.pdf`;
