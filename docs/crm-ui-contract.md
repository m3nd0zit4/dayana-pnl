# Contrato de UI del CRM

Diez reglas. Existen porque el panel creció sección a sección y cada una
resolvió los mismos problemas a su manera: había cinco formas de enlazar a la
página pública, cuatro de colocar el botón Guardar, cinco de decir «esto falló»
y veinte de decir «no hay nada aquí».

**Estas reglas son verificables.** `e2e/crm-contract.spec.ts` las comprueba en
las 15 rutas del CRM que funcionan en modo vista previa, y `bun run
check:tokens` caza la deriva de color que un navegador no puede detectar. Si
cambias una regla, cambia también su test.

---

## R1 · Marco de página

Toda ruta del CRM es exactamente esto:

```tsx
<CrmPageShell>
  <CrmPageHeader … />   {/* siempre el primer hijo */}
  …bloques…
</CrmPageShell>
```

`CrmPageShell` pone el ancho máximo y el ritmo vertical. No los pongas tú.

| `width` | Ancho | Cuándo |
|---|---|---|
| `default` | `max-w-6xl` | Listas y detalles. Es el defecto. |
| `narrow` | `max-w-3xl` | Páginas que son solo un formulario. |
| `full` | sin límite | Solo layouts de dos paneles (bandeja de entrada). |

Ritmo vertical: `space-y-6` lo pone el shell. Dentro de una `Card`, `space-y-4`.
Nada más.

**Un solo `<h1>` por ruta, y lo pinta `CrmPageHeader`.** Nunca escribas uno a
mano.

## R2 · Cabecera

Una sola disposición, sin variantes:

- Alineación `items-start`. No `items-end` ni `items-center`: se rompen en
  cuanto hay descripción, y la descripción es lo normal.
- Izquierda, en orden: enlace volver → `<h1>` → descripción.
- Derecha, en orden: `secondaryActions` → `action`.

**La acción primaria vive en la columna derecha de la cabecera, y en ningún
otro sitio.** Usa `CrmNewButton`, que ya lleva el marcador
`data-crm-primary-action`. Cualquier cosa que no cree algo — refrescar, marcar
todo como leído, previsualizar — va en `secondaryActions`.

## R3 · Volver, no breadcrumbs

No hay sistema de breadcrumbs y no se va a construir: la profundidad de rutas
es ≤2 y el sidebar ya dice en qué sección estás.

Pasa `backHref` y `backLabel` a `CrmPageHeader`. Un solo estilo.

## R4 · Enlace a la página pública

Un componente, `CrmPublicLink`, tres densidades:

| `density` | Forma | Dónde |
|---|---|---|
| `page` | botón con etiqueta visible | `secondaryActions` de la cabecera |
| `row` | solo icono, con `aria-label` y `title` | dentro de `CrmRowActions` |
| `chrome` | solo icono | barra superior |

**A nivel de página nunca solo icono.** Si la acción merece estar en la
cabecera, merece un nombre.

- `copy` añade copiar la URL al portapapeles.
- `disabledReason` para cuando la página pública daría 404 (webinar apagado,
  taller sin publicar): el botón se muestra deshabilitado explicando por qué,
  en vez de llevar a un error.

## R5 · Acciones de formulario

`CrmFormActions` siempre: alineado a la derecha, primario el último.

- **Modal:** Cancelar → Guardar.
- **Formulario de página:** igual, al final.
- **Formulario en Card:** igual, `size="sm"`.

En móvil se apila con `flex-col-reverse`, así el primario queda arriba — donde
llega el pulgar.

## R6 · Acciones de fila

Solo icono, `variant="ghost" size="icon-sm"`, siempre con `aria-label` **y**
`title`.

Orden fijo: **previsualizar → propias → editar → eliminar.** Eliminar siempre
el último, lejos de donde el dedo va por inercia.

No hay menú de desbordamiento «…». No lo añadas.

## R7 · Destructivo

Dos contextos, dos tratamientos:

- **Fila:** `CrmRowDelete` — ghost con texto destructivo. La variante
  `destructive` del botón es un relleno suave, y a densidad de fila diez filas
  se leen como diez errores.
- **Confirmación:** el relleno sí, vía `confirm({ destructive: true })`.

**Pasa siempre `confirmLabel` con el verbo real.** «Eliminar», «Revocar»,
«Quitar». «Confirmar» obliga a releer el título para saber qué vas a hacer.

## R8 · Listas

`CrmDataList` + `CrmDataListRow`. Cada celda lleva su anchura (`sm:w-40`), de
modo que las columnas quedan alineadas en pantalla ancha y se apilan solas en
móvil.

`<Table>` sobrevive únicamente en `EnrollmentDetailClient` y
`ActiveSessionsTable`: datos genuinamente tabulares sin versión móvil aparte.

**Nunca envíes la lista dos veces** — una tabla para `lg` y tarjetas para
móvil. Paquetes y Códigos lo hacían y las dos copias ya habían divergido.

## R9 · Vacío, carga, error, éxito

| Estado | Componente |
|---|---|
| Vacío | `CrmEmptyState` |
| Cargando | `CrmLoadingState` (esqueletos, nunca «Cargando…») |
| Error | `CrmErrorState` con `onRetry` cuando se pueda reintentar |
| Aviso | `<Alert variant="warning">` |
| Error de campo | `<p className="text-sm text-destructive" role="alert">` |
| **Éxito** | **siempre toast** |

Nunca texto verde en línea para el éxito.

## R10 · Paginación, pestañas, filtros

- **Paginación:** `CrmLoadMore`. Un solo estilo.
- **Pestañas:** `CrmSegmentedControl`. Ni `Tabs` crudo ni `role="tablist"` a
  mano.
- **Filtros:** `CrmFilterBar` — búsqueda primero, luego selects, recuento a la
  derecha. **Se filtra al cambiar, sin botón de enviar.**

---

## Colores

Solo tokens. `bun run check:tokens` falla si añades un color escrito a mano en
`app/components/admin/crm/**` o `app/components/miembros/**`.

| En vez de | Usa |
|---|---|
| `text-[#b4543a]`, `text-red-700` | `text-destructive` |
| `text-emerald-700`, `bg-green-100` | `text-success`, `bg-success/10` |
| `bg-amber-100`, `text-amber-700` | `bg-warning/10`, `text-warning` |
| `text-black/55` | `text-muted-foreground` |
| `bg-white/80` | `bg-card` |
| `bg-neutral-200` | `bg-muted` |

El checker corre con una línea base (los casos previos que quedan en el panel
del agente, la bandeja y el portal). **Ese número solo puede bajar.**

---

## Marcadores para los tests

Los primitivos los ponen solos. Si construyes algo a mano que ocupe su lugar,
tendrás que ponerlos tú — o mejor, usa el primitivo.

| Atributo | Lo pone |
|---|---|
| `data-crm-page` | `CrmPageShell` |
| `data-crm-page-header` | `CrmPageHeader` |
| `data-crm-primary-action` | `CrmNewButton` |
| `data-crm-public-link` | `CrmPublicLink` |
| `data-crm-empty` | `CrmEmptyState` |
| `data-crm-form-actions` | `CrmFormActions`, `CrmConfirmDialog` |

## Excepciones

`/admin` (el panel de inicio) está en `CONTRACT_EXEMPT`. No es una página de
lista: su `<h1>` es un saludo centrado sobre el cuadro del agente. Meterlo en
`CrmPageHeader` no lo haría más consistente, lo convertiría en otra pantalla.

Añadir algo a esa lista exige explicar por qué la regla no aplica — no basta
con que falle.

## Cobertura

- **Tier A (15 rutas)** — funcionan con `CRM_UI_PREVIEW=true` sin base de
  datos. El contrato se comprueba en cada PR.
- **Tier B (12 rutas)** — detalle de contacto e inscripción, bandeja de
  entrada, contenido y todo `ajustes`. Necesitan sesión real, así que hoy no
  tienen cobertura automática: **revísalas a mano** al tocarlas.
