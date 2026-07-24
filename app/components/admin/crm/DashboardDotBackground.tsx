/**
 * Generic decorative dot-grid texture behind the dashboard hero — evokes the
 * same "subtle background pattern" role as Shopify's world-map graphic
 * without tracing their specific (copyrighted) illustration. Pure CSS radial
 * gradient, masked to fade out toward the edges so it reads as ambient
 * texture, not a literal image.
 */
const DashboardDotBackground = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    style={{
      backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
      backgroundSize: "18px 18px",
      maskImage: "radial-gradient(ellipse 60% 60% at 50% 30%, black 0%, transparent 75%)",
      WebkitMaskImage: "radial-gradient(ellipse 60% 60% at 50% 30%, black 0%, transparent 75%)",
    }}
  />
);

export default DashboardDotBackground;
