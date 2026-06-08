/** Datos de ejemplo solo para CRM_UI_PREVIEW (sin DB). */
export const PREVIEW_CONTACTS = [
  {
    id: "preview-1",
    firstName: "María",
    lastName: "González",
    phoneE164: "+34612345678",
    enrollments: [{ product: { title: "Terapia 6 sesiones" } }],
  },
  {
    id: "preview-2",
    firstName: "Ana",
    lastName: "Restrepo",
    phoneE164: "+573101234567",
    enrollments: [
      { product: { title: "Taller virtual" } },
      { product: { title: "Curso en vivo" } },
    ],
  },
  {
    id: "preview-3",
    firstName: "Laura",
    lastName: "Martínez",
    phoneE164: "+12025550199",
    enrollments: [{ product: { title: "Terapia 1 sesión" } }],
  },
] as const;
