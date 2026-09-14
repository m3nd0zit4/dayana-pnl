# Contrato de UI del CRM

Diez reglas. Existen porque el panel creció sección a sección y cada una
resolvió los mismos problemas a su manera: había cinco formas de enlazar a la
página pública, cuatro de colocar el botón Guardar, cinco de decir «esto falló»
y veinte de decir «no hay nada aquí».

**Estas reglas son verificables.** `e2e/crm-contract.spec.ts` las comprueba en
las 17 rutas del CRM que funcionan en modo vista previa, y `bun run
check:tokens` caza la deriva de color que un navegador no puede detectar. Si
cambias una regla, cambia también su test.

**Y hay un criterio por encima de todas: menos botones, misma utilidad.** Quien
usa el panel es Dayana, desde el teléfono y desde el computador. Cada pantalla
tiene una sola acción principal; lo que se usa a diario está a la vista y lo
que se usa de vez en cuando está a un toque (una hoja de filtros, un bloque
plegado, el detalle). Antes de añadir un botón, pregunta dónde vive ya esa
acción.

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
mano. Vale también para Inicio: su `<h1>` es el saludo.

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

«Crear» incluye registrar: en Pagos y en la ficha del contacto la primaria es
«Registrar pago».

**Pestañas en un detalle:** las pestañas (`CrmSegmentedControl`) van en
`trailing`, dentro de la cabecera. Junto a ellas se admite **una** acción
propia de la pestaña activa (p. ej. «Agregar servicio» en Servicios y pagos),
como botón normal, no como primaria.

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

**Detalles en lectura primero.** Una ficha abre mostrando los datos; el
formulario aparece al pulsar «Editar», y eliminar vive dentro de ese modo, no
en la vista por defecto.

### El campo se escribe con `CrmField`, no a mano

```tsx
<CrmField label="Título" description="Sale en la tarjeta." error={errors.title}>
  <Input value={title} onChange={…} />
</CrmField>
```

Envuelve `Field` de Base UI, que ya venía instalado y no se usaba. Da tres
cosas que a mano se olvidan:

- **El enlace etiqueta↔control sin `id` a mano.** El panel llegó a tener
  sesenta copias del bloque `<div><Label/><Input/><p/></div>`, y basta que un
  `htmlFor` no cuadre para que la etiqueta deje de leerse con lector de
  pantalla.
- **El hueco de error del campo**, que es el `role="alert"` que pide R9 más
  abajo — ya no depende de que quien escribe la pantalla se acuerde.
- **`data-dirty` / `data-invalid` / `data-touched` en el DOM**, de donde sale
  «hay cambios sin guardar» sin llevar la cuenta a mano.

Para agrupar, `CrmFieldset`: los `border-t` con un `<p>` de título agrupaban
sólo de forma visual y para un lector de pantalla los campos quedaban sueltos.

Las pantallas anteriores siguen a mano. Se migran cuando se toquen, no en una
barrida.

## R6 · Acciones de fila

Solo icono, `variant="ghost" size="icon-sm"`, siempre con `aria-label` **y**
`title`. **Como mucho tres por fila**; la fila entera es el enlace al detalle,
así que «Ver»/«Gestionar» no es una acción.

Orden fijo: **previsualizar → propias → editar → eliminar.** Eliminar siempre
el último, lejos de donde el dedo va por inercia.

No hay menú de desbordamiento «…». No lo añadas: si una fila necesita más de
tres acciones, las que sobran van al detalle o a un diálogo que las agrupe
(p. ej. «Acceso al portal» en Membresías agrupa invitar y generar contraseña).

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

### Rejilla de tarjetas — la tercera forma, y la única excepción

Se admite una rejilla en lugar de `CrmDataList` cuando **la fila ES lo que la
clienta ve**: la pantalla no lista registros, lista las tarjetas publicadas, y
enseñarlas como filas obligaría a mirar la web en otra pestaña para saber qué
se está tocando. Hoy sólo la cumple **Paquetes** (`/admin/products`).

Marcador: `data-crm-card-grid` en el contenedor.

Las condiciones no son negociables, y existen porque la tarjeta pública y el
panel dicen cosas distintas:

- **Se renderiza el componente público de verdad**, nunca una imitación. En
  Paquetes es `PublicProductCard`, el mismo que sirven `/pagar/<token>` y el
  resultado del diagnóstico. Una copia dibujada aparte se desincroniza en el
  primer cambio de estilo y a partir de ahí miente justo al publicar.
- **Lo que es verdad del CRM va FUERA de la tarjeta.** El estado de
  visibilidad, el aviso de sincronización de precio, las acciones de fila: la
  clienta no debe verlos nunca, y perderlos sería perder el único sitio donde
  se lee que un precio quedó sin propagar.
- **El fondo es el de la web** (`bg-hero-paper`), no el del panel: una tarjeta
  de papel crema se lee distinta sobre el gris del CRM, y la pregunta que
  responde esta pantalla es «¿cómo se ve publicada?».
- Vacío, carga y error siguen siendo los de R9. La rejilla sustituye a la
  lista, no a sus estados.

**Se admite un segundo modo, «compacta», y sólo bajo estas reglas.** Dieciséis
paquetes en tamaño publicado son cuatro pantallas de scroll: para responder
«¿cuál toco?» hay que recorrerlas todas, que es exactamente lo que la rejilla
venía a evitar. El modo compacto reduce cada celda a título, línea de sesiones,
precio y estado.

- **«Publicada» sigue existiendo y es la que manda.** El interruptor va en la
  cabecera, junto al de moneda, y el modo compacto no puede ser el único: la
  pregunta «¿cómo se ve publicada?» tiene que poder contestarse sin salir.
- **La compacta no imita la tarjeta.** Es una celda del panel con sus propios
  tokens; no copia el papel crema ni el vocabulario de color de
  `PublicProductCard`. Una imitación a media escala es justo la copia que el
  punto de arriba prohíbe.
- **El editor sigue enseñando la tarjeta de verdad**, dentro del panel lateral
  y viva mientras se escribe. Ahí es donde se cumple «se renderiza el
  componente público»: al abrir una celda compacta se ve la tarjeta publicada.

Si aparece una segunda pantalla que quiera esto, se justifica igual o se queda
en `CrmDataList`. «Se ve mejor» no basta.

## R9 · Vacío, carga, error, éxito

| Estado | Componente |
|---|---|
| Vacío | `CrmEmptyState` |
| Cargando | `CrmLoadingState` (esqueletos, nunca «Cargando…») |
| Error | `CrmErrorState` con `onRetry` cuando se pueda reintentar |
| Aviso | `<Alert variant="warning">` |
| Error de campo | `CrmField error="…"` — lo pinta él (`role="alert"`, ver R5) |
| **Éxito** | **siempre toast** |

Nunca texto verde en línea para el éxito. Y una explicación se dice una vez:
si ya está en la descripción de la cabecera, no se repite en un aviso debajo.

## R10 · Paginación, pestañas, filtros

- **Paginación:** `CrmLoadMore`. Un solo estilo.
- **Pestañas:** `CrmSegmentedControl`. Ni `Tabs` crudo ni `role="tablist"` a
  mano.
- **Filtros:** `CrmFilterBar` — búsqueda primero, luego filtros, recuento a la
  derecha. **Se filtra al cambiar, sin botón de enviar.**
  - **A la vista, como mucho dos filtros**: los que son destino de un aviso de
    «Para hoy» (p. ej. «Sin identificar» en Pagos).
  - **El resto va en `CrmFilterSheet`**: un botón «Filtros» con el número de
    filtros puestos, que abre una hoja (desde abajo en móvil, desde la derecha
    en escritorio) con «Limpiar filtros». Exportar lo filtrado va en el pie de
    esa hoja, no en la cabecera.

---

## Navegación

El menú, el grupo plegado y la barra inferior del móvil salen de
`app/config/crm-menu-items.ts`. Nada de listas de enlaces escritas a mano en
otro sitio.

- **Cada entrada tiene un `id` estable.** Lo que necesite una entrada concreta
  la busca con `findMenuItem(id)`, nunca por el título del grupo.
- **Grupos por uso diario:** Ventas, Personas, Clases. Lo que se usa poco va
  en **Herramientas** (`collapsible: true`), plegado por defecto y abierto solo
  cuando la página actual es suya.
- **Barra inferior (móvil):** `CRM_BOTTOM_TABS` — Inicio, Contactos, Pagos — y
  «Más», que abre el menú completo. Es el único botón que abre el menú en el
  móvil.
- **Sin duplicados de chrome:** la web pública se abre desde el icono de la
  barra superior; la cuenta propia, desde Ajustes. Una sola búsqueda por
  pantalla (en Contactos la de la página sustituye a la de la barra).

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
| `data-crm-filter-bar` | `CrmFilterBar` |

## Excepciones

Ninguna. Inicio estuvo exento mientras su saludo era un `<h1>` suelto; desde
que la portada abre con `CrmPageHeader` (saludo y fecha) cumple el contrato
como las demás.

Añadir algo a `CONTRACT_EXEMPT` exige explicar por qué la regla no aplica — no
basta con que falle.

## Cobertura

- **Tier A (17 rutas)** — funcionan con `CRM_UI_PREVIEW=true` sin base de
  datos. El contrato se comprueba en cada PR.
- **Tier B (12 rutas)** — detalle de contacto e inscripción, bandeja de
  entrada, contenido y todo `ajustes`. Necesitan sesión real, así que hoy no
  tienen cobertura automática: **revísalas a mano** al tocarlas.
- **Vista previa = solo lectura.** En preview nadie tiene rol de escritura, así
  que los botones de crear y registrar no se pintan. Lo que depende de permisos
  (Registrar pago, Editar, Nuevo miembro) hay que revisarlo con sesión real.
