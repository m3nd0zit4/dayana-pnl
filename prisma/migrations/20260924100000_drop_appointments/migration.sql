-- La agenda propia se retira: las citas se toman en la página de citas de
-- Google Calendar de Dayana, no en el sitio. La tabla nunca llegó a tener
-- filas en producción.
DROP TABLE IF EXISTS "appointments";
DROP TYPE IF EXISTS "AppointmentStatus";
